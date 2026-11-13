import "server-only";
/**
 * 잔량 종결·일마감 조회 (정의서 ⑦, 2026-11-12) — 3PL 관리자·운영담당, 소속 센터(센터가 없는 계정은 전체).
 * 잔량 종결 탭: 미종결(승인·부분입고) 입고예정 전부. 기간 조건 없이 모두 보여 주고, 화주사·센터·경과·검색은 화면에서 거른다.
 */
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { can } from "@/domain/permissions";
import type { ItemUnit } from "@/domain/master";
import { OPEN_ASN, OPEN_PLAN, addDays, overdueCutoff, progressPct } from "@/domain/inquiry-rules";
import { PRE_APPROVAL, businessDateOf, expireCutoff, expireDueDate, type OffDays } from "@/domain/business-day";
import { needsReason } from "@/domain/rcv-rules";
import { alertDays } from "@/server/plans/inquiry";
import { remainOf } from "@/domain/close-rules";
import type { DailyView, RemainCloseRow } from "@/features/closing/types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const UNIT_ORDER: ItemUnit[] = ["EA", "BOX", "PLT"];
const factorOf = (l: { qty: number; baseQty: number }) => Math.max(Math.round(l.baseQty / Math.max(l.qty, 1)), 1);

export const canClosing = (me: PlanActor) => can(me.roles, "closing", "view");

export async function listRemainClose(me: PlanActor): Promise<RemainCloseRow[]> {
  if (!canClosing(me)) return [];
  const plans = await db.inboundPlan.findMany({
    where: { status: { in: [...OPEN_PLAN] }, ...(me.centerId ? { centerId: me.centerId } : {}) },
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { code: true, name: true, baseUnit: true } } } },
    },
    orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
    take: 2000,
  });
  const ids = plans.map((p) => p.id);
  const lineIds = plans.flatMap((p) => p.lines.map((l) => l.id));
  const [openAsn, lastAlloc] = await Promise.all([
    db.asnLine.findMany({ where: { planId: { in: ids }, asn: { status: { in: [...OPEN_ASN] } } }, select: { planId: true, asnId: true }, distinct: ["planId", "asnId"] }),
    db.rcvAlloc.groupBy({ by: ["planLineId"], where: { planLineId: { in: lineIds }, reverse: false }, _max: { createdAt: true } }),
  ]);
  const asnCount = new Map<number, number>();
  for (const a of openAsn) asnCount.set(a.planId, (asnCount.get(a.planId) ?? 0) + 1);
  const lastByLine = new Map(lastAlloc.map((a) => [a.planLineId, a._max.createdAt]));

  return plans.map((p) => {
    const sums = new Map<ItemUnit, number>();
    let last: Date | null = null;
    for (const l of p.lines) {
      const r = remainOf(l);
      const t = lastByLine.get(l.id);
      if (t && (!last || t > last)) last = t;
      if (r <= 0) continue;
      const f = factorOf(l);
      const [u, q] = r % f === 0 ? [l.unit, r / f] : [l.item.baseUnit, r];
      sums.set(u, (sums.get(u) ?? 0) + q);
    }
    return {
      id: p.id,
      version: p.version,
      planNo: p.planNo,
      clientId: p.clientId,
      clientName: p.client.name,
      centerId: p.centerId,
      centerName: p.center.name,
      planDate: ymd(p.planDate),
      status: p.status,
      lineCount: p.lines.length,
      remainLineCount: p.lines.filter((l) => remainOf(l) > 0).length,
      remainByUnit: UNIT_ORDER.filter((u) => sums.has(u)).map((u) => [u, sums.get(u)!]),
      pct: progressPct(p.lines),
      openAsnCount: asnCount.get(p.id) ?? 0,
      lastRcvAt: last ? last.toISOString() : null,
      closeReqMemo: p.closeReqMemo,
      itemTexts: p.lines.flatMap((l) => [l.item.code, l.item.name]),
    };
  });
}

/* ═════════ 일마감 (정의서 ⑦·D18·D21, 2026-11-12) ═════════ */

type Client = Pick<typeof db, "rcv" | "inboundPlan" | "holiday">;
type CenterRow = { id: number; businessDayStart: string; expireGraceDays: number; weeklyOffDays: number[] };

/**
 * 일마감 대상 — 화면과 실행이 같은 기준을 쓴다.
 * - 확정할 검수 실적: 그 센터의 검수 확정 건 중 아직 일마감되지 않은 것 전부(지난 업무일에 마감을 건너뛴 건·마감 뒤 확정된 건 포함)
 * - 기한경과 취소: 승인 전(승인대기·반려)이고 입고예정일 + 유예 영업일이 지금 업무일 이전(포함)인 건 (D21)
 */
