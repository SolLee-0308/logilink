import "server-only";
/**
 * 화주사 입고예정 등록 — 목록·기준정보 조회, 엑셀 양식·미리보기.
 * 저장·취소 규칙은 service.ts(savePlan·cancelPlanByShipper)가 그대로 검사한다.
 */
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeAlias, type ItemUnit, type StorageTemp } from "@/domain/master";
import { can } from "@/domain/permissions";
import { PLAN_COLUMNS, PLAN_MAX_LINES, buildIndex, isPlanExampleRow, missingItemColumn, toDraftLine, type CatalogItem, type DraftLine } from "@/domain/plan-entry";
import { todayKst } from "@/lib/format";
import { buildSheetTemplate, readSheet, type SheetSpec } from "@/server/master/excel";
import type { EntryOptions, EntryRow, EntryTab } from "@/features/plans/types";

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const UNIT_ORDER: ItemUnit[] = ["EA", "BOX", "PLT"];
/** 승인·취소 건을 목록에 남겨 두는 기간 (그 이전 건은 입고예정 조회 화면에서) */
export const RECENT_DAYS = 30;

const canEntry = (me: PlanActor) => can(me.roles, "planEntry", "view") && !!me.clientId;

const catalogInclude = { uoms: true, barcodes: { select: { barcode: true, unit: true } }, aliases: { select: { normalized: true } } } as const;
type CatalogRow = Prisma.ItemGetPayload<{ include: typeof catalogInclude }>;

function toCatalog(rows: CatalogRow[]): CatalogItem[] {
  return rows.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    baseUnit: i.baseUnit,
    uoms: UNIT_ORDER.flatMap((u) => i.uoms.filter((x) => x.unit === u).map((x) => ({ unit: x.unit, qty: x.qty }))),
    barcodes: i.barcodes.map((b) => ({ barcode: b.barcode, unit: b.unit })),
    aliases: i.aliases.map((a) => a.normalized),
    expiryManaged: i.expiryManaged,
    lotManaged: i.lotManaged,
    storageTemp: i.storageTemp,
  }));
}

/** 화주사의 사용 중인 품목 전체 — 서버 매칭(엑셀·AI 판독)용. 화면에는 보내지 않는다 */
export async function catalogOf(clientId: number): Promise<CatalogItem[]> {
  return toCatalog(await db.item.findMany({ where: { clientId, isActive: true }, orderBy: { code: "asc" }, include: catalogInclude }));
}

/** 지정한 품목만 (수정 화면의 기존 줄·초안 라인의 매칭·후보 품목) */
export async function catalogByIds(clientId: number, ids: number[]): Promise<CatalogItem[]> {
  if (!ids.length) return [];
  return toCatalog(await db.item.findMany({ where: { clientId, id: { in: [...new Set(ids)] } }, orderBy: { code: "asc" }, include: catalogInclude }));
}

/** 최근 입고예정에 넣었던 품목 (최근 저장 순, 최대 200개) */
async function recentItemIds(clientId: number): Promise<number[]> {
  const rows = await db.inboundPlanLine.findMany({
    where: { plan: { clientId }, item: { isActive: true } },
    orderBy: { plan: { savedAt: "desc" } },
    select: { itemId: true },
    take: 2000,
  });
  return [...new Set(rows.map((r) => r.itemId))].slice(0, 200);
}

export const SEARCH_PAGE = 50;

/**
 * 품목 찾기 — 품목코드·품목명·바코드·별칭으로 서버에서 찾는다 (품목이 수천 개여도 화면에는 한 쪽씩).
 * 품목코드·바코드가 정확히 같은 품목을 맨 앞에 둔다.
 */
