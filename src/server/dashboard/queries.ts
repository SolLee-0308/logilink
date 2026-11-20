import "server-only";
/**
 * 웹 대시보드 (2026-11-17 Sol 재구성, 시안 v0.1) — 처리할 일 · 오늘 차량 흐름 · 주의할 건 · 추이(14업무일).
 * 3PL: 소속 센터, 센터가 없는 계정은 전체(센터 고르기 가능). 머리 줄에 센터별 일마감 상태.
 * 화주사: 자기 화주사 건만, 이용 센터 기준(센터 고르기 가능).
 * "오늘"은 센터별 업무일(업무일 시작 시각 기준)로 센다 — src/domain/business-day.ts
 * 두 대시보드가 같은 숫자를 내도록 센터별 집계(collect)를 함께 쓴다.
 */
import type { Center } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { alertDays } from "@/server/plans/inquiry";
import { distributablePlans } from "@/server/asn/queries";
import { ACTIVE_RCV } from "@/server/rcv/queries";
import { can, isShipperRole } from "@/domain/permissions";
import { OPEN_PLAN, addDays, overdueCutoff } from "@/domain/inquiry-rules";
import { PRE_APPROVAL, businessDateOf, businessDayRange, expireCutoff, expireDueDate, isBusinessDay, type OffDays } from "@/domain/business-day";
import { needsReason } from "@/domain/rcv-rules";
import { flowStage, lastBusinessDays } from "@/domain/dashboard-rules";
import type { DashAsnRow, DashCenter, DashFlow, DashPlanRow, DashRcvRow, DashTrendDay, DashWatch, ShipperDashboard, TplDashboard } from "@/features/dashboard/types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
/** 주의 목록에 보일 최대 줄 수 (나머지는 건수로) */
const LIST_MAX = 5;
/** 추이 기간 (2026-11-17 Sol) */
export const TREND_DAYS = 14;
/** 입고율 분모 — 승인 이후 건 (취소·승인 전 제외) */
const APPROVED_PLAN = ["APPROVED", "PARTIAL", "COMPLETED", "CLOSED"] as const;

export const canDashboard = (me: PlanActor) => can(me.roles, "dashboard", "view") && (!isShipperRole(me.roles) || !!me.clientId);

const CLIENT = { client: { select: { name: true, code: true } } } as const;

interface Collected {
  centers: DashCenter[];
  flow: DashFlow;
  /** 승인 전 + 입고예정일 지남 (취소 대상 + 유예 중), 입고예정일 순 */
  preOverdue: (DashPlanRow & { target: boolean })[];
  overdueAsn: DashAsnRow[];
  issueRcv: DashRcvRow[];
  unclosedOverdue: number;
  alertDays: number;
  trend: DashTrendDay[];
}

/**
 * 센터별 업무일로 오늘 흐름·주의 건·추이를 센다 (센터마다 업무일이 달라 센터별로 세어 더한다 — 센터 수가 적어 차례로 조회).
 * clientId가 있으면 그 화주사 건만. asnHref = 검수 결과를 보는 ASN 상세 경로(3PL·화주사 화면이 다르다).
 */