export async function dailyTargets(client: Client, c: CenterRow, now: Date = new Date()) {
  const today = businessDateOf(now, c.businessDayStart);
  const holidays = await client.holiday.findMany({
    where: { centerId: c.id, date: { gte: new Date(`${addDays(today, -70)}T00:00:00Z`), lte: new Date(`${addDays(today, 2)}T00:00:00Z`) } },
    select: { date: true },
  });
  const off: OffDays = { weekly: c.weeklyOffDays, holidays: new Set(holidays.map((h) => ymd(h.date))) };
  const cutoff = expireCutoff(today, c.expireGraceDays, off);
  const [rcvs, expire] = await Promise.all([
    client.rcv.findMany({
      where: { centerId: c.id, status: "CONFIRMED", dailyCloseId: null, confirmedAt: { lte: now } },
      orderBy: [{ confirmedAt: "asc" }, { id: "asc" }],
      include: {
        client: { select: { name: true } },
        load: { select: { id: true, asnId: true, loadType: true } },
        lines: { select: { expectBaseQty: true, goodBaseQty: true, damagedBaseQty: true, mismatchBaseQty: true, mismatch: true, zeroConfirm: true } },
      },
    }),
    client.inboundPlan.findMany({
      where: { centerId: c.id, status: { in: [...PRE_APPROVAL] }, planDate: { lte: new Date(`${cutoff}T00:00:00Z`) } },
      orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
      include: { client: { select: { name: true } } },
    }),
  ]);
  return { today, off, rcvs, expire };
}

/** 확정 수량 합계 — 입고(정상)·반송(훼손 + 품목 불일치), 기준 단위 */
export function rcvSums(lines: { goodBaseQty: number; damagedBaseQty: number; mismatchBaseQty: number; mismatch: boolean }[]) {
  return {
    good: lines.reduce((s, l) => s + l.goodBaseQty, 0),
    ret: lines.reduce((s, l) => s + l.damagedBaseQty + l.mismatchBaseQty, 0),
    lineCount: lines.filter((l) => !l.mismatch).length,
  };
}

export async function dailyCloseView(me: PlanActor, centerParam: string): Promise<DailyView | null> {
  if (!canClosing(me)) return null;
  const centers = await db.center.findMany({ where: me.centerId ? { id: me.centerId } : { isActive: true }, orderBy: { code: "asc" } });
  if (!centers.length) return null;
  const c = centers.find((x) => String(x.id) === centerParam) ?? centers[0];
  const now = new Date();
  const [{ today, off, rcvs, expire }, closedToday, history, days] = await Promise.all([
    dailyTargets(db, c, now),
    db.dailyClose.findUnique({ where: { centerId_businessDate: { centerId: c.id, businessDate: new Date(`${businessDateOf(now, c.businessDayStart)}T00:00:00Z`) } } }),
    db.dailyClose.findMany({ where: { centerId: c.id }, orderBy: { businessDate: "desc" }, take: 14 }),
    alertDays(),
  ]);
  const [unclosedCount, unclosedOverdue] = await Promise.all([
    db.inboundPlan.count({ where: { centerId: c.id, status: { in: [...OPEN_PLAN] } } }),
    db.inboundPlan.count({ where: { centerId: c.id, status: { in: [...OPEN_PLAN] }, planDate: { lte: new Date(`${overdueCutoff(today, days)}T00:00:00Z`) } } }),
  ]);
  return {
    centerOptions: centers.map((x) => ({ id: x.id, name: x.name })),
    center: {
      id: c.id,
      name: c.name,
      businessDate: today,
      businessDayStart: c.businessDayStart,
      dailyCloseTime: c.dailyCloseTime,
      expireGraceDays: c.expireGraceDays,
      closed: closedToday ? { at: closedToday.closedAt.toISOString(), by: closedToday.closedBy, rcvCount: closedToday.rcvCount, expireCount: closedToday.expireCount } : null,
    },
    rcvs: rcvs.map((r) => {
      const s = rcvSums(r.lines);
      return {
        id: r.id,
        rcvNo: r.rcvNo,
        businessDate: businessDateOf(r.confirmedAt!, c.businessDayStart),
        confirmedAt: r.confirmedAt!.toISOString(),
        confirmedBy: r.confirmedBy,
        vehicleNo: r.vehicleNo,
        clientName: r.client.name,
        loadType: r.load.loadType,
        lineCount: s.lineCount,
        goodBaseQty: s.good,
        returnBaseQty: s.ret,
        issueCount: r.lines.filter((l) =>
          needsReason({ expect: l.expectBaseQty, good: l.goodBaseQty, damaged: l.damagedBaseQty, mismatchQty: l.mismatchBaseQty, mismatch: l.mismatch, zeroConfirm: l.zeroConfirm, hasInputs: true }),
        ).length,
        href: r.load.asnId ? `/plans/asn-status/${r.load.asnId}` : `/plans/loads/${r.load.id}`,
      };
    }),
    expire: expire.map((p) => ({
      id: p.id,
      planNo: p.planNo,
      clientName: p.client.name,
      planDate: ymd(p.planDate),
      status: p.status as "WAITING" | "REJECTED",
      dueDate: expireDueDate(ymd(p.planDate), c.expireGraceDays, off),
    })),
    unclosedCount,
    unclosedOverdue,
    alertDays: days,
    history: history.map((h) => ({
      id: h.id,
      businessDate: ymd(h.businessDate),
      closedAt: h.closedAt.toISOString(),
      closedBy: h.closedBy,
      rcvCount: h.rcvCount,
      rcvLineCount: h.rcvLineCount,
      goodBaseQty: h.goodBaseQty,
      returnBaseQty: h.returnBaseQty,
      expireCount: h.expireCount,
    })),
  };
}