export async function searchCatalog(
  clientId: number,
  opt: { q: string; temp?: StorageTemp | null; recent?: boolean; offset?: number; limit?: number },
): Promise<{ items: CatalogItem[]; total: number }> {
  const q = opt.q.trim().slice(0, 60);
  const limit = Math.min(opt.limit ?? SEARCH_PAGE, SEARCH_PAGE);
  const offset = Math.max(opt.offset ?? 0, 0);
  const where: Prisma.ItemWhereInput = { clientId, isActive: true, ...(opt.temp ? { storageTemp: opt.temp } : {}) };
  if (q) {
    const n = normalizeAlias(q);
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { barcodes: { some: { barcode: { contains: q } } } },
      ...(n ? [{ aliases: { some: { normalized: { contains: n } } } }] : []),
    ];
  }
  if (opt.recent) {
    const ids = await recentItemIds(clientId);
    where.id = { in: ids };
    const rows = toCatalog(await db.item.findMany({ where, include: catalogInclude }));
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { items: rows.slice(offset, offset + limit), total: rows.length };
  }
  const [total, exact] = await Promise.all([
    db.item.count({ where }),
    q && offset === 0
      ? db.item.findMany({
          where: { clientId, isActive: true, OR: [{ code: { equals: q, mode: "insensitive" } }, { barcodes: { some: { barcode: q } } }] },
          include: catalogInclude,
        })
      : Promise.resolve([]),
  ]);
  const exactIds = exact.map((e) => e.id);
  const rows = await db.item.findMany({
    where: exactIds.length ? { AND: [where, { id: { notIn: exactIds } }] } : where,
    orderBy: { code: "asc" },
    skip: offset === 0 ? 0 : Math.max(offset - exactIds.length, 0),
    take: limit - (offset === 0 ? exactIds.length : 0),
    include: catalogInclude,
  });
  return { items: toCatalog([...(offset === 0 ? exact : []), ...rows]), total };
}

/** 빠른 입력 — 품목코드·바코드가 정확히 같은 품목 하나 (바코드면 그 단위도) */
export async function findExactItem(clientId: number, text: string): Promise<{ item: CatalogItem; unit: ItemUnit | null } | null> {
  const t = text.trim();
  if (!t) return null;
  const rows = await db.item.findMany({
    where: { clientId, isActive: true, OR: [{ code: { equals: t, mode: "insensitive" } }, { barcodes: { some: { barcode: t } } }] },
    include: catalogInclude,
    take: 2,
  });
  if (rows.length !== 1) return null;
  const [item] = toCatalog(rows);
  return { item, unit: item.barcodes.find((b) => b.barcode === t)?.unit ?? null };
}

/**
 * 화주사 사용자가 고를 수 있는 센터 — 이 화주사가 이용하는 사용 중 센터.
 * 기본값: 사용자 기본 센터(이용 중인 센터일 때) → 이용 센터가 1곳이면 그 센터 → ""(전체). 입고예정 등록·ASN 등록이 같이 쓴다
 */
export async function centerChoices(me: PlanActor): Promise<{ centers: { id: number; name: string }[]; defaultCenterId: string }> {
  if (!me.clientId) return { centers: [], defaultCenterId: "" };
  const links = await db.clientCenter.findMany({ where: { clientId: me.clientId }, select: { centerCode: true } });
  const [centers, user] = await Promise.all([
    db.center.findMany({ where: { code: { in: links.map((l) => l.centerCode) }, isActive: true }, orderBy: { code: "asc" }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { id: me.id }, select: { defaultCenterId: true } }),
  ]);
  const defaultCenterId =
    user?.defaultCenterId && centers.some((c) => c.id === user.defaultCenterId) ? String(user.defaultCenterId) : centers.length === 1 ? String(centers[0].id) : "";
  return { centers, defaultCenterId };
}

/** 등록·수정 화면 기준정보 — 이 화주사가 이용하는 사용 중 센터, 품목, 앞으로 1년 휴무일 */
export async function entryOptions(me: PlanActor): Promise<EntryOptions | null> {
  if (!canEntry(me)) return null;
  const today = todayKst();
  const { centers, defaultCenterId } = await centerChoices(me);
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCFullYear(until.getUTCFullYear() + 1);
  const holidays = await db.holiday.findMany({
    where: { centerId: { in: centers.map((c) => c.id) }, date: { gte: new Date(`${today}T00:00:00Z`), lte: until } },
    select: { centerId: true, date: true, name: true },
  });
  // 품목은 화면에서 찾을 때마다 서버에서 가져온다 (수정 화면은 기존 줄 품목만 따로 넣는다)
  return { centers, defaultCenterId, items: [], holidays: holidays.map((h) => ({ centerId: h.centerId, date: ymd(h.date), name: h.name })), today };
}

