import "server-only";
/**
 * 상차등록 처리 — 화주사 상차담당(PDA). 지시 상차 시작·무지시 상차 시작·추가수량 입력·본인 입력 취소·정정·상차완료.
 * 근거: 정의서 v1.4 ④ · 4-2 · 9장 · C5 · C6 · D10~D13
 * 처리자를 인자로 받아 서버 액션(actions.ts)과 점검 스크립트가 같은 규칙을 쓴다.
 *
 * - 작업자 잠금 없음(D11): 같은 차량을 여러 작업자가 동시에 입력한다. 입력은 실적 행을 잠근 뒤 한 줄씩 쌓는다.
 * - 품목 차단(C5·D10): 같은 화주사·같은 센터의 당일 ASN 품목만. 지시수량 초과·지시 외 품목은 경고 후 확인하면 받는다.
 * - 상차완료(C6): 차량당 1회. 확인 화면에서 본 마지막 입력 id가 바뀌었으면 막는다. ASN 대비 차이가 있으면 사유 필수.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { fail, type ActionResult } from "@/server/action-result";
import type { PlanActor } from "@/server/plans/service";
import { asDate, canLoad, todayAsnItemIds } from "@/server/loads/queries";
import { LOAD_DIFF_GROUP, type ItemUnit } from "@/domain/master";
import { docNoPrefix, looksLikeVehicleNo, nextDocNo, normalizeVehicleNo } from "@/domain/asn-rules";
import {
  LOADABLE_ASN,
  LOAD_CONFLICT_MSG,
  LOAD_DONE_MSG,
  LOAD_PREFIX,
  addQtyError,
  hasLoadDiff,
  normalizeDocNo,
  normalizeScan,
  overWarning,
  qtyInUnit,
} from "@/domain/load-rules";
import { todayKst } from "@/lib/format";
import type { ScanPreview } from "@/features/loads/types";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

const ok = <T>(message: string, data?: T): ActionResult<T> => ({ ok: true, message, data });
const forbidden = () => fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
const notFound = () => fail("NOT_FOUND", "상차 실적을 찾을 수 없습니다. 첫 화면에서 다시 시작하세요.");

async function guarded<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return fail("CONFLICT", "다른 작업자가 같은 차량을 동시에 시작했습니다. 다시 스캔하세요.");
    console.error(e);
    return fail("ERROR", "처리하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

async function nextLoadNo(tx: Tx, today: string) {
  const used = await tx.load.findMany({ where: { loadNo: { startsWith: docNoPrefix(LOAD_PREFIX, today) } }, select: { loadNo: true } });
  return nextDocNo(LOAD_PREFIX, today, used.map((u) => u.loadNo));
}

/** 실적 행을 잠근다 — 같은 차량 입력·상차완료를 줄 세운다 */
async function lockLoad(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM tb_load_h WHERE id = ${id} FOR UPDATE`;
  return tx.load.findUnique({ where: { id } });
}

/* ═════════ 지시 상차 시작 — 상차지시서 바코드 스캔 ═════════ */

export async function startOrderedLoad(me: PlanActor, input: { orderNo: string }): Promise<ActionResult<{ loadId: number; notice?: string }>> {
  if (!canLoad(me)) return forbidden();
  const orderNo = normalizeDocNo(input.orderNo ?? "");
  if (!orderNo) return fail("VALIDATION", "상차지시서 바코드를 스캔하세요.", { orderNo: "상차지시서 바코드를 스캔하세요." });
  const today = todayKst();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const lo = await tx.loadOrder.findUnique({ where: { orderNo }, include: { asn: { include: { lines: true } }, load: true } });
      // 다른 화주사 지시서도 "찾을 수 없음"으로 답한다 (있는지 드러내지 않는다)
      if (!lo || lo.asn.clientId !== me.clientId) return fail("NOT_FOUND", `상차지시서 ${orderNo}을(를) 찾을 수 없습니다. 바코드를 다시 스캔하거나 번호를 확인하세요.`);
      if (lo.status === "CANCELED") return fail("STATE", `취소된 상차지시서입니다(${orderNo}). 화주사 담당자에게 새 지시서를 받으세요.`);
      if (lo.load) {
        if (lo.load.status === "COMPLETED") return ok("이미 상차완료된 차량입니다.", { loadId: lo.load.id, notice: LOAD_DONE_MSG });
        return ok("작업 중인 차량에 함께 들어갑니다.", { loadId: lo.load.id });
      }
      if (!(LOADABLE_ASN as readonly string[]).includes(lo.asn.status)) return fail("STATE", "상차를 받을 수 없는 ASN입니다.");

      // 품목별 지시수량(기준 단위)을 미리 만들어 둔다 — 화면에 지시수량과 상차 합계를 함께 보여 준다
      const order = new Map<number, number>();
      for (const l of lo.asn.lines) order.set(l.itemId, (order.get(l.itemId) ?? 0) + l.baseQty);
      const load = await tx.load.create({
        data: {
          loadNo: await nextLoadNo(tx, today),
          loadType: "ORDERED",
          loadOrderId: lo.id,
          asnId: lo.asnId,
          clientId: lo.asn.clientId,
          centerId: lo.asn.centerId,
          vehicleNo: lo.asn.vehicleNo,
          loadDate: asDate(today),
          createdBy: me.name,
          lines: { create: [...order].map(([itemId, orderBaseQty]) => ({ itemId, orderBaseQty })) },
        },
      });
      const ship = lo.asn.shipDate.toISOString().slice(0, 10);
      const notice =
        ship < today
          ? `출고일(${ship})이 지난 ASN입니다. 늦게 출발하는 차량이 맞는지 확인하세요.`
          : ship > today
            ? `출고일(${ship})이 오늘이 아닙니다. 미리 싣는 차량이 맞는지 확인하세요.`
            : undefined;
      return ok(`상차를 시작합니다 · ${lo.asn.vehicleNo}`, { loadId: load.id, notice });
    }),
  );
}

/* ═════════ 무지시 상차 시작 — 예정에 없던 차량 (D12) ═════════ */

const unorderedSchema = z.object({
  centerId: z.number({ error: "센터를 선택하세요." }).int().positive("센터를 선택하세요."),
  vehicleNo: z.string().trim().min(1, "차량번호를 입력하세요.").max(20, "차량번호는 20자 이내로 입력하세요."),
  /** 같은 차량번호로 오늘 ASN이 있어도 무지시로 시작한다 */
  force: z.boolean().optional(),
});

export async function startUnorderedLoad(me: PlanActor, input: z.input<typeof unorderedSchema>): Promise<ActionResult<{ loadId: number; notice?: string }>> {
  if (!canLoad(me)) return forbidden();
  const p = unorderedSchema.safeParse(input);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) fe[String(i.path[0] ?? "_")] ??= i.message;
    return fail("VALIDATION", "입력 내용을 확인하세요.", fe);
  }
  const clientId = me.clientId!;
  const vehicleNo = normalizeVehicleNo(p.data.vehicleNo);
  const today = todayKst();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const center = await tx.center.findUnique({ where: { id: p.data.centerId } });
      const linked = center && (await tx.clientCenter.findUnique({ where: { clientId_centerCode: { clientId, centerCode: center.code } } }));
      if (!center || !center.isActive || !linked) return fail("VALIDATION", "이용 중인 센터를 선택하세요.", { centerId: "이용 중인 센터를 선택하세요." });

      // C5: 오늘 ASN 품목만 실을 수 있다 — 오늘 ASN이 하나도 없으면 실을 품목이 없다
      if (!(await todayAsnItemIds(clientId, center.id, today, tx)).size)
        return fail("STATE", `오늘 ${center.name}(으)로 출고하는 ASN이 없어 실을 수 있는 품목이 없습니다. 화주사 담당자가 먼저 ASN을 등록해야 합니다.`);

      // 같은 차량번호로 오늘 상차할 ASN이 있으면 지시 상차로 안내한다 (지시서를 잃어버린 경우 등)
      if (!p.data.force) {
        const same = await tx.asn.findFirst({
          where: { clientId, centerId: center.id, vehicleNo, shipDate: { lte: asDate(today) }, status: { in: [...LOADABLE_ASN] } },
          include: { loadOrder: { select: { orderNo: true } } },
        });
        if (same?.loadOrder)
          return fail("CONFIRM", `${vehicleNo} 차량은 상차할 ASN(${same.asnNo})이 있습니다. 상차지시서 ${same.loadOrder.orderNo}로 지시 상차를 시작하세요.`, {
            orderNo: same.loadOrder.orderNo,
          });
      }

      // 같은 차량을 다른 작업자가 이미 무지시로 시작했으면 함께 들어간다 (D11)
      const working = await tx.load.findFirst({ where: { clientId, centerId: center.id, vehicleNo, loadType: "UNORDERED", status: "WORKING", loadDate: asDate(today) } });
      if (working) return ok("작업 중인 차량에 함께 들어갑니다.", { loadId: working.id });

      const load = await tx.load.create({
        data: { loadNo: await nextLoadNo(tx, today), loadType: "UNORDERED", clientId, centerId: center.id, vehicleNo, loadDate: asDate(today), createdBy: me.name },
      });
      return ok(`무지시 상차를 시작합니다 · ${vehicleNo}`, {
        loadId: load.id,
        notice: looksLikeVehicleNo(vehicleNo) ? undefined : `차량번호(${vehicleNo})가 번호판 모양이 아닙니다. 맞는지 확인하세요.`,
      });
    }),
  );
}

/* ═════════ 스캔 → 품목 찾기 ═════════ */

export type Resolved = { itemId: number; itemCode: string; itemName: string; unit: ItemUnit; factor: number; baseUnit: ItemUnit; by: "barcode" | "code" };

/** 바코드(단위별)로 먼저 찾고, 없으면 품목코드로 찾는다(기준 단위). 같은 화주사 품목만 */
export async function resolveScan(tx: Tx | typeof db, clientId: number, raw: string): Promise<Resolved | null> {
  const scan = normalizeScan(raw);
  if (!scan) return null;
  const bc = await tx.itemBarcode.findUnique({
    where: { clientId_barcode: { clientId, barcode: scan } },
    include: { item: { select: { id: true, code: true, name: true, baseUnit: true } }, uom: { select: { qty: true } } },
  });
  if (bc) return { itemId: bc.item.id, itemCode: bc.item.code, itemName: bc.item.name, unit: bc.unit, factor: bc.uom.qty, baseUnit: bc.item.baseUnit, by: "barcode" };
  const item = await tx.item.findFirst({ where: { clientId, code: { equals: scan, mode: "insensitive" } }, select: { id: true, code: true, name: true, baseUnit: true } });
  if (item) return { itemId: item.id, itemCode: item.code, itemName: item.name, unit: item.baseUnit, factor: 1, baseUnit: item.baseUnit, by: "code" };
  return null;
}

/** 스캔한 품목을 이 차량에 실을 수 있는지 (C5) — 오류 문장 또는 null */
async function blockReason(tx: Tx | typeof db, load: { clientId: number; centerId: number; loadType: string }, orderBase: number, itemId: number, today: string) {
  if (load.loadType === "ORDERED" && orderBase > 0) return null;
  if ((await todayAsnItemIds(load.clientId, load.centerId, today, tx)).has(itemId)) return null;
  return "오늘 ASN에 없는 품목이라 실을 수 없습니다. 실어야 하면 화주사 담당자가 상차 전에 ASN을 추가로 등록해야 합니다.";
}

/** 보여 줄 단위 — 지시 품목이면 ASN 지시 단위, 아니면 스캔한 단위 */
async function showUnitOf(tx: Tx | typeof db, asnId: number | null, orderBase: number, r: Resolved): Promise<{ showUnit: ItemUnit; showFactor: number }> {
  if (asnId && orderBase > 0) {
    const al = await tx.asnLine.findFirst({ where: { asnId, itemId: r.itemId }, select: { unit: true, baseQty: true, qty: true } });
    if (al) return { showUnit: al.unit, showFactor: Math.max(Math.round(al.baseQty / al.qty), 1) };
  }
  return { showUnit: r.unit, showFactor: r.factor };
}

/** 수량을 넣기 전에 스캔한 품목·단위·지금 합계를 보여 준다 */
export async function previewScan(me: PlanActor, input: { loadId: number; scan: string }): Promise<ActionResult<ScanPreview>> {
  if (!canLoad(me)) return forbidden();
  const load = await db.load.findUnique({ where: { id: input.loadId } });
  if (!load || load.clientId !== me.clientId) return notFound();
  if (load.status !== "WORKING") return fail("STATE", LOAD_DONE_MSG);
  const r = await resolveScan(db, load.clientId, input.scan);
  if (!r) return fail("NOT_FOUND", `등록되지 않은 바코드입니다(${normalizeScan(input.scan)}). 품목 바코드를 다시 스캔하세요.`);
  const line = await db.loadLine.findUnique({ where: { loadId_itemId: { loadId: load.id, itemId: r.itemId } } });
  const orderBase = line?.orderBaseQty ?? 0;
  const blocked = await blockReason(db, load, orderBase, r.itemId, todayKst());
  if (blocked) return fail("STATE", `${r.itemName}(${r.itemCode}) — ${blocked}`);
  const { showUnit, showFactor } = await showUnitOf(db, load.asnId, orderBase, r);
  return ok("", { scan: normalizeScan(input.scan), ...r, showUnit, showFactor, orderBase, loadBase: line?.loadBaseQty ?? 0 });
}

/* ═════════ 추가수량 입력 ═════════ */

export interface AddInput {
  loadId: number;
  scan: string;
  qty: number;
  deviceId?: string | null;
  /** 지시 외 품목·지시수량 초과 경고를 보고 확인했다 */
  confirm?: boolean;
}

function warningText(kind: "extra" | "over", r: Resolved, orderBase: number, after: number, showUnit: Resolved["unit"], showFactor: number) {
  const f = (n: number) => qtyInUnit(n, showUnit, showFactor, r.baseUnit);
  return kind === "extra"
    ? `${r.itemName}은(는) 이 차량의 지시 품목이 아닙니다(오늘 다른 ASN 품목). 그래도 싣겠습니까? 상차완료 때 차이 사유를 고릅니다.`
    : `${r.itemName}: 지시 ${f(orderBase)}보다 많아집니다(입력 후 ${f(after)}). 그래도 싣겠습니까? 상차완료 때 차이 사유를 고릅니다.`;
}

export async function addLoadInput(me: PlanActor, input: AddInput): Promise<ActionResult<{ inputId: number }>> {
  if (!canLoad(me)) return forbidden();
  const qtyErr = addQtyError(input.qty);
  if (qtyErr) return fail("VALIDATION", qtyErr, { qty: qtyErr });
  const today = todayKst();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const load = await lockLoad(tx, input.loadId);
      if (!load || load.clientId !== me.clientId) return notFound();
      if (load.status !== "WORKING") return fail("STATE", LOAD_DONE_MSG);
      const r = await resolveScan(tx, load.clientId, input.scan);
      if (!r) return fail("NOT_FOUND", `등록되지 않은 바코드입니다(${normalizeScan(input.scan)}).`, { scan: "등록되지 않은 바코드입니다." });
      const line = await tx.loadLine.findUnique({ where: { loadId_itemId: { loadId: load.id, itemId: r.itemId } } });
      const orderBase = line?.orderBaseQty ?? 0;
      const loadBase = line?.loadBaseQty ?? 0;
      const blocked = await blockReason(tx, load, orderBase, r.itemId, today);
      if (blocked) return fail("STATE", `${r.itemName}(${r.itemCode}) — ${blocked}`);

      const addBase = input.qty * r.factor;
      const warn = overWarning({ ordered: load.loadType === "ORDERED", orderBase, loadBase, addBase });
      if (warn && !input.confirm) {
        const { showUnit, showFactor } = await showUnitOf(tx, load.asnId, orderBase, r);
        return fail("CONFIRM", warningText(warn, r, orderBase, loadBase + addBase, showUnit, showFactor));
      }

      const row = await tx.loadInput.create({
        data: {
          loadId: load.id, itemId: r.itemId, unit: r.unit, addQty: input.qty, baseQty: addBase, scanned: normalizeScan(input.scan).slice(0, 40),
          workerId: me.id, workerName: me.name, deviceId: input.deviceId?.slice(0, 64) || null, overConfirm: !!warn,
        },
      });
      await tx.loadLine.upsert({
        where: { loadId_itemId: { loadId: load.id, itemId: r.itemId } },
        create: { loadId: load.id, itemId: r.itemId, orderBaseQty: 0, loadBaseQty: addBase },
        update: { loadBaseQty: { increment: addBase } },
      });
      await markAsnLoading(tx, load, me);
      return ok(`${r.itemName} +${input.qty.toLocaleString()} ${r.unit}`, { inputId: row.id });
    }),
  );
}

/** 지시 상차의 첫 입력 — ASN을 상차중으로 바꾼다 (이후 화주사가 ASN을 취소할 수 없다) */
async function markAsnLoading(tx: Tx, load: { asnId: number | null }, me: PlanActor) {
  if (!load.asnId) return;
  const asn = await tx.asn.findUnique({ where: { id: load.asnId } });
  if (!asn || asn.status !== "REGISTERED") return;
  const r = await tx.asn.updateMany({ where: { id: asn.id, status: "REGISTERED" }, data: { status: "LOADING", version: { increment: 1 }, updatedBy: me.name } });
  if (r.count) await tx.asnHistory.create({ data: { asnId: asn.id, action: "LOAD_START", version: asn.version + 1, actor: me.name, actorId: me.id } });
}

/* ═════════ 본인 입력 취소·정정 (상차완료 전) ═════════ */

async function ownInput(tx: Tx, me: PlanActor, inputId: number) {
  const cur = await tx.loadInput.findUnique({ where: { id: inputId } });
  if (!cur) return { err: fail("NOT_FOUND", "입력 건을 찾을 수 없습니다.") } as const;
  const load = await lockLoad(tx, cur.loadId);
  if (!load || load.clientId !== me.clientId) return { err: notFound() } as const;
  if (load.status !== "WORKING") return { err: fail("STATE", LOAD_DONE_MSG) } as const;
  if (cur.workerId !== me.id) return { err: fail("FORBIDDEN", `본인이 입력한 건만 고칠 수 있습니다. (${cur.workerName}님 입력)`) } as const;
  const fresh = await tx.loadInput.findUniqueOrThrow({ where: { id: inputId } });
  if (fresh.canceledAt) return { err: fail("STATE", "이미 취소한 입력입니다.") } as const;
  return { cur: fresh, load } as const;
}

export async function cancelLoadInput(me: PlanActor, input: { inputId: number }): Promise<ActionResult> {
  if (!canLoad(me)) return forbidden();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const o = await ownInput(tx, me, input.inputId);
      if (o.err) return o.err;
      await tx.loadInput.update({ where: { id: o.cur.id }, data: { canceledAt: new Date() } });
      await tx.loadLine.update({ where: { loadId_itemId: { loadId: o.load.id, itemId: o.cur.itemId } }, data: { loadBaseQty: { decrement: o.cur.baseQty } } });
      return ok(`입력을 취소했습니다 (−${o.cur.addQty.toLocaleString()} ${o.cur.unit}).`);
    }),
  );
}

/** 정정 = 원래 행 취소 + 새 수량으로 한 행 추가 (이력이 남는다) */
export async function correctLoadInput(me: PlanActor, input: { inputId: number; qty: number; confirm?: boolean; deviceId?: string | null }): Promise<ActionResult<{ inputId: number }>> {
  if (!canLoad(me)) return forbidden();
  const qtyErr = addQtyError(input.qty);
  if (qtyErr) return fail("VALIDATION", qtyErr, { qty: qtyErr });
  return guarded(() =>
    db.$transaction(async (tx) => {
      const o = await ownInput(tx, me, input.inputId);
      if (o.err) return o.err;
      const { cur, load } = o;
      if (input.qty === cur.addQty) return fail("VALIDATION", "수량이 같습니다.", { qty: "다른 수량을 입력하세요." });
      // 트랜잭션 안에서는 한 연결을 쓰므로 순서대로 읽는다
      const line = await tx.loadLine.findUniqueOrThrow({ where: { loadId_itemId: { loadId: load.id, itemId: cur.itemId } } });
      const uom = await tx.itemUom.findUnique({ where: { itemId_unit: { itemId: cur.itemId, unit: cur.unit } } });
      const item = await tx.item.findUniqueOrThrow({ where: { id: cur.itemId }, select: { code: true, name: true, baseUnit: true } });
      const factor = uom?.qty ?? 1;
      const newBase = input.qty * factor;
      const after = line.loadBaseQty - cur.baseQty + newBase;
      const warn = overWarning({ ordered: load.loadType === "ORDERED", orderBase: line.orderBaseQty, loadBase: line.loadBaseQty - cur.baseQty, addBase: newBase });
      if (warn && newBase > cur.baseQty && !input.confirm) {
        const r: Resolved = { itemId: cur.itemId, itemCode: item.code, itemName: item.name, unit: cur.unit, factor, baseUnit: item.baseUnit, by: "barcode" };
        const { showUnit, showFactor } = await showUnitOf(tx, load.asnId, line.orderBaseQty, r);
        return fail("CONFIRM", warningText(warn, r, line.orderBaseQty, after, showUnit, showFactor));
      }
      await tx.loadInput.update({ where: { id: cur.id }, data: { canceledAt: new Date() } });
      const row = await tx.loadInput.create({
        data: {
          loadId: load.id, itemId: cur.itemId, unit: cur.unit, addQty: input.qty, baseQty: newBase, scanned: cur.scanned,
          workerId: me.id, workerName: me.name, deviceId: input.deviceId?.slice(0, 64) || cur.deviceId, overConfirm: !!warn, correctsId: cur.id,
        },
      });
      await tx.loadLine.update({ where: { id: line.id }, data: { loadBaseQty: after } });
      return ok(`${cur.addQty.toLocaleString()} → ${input.qty.toLocaleString()} ${cur.unit}로 정정했습니다.`, { inputId: row.id });
    }),
  );
}

/* ═════════ 상차완료 (차량당 1회, 상차확인서 발행) ═════════ */

export interface CompleteInput {
  loadId: number;
  /** 확인 화면에서 본 마지막 입력 id */
  lastInputId: number;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export async function completeLoad(me: PlanActor, input: CompleteInput): Promise<ActionResult<{ loadNo: string }>> {
  if (!canLoad(me)) return forbidden();
  const text = input.reasonText?.trim() ?? "";
  if (text.length > 500) return fail("VALIDATION", "상세 내용은 500자 이내로 입력하세요.", { reasonText: "상세 내용은 500자 이내로 입력하세요." });
  return guarded(() =>
    db.$transaction(async (tx) => {
      const load = await lockLoad(tx, input.loadId);
      if (!load || load.clientId !== me.clientId) return notFound();
      if (load.status !== "WORKING") return fail("STATE", "이미 상차완료된 차량입니다. 상차완료는 차량당 한 번만 합니다.");
      const last = await tx.loadInput.findFirst({ where: { loadId: load.id }, orderBy: { id: "desc" }, select: { id: true } });
      if ((last?.id ?? 0) !== input.lastInputId) return fail("CONFLICT", LOAD_CONFLICT_MSG);

      const lines = await tx.loadLine.findMany({ where: { loadId: load.id } });
      if (!lines.some((l) => l.loadBaseQty > 0))
        return fail("STATE", "아직 실은 품목이 없습니다. 품목을 스캔해 수량을 입력한 뒤 상차완료하세요. 차량이 출발하지 않으면 화주사 담당자에게 알리세요.");
      const ordered = load.loadType === "ORDERED";
      const diff = hasLoadDiff(ordered, lines.map((l) => ({ orderBase: l.orderBaseQty, loadBase: l.loadBaseQty })));

      let reason: { code: string; name: string } | null = null;
      if (diff) {
        const code = input.reasonCode
          ? await tx.commonCode.findUnique({ where: { groupCode_code: { groupCode: LOAD_DIFF_GROUP, code: input.reasonCode } } })
          : null;
        if (!code || !code.isActive) return fail("VALIDATION", "지시수량과 차이가 있습니다. 차이 사유를 고르세요.", { reasonCode: "차이 사유를 고르세요." });
        if (code.requiresText && !text) return fail("VALIDATION", `"${code.name}"을(를) 고르면 상세 내용을 입력해야 합니다.`, { reasonText: "상세 내용을 입력하세요." });
        reason = { code: code.code, name: code.name };
      }

      const now = new Date();
      const r = await tx.load.updateMany({
        where: { id: load.id, status: "WORKING" },
        data: {
          status: "COMPLETED", version: { increment: 1 }, completedAt: now, completedBy: me.name, completeUserId: me.id,
          diffReasonCode: reason?.code ?? null, diffReasonName: reason?.name ?? null, diffReasonText: reason ? text || null : null,
        },
      });
      if (!r.count) return fail("STATE", "이미 상차완료된 차량입니다.");

      // 지시 상차: ASN 상차완료(= ASN 확정), 상차지시서 상차완료
      if (ordered && load.asnId) {
        const asn = await tx.asn.findUniqueOrThrow({ where: { id: load.asnId } });
        await tx.asn.update({ where: { id: asn.id }, data: { status: "LOADED", version: { increment: 1 }, updatedBy: me.name } });
        await tx.loadOrder.updateMany({ where: { asnId: asn.id }, data: { status: "LOADED" } });
        await tx.asnHistory.create({
          data: {
            asnId: asn.id, action: "LOAD_COMPLETE", version: asn.version + 1, actor: me.name, actorId: me.id,
            reasonCode: reason?.code ?? null, reasonName: reason?.name ?? null, reasonText: reason ? text || null : null,
          },
        });
      }
      return ok(`상차완료 · 상차확인서 ${load.loadNo}을(를) 발행했습니다.`, { loadNo: load.loadNo });
    }),
  );
}
