import "server-only";
/**
 * 3PL 웹 대시보드 — 오늘 할 일 · 오늘 흐름 · 주의할 건 · 일마감 상태 (2026-11-11 Sol).
 * 범위: 소속 센터, 센터가 없는 계정은 전체(센터 고르기 가능).
 * "오늘"은 센터별 업무일(업무일 시작 시각 기준)로 센다 — src/domain/business-day.ts
 */
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { alertDays } from "@/server/plans/inquiry";
import { ACTIVE_RCV } from "@/server/rcv/queries";
import { can } from "@/domain/permissions";
import { OPEN_PLAN, addDays, overdueCutoff } from "@/domain/inquiry-rules";
import { PRE_APPROVAL, businessDateOf, businessDayRange, expireCutoff, expireDueDate, type OffDays } from "@/domain/business-day";
import { needsReason } from "@/domain/rcv-rules";
import type { DashAsnRow, DashCenter, DashPlanRow, DashRcvRow, TplDashboard } from "@/features/dashboard/types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
/** 주의 목록에 보일 최대 줄 수 (나머지는 건수로) */
const LIST_MAX = 5;

export const canDashboard = (me: PlanActor) => can(me.roles, "dashboard", "view");

export async function tplDashboard(me: PlanActor, centerParam: string): Promise<TplDashboard | null> {
  if (!canDashboard(me)) return null;
  const now = new Date();
  const allCenters = await db.center.findMany({
    where: me.centerId ? { id: me.centerId } : { isActive: true },
    orderBy: { code: "asc" },
  });
  const selected = !me.centerId && allCenters.some((c) => String(c.id) === centerParam) ? centerParam : "";
  const centers = selected ? allCenters.filter((c) => String(c.id) === selected) : allCenters;
  const ids = centers.map((c) => c.id);
  const scope = { centerId: { in: ids } };

  // 휴무일 — 기한경과 계산은 최근 몇 주만 보면 된다 (유예 최대 30영업일 + 여유). 정기 휴무 요일은 센터 설정
  const today0 = businessDateOf(now);
  const holidays = await db.holiday.findMany({
    where: { centerId: { in: ids }, date: { gte: asDate(addDays(today0, -70)), lte: asDate(addDays(today0, 2)) } },
    select: { centerId: true, date: true },
  });
  const offOf = (c: (typeof centers)[number]): OffDays => ({
    weekly: c.weeklyOffDays,
    holidays: new Set(holidays.filter((h) => h.centerId === c.id).map((h) => ymd(h.date))),
  });

  const [approvalWaiting, inspectWaiting, inspecting, partial, days] = await Promise.all([
    db.inboundPlan.count({ where: { ...scope, status: "WAITING" } }),
    db.load.count({ where: { ...scope, status: "COMPLETED", rcvs: { none: { status: { in: [...ACTIVE_RCV] } } } } }),
    db.rcv.count({ where: { ...scope, status: "WORKING" } }),
    db.inboundPlan.count({ where: { ...scope, status: "PARTIAL" } }),
    alertDays(),
  ]);

  const flow: TplDashboard["flow"] = {
    planPre: 0,
    planApproved: 0,
    asnRegistered: 0,
    asnLoading: 0,
    asnLoaded: 0,
    asnReceived: 0,
    rcvVehicles: 0,
    rcvLines: 0,
    rcvIssueVehicles: 0,
  };
  const dashCenters: DashCenter[] = [];
  const expireRows: DashPlanRow[] = [];
  const issueRows: DashRcvRow[] = [];
  const overdueAsnRows: DashAsnRow[] = [];
  let expireTotal = 0;
  let overdueAsnTotal = 0;
  let unclosedOverdue = 0;

  // 센터마다 업무일이 다르므로 센터별로 세어 더한다 (센터 수가 적어 차례로 조회)
  for (const c of centers) {
    const today = businessDateOf(now, c.businessDayStart);
    const range = businessDayRange(today, c.businessDayStart);
    const hol = offOf(c);
    const cutoff = expireCutoff(today, c.expireGraceDays, hol);
    const where = { centerId: c.id };

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
      // 승인 전 + 입고예정일 지남 (취소 대상 + 유예 중)
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
        issueRows.push({
          rcvId: r.id,
          rcvNo: r.rcvNo,
          href: r.load.asnId ? `/plans/asn-status/${r.load.asnId}` : `/plans/loads/${r.load.id}`,
          clientName: r.client.name,
          centerName: c.name,
          vehicleNo: r.vehicleNo,
          confirmedAt: r.confirmedAt!.toISOString(),
          issueCount,
        });
      }
    }

    const targets = preOverdue.filter((p) => ymd(p.planDate) <= cutoff);
    expireTotal += targets.length;
    for (const p of targets)
      expireRows.push({
        id: p.id,
        planNo: p.planNo,
        clientName: p.client.name,
        centerName: c.name,
        planDate: ymd(p.planDate),
        status: p.status,
        dueDate: expireDueDate(ymd(p.planDate), c.expireGraceDays, hol),
      });

    overdueAsnTotal += overdueAsn.length;
    for (const a of overdueAsn)
      overdueAsnRows.push({ id: a.id, asnNo: a.asnNo, clientName: a.client.name, centerName: c.name, vehicleNo: a.vehicleNo, shipDate: ymd(a.shipDate) });
    unclosedOverdue += unclosed;

    dashCenters.push({
      id: c.id,
      name: c.name,
      businessDate: today,
      businessDayStart: c.businessDayStart,
      dailyCloseTime: c.dailyCloseTime,
      expireGraceDays: c.expireGraceDays,
      weeklyOffDays: c.weeklyOffDays,
      confirmedVehicles: rcvs.length,
      expireTargets: targets.length,
      expireGrace: preOverdue.length - targets.length,
    });
  }

  expireRows.sort((a, b) => a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo));
  overdueAsnRows.sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.asnNo.localeCompare(b.asnNo));
  issueRows.sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));

  return {
    now: now.toISOString(),
    centers: dashCenters,
    centerOptions: me.centerId ? [] : allCenters.map((c) => ({ id: c.id, name: c.name })),
    selectedCenter: selected,
    todo: { approvalWaiting, inspectWaiting, inspecting, partial, expireTargets: expireTotal },
    flow,
    watch: {
      expire: expireRows.slice(0, LIST_MAX),
      expireCount: expireTotal,
      overdueAsn: overdueAsnRows.slice(0, LIST_MAX),
      overdueAsnCount: overdueAsnTotal,
      issueRcv: issueRows.slice(0, LIST_MAX),
      unclosedOverdue,
      alertDays: days,
    },
  };
}