/** 입고예정 등록 목록 — 승인 전(승인대기·반려) 전부 + 최근 승인·취소 */
export async function listMyPlans(me: PlanActor): Promise<EntryRow[]> {
  if (!canEntry(me)) return [];
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const plans = await db.inboundPlan.findMany({
    where: {
      clientId: me.clientId!,
      OR: [
        { status: { in: ["WAITING", "REJECTED"] } },
        { status: "APPROVED", approvedAt: { gte: since } },
        { status: "CANCELED", canceledAt: { gte: since } },
      ],
    },
    orderBy: [{ planDate: "asc" }, { planNo: "asc" }],
    include: {
      client: { select: { name: true } },
      center: { select: { name: true } },
      lines: { select: { unit: true, qty: true, item: { select: { code: true, name: true } } } },
      rejects: { orderBy: { revisionNo: "desc" }, take: 1, select: { reasonName: true } },
    },
  });
  return plans.map((p) => {
    const sums = new Map<ItemUnit, number>();
    for (const l of p.lines) sums.set(l.unit, (sums.get(l.unit) ?? 0) + l.qty);
    const tab: EntryTab = p.status === "WAITING" ? "wait" : p.status === "REJECTED" ? "rej" : p.status === "APPROVED" ? "approved" : "canceled";
    const closed = p.status === "APPROVED" ? p.approvedAt : p.status === "CANCELED" ? p.canceledAt : null;
    return {
      id: p.id,
      planNo: p.planNo,
      tab,
      clientId: p.clientId,
      clientName: p.client.name,
      centerId: p.centerId,
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
      rejectReason: p.status === "REJECTED" ? (p.rejects[0]?.reasonName ?? null) : null,
      closedAt: closed ? iso(closed) : null,
    };
  });
}

/** 반려되어 화주사가 고쳐야 할 입고예정 수 — 사이드바 건수 */
export async function countMyRejected(me: PlanActor) {
  if (!canEntry(me)) return 0;
  return db.inboundPlan.count({ where: { clientId: me.clientId!, status: "REJECTED" } });
}

/* ───────── 엑셀 양식 ───────── */

export const PLAN_SHEET: SheetSpec = {
  title: "입고예정",
  columns: PLAN_COLUMNS,
  maxRows: PLAN_MAX_LINES,
  guide: [
    "입고예정 1건(센터 1곳·입고예정일 하루)의 품목을 1행에 하나씩 씁니다. 센터·입고예정일·메모는 화면에서 고릅니다.",
    "품목은 품목코드 → 바코드 → 품목명·별칭 순으로 찾습니다. 찾지 못한 행은 화면에서 '확인 필요'로 표시되어 직접 매칭할 수 있습니다.",
    "실제로 새 품목이면 화면에서 품목 등록 요청을 보내고, 그 행은 빼고 저장합니다. 미매칭 행이 남아 있으면 저장할 수 없습니다.",
  ],
  isExample: isPlanExampleRow,
  headerError: (headers, keys, missing) => {
    const hasItemTemplate = headers.some((h) => /기준단위|EA바코드|BOX입수/.test(h));
    if (missing.length && hasItemTemplate)
      return "품목 양식으로 작성한 파일입니다. 입고예정은 위 [양식 내려받기]로 받은 '입고예정 양식'에 품목·수량을 옮겨 작성하세요.";
    if (missing.length) return `필수 열이 없습니다: ${missing.join(", ")}. 양식을 내려받아 머리글을 그대로 두고 작성하세요.`;
    if (missingItemColumn(keys)) return "품목코드·바코드·품목명 열 중 하나는 있어야 합니다. 양식을 내려받아 머리글을 그대로 두고 작성하세요.";
    return null;
  },
};

export const buildPlanTemplate = () => buildSheetTemplate(PLAN_SHEET);

/** 올린 엑셀 → 초안 라인 (저장하지 않는다) */
export async function previewPlanExcel(
  clientId: number,
  data: ArrayBuffer,
): Promise<{ ok: true; lines: DraftLine[]; items: CatalogItem[] } | { ok: false; error: string }> {
  const r = await readSheet(PLAN_SHEET, data);
  if (!r.ok) return r;
  const idx = buildIndex(await catalogOf(clientId));
  const lines = r.rows.map(({ rowNo, raw }) =>
    toDraftLine(idx, { origin: `엑셀 ${rowNo}행`, code: raw.code, barcode: raw.barcode, name: raw.name, unit: raw.unit, qty: raw.qty, expiry: raw.expiry, lot: raw.lot }),
  );
  return { ok: true, lines, items: referencedItems(idx, lines) };
}

/** 초안 라인이 가리키는 품목(매칭·후보)만 화면에 보낸다 */
export function referencedItems(idx: ReturnType<typeof buildIndex>, lines: DraftLine[]): CatalogItem[] {
  const ids = new Set(lines.flatMap((l) => [...(l.itemId ? [l.itemId] : []), ...l.candidates]));
  return [...ids].map((id) => idx.byId.get(id)!).filter(Boolean);
}
