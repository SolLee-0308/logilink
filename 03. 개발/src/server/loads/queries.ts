import "server-only";
/**
 * 상차 실적 조회 — PDA(화주사 상차담당, 자기 화주사)·웹(화주사 담당자: 자기 화주사 / 3PL: 소속 센터).
 * 근거: 정의서 v1.4 ④ · 4-2 · 9장 · C5 · C6
 */
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanActor } from "@/server/plans/service";
import { centerChoices } from "@/server/plans/entry";
import { can } from "@/domain/permissions";
import type { ItemUnit } from "@/domain/master";
import { LOADABLE_ASN, TODAY_ASN_COUNTED, hasLoadDiff, lineState } from "@/domain/load-rules";
import { todayKst } from "@/lib/format";
import type { LoadConfirmPrint, LoadView, PdaHistory, PdaHome, PdaLoadDashboard, PdaWorkingRow } from "@/features/loads/types";

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

type Tx = Prisma.TransactionClient | typeof db;

export const canLoad = (me: PlanActor) => can(me.roles, "loading", "edit") && !!me.clientId;

/** 웹 조회 범위 — 화주사 담당자는 자기 화주사, 3PL은 소속 센터(센터가 없으면 전체). 권한이 없으면 null */
export function webLoadScope(me: PlanActor): Prisma.LoadWhereInput | null {
  if (can(me.roles, "asn", "view") && me.clientId) return { clientId: me.clientId };
  if (can(me.roles, "asnStatus", "view")) return me.centerId ? { centerId: me.centerId } : {};
  return null;
}

/**
 * "당일 ASN 품목" (C5·D10) — 같은 화주사·같은 센터, 출고일이 오늘인 취소되지 않은 ASN에 들어 있는 품목.
 * 무지시 상차는 이 품목만 실을 수 있고, 지시 상차는 자기 ASN 품목에 더해 이 품목도 (경고 후) 실을 수 있다.
 */
