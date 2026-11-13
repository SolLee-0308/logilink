import "server-only";
/**
 * 입고검수 실적 조회 (2026-11-12) — 3PL 관리자·운영담당, 소속 센터(센터가 없는 계정은 전체). 조회 전용.
 * 기간은 센터 업무일(D21) 기준 — 확정 건은 확정 시각, 검수 중은 시작 시각이 속한 업무일.
 * 업무일 시작 시각이 센터마다 달라 하루 넓게 읽은 뒤 업무일로 다시 거른다.
 */
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { can } from "@/domain/permissions";
import { addDays } from "@/domain/inquiry-rules";
import { businessDateOf } from "@/domain/business-day";
import { needsReason } from "@/domain/rcv-rules";
import { REVERSE_LOCKED_PLAN, rcvCancelBlock } from "@/domain/rcv-cancel-rules";
import { rcvSums } from "@/server/plans/closing";
import type { RcvResultQuery, RcvResultRow } from "@/features/rcv-results/types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const kstStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 9 * 3_600_000);

export const canRcvResults = (me: PlanActor) => can(me.roles, "rcvResults", "view");

export async function listRcvResults(me: PlanActor, q: RcvResultQuery): Promise<RcvResultRow[]> {
  if (!canRcvResults(me)) return [];
  const confirmed = q.tab === "confirmed";
  const canceled = q.tab === "canceled";
  // 업무일 범위보다 하루씩 넓게 (업무일 시작 시각이 06:00 등이라 달력 날짜와 어긋난다)
  const range = { ...(q.from ? { gte: kstStart(addDays(q.from, -1)) } : {}), ...(q.to ? { lt: kstStart(addDays(q.to, 2)) } : {}) };
  const rows = await db.rcv.findMany({
    where: {
      ...(me.centerId ? { centerId: me.centerId } : {}),
      status: confirmed ? "CONFIRMED" : canceled ? "CANCELED" : "WORKING",
      ...(q.from || q.to ? (confirmed ? { confirmedAt: range } : canceled ? { reverseDoc: { createdAt: range } } : { createdAt: range }) : {}),
    },
    orderBy: confirmed ? [{ confirmedAt: "desc" }, { id: "desc" }] : [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      client: { select: { name: true } },
      center: { select: { name: true, businessDayStart: true } },
      load: { select: { id: true, loadNo: true, loadType: true, asnId: true, asn: { select: { asnNo: true } } } },
      dailyClose: { select: { businessDate: true } },
      reverseDoc: true,
      // 입고취소 가능 여부 — 배분된 입고예정이 종결·취소되었는지
      allocs: { where: { reverse: false, planLineId: { not: null } }, select: { planLine: { select: { plan: { select: { planNo: true, status: true } } } } } },
      inputs: { where: { canceledAt: null }, select: { workerId: true } },
      lines: {
        select: {
          expectBaseQty: true, goodBaseQty: true, damagedBaseQty: true, mismatchBaseQty: true, mismatch: true, zeroConfirm: true,
          item: { select: { code: true, name: true } },
        },
      },
    },
    take: 2000,
  });
  return rows
    .map((r) => {
      const at = confirmed ? r.confirmedAt! : canceled && r.reverseDoc ? r.reverseDoc.createdAt : r.createdAt;
      const locked = [...new Set(r.allocs.filter((a) => a.planLine && REVERSE_LOCKED_PLAN.includes(a.planLine.plan.status)).map((a) => a.planLine!.plan.planNo))];
      const s = rcvSums(r.lines);
      return {
        id: r.id,
        rcvNo: r.rcvNo,
        version: r.version,
        status: r.status as "WORKING" | "CONFIRMED" | "CANCELED",
        businessDate: businessDateOf(at, r.center.businessDayStart),
        startedAt: r.createdAt.toISOString(),
        confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
        confirmedBy: r.confirmedBy,
        vehicleNo: r.vehicleNo,
        clientId: r.clientId,
        clientName: r.client.name,
        centerId: r.centerId,
        centerName: r.center.name,
        loadType: r.load.loadType,
        loadNo: r.load.loadNo,
        asnNo: r.load.asn?.asnNo ?? null,
        lineCount: s.lineCount,
        goodBaseQty: s.good,
        returnBaseQty: s.ret,
        cancelBlock: confirmed ? rcvCancelBlock({ status: r.status, dailyClosed: !!r.dailyCloseId, lockedPlanNos: locked }) : null,
        reverse: r.reverseDoc
          ? {
              no: r.reverseDoc.reverseNo,
              reasonName: r.reverseDoc.reasonName,
              reasonText: r.reverseDoc.reasonText,
              at: r.reverseDoc.createdAt.toISOString(),
              by: r.reverseDoc.createdBy,
              goodBaseQty: r.reverseDoc.goodBaseQty,
              returnBaseQty: r.reverseDoc.returnBaseQty,
            }
          : null,
        issueCount: confirmed || canceled
          ? r.lines.filter((l) =>
              needsReason({ expect: l.expectBaseQty, good: l.goodBaseQty, damaged: l.damagedBaseQty, mismatchQty: l.mismatchBaseQty, mismatch: l.mismatch, zeroConfirm: l.zeroConfirm, hasInputs: true }),
            ).length
          : 0,
        closedDate: r.dailyClose ? ymd(r.dailyClose.businessDate) : null,
        workerCount: new Set(r.inputs.map((i) => i.workerId)).size,
        href: r.load.asnId ? `/plans/asn-status/${r.load.asnId}` : `/plans/loads/${r.load.id}`,
        itemTexts: r.lines.flatMap((l) => [l.item.code, l.item.name]),
      } satisfies RcvResultRow;
    })
    .filter((r) => (!q.from || r.businessDate >= q.from) && (!q.to || r.businessDate <= q.to));
}
