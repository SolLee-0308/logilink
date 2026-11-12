import "server-only";
/**
 * 웹 대시보드 — 오늘 할 일 · 오늘 흐름 · 주의할 건.
 * 3PL(2026-11-11): 소속 센터, 센터가 없는 계정은 전체(센터 고르기 가능). 일마감 상태 포함.
 * 화주사(2026-11-11): 자기 화주사 건만, 이용 센터 기준(센터 고르기 가능). 일마감 대신 센터 운영 기준.
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
import { PRE_APPROVAL, businessDateOf, businessDayRange, expireCutoff, expireDueDate, type OffDays } from "@/domain/business-day";
import { needsReason } from "@/domain/rcv-rules";
import type { DashAsnRow, DashCenter, DashFlow, DashPlanRow, DashRcvRow, ShipperDashboard, TplDashboard } from "@/features/dashboard/types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
/** 주의 목록에 보일 최대 줄 수 (나머지는 건수로) */
const LIST_MAX = 5;

export const canDashboard = (me: PlanActor) => can(me.roles, "dashboard", "view") && (!isShipperRole(me.roles) || !!me.clientId);

interface Collected {
  centers: DashCenter[];
  flow: DashFlow;
  /** 승인 전 + 입고예정일 지남 (취소 대상 + 유예 중), 입고예정일 순 */
  preOverdue: (DashPlanRow & { target: boolean })[];
  overdueAsn: DashAsnRow[];
  issueRcv: DashRcvRow[];
  unclosedOverdue: number;
  alertDays: number;
}

/**
 * 센터별 업무일로 오늘 흐름·주의 건을 센다 (센터마다 업무일이 달라 센터별로 세어 더한다 — 센터 수가 적어 차례로 조회).
 * clientId가 있으면 그 화주사 건만. asnHref = 검수 결과를 보는 ASN 상세 경로(3PL·화주사 화면이 다르다).
 */
