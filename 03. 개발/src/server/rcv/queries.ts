import "server-only";
/**
 * 입고검수 조회 — PDA(3PL 입고검수자, 소속 센터) · 웹(ASN 상세·무지시 상차 상세의 검수 결과 카드).
 * 근거: 정의서 v1.4 ⑥ · 4-2 · 5장 · C7 · C8
 */
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanActor } from "@/server/plans/service";
import { can } from "@/domain/permissions";
import type { ItemUnit } from "@/domain/master";
import { departureOf, qtyInUnit } from "@/domain/load-rules";
import { lineDiff, needsReason, rcvLineState } from "@/domain/rcv-rules";
import { DEFAULT_BUSINESS_DAY_START, businessDateOf, businessDayRange } from "@/domain/business-day";
import type { PdaRcvDashboard, PdaRcvHistory, PdaRcvHome, PdaRcvRow, RcvLineView, RcvView } from "@/features/rcv/types";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
/** KST 하루 [시작, 끝) */
export const kstDay = (s: string) => {
  const start = new Date(`${s}T00:00:00+09:00`);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
};

export const canInspect = (me: PlanActor) => can(me.roles, "inspection", "edit");

/**
 * 검수자의 "오늘" = 소속 센터 업무일 (2026-11-17 Sol: 웹 대시보드와 같은 기준).
 * 업무일 시작(기본 06:00) 전 새벽 확정은 전날 업무일로 센다. 센터가 없는 계정은 기본 시작 시각.
 */
async function rcvDayStart(me: Pick<PlanActor, "centerId">): Promise<string> {
  if (!me.centerId) return DEFAULT_BUSINESS_DAY_START;
  const c = await db.center.findUnique({ where: { id: me.centerId }, select: { businessDayStart: true } });
  return c?.businessDayStart ?? DEFAULT_BUSINESS_DAY_START;
}

/** 검수자 범위 — 소속 센터 차량만, 센터가 없는 계정은 전체 (U19와 같은 기준) */
export const rcvCenterScope = (me: Pick<PlanActor, "centerId">): { centerId?: number } => (me.centerId ? { centerId: me.centerId } : {});

/** 진행·확정 검수 (입고취소는 4단계) */
export const ACTIVE_RCV = ["WORKING", "CONFIRMED"] as const;

const VIEW_INCLUDE = {
  client: { select: { name: true } },
  center: { select: { name: true } },
  load: {
    include: {
      loadOrder: { select: { orderNo: true } },
      asn: { select: { asnNo: true, driverName: true, lines: { select: { itemId: true, unit: true, qty: true, baseQty: true, planLine: { select: { expiryDate: true, lotNo: true } } } } } },
      inputs: { where: { canceledAt: null }, select: { itemId: true, unit: true }, orderBy: { id: "asc" } },
    },
  },
  lines: { include: { item: { select: { code: true, name: true, baseUnit: true, expiryManaged: true, lotManaged: true, uoms: { select: { unit: true, qty: true } } } } }, orderBy: { id: "asc" } },
  inputs: { include: { item: { select: { name: true } } }, orderBy: { id: "desc" } },
  images: { select: { id: true, itemId: true }, orderBy: { id: "asc" } },
  allocs: { where: { reverse: false }, include: { rcvLine: { select: { itemId: true } }, planLine: { select: { plan: { select: { id: true, planNo: true } } } } }, orderBy: { id: "asc" } },
} satisfies Prisma.RcvInclude;

type RcvFull = Prisma.RcvGetPayload<{ include: typeof VIEW_INCLUDE }>;

/** 보여 줄 단위 — ASN 지시 단위, 없으면 상차 때 처음 입력한 단위, 그것도 없으면 기준 단위 */
function unitOf(r: RcvFull, itemId: number, baseUnit: ItemUnit, uoms: { unit: ItemUnit; qty: number }[]): { showUnit: ItemUnit; showFactor: number } {
  const al = r.load.asn?.lines.find((l) => l.itemId === itemId);
  if (al) return { showUnit: al.unit, showFactor: Math.max(Math.round(al.baseQty / al.qty), 1) };
  const li = r.load.inputs.find((i) => i.itemId === itemId);
  if (li) return { showUnit: li.unit, showFactor: uoms.find((u) => u.unit === li.unit)?.qty ?? 1 };
  return { showUnit: baseUnit, showFactor: 1 };
}

