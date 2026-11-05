import "server-only";
/**
 * 입고검수 처리 — 3PL 입고검수자(PDA). 검수 시작·추가 수량 입력·본인 입력 취소·정정·0 확인·사유·사진·검수 확정(자동 배분).
 * 근거: 정의서 v1.4 ⑥ · 4-2 · 5장 · C6 · C7 · C8 · D14~D17
 * 처리자를 인자로 받아 서버 액션(actions.ts)과 점검 스크립트가 같은 규칙을 쓴다.
 *
 * - 작업자 잠금 없음 (2026-11-05 Sol, O1): 여러 검수자가 같은 차량에 입력 1건 = 추가 수량 1행을 쌓는다. 입력은 검수 행을 잠근 뒤 줄 세운다.
 * - 상차 실적에 있는 품목은 정상·훼손 반송, 없는 품목은 품목 불일치 반송만 (2026-11-05 Sol, 정의서대로).
 * - 확정(C7·C8): 차량 1대 = 1회. 확인 화면에서 본 마지막 입력 id가 바뀌었으면 막는다. 미입력 라인은 경고 후 명시적 0.
 *   검수·배분·입고예정 누계·상태·ASN을 한 트랜잭션으로 바꾼다. 같은 화주사 배분은 advisory lock으로 줄 세운다.
 */
import { db } from "@/server/db";
import { fail, type ActionResult } from "@/server/action-result";
import type { PlanActor } from "@/server/plans/service";
import { resolveScan, type Resolved } from "@/server/loads/service";
import { asDate, canInspect, rcvCenterScope, ACTIVE_RCV } from "@/server/rcv/queries";
import { RCV_DIFF_GROUP } from "@/domain/master";
import { ASN_COUNTED, DISTRIBUTABLE_PLAN, docNoPrefix, nextDocNo, normalizeVehicleNo } from "@/domain/asn-rules";
import { addQtyError, normalizeDocNo, normalizeScan, qtyInUnit } from "@/domain/load-rules";
import {
  RCV_CONFLICT_MSG,
  RCV_DONE_MSG,
  RCV_IMAGE_BYTES,
  RCV_IMAGE_MAX,
  RCV_IMAGE_MIN,
  RCV_PREFIX,
  RCV_REASON,
  allocate,
  defaultReason,
  needsReason,
  planStatusAfterReceive,
  type RcvLineQty,
} from "@/domain/rcv-rules";
import { todayKst } from "@/lib/format";
import type { RcvCandidate, RcvScanPreview } from "@/features/rcv/types";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

const ok = <T>(message: string, data?: T): ActionResult<T> => ({ ok: true, message, data });
const forbidden = () => fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
const notFound = () => fail("NOT_FOUND", "검수 건을 찾을 수 없습니다. 첫 화면에서 다시 시작하세요.");