export async function todayAsnItemIds(clientId: number, centerId: number, today: string, tx: Tx = db): Promise<Set<number>> {
  const rows = await tx.asnLine.findMany({
    where: { asn: { clientId, centerId, shipDate: asDate(today), status: { in: [...TODAY_ASN_COUNTED] } } },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  return new Set(rows.map((r) => r.itemId));
}

const viewInclude = {
  client: { select: { name: true } },
  center: { select: { name: true } },
  asn: {
    select: {
      id: true, asnNo: true, status: true, shipDate: true, driverName: true, driverTel: true,
      loadOrder: { select: { orderNo: true } },
      lines: { select: { itemId: true, unit: true } },
    },
  },
  lines: { include: { item: { select: { code: true, clientCode: true, name: true, baseUnit: true, uoms: { select: { unit: true, qty: true } } } } } },
  inputs: { orderBy: { id: "desc" }, include: { item: { select: { code: true, clientCode: true, name: true } } } },
  // 상차 재개 가능 여부(검수 시작 전) · 마지막 재개 (정의서 v1.5 D20)
  rcvs: { where: { status: { in: ["WORKING", "CONFIRMED"] } }, select: { id: true } },
  histories: { where: { action: "REOPEN" }, orderBy: { id: "desc" }, take: 1 },
} satisfies Prisma.LoadInclude;

type LoadRow = Prisma.LoadGetPayload<{ include: typeof viewInclude }>;

function toView(l: LoadRow, meId: number | null): LoadView {
  // 보여 줄 단위: ASN 지시 단위 → 처음 스캔한 단위 → 기준 단위
  const asnUnit = new Map<number, ItemUnit>();
  for (const a of l.asn?.lines ?? []) if (!asnUnit.has(a.itemId)) asnUnit.set(a.itemId, a.unit);
  const firstUnit = new Map<number, ItemUnit>();
  for (const i of [...l.inputs].reverse()) if (!firstUnit.has(i.itemId)) firstUnit.set(i.itemId, i.unit);

  const lines = l.lines
    .map((d) => {
      const showUnit = asnUnit.get(d.itemId) ?? firstUnit.get(d.itemId) ?? d.item.baseUnit;
      const showFactor = d.item.uoms.find((u) => u.unit === showUnit)?.qty ?? 1;
      return {
        itemId: d.itemId,
        itemCode: d.item.code,
        itemClientCode: d.item.clientCode,
        itemName: d.item.name,
        baseUnit: d.item.baseUnit,
        showUnit,
        showFactor,
        orderBase: d.orderBaseQty,
        loadBase: d.loadBaseQty,
        state: lineState(d.orderBaseQty, d.loadBaseQty),
      };
    })
    // 지시 품목 먼저(품목코드 순), 그다음 지시 외 품목. 지시도 상차도 0인 줄(입력을 모두 취소한 지시 외 품목)은 뺀다
    .filter((d) => d.orderBase > 0 || d.loadBase > 0)
    .sort((a, b) => Number(a.orderBase === 0) - Number(b.orderBase === 0) || a.itemCode.localeCompare(b.itemCode));

  const workers = new Map<number, { workerId: number; name: string; count: number; lastAt: string }>();
  for (const i of l.inputs) {
    if (i.canceledAt) continue;
    const w = workers.get(i.workerId) ?? { workerId: i.workerId, name: i.workerName, count: 0, lastAt: iso(i.inputAt) };
    w.count++;
    if (iso(i.inputAt) > w.lastAt) w.lastAt = iso(i.inputAt);
    workers.set(i.workerId, w);
  }
  const ordered = l.loadType === "ORDERED";
  return {
    id: l.id,
    loadNo: l.loadNo,
    type: l.loadType,
    status: l.status,
    version: l.version,
    revisionNo: l.revisionNo,
    canReopen: l.status === "COMPLETED" && l.rcvs.length === 0,
    lastReopen: l.histories[0]
      ? { at: iso(l.histories[0].at), by: l.histories[0].actor, reasonName: l.histories[0].reasonName, reasonText: l.histories[0].reasonText }
      : null,
    clientName: l.client.name,
    centerId: l.centerId,
    centerName: l.center.name,
    vehicleNo: l.vehicleNo,
    loadDate: ymd(l.loadDate),
    asn: l.asn
      ? {
          id: l.asn.id,
          asnNo: l.asn.asnNo,
          status: l.asn.status,
          shipDate: ymd(l.asn.shipDate),
          orderNo: l.asn.loadOrder?.orderNo ?? null,
          driverName: l.asn.driverName,
          driverTel: l.asn.driverTel,
        }
      : null,
    lines,
    inputs: l.inputs.map((i) => ({
      id: i.id,
      itemId: i.itemId,
      itemCode: i.item.code,
      itemClientCode: i.item.clientCode,
      itemName: i.item.name,
      unit: i.unit,
      addQty: i.addQty,
      baseQty: i.baseQty,
      workerId: i.workerId,
      workerName: i.workerName,
      deviceId: i.deviceId,
      inputAt: iso(i.inputAt),
      canceled: !!i.canceledAt,
      corrected: i.correctsId !== null,
      mine: meId !== null && i.workerId === meId,
    })),
    workers: [...workers.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    lastInputId: l.inputs[0]?.id ?? 0,
    hasDiff: hasLoadDiff(ordered, lines),
    createdAt: iso(l.createdAt),
    createdBy: l.createdBy,
    completedAt: l.completedAt ? iso(l.completedAt) : null,
    completedBy: l.completedBy,
    diffReasonName: l.diffReasonName,
    diffReasonText: l.diffReasonText,
  };
}

async function findView(where: Prisma.LoadWhereInput, meId: number | null): Promise<LoadView | null> {
  const l = await db.load.findFirst({ where, include: viewInclude });
  return l ? toView(l, meId) : null;
}

/** PDA 작업 화면 — 자기 화주사 실적만 */
export async function getPdaLoad(me: PlanActor, id: number): Promise<LoadView | null> {
  if (!canLoad(me)) return null;
  return findView({ id, clientId: me.clientId! }, me.id);
}

/** 웹 상차 실적 (ASN 상세 안 · 무지시 상차 상세) */
export async function getLoadView(me: PlanActor, id: number): Promise<LoadView | null> {
  const scope = webLoadScope(me);
  if (!scope) return null;
  return findView({ id, ...scope }, null);
}

/** ASN에 딸린 상차 실적 (없으면 null) — 상차지시서를 스캔하기 전 */
export async function getLoadOfAsn(asnId: number): Promise<LoadView | null> {
  return findView({ asnId }, null);
}

/** 상차확인서 인쇄 — 상차완료 실적만. 발송인 = 화주사 법인, 수신 = 센터 */
export async function getLoadConfirmPrint(me: PlanActor, id: number): Promise<LoadConfirmPrint | null> {
  const v = await getLoadView(me, id);
  if (!v || v.status !== "COMPLETED") return null;
  const l = await db.load.findUniqueOrThrow({ where: { id }, select: { clientId: true } });
  const [client, center] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: l.clientId } }),
    db.center.findUniqueOrThrow({ where: { id: v.centerId } }),
  ]);
  return {
    ...v,
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

/** PDA 목록 카드 한 줄에 필요한 관계 */
const ROW_INCLUDE = {
  center: { select: { name: true } },
  loadOrder: { select: { orderNo: true } },
  inputs: { where: { canceledAt: null }, select: { workerId: true } },
} satisfies Prisma.LoadInclude;

type RowLoad = Prisma.LoadGetPayload<{ include: typeof ROW_INCLUDE }>;

const pdaRow = (l: RowLoad): PdaWorkingRow => ({
  loadId: l.id,
  loadNo: l.loadNo,
  type: l.loadType,
  vehicleNo: l.vehicleNo,
  centerName: l.center.name,
  orderNo: l.loadOrder?.orderNo ?? null,
  inputCount: l.inputs.length,
  workerCount: new Set(l.inputs.map((i) => i.workerId)).size,
  completedAt: l.completedAt ? iso(l.completedAt) : null,
  completedBy: l.completedBy,
  diffReasonName: l.diffReasonName,
});

/** PDA 상차내역 — 자기 화주사의 그 날짜(상차일) 상차완료 차량, 최근 완료가 앞 */
export async function pdaLoadHistory(me: PlanActor, date: string): Promise<PdaHistory | null> {
  if (!canLoad(me)) return null;
  const rows = await db.load.findMany({
    where: { clientId: me.clientId!, status: "COMPLETED", loadDate: asDate(date) },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    include: ROW_INCLUDE,
  });
  return { date, today: todayKst(), rows: rows.map(pdaRow) };
}

/** PDA 대시보드(상차담당) — 오늘 상차할·작업 중·완료 차량과 내 입력 건수 (임시안 U41) */
export async function pdaLoadDashboard(me: PlanActor): Promise<PdaLoadDashboard | null> {
  const home = await pdaHome(me);
  if (!home) return null;
  const start = new Date(`${home.today}T00:00:00+09:00`);
  const myInputs = await db.loadInput.count({ where: { workerId: me.id, canceledAt: null, inputAt: { gte: start } } });
  return {
    today: home.today,
    todo: home.orders.filter((o) => !o.loadId).length,
    working: home.working.length,
    done: home.done.length,
    unorderedDone: home.done.filter((d) => d.type === "UNORDERED").length,
    diffDone: home.done.filter((d) => !!d.diffReasonName).length,
    myInputs,
    recent: home.done.slice(0, 3),
  };
}

/** PDA 첫 화면 — 오늘(과 출고일 지난) 상차할 지시서, 작업 중인 차량, 오늘 상차완료한 차량 */
export async function pdaHome(me: PlanActor): Promise<PdaHome | null> {
  if (!canLoad(me)) return null;
  const today = todayKst();
  const clientId = me.clientId!;
  const [asns, loads, { centers, defaultCenterId }] = await Promise.all([
    db.asn.findMany({
      where: { clientId, status: { in: [...LOADABLE_ASN] }, shipDate: { lte: asDate(today) } },
      orderBy: [{ shipDate: "asc" }, { asnNo: "asc" }],
      include: { center: { select: { name: true } }, loadOrder: { select: { orderNo: true, status: true } }, load: { select: { id: true } }, _count: { select: { lines: true } } },
    }),
    db.load.findMany({
      where: { clientId, OR: [{ status: "WORKING" }, { status: "COMPLETED", loadDate: asDate(today) }] },
      orderBy: { id: "desc" },
      include: ROW_INCLUDE,
    }),
    centerChoices(me),
  ]);
  return {
    today,
    orders: asns
      .filter((a) => a.loadOrder && a.loadOrder.status === "ISSUED")
      .map((a) => ({
        orderNo: a.loadOrder!.orderNo,
        asnId: a.id,
        asnNo: a.asnNo,
        asnStatus: a.status,
        vehicleNo: a.vehicleNo,
        driverName: a.driverName,
        shipDate: ymd(a.shipDate),
        centerName: a.center.name,
        lineCount: a._count.lines,
        loadId: a.load?.id ?? null,
      })),
    working: loads.filter((l) => l.status === "WORKING").map(pdaRow),
    done: loads.filter((l) => l.status === "COMPLETED").map(pdaRow),
    centers,
    defaultCenterId,
  };
}

/** 목록용 무지시 상차 실적 (ASN이 없어서 ASN 목록에 따로 끼워 넣는다) */
export async function listUnorderedLoads(scope: Prisma.LoadWhereInput) {
  return db.load.findMany({
    where: { ...scope, loadType: "UNORDERED" },
    orderBy: { id: "asc" },
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      lines: { select: { loadBaseQty: true, item: { select: { code: true, name: true, baseUnit: true } } } },
      rcvs: { where: { status: "CONFIRMED" }, select: { confirmedAt: true } },
    },
  });
}