function toView(r: RcvFull, meId: number | null): RcvView {
  const live = r.inputs.filter((i) => !i.canceledAt);
  const lines: RcvLineView[] = r.lines.map((l) => {
    const mine = live.filter((i) => i.itemId === l.itemId);
    const q = {
      expect: l.expectBaseQty,
      good: l.goodBaseQty,
      damaged: l.damagedBaseQty,
      mismatchQty: l.mismatchBaseQty,
      mismatch: l.mismatch,
      zeroConfirm: l.zeroConfirm,
      hasInputs: mine.length > 0,
    };
    const plan = r.load.asn?.lines.find((a) => a.itemId === l.itemId)?.planLine;
    return {
      itemId: l.itemId,
      itemCode: l.item.code,
      itemName: l.item.name,
      baseUnit: l.item.baseUnit,
      ...unitOf(r, l.itemId, l.item.baseUnit, l.item.uoms),
      ...q,
      state: rcvLineState(q),
      diff: lineDiff(q),
      needsReason: needsReason(q),
      reasonCode: l.reasonCode,
      reasonName: l.reasonName,
      reasonText: l.reasonText,
      expiryManaged: l.item.expiryManaged,
      lotManaged: l.item.lotManaged,
      expiryDate: ymd(l.expiryDate),
      lotNo: l.lotNo,
      planExpiry: ymd(plan?.expiryDate),
      planLot: plan?.lotNo ?? null,
      imageIds: r.images.filter((im) => im.itemId === l.itemId).map((im) => im.id),
      workers: [...new Set(mine.map((i) => i.workerName))],
    };
  });
  const workers = new Map<number, { workerId: number; name: string; count: number; lastAt: string }>();
  for (const i of live) {
    const w = workers.get(i.workerId) ?? { workerId: i.workerId, name: i.workerName, count: 0, lastAt: iso(i.inputAt)! };
    w.count += 1;
    if (iso(i.inputAt)! > w.lastAt) w.lastAt = iso(i.inputAt)!;
    workers.set(i.workerId, w);
  }
  const lineOf = new Map(lines.map((l) => [l.itemId, l]));
  return {
    id: r.id,
    rcvNo: r.rcvNo,
    status: r.status,
    startedAt: iso(r.startedAt),
    arrivedAt: iso(r.load.arrivedAt),
    arrivedBy: r.load.arrivedBy,
    departure: departureOf(r.load),
    voided: r.status === "VOIDED" && r.voidedAt ? { at: iso(r.voidedAt)!, by: r.voidedBy ?? "", reasonName: r.voidReasonName ?? "", reasonText: r.voidReasonText } : null,
    canVoid: r.status === "WORKING" && !r.startedAt && r.inputs.length === 0 && !r.lines.some((l) => l.zeroConfirm),
    clientName: r.client.name,
    centerName: r.center.name,
    vehicleNo: r.vehicleNo,
    load: {
      id: r.load.id,
      loadNo: r.load.loadNo,
      type: r.load.loadType,
      completedAt: iso(r.load.completedAt),
      asnNo: r.load.asn?.asnNo ?? null,
      orderNo: r.load.loadOrder?.orderNo ?? null,
      driverName: r.load.asn?.driverName ?? null,
    },
    lines,
    inputs: r.inputs.map((i) => ({
      id: i.id,
      itemId: i.itemId,
      itemName: i.item.name,
      kind: i.kind,
      unit: i.unit,
      addQty: i.addQty,
      baseQty: i.baseQty,
      workerName: i.workerName,
      inputAt: iso(i.inputAt)!,
      canceled: !!i.canceledAt,
      corrected: !!i.correctsId,
      mine: meId !== null && i.workerId === meId,
    })),
    workers: [...workers.values()],
    lastInputId: r.inputs[0]?.id ?? 0,
    createdAt: iso(r.createdAt)!,
    createdBy: r.createdBy,
    confirmedAt: iso(r.confirmedAt),
    confirmedBy: r.confirmedBy,
    allocs: r.allocs.map((a) => {
      const l = lineOf.get(a.rcvLine.itemId);
      return {
        itemName: l?.itemName ?? "",
        kind: a.kind,
        step: a.step,
        planNo: a.planLine?.plan.planNo ?? null,
        planId: a.planLine?.plan.id ?? null,
        qty: l ? qtyInUnit(a.allocQty, l.showUnit, l.showFactor, l.baseUnit) : String(a.allocQty),
      };
    }),
  };
}