async function guarded<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return fail("CONFLICT", "다른 검수자가 같은 차량을 동시에 시작했습니다. 다시 스캔하세요.");
    console.error(e);
    return fail("ERROR", "처리하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

/** 검수 행을 잠근다 — 같은 차량 입력·확정을 줄 세운다 */
async function lockRcv(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM tb_rcv_h WHERE id = ${id} FOR UPDATE`;
  return tx.rcv.findUnique({ where: { id } });
}

const inScope = (me: PlanActor, r: { centerId: number }) => !me.centerId || me.centerId === r.centerId;

async function reasonOf(tx: Tx | typeof db, code: string) {
  const c = await tx.commonCode.findUnique({ where: { groupCode_code: { groupCode: RCV_DIFF_GROUP, code } } });
  return c && c.isActive ? c : null;
}

/* ═════════ 검수 시작 — 상차확인서·상차지시서 바코드 또는 차량번호 (R1 · C6) ═════════ */

export async function startRcv(
  me: PlanActor,
  input: { code?: string; loadId?: number },
): Promise<ActionResult<{ rcvId?: number; candidates?: RcvCandidate[]; notice?: string }>> {
  if (!canInspect(me)) return forbidden();
  const scope = rcvCenterScope(me);
  let loadId = input.loadId ?? null;

  if (!loadId) {
    const raw = normalizeDocNo(input.code ?? "");
    if (!raw) return fail("VALIDATION", "상차확인서·상차지시서 바코드를 스캔하거나 차량번호를 입력하세요.", { code: "스캔하거나 입력하세요." });
    if (raw.startsWith("LD-")) {
      const l = await db.load.findFirst({ where: { loadNo: raw, ...scope }, select: { id: true } });
      if (!l) return fail("NOT_FOUND", `상차확인서 ${raw}을(를) 찾을 수 없습니다. 이 센터로 오는 차량인지 확인하세요.`);
      loadId = l.id;
    } else if (raw.startsWith("LO-")) {
      const lo = await db.loadOrder.findUnique({ where: { orderNo: raw }, select: { status: true, asn: { select: { centerId: true } }, load: { select: { id: true } } } });
      if (!lo || (scope.centerId && lo.asn.centerId !== scope.centerId)) return fail("NOT_FOUND", `상차지시서 ${raw}을(를) 찾을 수 없습니다. 이 센터로 오는 차량인지 확인하세요.`);
      if (!lo.load) return fail("STATE", `아직 상차하지 않은 차량입니다(${raw}). 상차완료된 차량만 검수할 수 있습니다.`);
      loadId = lo.load.id;
    } else {
      const vehicleNo = normalizeVehicleNo(input.code ?? "");
      const loads = await db.load.findMany({
        where: { vehicleNo, ...scope, status: "COMPLETED", rcvs: { none: { status: "CONFIRMED" } } },
        orderBy: { completedAt: "desc" },
        include: { client: { select: { name: true } }, center: { select: { name: true } } },
      });
      if (!loads.length) {
        const working = await db.load.count({ where: { vehicleNo, ...scope, status: "WORKING" } });
        return working
          ? fail("STATE", `${vehicleNo} 차량은 아직 상차 중입니다. 상차완료된 차량만 검수할 수 있습니다.`)
          : fail("NOT_FOUND", `${vehicleNo} 차량의 검수할 상차 실적이 없습니다. 차량번호를 확인하거나 상차확인서를 스캔하세요.`);
      }
      if (loads.length > 1)
        return ok("같은 차량번호로 검수할 실적이 여럿입니다. 상차확인서 번호를 확인해 고르세요.", {
          candidates: loads.map((l) => ({ loadId: l.id, loadNo: l.loadNo, clientName: l.client.name, centerName: l.center.name, completedAt: l.completedAt?.toISOString() ?? null })),
        });
      loadId = loads[0].id;
    }
  }

  const today = todayKst();
  return guarded(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tb_load_h WHERE id = ${loadId} FOR UPDATE`;
      const load = await tx.load.findUnique({ where: { id: loadId! }, include: { lines: true } });
      if (!load || !inScope(me, load)) return fail("NOT_FOUND", "상차 실적을 찾을 수 없습니다. 이 센터로 오는 차량인지 확인하세요.");
      if (load.status !== "COMPLETED") return fail("STATE", `${load.vehicleNo} 차량은 아직 상차 중입니다. 상차완료된 차량만 검수할 수 있습니다.`);
      const existing = await tx.rcv.findFirst({ where: { loadId: load.id, status: { in: [...ACTIVE_RCV] } } });
      if (existing?.status === "CONFIRMED") return ok("이미 검수 확정된 차량입니다.", { rcvId: existing.id, notice: RCV_DONE_MSG });
      if (existing) return ok("검수 중인 차량에 함께 들어갑니다.", { rcvId: existing.id });

      const used = await tx.rcv.findMany({ where: { rcvNo: { startsWith: docNoPrefix(RCV_PREFIX, today) } }, select: { rcvNo: true } });
      const rcv = await tx.rcv.create({
        data: {
          rcvNo: nextDocNo(RCV_PREFIX, today, used.map((u) => u.rcvNo)),
          loadId: load.id,
          clientId: load.clientId,
          centerId: load.centerId,
          vehicleNo: load.vehicleNo,
          rcvDate: asDate(today),
          createdBy: me.name,
          // 기대수량 = 상차완료 확정 수량 (정의서 ⑥)
          lines: { create: load.lines.filter((l) => l.loadBaseQty > 0).map((l) => ({ itemId: l.itemId, expectBaseQty: l.loadBaseQty })) },
        },
      });
      return ok(`검수를 시작합니다 · ${load.vehicleNo}`, { rcvId: rcv.id });
    }),
  );
}

/* ═════════ 스캔 → 품목 ═════════ */

async function showUnitOf(tx: Tx | typeof db, loadId: number, r: Resolved) {
  const load = await tx.load.findUnique({ where: { id: loadId }, select: { asnId: true } });
  if (load?.asnId) {
    const al = await tx.asnLine.findFirst({ where: { asnId: load.asnId, itemId: r.itemId }, select: { unit: true, baseQty: true, qty: true } });
    if (al) return { showUnit: al.unit, showFactor: Math.max(Math.round(al.baseQty / al.qty), 1) };
  }
  return { showUnit: r.unit, showFactor: r.factor };
}

