import "server-only";
/**
 * 입고예정 조회 (정의서 ⑤) — 승인 기준 품목별 조회 / ASN·상차 기준 차량별 조회.
 * 두 조회 모두 입고현황(검수 확정 배분)과 입고예정별 잔량을 함께 보여 준다.
 * 범위: 화주사 담당자 = 자기 화주사, 3PL = 소속 센터(센터가 없는 계정은 전체).
 */
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanActor } from "@/server/plans/service";
import { getPlanDetail } from "@/server/plans/queries";
import { distributedByLine } from "@/server/asn/queries";
import { can, isShipperRole } from "@/domain/permissions";
import { CANCEL_GROUP, type ItemUnit } from "@/domain/master";
import { ALERT_DAYS_KEY, DEFAULT_ALERT_DAYS, OPEN_PLAN, approvedCancelBlock, asnStatusesOf, overdueCutoff, planStatusesOf } from "@/domain/inquiry-rules";
import { todayKst } from "@/lib/format";
import type { CenterOption, InquiryDetail, InquiryPlanRow, InquiryVehicleRow } from "@/features/plans/inquiry/types";
import type { InquiryQuery } from "@/features/plans/inquiry/inquiry-list";

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const UNIT_ORDER: ItemUnit[] = ["EA", "BOX", "PLT"];
const factorOf = (l: { qty: number; baseQty: number }) => Math.max(Math.round(l.baseQty / Math.max(l.qty, 1)), 1);

export const canInquiry = (me: PlanActor) => can(me.roles, "planInquiry", "view") && (!isShipperRole(me.roles) || !!me.clientId);

/** 조회 범위 — 화주사: 자기 화주사 / 3PL: 소속 센터 */
function scopeOf(me: PlanActor): { clientId?: number; centerId?: number } {
  if (isShipperRole(me.roles)) return { clientId: me.clientId ?? -1 };
  return me.centerId ? { centerId: me.centerId } : {};
}

/** 조회조건의 화주사·센터 (범위 안에서만 좁힌다) */
function narrow(me: PlanActor, q: Pick<InquiryQuery, "client" | "center">) {
  const s = scopeOf(me);
  return {
    ...s,
    ...(q.client && !s.clientId ? { clientId: Number(q.client) } : {}),
    ...(q.center && !s.centerId ? { centerId: Number(q.center) } : {}),
  };
}

const range = (from: string, to: string) => (from || to ? { ...(from ? { gte: asDate(from) } : {}), ...(to ? { lte: asDate(to) } : {}) } : undefined);

/** 미종결 경과 강조 기준 (운영 설정, O2) */
export async function alertDays(): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: ALERT_DAYS_KEY } });
  const n = Number(s?.value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_ALERT_DAYS;
}

/** 조회조건 센터 선택지 — 화주사: 이용 센터 / 3PL: 소속 센터가 없을 때 전체 센터 (있으면 고정이라 선택지 없음) */
export async function inquiryCenters(me: PlanActor): Promise<CenterOption[]> {
  if (isShipperRole(me.roles)) {
    if (!me.clientId) return [];
    const links = await db.clientCenter.findMany({ where: { clientId: me.clientId }, select: { centerCode: true } });
    return db.center.findMany({ where: { code: { in: links.map((l) => l.centerCode) } }, orderBy: { code: "asc" }, select: { id: true, name: true } });
  }
  if (me.centerId) return [];
  return db.center.findMany({ orderBy: { code: "asc" }, select: { id: true, name: true } });
}

/* ═════════ 품목별 탭 ═════════ */

export async function listInquiryPlans(me: PlanActor, q: InquiryQuery): Promise<InquiryPlanRow[]> {
  if (!canInquiry(me)) return [];
  const where: Prisma.InboundPlanWhereInput = {
    ...narrow(me, q),
    status: { in: planStatusesOf(q.st) },
    // 승인 기준 — 승인 전에 화주사가 취소한 건은 빠진다 (승인 건 취소만 남는다)
    approvedAt: { not: null },
    planDate: range(q.from, q.to),
  };
  const plans = await db.inboundPlan.findMany({
    where,
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { code: true, name: true, baseUnit: true } } } },
    },
    orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
    take: 1000,
  });
  const lineIds = plans.flatMap((p) => p.lines.map((l) => l.id));
  const [incoming, asnLinks] = await Promise.all([
    distributedByLine(lineIds),
    db.asnLine.findMany({
      where: { planId: { in: plans.map((p) => p.id) }, asn: { status: { not: "CANCELED" } } },
      select: { planId: true, asnId: true },
      distinct: ["planId", "asnId"],
    }),
  ]);
  const vehicles = new Map<number, number>();
  for (const a of asnLinks) vehicles.set(a.planId, (vehicles.get(a.planId) ?? 0) + 1);
  return plans.map((p) => ({
    id: p.id,
    planNo: p.planNo,
    clientId: p.clientId,
    clientName: p.client.name,
    centerId: p.centerId,
    centerName: p.center.name,
    planDate: ymd(p.planDate),
    status: p.status,
    approvedAt: p.approvedAt ? iso(p.approvedAt) : null,
    approvedBy: p.approvedBy,
    vehicleCount: vehicles.get(p.id) ?? 0,
    lines: p.lines.map((l) => ({
      lineNo: l.lineNo,
      itemCode: l.item.code,
      itemName: l.item.name,
      unit: l.unit,
      qty: l.qty,
      baseUnit: l.item.baseUnit,
      factor: factorOf(l),
      baseQty: l.baseQty,
      incomingQty: OPEN_PLAN.includes(p.status) ? (incoming.get(l.id) ?? 0) : 0,
      rcvQty: l.rcvQty,
      returnQty: l.returnQty,
      closeQty: l.closeQty,
    })),
  }));
}