/** PDA 검수 화면 — 소속 센터 검수만 */
export async function getPdaRcv(me: PlanActor, id: number): Promise<RcvView | null> {
  if (!canInspect(me)) return null;
  const r = await db.rcv.findFirst({ where: { id, ...rcvCenterScope(me) }, include: VIEW_INCLUDE });
  return r ? toView(r, me.id) : null;
}

/** 웹 — 상차 실적의 검수 결과 (ASN 상세·무지시 상차 상세. 범위 검사는 호출하는 화면이 이미 했다) */
export async function getRcvOfLoad(loadId: number): Promise<RcvView | null> {
  const r = await db.rcv.findFirst({ where: { loadId, status: { in: [...ACTIVE_RCV] } }, include: VIEW_INCLUDE, orderBy: { id: "desc" } });
  return r ? toView(r, null) : null;
}

/* ═════════ PDA 목록 ═════════ */

const ROW_INCLUDE = {
  client: { select: { name: true } },
  center: { select: { name: true } },
  load: {
    select: {
      id: true, loadNo: true, loadType: true, completedAt: true, arrivedAt: true, departedAt: true, departedBy: true, departType: true,
      loadOrder: { select: { orderNo: true } }, _count: { select: { lines: true } },
    },
  },
  inputs: { where: { canceledAt: null }, select: { workerId: true } },
  lines: { select: { expectBaseQty: true, goodBaseQty: true, damagedBaseQty: true, mismatchBaseQty: true, mismatch: true, zeroConfirm: true } },
} satisfies Prisma.RcvInclude;

const rcvRow = (r: Prisma.RcvGetPayload<{ include: typeof ROW_INCLUDE }>): PdaRcvRow => ({
  rcvId: r.id,
  arrivedAt: iso(r.load.arrivedAt),
  startedAt: iso(r.startedAt),
  departure: departureOf(r.load),
  rcvNo: r.rcvNo,
  loadId: r.load.id,
  loadNo: r.load.loadNo,
  loadType: r.load.loadType,
  vehicleNo: r.vehicleNo,
  clientName: r.client.name,
  centerName: r.center.name,
  orderNo: r.load.loadOrder?.orderNo ?? null,
  lineCount: r.lines.filter((l) => !l.mismatch).length,
  loadCompletedAt: iso(r.load.completedAt),
  inputCount: r.inputs.length,
  workerCount: new Set(r.inputs.map((i) => i.workerId)).size,
  confirmedAt: iso(r.confirmedAt),
  confirmedBy: r.confirmedBy,
  issueCount: r.lines.filter((l) =>
    needsReason({ expect: l.expectBaseQty, good: l.goodBaseQty, damaged: l.damagedBaseQty, mismatchQty: l.mismatchBaseQty, mismatch: l.mismatch, zeroConfirm: l.zeroConfirm, hasInputs: true }),
  ).length,
});

/**
 * PDA 입고검수 — 입차 전·도착·검수 대기·검수 중·확정 차량 (2026-11-12 Sol: 검수 내역을 합침, v1.9: 입차·검수 시작 구분)
 * 날짜 규칙: 확정 전 차량은 남은 일이라 날짜와 상관없이 모두, 확정은 그 날짜(확정 시각 KST)
 */
