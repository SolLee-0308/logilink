import "server-only";
/**
 * ASN 조회 — 화주사 자기 건만. 목록·분배 대상·상세·상차지시서 인쇄.
 * 근거: 정의서 v1.4 ③ · 4-2 · C4
 */
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import type { Prisma } from "@/generated/prisma/client";
import { centerChoices } from "@/server/plans/entry";
import { can } from "@/domain/permissions";
import { ASN_OPEN, DISTRIBUTABLE_PLAN, remainingBase, toLineUnitQty, type AsnStatus } from "@/domain/asn-rules";
import type { ItemUnit } from "@/domain/master";
import { todayKst } from "@/lib/format";
import { getLoadOfAsn, listUnorderedLoads } from "@/server/loads/queries";
import { getRcvOfLoad } from "@/server/rcv/queries";
import type { AsnDetail, AsnOptions, AsnRow, AsnTab, DistPlan, LoadOrderPrint } from "@/features/asn/types";

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const UNIT_ORDER: ItemUnit[] = ["EA", "BOX", "PLT"];
/** 입고완료·취소 건을 목록에 남겨 두는 기간 */
export const ASN_RECENT_DAYS = 30;

export const canAsn = (me: PlanActor) => can(me.roles, "asn", "view") && !!me.clientId;

function sumByUnit(lines: { unit: ItemUnit; qty: number }[]): [ItemUnit, number][] {
  const sums = new Map<ItemUnit, number>();
  for (const l of lines) sums.set(l.unit, (sums.get(l.unit) ?? 0) + l.qty);
  return UNIT_ORDER.filter((u) => sums.has(u)).map((u) => [u, sums.get(u)!]);
}

const tabOf = (s: AsnStatus): AsnTab => (s === "REGISTERED" ? "wait" : s === "LOADING" || s === "LOADED" ? "loading" : s === "RECEIVED" ? "done" : "canceled");

/** 입고예정 라인별로 아직 입고되지 않은 ASN(등록·상차중·상차완료)에 담은 기준 단위 수량 — 입고완료 ASN은 라인의 입고·반송 누계로 센다 */
export async function distributedByLine(planLineIds: number[], tx: Pick<typeof db, "asnLine"> = db): Promise<Map<number, number>> {
  if (!planLineIds.length) return new Map();
  const rows = await tx.asnLine.groupBy({
    by: ["planLineId"],
    where: { planLineId: { in: planLineIds }, asn: { status: { in: [...ASN_OPEN] } } },
    _sum: { baseQty: true },
  });
  return new Map(rows.map((r) => [r.planLineId, r._sum.baseQty ?? 0]));
}

/** 무지시 상차 실적을 ASN 목록 행으로 — 작업중은 상차중, 상차완료는 검수 대기, 검수 확정은 입고완료로 보인다 */
async function unorderedRows(scope: Prisma.LoadWhereInput): Promise<AsnRow[]> {
  const loads = await listUnorderedLoads(scope);
  return loads.map((l) => {
    const received = l.rcvs[0]?.confirmedAt ?? null;
    return {
    kind: "load" as const,
    key: `load-${l.id}`,
    href: `/plans/loads/${l.id}`,
    id: l.id,
    clientId: l.clientId,
    clientName: l.client.name,
    asnNo: "",
    loadOrderNo: null,
    loadNo: l.loadNo,
    tab: received ? ("done" as const) : ("loading" as const),
    status: received ? ("RECEIVED" as const) : l.status === "WORKING" ? ("LOADING" as const) : ("LOADED" as const),
    centerId: l.centerId,
    centerName: l.center.name,
    shipDate: ymd(l.loadDate),
    vehicleNo: l.vehicleNo,
    driverName: null,
    driverTel: null,
    lineCount: l.lines.filter((d) => d.loadBaseQty > 0).length,
    planNos: [],
    qtyByUnit: sumByUnit(l.lines.filter((d) => d.loadBaseQty > 0).map((d) => ({ unit: d.item.baseUnit, qty: d.loadBaseQty }))),
    itemTexts: l.lines.flatMap((d) => [d.item.code, d.item.name]),
    createdAt: iso(l.createdAt),
    createdBy: l.createdBy,
    closedAt: received ? iso(received) : null,
    };
  });
}

/** 목록에 남기는 ASN — 상차 전·진행 건 전부 + 최근 30일 입고완료·취소 */
function listWhere(scope: Prisma.AsnWhereInput): Prisma.AsnWhereInput {
  const since = new Date(Date.now() - ASN_RECENT_DAYS * 86_400_000);
  return {
    ...scope,
    OR: [
      { status: { in: ["REGISTERED", "LOADING", "LOADED"] } },
      { status: "RECEIVED", updatedAt: { gte: since } },
      { status: "CANCELED", canceledAt: { gte: since } },
    ],
  };
}