export async function previewRcvScan(me: PlanActor, input: { rcvId: number; scan: string }): Promise<ActionResult<RcvScanPreview>> {
  if (!canInspect(me)) return forbidden();
  const rcv = await db.rcv.findUnique({ where: { id: input.rcvId } });
  if (!rcv || !inScope(me, rcv)) return notFound();
  if (rcv.status !== "WORKING") return fail("STATE", RCV_DONE_MSG);
  const r = await resolveScan(db, rcv.clientId, input.scan);
  if (!r) return fail("NOT_FOUND", `등록되지 않은 바코드입니다(${normalizeScan(input.scan)}). 화주사 품목이 아니면 품목 불일치로 반송하세요.`);
  const line = await db.rcvLine.findUnique({ where: { rcvId_itemId: { rcvId: rcv.id, itemId: r.itemId } } });
  const { showUnit, showFactor } = await showUnitOf(db, rcv.loadId, r);
  return ok("", {
    scan: normalizeScan(input.scan),
    ...r,
    showUnit,
    showFactor,
    expect: line?.expectBaseQty ?? 0,
    good: line?.goodBaseQty ?? 0,
    damaged: line?.damagedBaseQty ?? 0,
    mismatch: !line || line.mismatch,
  });
}

/* ═════════ 추가 수량 입력 ═════════ */

export interface RcvAddInput {
  rcvId: number;
  scan: string;
  qty: number;
  /** 상차 실적에 있는 품목만 고른다. 없는 품목은 늘 품목 불일치 반송 */
  kind: "GOOD" | "DAMAGED";
  deviceId?: string | null;
  /** 기대수량보다 많아지는 경고를 보고 확인했다 */
  confirm?: boolean;
}

export async function addRcvInput(me: PlanActor, input: RcvAddInput): Promise<ActionResult<{ inputId: number }>> {
  if (!canInspect(me)) return forbidden();
  const qtyErr = addQtyError(input.qty);
  if (qtyErr) return fail("VALIDATION", qtyErr, { qty: qtyErr });
  return guarded(() =>
    db.$transaction(async (tx) => {
      const rcv = await lockRcv(tx, input.rcvId);
      if (!rcv || !inScope(me, rcv)) return notFound();
      if (rcv.status !== "WORKING") return fail("STATE", RCV_DONE_MSG);
      const r = await resolveScan(tx, rcv.clientId, input.scan);
      if (!r) return fail("NOT_FOUND", `등록되지 않은 바코드입니다(${normalizeScan(input.scan)}).`, { scan: "등록되지 않은 바코드입니다." });
      let line = await tx.rcvLine.findUnique({ where: { rcvId_itemId: { rcvId: rcv.id, itemId: r.itemId } } });
      const mismatch = !line || line.mismatch;
      const kind = mismatch ? "MISMATCH" : input.kind === "DAMAGED" ? "DAMAGED" : "GOOD";
      const addBase = input.qty * r.factor;

      // 수량 불일치는 막지 않는다(정의서 ⑥) — 기대수량을 넘으면 한 번 확인만 받는다
      if (line && !mismatch && !input.confirm && line.goodBaseQty + line.damagedBaseQty + addBase > line.expectBaseQty) {
        const { showUnit, showFactor } = await showUnitOf(tx, rcv.loadId, r);
        const f = (n: number) => qtyInUnit(n, showUnit, showFactor, r.baseUnit);
        return fail("CONFIRM", `${r.itemName}: 상차 수량 ${f(line.expectBaseQty)}보다 많아집니다(입력 후 ${f(line.goodBaseQty + line.damagedBaseQty + addBase)}). 실제로 센 수량이 맞으면 그대로 입력하세요. 확정 때 차이 사유를 고릅니다.`);
      }

      if (!line) {
        const reason = await reasonOf(tx, RCV_REASON.MISMATCH);
        line = await tx.rcvLine.create({ data: { rcvId: rcv.id, itemId: r.itemId, mismatch: true, reasonCode: reason?.code ?? null, reasonName: reason?.name ?? null } });
      }
      const row = await tx.rcvInput.create({
        data: {
          rcvId: rcv.id, itemId: r.itemId, kind, unit: r.unit, addQty: input.qty, baseQty: addBase, scanned: normalizeScan(input.scan).slice(0, 40),
          workerId: me.id, workerName: me.name, deviceId: input.deviceId?.slice(0, 64) || null,
        },
      });
      // 첫 훼손 입력이면 사유를 "훼손·오염(반송)"으로 미리 골라 둔다. 0 확인은 입력이 들어오면 푼다
      const preset = kind === "DAMAGED" && !line.reasonCode ? await reasonOf(tx, RCV_REASON.DAMAGED) : null;
      const zeroReset = line.zeroConfirm && line.reasonCode === RCV_REASON.MISSING;
      await tx.rcvLine.update({
        where: { id: line.id },
        data: {
          ...(kind === "GOOD" ? { goodBaseQty: { increment: addBase } } : kind === "DAMAGED" ? { damagedBaseQty: { increment: addBase } } : { mismatchBaseQty: { increment: addBase } }),
          zeroConfirm: false,
          ...(preset ? { reasonCode: preset.code, reasonName: preset.name } : zeroReset ? { reasonCode: null, reasonName: null, reasonText: null } : {}),
        },
      });
      const label = kind === "GOOD" ? "" : kind === "DAMAGED" ? " (훼손 반송)" : " (품목 불일치 반송)";
      return ok(`${r.itemName} +${input.qty.toLocaleString()} ${r.unit}${label}`, { inputId: row.id });
    }),
  );
}