async function collect(centers: Center[], clientId: number | null, asnHref: (asnId: number) => string): Promise<Collected> {
  const now = new Date();
  const ids = centers.map((c) => c.id);
  const own = clientId ? { clientId } : {};

  // 휴무일 — 기한경과 계산은 최근 몇 주만 보면 된다 (유예 최대 30영업일 + 여유). 정기 휴무 요일은 센터 설정
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

  const out: Collected = {
    centers: [],
    flow: { planPre: 0, planApproved: 0, asnRegistered: 0, asnLoading: 0, asnLoaded: 0, asnReceived: 0, rcvVehicles: 0, rcvLines: 0, rcvIssueVehicles: 0 },
    preOverdue: [],
    overdueAsn: [],
    issueRcv: [],
    unclosedOverdue: 0,
    alertDays: days,
  };
  const flow = out.flow;

  for (const c of centers) {
    const today = businessDateOf(now, c.businessDayStart);
    const range = businessDayRange(today, c.businessDayStart);
    const hol = offOf(c);
    const cutoff = expireCutoff(today, c.expireGraceDays, hol);
    const where = { ...own, centerId: c.id };

    const [plans, asns, rcvs, preOverdue, overdueAsn, unclosed] = await Promise.all([
      db.inboundPlan.groupBy({ by: ["status"], where: { ...where, planDate: asDate(today), status: { not: "CANCELED" } }, _count: { _all: true } }),
      db.asn.groupBy({ by: ["status"], where: { ...where, shipDate: asDate(today), status: { not: "CANCELED" } }, _count: { _all: true } }),
      db.rcv.findMany({
        where: { ...where, status: "CONFIRMED", confirmedAt: range },
        orderBy: { confirmedAt: "desc" },
        include: {
          client: { select: { name: true } },
          load: { select: { id: true, asnId: true } },
          lines: { select: { expectBaseQty: true, goodBaseQty: true, damagedBaseQty: true, mismatchBaseQty: true, mismatch: true, zeroConfirm: true } },
        },
      }),
      db.inboundPlan.findMany({
        where: { ...where, status: { in: [...PRE_APPROVAL] }, planDate: { lt: asDate(today) } },
        orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
        include: { client: { select: { name: true } } },
      }),
      db.asn.findMany({
        where: { ...where, status: "REGISTERED", shipDate: { lt: asDate(today) } },
        orderBy: [{ shipDate: "asc" }, { asnNo: "asc" }],
        include: { client: { select: { name: true } } },
      }),
      db.inboundPlan.count({ where: { ...where, status: { in: [...OPEN_PLAN] }, planDate: { lte: asDate(overdueCutoff(today, days)) } } }),
    ]);

    for (const p of plans) {
      if (PRE_APPROVAL.includes(p.status)) flow.planPre += p._count._all;
      else flow.planApproved += p._count._all;
    }
    for (const a of asns) {
      const n = a._count._all;
      if (a.status === "REGISTERED") flow.asnRegistered += n;
      else if (a.status === "LOADING") flow.asnLoading += n;
      else if (a.status === "LOADED") flow.asnLoaded += n;
      else if (a.status === "RECEIVED") flow.asnReceived += n;
    }

    for (const r of rcvs) {
      const issueCount = r.lines.filter((l) =>
        needsReason({ expect: l.expectBaseQty, good: l.goodBaseQty, damaged: l.damagedBaseQty, mismatchQty: l.mismatchBaseQty, mismatch: l.mismatch, zeroConfirm: l.zeroConfirm, hasInputs: true }),
      ).length;
      flow.rcvVehicles++;
      flow.rcvLines += r.lines.filter((l) => !l.mismatch).length;
      if (issueCount > 0) {
        flow.rcvIssueVehicles++;
        out.issueRcv.push({
          rcvId: r.id,
          rcvNo: r.rcvNo,
          href: r.load.asnId ? asnHref(r.load.asnId) : `/plans/loads/${r.load.id}`,
          clientName: r.client.name,
          centerName: c.name,
          vehicleNo: r.vehicleNo,
          confirmedAt: r.confirmedAt!.toISOString(),
          issueCount,
        });
      }
    }

    let targets = 0;
    for (const p of preOverdue) {
      const target = ymd(p.planDate) <= cutoff;
      if (target) targets++;
      out.preOverdue.push({
        id: p.id,
        planNo: p.planNo,
        clientName: p.client.name,
        centerName: c.name,
        planDate: ymd(p.planDate),
        status: p.status,
        dueDate: expireDueDate(ymd(p.planDate), c.expireGraceDays, hol),
        target,
      });
    }

    for (const a of overdueAsn)
      out.overdueAsn.push({ id: a.id, asnNo: a.asnNo, clientName: a.client.name, centerName: c.name, vehicleNo: a.vehicleNo, shipDate: ymd(a.shipDate) });
    out.unclosedOverdue += unclosed;

    out.centers.push({
      id: c.id,
      name: c.name,
      businessDate: today,
      businessDayStart: c.businessDayStart,
      dailyCloseTime: c.dailyCloseTime,
      expireGraceDays: c.expireGraceDays,
      weeklyOffDays: c.weeklyOffDays,
      confirmedVehicles: rcvs.length,
      expireTargets: targets,
      expireGrace: preOverdue.length - targets,
    });
  }

  out.preOverdue.sort((a, b) => a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo));
  out.overdueAsn.sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.asnNo.localeCompare(b.asnNo));
  out.issueRcv.sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
  return out;
}

/** 센터 고르기 — 고를 수 있는 센터 중에 있으면 그 센터만 */
function pick(all: Center[], centerParam: string) {
  const selected = all.length > 1 && all.some((c) => String(c.id) === centerParam) ? centerParam : "";
  return { selected, centers: selected ? all.filter((c) => String(c.id) === selected) : all };
}