/** ASN 목록 (화주사) — 자기 화주사 건만 */
export async function listMyAsns(me: PlanActor): Promise<AsnRow[]> {
  if (!canAsn(me)) return [];
  const [asns, loads] = await Promise.all([listAsnRows(listWhere({ clientId: me.clientId! }), "/plans/asn"), unorderedRows({ clientId: me.clientId! })]);
  return [...asns, ...loads];
}

/** 3PL 조회 범위 — 소속 센터 ASN만 (센터가 없는 계정은 전체) */
export const canAsnStatus = (me: PlanActor) => can(me.roles, "asnStatus", "view");
const tplScope = (me: PlanActor): Prisma.AsnWhereInput => (me.centerId ? { centerId: me.centerId } : {});

/** ASN·상차 현황 (3PL) */
export async function listAsnStatus(me: PlanActor): Promise<AsnRow[]> {
  if (!canAsnStatus(me)) return [];
  const scope = tplScope(me);
  const [asns, loads] = await Promise.all([listAsnRows(listWhere(scope), "/plans/asn-status"), unorderedRows(scope.centerId ? { centerId: scope.centerId as number } : {})]);
  return [...asns, ...loads];
}

async function listAsnRows(where: Prisma.AsnWhereInput, base: string): Promise<AsnRow[]> {
  const asns = await db.asn.findMany({
    where,
    orderBy: [{ shipDate: "asc" }, { asnNo: "asc" }],
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      loadOrder: { select: { orderNo: true } },
      load: { select: { loadNo: true } },
      lines: { select: { unit: true, qty: true, plan: { select: { planNo: true } }, item: { select: { code: true, name: true } } } },
    },
  });
  return asns.map((a) => ({
    kind: "asn" as const,
    key: `asn-${a.id}`,
    href: `${base}/${a.id}`,
    id: a.id,
    clientId: a.clientId,
    clientName: a.client.name,
    asnNo: a.asnNo,
    loadOrderNo: a.loadOrder?.orderNo ?? null,
    loadNo: a.load?.loadNo ?? null,
    tab: tabOf(a.status),
    status: a.status,
    centerId: a.centerId,
    centerName: a.center.name,
    shipDate: ymd(a.shipDate),
    vehicleNo: a.vehicleNo,
    driverName: a.driverName,
    driverTel: a.driverTel,
    lineCount: a.lines.length,
    planNos: [...new Set(a.lines.map((l) => l.plan.planNo))].sort(),
    qtyByUnit: sumByUnit(a.lines),
    itemTexts: a.lines.flatMap((l) => [l.item.code, l.item.name]),
    createdAt: iso(a.createdAt),
    createdBy: a.createdBy,
    closedAt: a.status === "CANCELED" && a.canceledAt ? iso(a.canceledAt) : a.status === "RECEIVED" ? iso(a.updatedAt) : null,
  }));
}

/** 분배 잔량이 남은 승인·미종결 입고예정 (센터 구분 없이 전부 — 화면에서 센터로 거른다) */
export async function distributablePlans(clientId: number): Promise<DistPlan[]> {
  const plans = await db.inboundPlan.findMany({
    where: { clientId, status: { in: [...DISTRIBUTABLE_PLAN] } },
    orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { item: { select: { code: true, name: true, baseUnit: true, uoms: { select: { unit: true, qty: true } } } } },
      },
    },
  });
  const dist = await distributedByLine(plans.flatMap((p) => p.lines.map((l) => l.id)));
  return plans
    .map((p) => ({
      id: p.id,
      planNo: p.planNo,
      centerId: p.centerId,
      planDate: ymd(p.planDate),
      status: p.status,
      approvedAt: p.approvedAt ? iso(p.approvedAt) : null,
      memo: p.memo,
      lines: p.lines.map((l) => {
        const factor = l.item.uoms.find((u) => u.unit === l.unit)?.qty ?? 1;
        const distributed = dist.get(l.id) ?? 0;
        return {
          planLineId: l.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          itemCode: l.item.code,
          itemName: l.item.name,
          unit: l.unit,
          qty: l.qty,
          factor,
          baseUnit: l.item.baseUnit,
          distributedQty: toLineUnitQty(distributed + l.rcvQty + l.returnQty, factor),
          remainingQty: toLineUnitQty(remainingBase(l, distributed), factor),
          expiryDate: l.expiryDate ? ymd(l.expiryDate) : null,
          lotNo: l.lotNo,
        };
      }),
    }))
    .filter((p) => p.lines.some((l) => l.remainingQty > 0));
}

/** ASN 등록 화면 기준정보 — 이용 센터·기본 센터, 분배 대상 입고예정 */
export async function asnOptions(me: PlanActor): Promise<AsnOptions | null> {
  if (!canAsn(me)) return null;
  const [{ centers, defaultCenterId }, plans] = await Promise.all([centerChoices(me), distributablePlans(me.clientId!)]);
  return { centers, defaultCenterId, plans, today: todayKst() };
}