/** 경과 기준 초과 미종결 건수 — 기간 조건과 상관없이 (요약 칸) */
export async function countOverdue(me: PlanActor, q: Pick<InquiryQuery, "client" | "center">, days: number): Promise<number> {
  if (!canInquiry(me)) return 0;
  return db.inboundPlan.count({
    where: { ...narrow(me, q), status: { in: [...OPEN_PLAN] }, planDate: { lte: asDate(overdueCutoff(todayKst(), days)) } },
  });
}

/* ═════════ 차량별 탭 ═════════ */

export async function listInquiryVehicles(me: PlanActor, q: InquiryQuery): Promise<InquiryVehicleRow[]> {
  if (!canInquiry(me)) return [];
  const asns = await db.asn.findMany({
    where: { ...narrow(me, q), status: { in: asnStatusesOf(q.st) }, shipDate: range(q.from, q.to) },
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          plan: { select: { planNo: true } },
          planLine: { select: { qty: true, baseQty: true, rcvQty: true, returnQty: true, closeQty: true } },
          item: { select: { code: true, name: true, baseUnit: true } },
        },
      },
      load: { select: { rcvs: { where: { status: "CONFIRMED" }, select: { id: true, confirmedAt: true } } } },
    },
    orderBy: [{ shipDate: "asc" }, { asnNo: "asc" }],
    take: 1000,
  });
  // 이 차량의 검수 확정으로 입고예정 라인에 배분된 입고·반송 (차량 × 입고예정 라인)
  const rcvToAsn = new Map<number, number>();
  for (const a of asns) for (const r of a.load?.rcvs ?? []) rcvToAsn.set(r.id, a.id);
  const allocs = rcvToAsn.size
    ? await db.rcvAlloc.groupBy({
        by: ["rcvId", "planLineId", "kind"],
        where: { rcvId: { in: [...rcvToAsn.keys()] }, reverse: false, planLineId: { not: null } },
        _sum: { allocQty: true },
      })
    : [];
  const got = new Map<string, { rcv: number; ret: number }>();
  for (const g of allocs) {
    const k = `${rcvToAsn.get(g.rcvId)}:${g.planLineId}`;
    const v = got.get(k) ?? { rcv: 0, ret: 0 };
    if (g.kind === "GOOD") v.rcv += g._sum.allocQty ?? 0;
    else v.ret += g._sum.allocQty ?? 0;
    got.set(k, v);
  }
  return asns.map((a) => {
    const open = a.status !== "RECEIVED";
    return {
      id: a.id,
      asnNo: a.asnNo,
      clientId: a.clientId,
      clientName: a.client.name,
      centerId: a.centerId,
      centerName: a.center.name,
      shipDate: ymd(a.shipDate),
      vehicleNo: a.vehicleNo,
      driverName: a.driverName,
      driverTel: a.driverTel,
      status: a.status,
      receivedAt: a.load?.rcvs[0]?.confirmedAt ? iso(a.load.rcvs[0].confirmedAt) : null,
      planNos: [...new Set(a.lines.map((l) => l.plan.planNo))],
      lines: a.lines.map((l) => {
        const g = got.get(`${a.id}:${l.planLineId}`) ?? { rcv: 0, ret: 0 };
        const pl = l.planLine;
        return {
          key: `${a.id}-${l.lineNo}`,
          planId: l.planId,
          planNo: l.plan.planNo,
          itemCode: l.item.code,
          itemName: l.item.name,
          unit: l.unit,
          baseUnit: l.item.baseUnit,
          factor: factorOf(l),
          orderQty: l.baseQty,
          rcvQty: g.rcv,
          returnQty: g.ret,
          incomingQty: open ? l.baseQty : 0,
          planRemainQty: Math.max(pl.baseQty - pl.rcvQty - pl.returnQty - pl.closeQty, 0),
        };
      }),
    };
  });
}