/* ═════════ 본인 입력 취소·정정 (확정 전) ═════════ */

const totalField = (kind: string) => (kind === "GOOD" ? "goodBaseQty" : kind === "DAMAGED" ? "damagedBaseQty" : "mismatchBaseQty");

async function ownInput(tx: Tx, me: PlanActor, inputId: number) {
  const cur = await tx.rcvInput.findUnique({ where: { id: inputId } });
  if (!cur) return { err: fail("NOT_FOUND", "입력 건을 찾을 수 없습니다.") } as const;
  const rcv = await lockRcv(tx, cur.rcvId);
  if (!rcv || !inScope(me, rcv)) return { err: notFound() } as const;
  if (rcv.status !== "WORKING") return { err: fail("STATE", RCV_DONE_MSG) } as const;
  if (cur.workerId !== me.id) return { err: fail("FORBIDDEN", `본인이 입력한 건만 고칠 수 있습니다. (${cur.workerName}님 입력)`) } as const;
  const fresh = await tx.rcvInput.findUniqueOrThrow({ where: { id: inputId } });
  if (fresh.canceledAt) return { err: fail("STATE", "이미 취소한 입력입니다.") } as const;
  return { cur: fresh, rcv } as const;
}

export async function cancelRcvInput(me: PlanActor, input: { inputId: number }): Promise<ActionResult> {
  if (!canInspect(me)) return forbidden();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const o = await ownInput(tx, me, input.inputId);
      if (o.err) return o.err;
      await tx.rcvInput.update({ where: { id: o.cur.id }, data: { canceledAt: new Date() } });
      await tx.rcvLine.update({ where: { rcvId_itemId: { rcvId: o.rcv.id, itemId: o.cur.itemId } }, data: { [totalField(o.cur.kind)]: { decrement: o.cur.baseQty } } });
      return ok(`입력을 취소했습니다 (−${o.cur.addQty.toLocaleString()} ${o.cur.unit}).`);
    }),
  );
}

/** 정정 = 원래 행 취소 + 새 수량으로 한 행 추가 (구분은 그대로) */
export async function correctRcvInput(me: PlanActor, input: { inputId: number; qty: number; deviceId?: string | null }): Promise<ActionResult<{ inputId: number }>> {
  if (!canInspect(me)) return forbidden();
  const qtyErr = addQtyError(input.qty);
  if (qtyErr) return fail("VALIDATION", qtyErr, { qty: qtyErr });
  return guarded(() =>
    db.$transaction(async (tx) => {
      const o = await ownInput(tx, me, input.inputId);
      if (o.err) return o.err;
      const { cur, rcv } = o;
      if (input.qty === cur.addQty) return fail("VALIDATION", "수량이 같습니다.", { qty: "다른 수량을 입력하세요." });
      const uom = await tx.itemUom.findUnique({ where: { itemId_unit: { itemId: cur.itemId, unit: cur.unit } } });
      const newBase = input.qty * (uom?.qty ?? 1);
      await tx.rcvInput.update({ where: { id: cur.id }, data: { canceledAt: new Date() } });
      const row = await tx.rcvInput.create({
        data: {
          rcvId: rcv.id, itemId: cur.itemId, kind: cur.kind, unit: cur.unit, addQty: input.qty, baseQty: newBase, scanned: cur.scanned,
          workerId: me.id, workerName: me.name, deviceId: input.deviceId?.slice(0, 64) || cur.deviceId, correctsId: cur.id,
        },
      });
      await tx.rcvLine.update({ where: { rcvId_itemId: { rcvId: rcv.id, itemId: cur.itemId } }, data: { [totalField(cur.kind)]: { increment: newBase - cur.baseQty } } });
      return ok(`${cur.addQty.toLocaleString()} → ${input.qty.toLocaleString()} ${cur.unit}로 정정했습니다.`, { inputId: row.id });
    }),
  );
}

/* ═════════ 0(미도착) 확인 · 사유 · 유통기한·로트 ═════════ */