async function collect(centers: Center[], clientId: number | null, asnHref: (asnId: number) => string): Promise<Collected> {
  const now = new Date();
  const ids = centers.map((c) => c.id);
  const own = clientId ? { clientId } : {};

  // 휴무일 — 기한경과(유예 최대 30영업일)·추이(14업무일)는 최근 몇 주만 보면 된다. 정기 휴무 요일은 센터 설정
  const today0 = businessDateOf(now);
  const [holidays, days] = await Promise.all([
    db.holiday.findMany({
      where: { centerId: { in: ids }, date: { gte: asDate(addDays(today0, -70)), lte: asDate(addDays(today0, 2)) } },
      select: { centerId: true, date: true },
    }),
    alertDays(),
  ]);
  const offOf = (c: Center): OffDays => ({
    weekly: c.weeklyOffDays,
    holidays: new Set(holidays.filter((h) => h.centerId === c.id).map((h) => ymd(h.date))),
  });

  // 추이 날짜 — 센터별 최근 14업무일을 합쳐 최근 14일 (센터가 1곳이면 그 센터 달력 그대로)
  const dayOff = new Map(centers.map((c) => [c.id, offOf(c)]));
  const trendDates = [
    ...new Set(centers.flatMap((c) => lastBusinessDays(businessDateOf(now, c.businessDayStart), TREND_DAYS, (d) => isBusinessDay(d, dayOff.get(c.id)!)))),
  ]
    .sort()
    .slice(-TREND_DAYS);
  const trend = new Map<string, DashTrendDay & { leadSum: number; leadN: number }>(
    trendDates.map((d) => [d, { date: d, vehicles: 0, issueVehicles: 0, goodQty: 0, returnQty: 0, leadMinutes: null, planQty: 0, planRcvQty: 0, leadSum: 0, leadN: 0 }]),
  );
  const trendFrom = trendDates.length ? new Date(`${addDays(trendDates[0], -1)}T00:00:00+09:00`) : now;

  const out: Collected = {
    centers: [],
    flow: { waiting: 0, loading: 0, onTheWay: 0, arrived: 0, received: 0 },
    preOverdue: [],
    overdueAsn: [],
    issueRcv: [],
    unclosedOverdue: 0,
    alertDays: days,
    trend: [],
  };
  const flow = out.flow;

  for (const c of centers) {
    const today = businessDateOf(now, c.businessDayStart);
    const range = businessDayRange(today, c.businessDayStart);
    const hol = dayOff.get(c.id)!;
    const cutoff = expireCutoff(today, c.expireGraceDays, hol);
    const where = { ...own, centerId: c.id };

    const [asnWaiting, loads, rcvs, preOverdue, overdueAsn, unclosed, closed, planLines] = await Promise.all([
      db.asn.count({ where: { ...where, shipDate: asDate(today), status: "REGISTERED" } }),
      // 오늘 차량 — 오늘 출고일 ASN의 상차 + 오늘 상차한 무지시 차량
      db.load.findMany({
        where: { ...where, OR: [{ asn: { shipDate: asDate(today), status: { not: "CANCELED" } } }, { asnId: null, loadDate: asDate(today) }] },
        select: { status: true, arrivedAt: true, rcvs: { select: { status: true } } },
      }),
      // 추이(14업무일)·오늘 검수 차이 — 확정 검수
      db.rcv.findMany({
        where: { ...where, status: "CONFIRMED", confirmedAt: { gte: trendFrom, lt: range.lt } },
        orderBy: { confirmedAt: "desc" },
        include: {
          ...CLIENT,
          load: { select: { id: true, asnId: true, arrivedAt: true } },
          lines: { select: { expectBaseQty: true, goodBaseQty: true, damagedBaseQty: true, mismatchBaseQty: true, mismatch: true, zeroConfirm: true } },
        },
      }),
      db.inboundPlan.findMany({
        where: { ...where, status: { in: [...PRE_APPROVAL] }, planDate: { lt: asDate(today) } },
        orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
        include: CLIENT,
      }),
      db.asn.findMany({
        where: { ...where, status: "REGISTERED", shipDate: { lt: asDate(today) } },
        orderBy: [{ shipDate: "asc" }, { asnNo: "asc" }],
        include: CLIENT,
      }),
      db.inboundPlan.count({ where: { ...where, status: { in: [...OPEN_PLAN] }, planDate: { lte: asDate(overdueCutoff(today, days)) } } }),
      db.dailyClose.findFirst({ where: { centerId: c.id, businessDate: asDate(today) }, orderBy: { closedAt: "desc" }, select: { closedAt: true, closedBy: true } }),
      trendDates.length
        ? db.inboundPlanLine.findMany({
            where: { plan: { ...where, status: { in: [...APPROVED_PLAN] }, planDate: { gte: asDate(trendDates[0]), lte: asDate(today) } } },
            select: { baseQty: true, rcvQty: true, plan: { select: { planDate: true } } },
          })
        : Promise.resolve([]),
    ]);

    // 오늘 차량 흐름
    flow.waiting += asnWaiting;
    for (const l of loads) flow[flowStage(l)]++;

    // 확정 검수 — 추이(업무일별)와 오늘 검수 차이
    for (const r of rcvs) {
      const issueCount = r.lines.filter((l) =>
        needsReason({ expect: l.expectBaseQty, good: l.goodBaseQty, damaged: l.damagedBaseQty, mismatchQty: l.mismatchBaseQty, mismatch: l.mismatch, zeroConfirm: l.zeroConfirm, hasInputs: true }),
      ).length;
      const day = businessDateOf(r.confirmedAt!, c.businessDayStart);
      const t = trend.get(day);
      if (t) {
        t.vehicles++;
        if (issueCount > 0) t.issueVehicles++;
        for (const l of r.lines) {
          t.goodQty += l.goodBaseQty;
          t.returnQty += l.damagedBaseQty + l.mismatchBaseQty;
        }
        if (r.load.arrivedAt && r.confirmedAt! > r.load.arrivedAt) {
          t.leadSum += (r.confirmedAt!.getTime() - r.load.arrivedAt.getTime()) / 60_000;
          t.leadN++;
        }
      }
      if (day === today && issueCount > 0)
        out.issueRcv.push({
          rcvId: r.id,
          rcvNo: r.rcvNo,
          href: r.load.asnId ? asnHref(r.load.asnId) : `/plans/loads/${r.load.id}`,
          clientName: r.client.name,
          clientCode: r.client.code,
          centerName: c.name,
          vehicleNo: r.vehicleNo,
          confirmedAt: r.confirmedAt!.toISOString(),
          issueCount,
        });
    }
    for (const l of planLines) {
      const t = trend.get(ymd(l.plan.planDate));
      if (!t) continue;
      t.planQty += l.baseQty;
      t.planRcvQty += Math.min(l.rcvQty, l.baseQty);
    }

    let targets = 0;
    for (const p of preOverdue) {
      const target = ymd(p.planDate) <= cutoff;
      if (target) targets++;
      out.preOverdue.push({
        id: p.id,
        planNo: p.planNo,
        clientName: p.client.name,
        clientCode: p.client.code,
        centerName: c.name,
        planDate: ymd(p.planDate),
        status: p.status,
        dueDate: expireDueDate(ymd(p.planDate), c.expireGraceDays, hol),
        target,
      });
    }

    for (const a of overdueAsn)
      out.overdueAsn.push({ id: a.id, asnNo: a.asnNo, clientName: a.client.name, clientCode: a.client.code, centerName: c.name, vehicleNo: a.vehicleNo, shipDate: ymd(a.shipDate) });
    out.unclosedOverdue += unclosed;

    out.centers.push({
      id: c.id,
      name: c.name,
      businessDate: today,
      businessDayStart: c.businessDayStart,
      dailyCloseTime: c.dailyCloseTime,
      closed: closed ? { at: closed.closedAt.toISOString(), by: closed.closedBy } : null,
      expireTargets: targets,
    });
  }

  out.preOverdue.sort((a, b) => a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo));
  out.overdueAsn.sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.asnNo.localeCompare(b.asnNo));
  out.issueRcv.sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
  out.trend = trendDates.map((d) => {
    const { leadSum, leadN, ...t } = trend.get(d)!;
    return { ...t, leadMinutes: leadN ? Math.round(leadSum / leadN) : null };
  });
  return out;
}