export async function pdaRcvHome(me: PlanActor, date?: string): Promise<PdaRcvHome | null> {
  if (!canInspect(me)) return null;
  const start = await rcvDayStart(me);
  const today = businessDateOf(new Date(), start);
  const day = date && date <= today ? date : today;
  const scope = rcvCenterScope(me);
  const [loads, working, done] = await Promise.all([
    // 진행·확정 검수가 없는 상차완료 차량 — 입차 전(오는 중), 또는 입고취소 뒤 다시 검수할 차량(입차 기록 있음)
    db.load.findMany({
      where: { ...scope, status: "COMPLETED", rcvs: { none: { status: { in: [...ACTIVE_RCV] } } } },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      include: { client: { select: { name: true } }, center: { select: { name: true } }, loadOrder: { select: { orderNo: true } }, _count: { select: { lines: true } } },
    }),
    db.rcv.findMany({ where: { ...scope, status: "WORKING" }, orderBy: { id: "desc" }, include: ROW_INCLUDE }),
    db.rcv.findMany({ where: { ...scope, status: "CONFIRMED", confirmedAt: businessDayRange(day, start) }, orderBy: [{ confirmedAt: "desc" }, { id: "desc" }], include: ROW_INCLUDE }),
  ]);
  const loadRow = (l: (typeof loads)[number]): PdaRcvRow => ({
      rcvId: null,
      arrivedAt: iso(l.arrivedAt),
      startedAt: null,
      departure: departureOf(l),
      rcvNo: null,
      loadId: l.id,
      loadNo: l.loadNo,
      loadType: l.loadType,
      vehicleNo: l.vehicleNo,
      clientName: l.client.name,
      centerName: l.center.name,
      orderNo: l.loadOrder?.orderNo ?? null,
      lineCount: l._count.lines,
      loadCompletedAt: iso(l.completedAt),
      inputCount: 0,
      workerCount: 0,
      confirmedAt: null,
      confirmedBy: null,
      issueCount: 0,
    });
  const rows = working.map(rcvRow);
  return {
    today,
    date: day,
    waiting: loads.filter((l) => !l.arrivedAt).map(loadRow),
    // 도착·검수 대기: 입차하고 첫 입력 전인 전표 + 입고취소 뒤 재검수 전 차량. 입차 순
    arrived: [...rows.filter((r) => !r.startedAt), ...loads.filter((l) => l.arrivedAt).map(loadRow)].sort((a, b) => (a.arrivedAt ?? "").localeCompare(b.arrivedAt ?? "")),
    working: rows.filter((r) => !!r.startedAt),
    done: done.map(rcvRow),
  };
}

/** 검수 내역 — 그 업무일(확정 시각, 센터 업무일 기준)에 확정한 차량, 최근이 앞 */
export async function pdaRcvHistory(me: PlanActor, date: string): Promise<PdaRcvHistory | null> {
  if (!canInspect(me)) return null;
  const start = await rcvDayStart(me);
  const rows = await db.rcv.findMany({
    where: { ...rcvCenterScope(me), status: "CONFIRMED", confirmedAt: businessDayRange(date, start) },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    include: ROW_INCLUDE,
  });
  return { date, today: businessDateOf(new Date(), start), rows: rows.map(rcvRow) };
}

/**
 * 입고검수자 대시보드 (임시안 U45-⑦, 2026-11-17 Sol 재구성) — 센터 업무일 기준.
 * 진행률 = 오늘 도착한 차량(도착·검수 대기 + 검수 중 + 확정) 중 확정. 입차 전(오는 중)은 보조 글로만.
 */
export async function pdaRcvDashboard(me: PlanActor): Promise<PdaRcvDashboard | null> {
  const home = await pdaRcvHome(me);
  if (!home) return null;
  const start = await rcvDayStart(me);
  const myInputs = await db.rcvInput.count({ where: { workerId: me.id, canceledAt: null, inputAt: { gte: businessDayRange(home.today, start).gte } } });
  return {
    today: home.today,
    waiting: home.waiting.length,
    arrived: home.arrived.length,
    working: home.working.length,
    done: home.done.length,
    issueDone: home.done.filter((r) => r.issueCount > 0).length,
    myInputs,
    recent: home.done.slice(0, 3),
  };
}

/** 사진 한 장 — 검수자(소속 센터) 또는 3PL 웹 사용자만 (route에서 권한 검사) */
export async function rcvImage(id: number) {
  return db.rcvImage.findUnique({ where: { id }, select: { mime: true, data: true, rcv: { select: { centerId: true, clientId: true } } } });
}