/** 검수자가 확인하고 0으로 입력 (D15). 입력이 있는 품목은 0으로 할 수 없다 — 입력을 먼저 취소한다 */
export async function setRcvZero(me: PlanActor, input: { rcvId: number; itemId: number; on: boolean }): Promise<ActionResult> {
  if (!canInspect(me)) return forbidden();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const rcv = await lockRcv(tx, input.rcvId);
      if (!rcv || !inScope(me, rcv)) return notFound();
      if (rcv.status !== "WORKING") return fail("STATE", RCV_DONE_MSG);
      const line = await tx.rcvLine.findUnique({ where: { rcvId_itemId: { rcvId: rcv.id, itemId: input.itemId } }, include: { item: { select: { name: true } } } });
      if (!line || line.mismatch) return fail("NOT_FOUND", "상차 실적에 있는 품목만 0으로 처리할 수 있습니다.");
      const inputs = await tx.rcvInput.count({ where: { rcvId: rcv.id, itemId: input.itemId, canceledAt: null } });
      if (input.on && inputs) return fail("STATE", `${line.item.name}은(는) 이미 입력한 수량이 있습니다. 0으로 하려면 입력을 먼저 취소하세요.`);
      const missing = input.on && !line.reasonCode ? await reasonOf(tx, RCV_REASON.MISSING) : null;
      await tx.rcvLine.update({
        where: { id: line.id },
        data: {
          zeroConfirm: input.on,
          ...(missing ? { reasonCode: missing.code, reasonName: missing.name } : {}),
          ...(!input.on && line.reasonCode === RCV_REASON.MISSING ? { reasonCode: null, reasonName: null, reasonText: null } : {}),
        },
      });
      return ok(input.on ? `${line.item.name} — 0(미도착)으로 확인했습니다.` : `${line.item.name} — 0 확인을 풀었습니다.`);
    }),
  );
}

export async function setRcvLineInfo(
  me: PlanActor,
  input: { rcvId: number; itemId: number; reasonCode?: string | null; reasonText?: string | null; expiryDate?: string | null; lotNo?: string | null },
): Promise<ActionResult> {
  if (!canInspect(me)) return forbidden();
  const text = input.reasonText?.trim() ?? "";
  if (text.length > 500) return fail("VALIDATION", "상세 내용은 500자 이내로 입력하세요.", { reasonText: "500자 이내" });
  if (input.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) return fail("VALIDATION", "유통기한을 날짜로 입력하세요.", { expiryDate: "날짜" });
  const lot = input.lotNo?.trim() ?? "";
  if (lot.length > 40) return fail("VALIDATION", "로트는 40자 이내로 입력하세요.", { lotNo: "40자 이내" });
  return guarded(() =>
    db.$transaction(async (tx) => {
      const rcv = await lockRcv(tx, input.rcvId);
      if (!rcv || !inScope(me, rcv)) return notFound();
      if (rcv.status !== "WORKING") return fail("STATE", RCV_DONE_MSG);
      const line = await tx.rcvLine.findUnique({ where: { rcvId_itemId: { rcvId: rcv.id, itemId: input.itemId } } });
      if (!line) return fail("NOT_FOUND", "검수 품목을 찾을 수 없습니다.");
      const data: Prisma.RcvLineUpdateInput = {};
      if (input.reasonCode !== undefined) {
        if (input.reasonCode) {
          const c = await reasonOf(tx, input.reasonCode);
          if (!c) return fail("VALIDATION", "사유를 다시 고르세요.", { reasonCode: "사유를 다시 고르세요." });
          Object.assign(data, { reasonCode: c.code, reasonName: c.name, reasonText: text || null });
        } else Object.assign(data, { reasonCode: null, reasonName: null, reasonText: null });
      }
      if (input.expiryDate !== undefined) data.expiryDate = input.expiryDate ? asDate(input.expiryDate) : null;
      if (input.lotNo !== undefined) data.lotNo = lot || null;
      await tx.rcvLine.update({ where: { id: line.id }, data });
      return ok("저장했습니다.");
    }),
  );
}

/* ═════════ 훼손 사진 (R7) ═════════ */

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];