/** ASN에 아직 다 담지 않은 승인 입고예정 건수 (목록 안내) */
export async function countUndistributed(me: PlanActor) {
  if (!canAsn(me)) return 0;
  return (await distributablePlans(me.clientId!)).length;
}

/** ASN 상세 (화주사) — 자기 화주사 건만 */
export async function getAsnDetail(me: PlanActor, id: number): Promise<AsnDetail | null> {
  if (!canAsn(me)) return null;
  return loadAsnDetail({ id, clientId: me.clientId! });
}

/** ASN 상세 (3PL) — 소속 센터 건만 */
export async function getAsnStatusDetail(me: PlanActor, id: number): Promise<AsnDetail | null> {
  if (!canAsnStatus(me)) return null;
  return loadAsnDetail({ id, ...tplScope(me) });
}

async function loadAsnDetail(where: Prisma.AsnWhereInput): Promise<AsnDetail | null> {
  const a = await db.asn.findFirst({
    where,
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      loadOrder: true,
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          plan: { select: { planNo: true, planDate: true } },
          planLine: { select: { expiryDate: true, lotNo: true } },
          item: { select: { code: true, name: true, baseUnit: true, barcodes: { select: { unit: true, barcode: true, isPrimary: true } } } },
        },
      },
      histories: { orderBy: { at: "asc" } },
    },
  });
  if (!a) return null;
  const cancel = a.histories.findLast((h) => h.action === "CANCEL");
  const load = await getLoadOfAsn(a.id);
  const rcv = load ? await getRcvOfLoad(load.id) : null;
  return {
    id: a.id,
    asnNo: a.asnNo,
    status: a.status,
    version: a.version,
    clientName: a.client.name,
    centerId: a.centerId,
    centerName: a.center.name,
    shipDate: ymd(a.shipDate),
    vehicleNo: a.vehicleNo,
    driverName: a.driverName,
    driverTel: a.driverTel,
    memo: a.memo,
    loadOrder: a.loadOrder ? { orderNo: a.loadOrder.orderNo, issuedAt: iso(a.loadOrder.issuedAt), issuedBy: a.loadOrder.issuedBy } : null,
    createdAt: iso(a.createdAt),
    createdBy: a.createdBy,
    canceledAt: a.canceledAt ? iso(a.canceledAt) : null,
    canceledBy: a.canceledBy,
    cancelReasonName: cancel?.reasonName ?? null,
    cancelReasonText: a.cancelReasonText,
    lines: a.lines.map((l) => {
      const bc = l.item.barcodes;
      const barcode = (bc.find((b) => b.unit === l.unit && b.isPrimary) ?? bc.find((b) => b.unit === l.unit) ?? bc.find((b) => b.isPrimary) ?? bc[0])?.barcode ?? null;
      return {
        lineNo: l.lineNo,
        planId: l.planId,
        planNo: l.plan.planNo,
        planDate: ymd(l.plan.planDate),
        itemId: l.itemId,
        itemCode: l.item.code,
        itemName: l.item.name,
        unit: l.unit,
        qty: l.qty,
        baseUnit: l.item.baseUnit,
        baseQty: l.baseQty,
        expiryDate: l.planLine.expiryDate ? ymd(l.planLine.expiryDate) : null,
        lotNo: l.planLine.lotNo,
        barcode,
      };
    }),
    lineCount: a.lines.length,
    planNos: [...new Set(a.lines.map((l) => l.plan.planNo))].sort(),
    qtyByUnit: sumByUnit(a.lines),
    histories: a.histories.map((h) => ({
      id: String(h.id),
      action: h.action,
      actor: h.actor,
      at: iso(h.at),
      reasonName: h.reasonName,
      reasonText: h.reasonText,
    })),
    load,
    rcv,
  };
}

/** 상차지시서 인쇄 — 발송인 = 화주사 법인, 수신 = 센터 */
export async function getLoadOrderPrint(me: PlanActor, id: number): Promise<LoadOrderPrint | null> {
  const d = await getAsnDetail(me, id);
  if (!d) return null;
  const [client, center] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: me.clientId! } }),
    db.center.findUniqueOrThrow({ where: { id: d.centerId } }),
  ]);
  return {
    ...d,
    sender: {
      name: client.name,
      bizNo: client.bizNo,
      ceoName: client.ceoName,
      address: `(${client.zipCode}) ${client.addr1} ${client.addr2}`.trim(),
      tel: client.tel,
      contact: `${client.contactName} ${client.contactTel}`,
    },
    receiver: { name: center.name, address: `(${center.zipCode}) ${center.addr1} ${center.addr2}`.trim(), tel: center.inboundTel },
  };
}