/** 센터 고르기 — 고를 수 있는 센터 중에 있으면 그 센터만 */
function pick(all: Center[], centerParam: string) {
  const selected = all.length > 1 && all.some((c) => String(c.id) === centerParam) ? centerParam : "";
  return { selected, centers: selected ? all.filter((c) => String(c.id) === selected) : all };
}

const stripTarget = ({ target: _t, ...r }: DashPlanRow & { target: boolean }): DashPlanRow => r;

function watchOf(d: Collected): Omit<DashWatch, "expire" | "expireCount"> {
  return {
    overdueAsn: d.overdueAsn.slice(0, LIST_MAX),
    overdueAsnCount: d.overdueAsn.length,
    issueRcv: d.issueRcv.slice(0, LIST_MAX),
    issueCount: d.issueRcv.length,
    unclosedOverdue: d.unclosedOverdue,
    alertDays: d.alertDays,
  };
}

/* ═════════ 3PL ═════════ */

export async function tplDashboard(me: PlanActor, centerParam: string): Promise<TplDashboard | null> {
  if (!canDashboard(me) || isShipperRole(me.roles)) return null;
  const allCenters = await db.center.findMany({
    where: me.centerId ? { id: me.centerId } : { isActive: true },
    orderBy: { code: "asc" },
  });
  const { selected, centers } = pick(me.centerId ? [] : allCenters, centerParam);
  const scoped = me.centerId ? allCenters : centers;
  const ids = scoped.map((c) => c.id);
  const scope = { centerId: { in: ids } };
  // 입차 후 검수 전(입고취소 뒤 재검수 전 포함)·입차 전 — 진행·확정 검수가 없는 상차완료 차량
  const idle = { ...scope, status: "COMPLETED" as const, rcvs: { none: { status: { in: [...ACTIVE_RCV] } } } };

  const [approvalWaiting, itemRequests, arrivedRcv, arrivedLoad, onTheWay, inspecting, d] = await Promise.all([
    db.inboundPlan.count({ where: { ...scope, status: "WAITING" } }),
    // 품목 등록 요청은 센터와 무관 (메뉴 숫자와 같은 기준)
    db.itemRequest.count({ where: { status: "WAITING" } }),
    db.rcv.count({ where: { ...scope, status: "WORKING", startedAt: null } }),
    db.load.count({ where: { ...idle, arrivedAt: { not: null } } }),
    db.load.count({ where: { ...idle, arrivedAt: null } }),
    db.rcv.count({ where: { ...scope, status: "WORKING", startedAt: { not: null } } }),
    collect(scoped, null, (id) => `/plans/asn-status/${id}`),
  ]);
  const expire = d.preOverdue.filter((p) => p.target).map(stripTarget);

  return {
    now: new Date().toISOString(),
    centers: d.centers,
    centerOptions: me.centerId ? [] : allCenters.map((c) => ({ id: c.id, name: c.name })),
    selectedCenter: selected,
    todo: { approvalWaiting, itemRequests, arrivedWaiting: arrivedRcv + arrivedLoad, onTheWay, inspecting, expireTargets: expire.length },
    flow: d.flow,
    trend: d.trend,
    watch: { ...watchOf(d), expire: expire.slice(0, LIST_MAX), expireCount: expire.length },
  };
}