export async function addRcvImage(me: PlanActor, input: { rcvId: number; itemId: number; mime: string; base64: string }): Promise<ActionResult<{ imageId: number }>> {
  if (!canInspect(me)) return forbidden();
  if (!IMAGE_MIME.includes(input.mime)) return fail("VALIDATION", "사진 형식(JPEG·PNG·WEBP)만 올릴 수 있습니다.");
  const data = Buffer.from(input.base64, "base64");
  if (!data.length) return fail("VALIDATION", "사진을 읽지 못했습니다. 다시 찍어 주세요.");
  if (data.length > RCV_IMAGE_BYTES) return fail("VALIDATION", "사진이 너무 큽니다(1MB 초과). 다시 찍어 주세요.");
  return guarded(() =>
    db.$transaction(async (tx) => {
      const rcv = await lockRcv(tx, input.rcvId);
      if (!rcv || !inScope(me, rcv)) return notFound();
      if (rcv.status !== "WORKING") return fail("STATE", RCV_DONE_MSG);
      const line = await tx.rcvLine.findUnique({ where: { rcvId_itemId: { rcvId: rcv.id, itemId: input.itemId } } });
      if (!line || line.mismatch) return fail("STATE", "훼손 사진은 상차 실적에 있는 품목만 찍습니다.");
      const n = await tx.rcvImage.count({ where: { rcvId: rcv.id, itemId: input.itemId } });
      if (n >= RCV_IMAGE_MAX) return fail("STATE", `사진은 품목당 ${RCV_IMAGE_MAX}장까지입니다.`);
      const img = await tx.rcvImage.create({ data: { rcvId: rcv.id, itemId: input.itemId, mime: input.mime, size: data.length, data, createdBy: me.name, creatorId: me.id } });
      return ok(`사진을 올렸습니다 (${n + 1}/${RCV_IMAGE_MAX}).`, { imageId: img.id });
    }),
  );
}

export async function deleteRcvImage(me: PlanActor, input: { imageId: number }): Promise<ActionResult> {
  if (!canInspect(me)) return forbidden();
  return guarded(() =>
    db.$transaction(async (tx) => {
      const img = await tx.rcvImage.findUnique({ where: { id: input.imageId }, select: { id: true, rcvId: true, creatorId: true, createdBy: true } });
      if (!img) return fail("NOT_FOUND", "사진을 찾을 수 없습니다.");
      const rcv = await lockRcv(tx, img.rcvId);
      if (!rcv || !inScope(me, rcv)) return notFound();
      if (rcv.status !== "WORKING") return fail("STATE", RCV_DONE_MSG);
      if (img.creatorId !== me.id) return fail("FORBIDDEN", `본인이 찍은 사진만 지울 수 있습니다. (${img.createdBy}님 사진)`);
      await tx.rcvImage.delete({ where: { id: img.id } });
      return ok("사진을 지웠습니다.");
    }),
  );
}

/* ═════════ 검수 확정 → 자동 배분 (C7 · C8 · D15 · D17) ═════════ */

export interface ConfirmRcvInput {
  rcvId: number;
  /** 확인 화면에서 본 마지막 입력 id */
  lastInputId: number;
  /** 경고창에서 [남은 라인 전부 0 처리]를 골랐다 */
  zeroRest?: boolean;
}

