import "server-only";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import type { ItemUnit } from "@/domain/master";
import { can } from "@/domain/permissions";
import { kstDayRange, todayKst } from "@/lib/format";
import type { ApprovalRow, ApprovalTab, PlanDetail } from "@/features/plans/types";

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const UNIT_ORDER: ItemUnit[] = ["EA", "BOX", "PLT"];

/** 3PL 사용자는 자기 센터 건만 본다 (센터가 없는 계정은 전체) */
const centerScope = (me: PlanActor) => (me.centerId ? { centerId: me.centerId } : {});

const rowInclude = {
  client: { select: { name: true } },
  center: { select: { name: true } },
  lines: { select: { unit: true, qty: true, item: { select: { code: true, name: true } } } },
} as const;

type RowSource = Awaited<ReturnType<typeof loadRows>>[number];
const loadRows = (where: object) =>
  db.inboundPlan.findMany({ where, include: rowInclude, orderBy: [{ planDate: "asc" }, { planNo: "asc" }] });

function toRow(p: RowSource, tab: ApprovalTab): ApprovalRow {
  const sums = new Map<ItemUnit, number>();
  for (const l of p.lines) sums.set(l.unit, (sums.get(l.unit) ?? 0) + l.qty);
  return {
    id: p.id,
    planNo: p.planNo,
    tab,
    clientId: p.clientId,
    clientName: p.client.name,
    centerName: p.center.name,
    planDate: ymd(p.planDate),
    status: p.status,
    revisionNo: p.revisionNo,
    version: p.version,
    inputMethod: p.inputMethod,
    savedAt: iso(p.savedAt),
    savedBy: p.savedBy,
    lineCount: p.lines.length,
    qtyByUnit: UNIT_ORDER.filter((u) => sums.has(u)).map((u) => [u, sums.get(u)!]),
    itemTexts: p.lines.flatMap((l) => [l.item.code, l.item.name]),
  };
}

/** 승인 대기 화면 목록 — 승인대기 / 반려(화주사 수정 중) / 오늘 내가 승인·반려한 건 */
export async function listApproval(me: PlanActor): Promise<ApprovalRow[]> {
  if (!can(me.role, "approval", "view")) return [];
  const { start, end } = kstDayRange(todayKst());
  const [open, mine] = await Promise.all([
    loadRows({ ...centerScope(me), status: { in: ["WAITING", "REJECTED"] } }),
    db.inboundPlanHistory.findMany({
      where: { actorId: me.id, action: { in: ["APPROVE", "REJECT"] }, at: { gte: start, lt: end } },
      orderBy: { at: "desc" },
      select: { planId: true, action: true, at: true },
    }),
  ]);
  const rows = open.map((p) => toRow(p, p.status === "WAITING" ? "wait" : "rej"));
  // 같은 건을 오늘 여러 번 처리했으면(반려 → 재요청 → 승인) 마지막 처리만
  const last = new Map<number, (typeof mine)[number]>();
  for (const h of mine) if (!last.has(h.planId)) last.set(h.planId, h);
  if (last.size) {
    const done = await loadRows({ ...centerScope(me), id: { in: [...last.keys()] } });
    for (const p of done) {
      const h = last.get(p.id)!;
      rows.push({ ...toRow(p, "done"), processed: { action: h.action as "APPROVE" | "REJECT", at: iso(h.at) } });
    }
  }
  return rows;
}

export async function countApprovalWaiting(me: PlanActor) {
  if (!can(me.role, "approval", "view")) return 0;
  return db.inboundPlan.count({ where: { ...centerScope(me), status: "WAITING" } });
}

/** 상세 — 라인·가장 최근 반려본·처리 이력 */
export async function getPlanDetail(me: PlanActor, id: number): Promise<PlanDetail | null> {
  if (!can(me.role, "approval", "view")) return null;
  const p = await db.inboundPlan.findFirst({
    where: { id, ...centerScope(me) },
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { code: true, name: true, baseUnit: true, expiryManaged: true, lotManaged: true } } } },
      rejects: { orderBy: { revisionNo: "desc" }, take: 1, include: { lines: { orderBy: { lineNo: "asc" } } } },
      histories: { orderBy: { at: "desc" } },
    },
  });
  if (!p) return null;
  const base = toRow({ ...p, lines: p.lines.map((l) => ({ unit: l.unit, qty: l.qty, item: { code: l.item.code, name: l.item.name } })) }, "wait");
  const rej = p.rejects[0];
  return {
    id: base.id,
    planNo: base.planNo,
    clientId: base.clientId,
    clientName: base.clientName,
    centerName: base.centerName,
    planDate: base.planDate,
    status: base.status,
    revisionNo: base.revisionNo,
    version: base.version,
    inputMethod: base.inputMethod,
    savedAt: base.savedAt,
    savedBy: base.savedBy,
    lineCount: base.lineCount,
    qtyByUnit: base.qtyByUnit,
    memo: p.memo,
    approvedRevisionNo: p.approvedRevisionNo,
    approvedAt: p.approvedAt ? iso(p.approvedAt) : null,
    approvedBy: p.approvedBy,
    lines: p.lines.map((l) => ({
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemCode: l.item.code,
      itemName: l.item.name,
      unit: l.unit,
      qty: l.qty,
      baseUnit: l.item.baseUnit,
      baseQty: l.baseQty,
      expiryDate: l.expiryDate ? ymd(l.expiryDate) : null,
      lotNo: l.lotNo,
      expiryManaged: l.item.expiryManaged,
      lotManaged: l.item.lotManaged,
    })),
    lastReject: rej
      ? {
          revisionNo: rej.revisionNo,
          reasonCode: rej.reasonCode,
          reasonName: rej.reasonName,
          reasonText: rej.reasonText,
          rejectedBy: rej.rejectedBy,
          rejectedAt: iso(rej.rejectedAt),
          planDate: ymd(rej.planDate),
          lines: rej.lines.map((l) => ({ lineNo: l.lineNo, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, unit: l.unit, qty: l.qty })),
        }
      : null,
    histories: p.histories.map((h) => ({
      id: h.id.toString(),
      action: h.action,
      version: h.version,
      revisionNo: h.revisionNo,
      actor: h.actor,
      at: iso(h.at),
      reasonName: h.reasonName,
      reasonText: h.reasonText,
    })),
  };
}