/* ═════════ 상세 ═════════ */

export async function getInquiryDetail(me: PlanActor, id: number): Promise<InquiryDetail | null> {
  if (!canInquiry(me)) return null;
  const scope = scopeOf(me);
  const p = await db.inboundPlan.findFirst({
    where: { id, ...scope, approvedAt: { not: null } },
    include: { lines: { select: { id: true, lineNo: true } } },
  });
  if (!p) return null;
  // 공통 상세(라인·이력)는 승인·등록 상세와 같은 함수로 (같은 범위: 화주사 담당자 = 자기 화주사, 3PL = 소속 센터)
  const base = await getPlanDetail(me, id);
  if (!base) return null;

  const lineNoOf = new Map(p.lines.map((l) => [l.id, l.lineNo]));
  const [incoming, asnLines, allocs, days, cancelCode] = await Promise.all([
    distributedByLine(p.lines.map((l) => l.id)),
    db.asnLine.findMany({
      where: { planId: id },
      include: { asn: { select: { id: true, asnNo: true, shipDate: true, vehicleNo: true, status: true } } },
      orderBy: [{ asnId: "asc" }, { lineNo: "asc" }],
    }),
    db.rcvAlloc.findMany({
      where: { planLine: { planId: id }, reverse: false },
      include: {
        rcv: { select: { rcvNo: true, vehicleNo: true, confirmedAt: true } },
        asnLine: { select: { asn: { select: { asnNo: true } } } },
        planLine: { select: { lineNo: true, unit: true, qty: true, baseQty: true, item: { select: { code: true, name: true, baseUnit: true } } } },
      },
      orderBy: [{ id: "asc" }],
    }),
    alertDays(),
    p.cancelReasonCode ? db.commonCode.findUnique({ where: { groupCode_code: { groupCode: CANCEL_GROUP, code: p.cancelReasonCode } }, select: { name: true } }) : null,
  ]);

  // 차량(ASN)별로 묶기
  const byAsn = new Map<number, InquiryDetail["vehicles"][number] & { sums: Map<ItemUnit, number> }>();
  for (const l of asnLines) {
    const v = byAsn.get(l.asn.id) ?? {
      id: l.asn.id,
      asnNo: l.asn.asnNo,
      shipDate: ymd(l.asn.shipDate),
      vehicleNo: l.asn.vehicleNo,
      status: l.asn.status,
      qtyByUnit: [],
      lineCount: 0,
      sums: new Map(),
    };
    v.lineCount++;
    v.sums.set(l.unit, (v.sums.get(l.unit) ?? 0) + l.qty);
    byAsn.set(l.asn.id, v);
  }
  const vehicles = [...byAsn.values()].map(({ sums, ...v }) => ({ ...v, qtyByUnit: UNIT_ORDER.filter((u) => sums.has(u)).map((u) => [u, sums.get(u)!] as [ItemUnit, number]) }));
  const activeAsnCount = vehicles.filter((v) => v.status !== "CANCELED").length;
  const cancelBlock = approvedCancelBlock({ status: p.status, activeAsnCount, allocCount: allocs.length });

  return {
    ...base,
    incoming: Object.fromEntries(p.lines.map((l) => [l.lineNo, OPEN_PLAN.includes(p.status) ? (incoming.get(l.id) ?? 0) : 0])),
    vehicles,
    allocs: allocs.map((a) => ({
      id: a.id,
      confirmedAt: a.rcv.confirmedAt ? iso(a.rcv.confirmedAt) : null,
      rcvNo: a.rcv.rcvNo,
      vehicleNo: a.rcv.vehicleNo,
      asnNo: a.asnLine?.asn.asnNo ?? null,
      step: a.step,
      kind: a.kind,
      lineNo: a.planLine?.lineNo ?? lineNoOf.get(a.planLineId ?? -1) ?? 0,
      itemCode: a.planLine?.item.code ?? "",
      itemName: a.planLine?.item.name ?? "",
      unit: a.planLine?.unit ?? "EA",
      baseUnit: a.planLine?.item.baseUnit ?? "EA",
      factor: a.planLine ? factorOf(a.planLine) : 1,
      qty: a.allocQty,
    })),
    cancelBlock,
    canCancel: can(me.roles, "planInquiry", "edit"),
    alertDays: days,
    cancelReasonName: cancelCode?.name ?? p.cancelReasonCode,
    cancelReasonText: p.cancelReasonText,
    canceledAt: p.canceledAt ? iso(p.canceledAt) : null,
    canceledBy: p.canceledBy,
  };
}