/* ═════════ 화주사 ═════════ */

export async function shipperDashboard(me: PlanActor, centerParam: string): Promise<ShipperDashboard | null> {
  if (!canDashboard(me) || !isShipperRole(me.roles) || !me.clientId) return null;
  const clientId = me.clientId;
  // 이용 센터 (화주사-센터 연결). 사용 중지 센터는 뺀다
  const [client, links] = await Promise.all([
    db.client.findUnique({ where: { id: clientId }, select: { name: true } }),
    db.clientCenter.findMany({ where: { clientId }, select: { centerCode: true } }),
  ]);
  const allCenters = await db.center.findMany({
    where: { code: { in: links.map((l) => l.centerCode) }, isActive: true },
    orderBy: { code: "asc" },
  });
  const { selected, centers } = pick(allCenters, centerParam);
  const ids = centers.map((c) => c.id);
  const scope = { clientId, centerId: { in: ids } };

  const [rejected, itemRejected, dist, d] = await Promise.all([
    db.inboundPlan.count({ where: { ...scope, status: "REJECTED" } }),
    // 품목 등록 요청은 센터와 무관 (화주사 단위)
    db.itemRequest.count({ where: { clientId, status: "REJECTED" } }),
    distributablePlans(clientId),
    collect(centers, clientId, (id) => `/plans/asn/${id}`),
  ]);
  const toAsn = dist.filter((p) => ids.includes(p.centerId)).length;
  const targets = d.preOverdue.filter((p) => p.target).length;

  return {
    now: new Date().toISOString(),
    clientName: client?.name ?? "",
    centers: d.centers,
    centerOptions: allCenters.length > 1 ? allCenters.map((c) => ({ id: c.id, name: c.name })) : [],
    selectedCenter: selected,
    todo: { rejected, expireTargets: targets, toAsn, itemRejected },
    flow: d.flow,
    trend: d.trend,
    watch: { ...watchOf(d), expire: d.preOverdue.slice(0, LIST_MAX), expireCount: d.preOverdue.length },
  };
}