const stripTarget = ({ target: _t, ...r }: DashPlanRow & { target: boolean }): DashPlanRow => r;

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

  const [approvalWaiting, inspectWaiting, inspecting, partial, d] = await Promise.all([
    db.inboundPlan.count({ where: { ...scope, status: "WAITING" } }),
    db.load.count({ where: { ...scope, status: "COMPLETED", rcvs: { none: { status: { in: [...ACTIVE_RCV] } } } } }),
    db.rcv.count({ where: { ...scope, status: "WORKING" } }),
    db.inboundPlan.count({ where: { ...scope, status: "PARTIAL" } }),
    collect(scoped, null, (id) => `/plans/asn-status/${id}`),
  ]);
  const expire = d.preOverdue.filter((p) => p.target).map(stripTarget);

  return {
    now: new Date().toISOString(),
    centers: d.centers,
    centerOptions: me.centerId ? [] : allCenters.map((c) => ({ id: c.id, name: c.name })),
    selectedCenter: selected,
    todo: { approvalWaiting, inspectWaiting, inspecting, partial, expireTargets: expire.length },
    flow: d.flow,
    watch: {
      expire: expire.slice(0, LIST_MAX),
      expireCount: expire.length,
      overdueAsn: d.overdueAsn.slice(0, LIST_MAX),
      overdueAsnCount: d.overdueAsn.length,
      issueRcv: d.issueRcv.slice(0, LIST_MAX),
      unclosedOverdue: d.unclosedOverdue,
      alertDays: d.alertDays,
    },
  };
}

/* ═════════ 화주사 ═════════ */

export async function shipperDashboard(me: PlanActor, centerParam: string): Promise<ShipperDashboard | null> {
  if (!canDashboard(me) || !isShipperRole(me.roles) || !me.clientId) return null;
  const clientId = me.clientId;
  // 이용 센터 (화주사-센터 연결). 사용 중지 센터는 뺀다
  const links = await db.clientCenter.findMany({ where: { clientId }, select: { centerCode: true } });
  const allCenters = await db.center.findMany({
    where: { code: { in: links.map((l) => l.centerCode) }, isActive: true },
    orderBy: { code: "asc" },
  });
  const { selected, centers } = pick(allCenters, centerParam);
  const ids = centers.map((c) => c.id);
  const scope = { clientId, centerId: { in: ids } };

  const [rejected, waiting, itemRejected, dist, inspecting, d] = await Promise.all([
    db.inboundPlan.count({ where: { ...scope, status: "REJECTED" } }),
    db.inboundPlan.count({ where: { ...scope, status: "WAITING" } }),
    // 품목 등록 요청은 센터와 무관 (화주사 단위)
    db.itemRequest.count({ where: { clientId, status: "REJECTED" } }),
    distributablePlans(clientId),
    db.rcv.count({ where: { ...scope, status: "WORKING" } }),
    collect(centers, clientId, (id) => `/plans/asn/${id}`),
  ]);
  const toAsn = dist.filter((p) => ids.includes(p.centerId)).length;
  const targets = d.preOverdue.filter((p) => p.target).length;

  return {
    now: new Date().toISOString(),
    centers: d.centers,
    centerOptions: allCenters.map((c) => ({ id: c.id, name: c.name })),
    selectedCenter: selected,
    todo: { rejected, waiting, toAsn, itemRejected, expireTargets: targets, inspecting },
    flow: d.flow,
    watch: {
      expire: d.preOverdue.slice(0, LIST_MAX).map((p) => ({ ...stripTarget(p), target: p.target })),
      expireCount: d.preOverdue.length,
      expireTargetCount: targets,
      overdueAsn: d.overdueAsn.slice(0, LIST_MAX),
      overdueAsnCount: d.overdueAsn.length,
      issueRcv: d.issueRcv.slice(0, LIST_MAX),
      unclosedOverdue: d.unclosedOverdue,
      alertDays: d.alertDays,
    },
  };
}