export async function confirmRcv(me: PlanActor, input: ConfirmRcvInput): Promise<ActionResult<{ rcvNo: string }>> {
  if (!canInspect(me)) return forbidden();
  return guarded(() =>
    db.$transaction(
      async (tx) => {
        const rcv = await lockRcv(tx, input.rcvId);
        if (!rcv || !inScope(me, rcv)) return notFound();
        if (rcv.status !== "WORKING") return fail("STATE", "이미 검수 확정된 차량입니다. 검수 확정은 차량당 한 번만 합니다.");
        const last = await tx.rcvInput.findFirst({ where: { rcvId: rcv.id }, orderBy: { id: "desc" }, select: { id: true } });
        if ((last?.id ?? 0) !== input.lastInputId) return fail("CONFLICT", RCV_CONFLICT_MSG);

        const load = await tx.load.findUniqueOrThrow({ where: { id: rcv.loadId } });
        let lines = await tx.rcvLine.findMany({ where: { rcvId: rcv.id }, include: { item: { select: { name: true, expiryManaged: true, lotManaged: true } } }, orderBy: { id: "asc" } });
        const counts = await tx.rcvInput.groupBy({ by: ["itemId"], where: { rcvId: rcv.id, canceledAt: null }, _count: { _all: true } });
        const has = new Set(counts.map((c) => c.itemId));
        const q = (l: (typeof lines)[number]): RcvLineQty => ({
          expect: l.expectBaseQty, good: l.goodBaseQty, damaged: l.damagedBaseQty, mismatchQty: l.mismatchBaseQty, mismatch: l.mismatch, zeroConfirm: l.zeroConfirm, hasInputs: has.has(l.itemId),
        });

        // D15: 미입력 라인 — 시스템이 임의로 0 처리하지 않는다. 검수자가 고르면 0 확인 표시를 남긴다
        const unentered = lines.filter((l) => !l.mismatch && !has.has(l.itemId) && !l.zeroConfirm);
        // 화면은 fieldErrors.unentered(품목명을 줄바꿈으로 이은 값)로 경고창 목록을 그린다
        if (unentered.length && !input.zeroRest)
          return fail("CONFIRM", `입력하지 않은 품목이 ${unentered.length}개 있습니다.`, { unentered: unentered.map((l) => l.item.name).join("\n") });
        if (unentered.length) {
          const missing = await reasonOf(tx, RCV_REASON.MISSING);
          for (const l of unentered)
            await tx.rcvLine.update({ where: { id: l.id }, data: { zeroConfirm: true, ...(l.reasonCode ? {} : { reasonCode: missing?.code ?? null, reasonName: missing?.name ?? null }) } });
          lines = await tx.rcvLine.findMany({ where: { rcvId: rcv.id }, include: { item: { select: { name: true, expiryManaged: true, lotManaged: true } } }, orderBy: { id: "asc" } });
        }
        if (!lines.some((l) => l.goodBaseQty + l.damagedBaseQty + l.mismatchBaseQty > 0 || l.zeroConfirm))
          return fail("STATE", "입력한 수량이 없습니다. 품목을 스캔해 수량을 입력하세요.");

        // 사유(D19)·훼손 사진(C7) 검사
        for (const l of lines) {
          const lq = q(l);
          if (!needsReason(lq)) continue;
          if (!l.reasonCode) {
            const preset = defaultReason(lq);
            const c = preset ? await reasonOf(tx, preset) : null;
            if (!c) return fail("VALIDATION", `${l.item.name}: 상차 수량과 차이가 있습니다. 차이 사유를 고르세요.`, { [`line-${l.itemId}`]: "차이 사유를 고르세요." });
            await tx.rcvLine.update({ where: { id: l.id }, data: { reasonCode: c.code, reasonName: c.name } });
            l.reasonCode = c.code;
          }
          const c = await reasonOf(tx, l.reasonCode);
          if (!c) return fail("VALIDATION", `${l.item.name}: 사용하지 않는 사유입니다. 다시 고르세요.`, { [`line-${l.itemId}`]: "사유를 다시 고르세요." });
          if (c.requiresText && !l.reasonText?.trim()) return fail("VALIDATION", `${l.item.name}: "${c.name}"을(를) 고르면 상세 내용을 입력해야 합니다.`, { [`line-${l.itemId}`]: "상세 내용을 입력하세요." });
          if (l.damagedBaseQty > 0) {
            const n = await tx.rcvImage.count({ where: { rcvId: rcv.id, itemId: l.itemId } });
            if (n < RCV_IMAGE_MIN) return fail("VALIDATION", `${l.item.name}: 훼손 반송은 사진을 ${RCV_IMAGE_MIN}장 이상 찍어야 합니다.`, { [`line-${l.itemId}`]: "사진을 찍으세요." });
          }
        }

        // 같은 화주사 배분을 줄 세운다 (같은 입력 → 같은 결과)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${7_700_000 + rcv.clientId})`;

        const asnLines = load.asnId ? await tx.asnLine.findMany({ where: { asnId: load.asnId }, orderBy: { lineNo: "asc" } }) : [];
        const touchedPlans = new Set<number>();
        for (const l of lines) {
          if (l.mismatch) continue; // 품목 불일치 반송은 기록만 (R9)
          const parts = [
            { kind: "GOOD" as const, qty: l.goodBaseQty },
            { kind: "RETURN" as const, qty: l.damagedBaseQty },
          ].filter((p) => p.qty > 0);
          if (!parts.length) continue;

          // 1단계: 원 ASN 라인 (상한 = 그 ASN 라인 지시수량 − 이미 배분된 수량)
          const s1 = [];
          for (const a of asnLines.filter((a) => a.itemId === l.itemId)) {
            const used = await tx.rcvAlloc.aggregate({ where: { asnLineId: a.id, reverse: false }, _sum: { allocQty: true } });
            s1.push({ asnLineId: a.id, planLineId: a.planLineId, cap: Math.max(a.baseQty - (used._sum.allocQty ?? 0), 0) });
          }
          // 2단계: 같은 화주사·같은 센터 미종결 입고예정 중 이 품목이 ASN으로 분배된 라인 (승인 시각이 오래된 순)
          const s2 = await tx.inboundPlanLine.findMany({
            where: {
              itemId: l.itemId,
              plan: { clientId: rcv.clientId, centerId: rcv.centerId, status: { in: [...DISTRIBUTABLE_PLAN] } },
              asnLines: { some: { asn: { status: { in: [...ASN_COUNTED] } } } },
            },
            orderBy: [{ plan: { approvedAt: "asc" } }, { planId: "asc" }, { lineNo: "asc" }],
            select: { id: true },
          });
          // 라인별 남은 칸 = ASN 분배수량 − 이미 배분된 수량, 그리고 승인 잔량(승인 − 입고 − 반송 − 종결)을 넘지 않게
          const ids = [...new Set([...s1.map((s) => s.planLineId), ...s2.map((s) => s.id)])];
          const planCap = new Map<number, number>();
          for (const id of ids) {
            const pl = await tx.inboundPlanLine.findUniqueOrThrow({ where: { id }, include: { plan: { select: { status: true } } } });
            if (!DISTRIBUTABLE_PLAN.includes(pl.plan.status)) {
              planCap.set(id, 0);
              continue;
            }
            const dist = await tx.asnLine.aggregate({ where: { planLineId: id, asn: { status: { in: [...ASN_COUNTED] } } }, _sum: { baseQty: true } });
            const used = await tx.rcvAlloc.aggregate({ where: { planLineId: id, reverse: false }, _sum: { allocQty: true } });
            const remain = pl.baseQty - pl.rcvQty - pl.returnQty - pl.closeQty;
            planCap.set(id, Math.max(Math.min((dist._sum.baseQty ?? 0) - (used._sum.allocQty ?? 0), remain), 0));
          }
          const rows = allocate(parts, s1, s2.map((s) => s.id), planCap);
          for (const a of rows) {
            await tx.rcvAlloc.create({ data: { rcvId: rcv.id, rcvLineId: l.id, kind: a.kind, step: a.step, planLineId: a.planLineId, asnLineId: a.asnLineId, allocQty: a.qty } });
            if (!a.planLineId) continue;
            const pl = await tx.inboundPlanLine.update({
              where: { id: a.planLineId },
              data: a.kind === "GOOD" ? { rcvQty: { increment: a.qty } } : { returnQty: { increment: a.qty } },
              select: { planId: true },
            });
            touchedPlans.add(pl.planId);
          }

          // 관리 품목: 현장에서 적지 않았으면 입고예정 값을 그대로 남긴다 (R8)
          if ((l.item.expiryManaged && !l.expiryDate) || (l.item.lotManaged && !l.lotNo)) {
            const src = s1[0] ? await tx.inboundPlanLine.findUnique({ where: { id: s1[0].planLineId }, select: { expiryDate: true, lotNo: true } }) : null;
            if (src)
              await tx.rcvLine.update({
                where: { id: l.id },
                data: { ...(l.item.expiryManaged && !l.expiryDate ? { expiryDate: src.expiryDate } : {}), ...(l.item.lotManaged && !l.lotNo ? { lotNo: src.lotNo } : {}) },
              });
          }
        }

        // 입고예정 상태: 잔량 0 이하 → 입고완료, 남으면 부분입고 (D17)
        for (const planId of touchedPlans) {
          const plan = await tx.inboundPlan.findUniqueOrThrow({ where: { id: planId }, include: { lines: true } });
          if (!DISTRIBUTABLE_PLAN.includes(plan.status)) continue;
          const next = planStatusAfterReceive(plan.lines);
          await tx.inboundPlan.update({ where: { id: plan.id }, data: { status: next, version: { increment: 1 }, updatedBy: me.name } });
          await tx.inboundPlanHistory.create({
            data: { planId: plan.id, action: "RECEIVE", version: plan.version + 1, revisionNo: plan.revisionNo, actor: me.name, actorId: me.id, reasonText: `입고검수 ${rcv.rcvNo} 확정 · ${next === "COMPLETED" ? "입고완료" : "부분입고"}` },
          });
        }

        // ASN 입고완료, 상차지시서 검수완료 (4-2)
        if (load.asnId) {
          const asn = await tx.asn.findUniqueOrThrow({ where: { id: load.asnId } });
          await tx.asn.update({ where: { id: asn.id }, data: { status: "RECEIVED", version: { increment: 1 }, updatedBy: me.name } });
          await tx.loadOrder.updateMany({ where: { asnId: asn.id }, data: { status: "INSPECTED" } });
          await tx.asnHistory.create({ data: { asnId: asn.id, action: "RECEIVE", version: asn.version + 1, actor: me.name, actorId: me.id, reasonText: `입고검수 ${rcv.rcvNo} 확정` } });
        }

        const r = await tx.rcv.updateMany({
          where: { id: rcv.id, status: "WORKING" },
          data: { status: "CONFIRMED", version: { increment: 1 }, confirmedAt: new Date(), confirmedBy: me.name, confirmUserId: me.id },
        });
        if (!r.count) return fail("STATE", "이미 검수 확정된 차량입니다.");
        return ok(`검수 확정 · ${rcv.rcvNo} — 입고예정 ${touchedPlans.size}건에 자동 배분했습니다.`, { rcvNo: rcv.rcvNo });
      },
      { timeout: 30_000 },
    ),
  );
}
