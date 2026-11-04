/**
 * 입고예정 등록 — 엑셀·AI 판독 원문을 품목 마스터와 매칭해 "초안 라인"으로 바꾼다.
 * 근거: 정의서 v1.4 ① · C1 · D2 — 미매칭·저신뢰 라인은 "확인 필요"로 강조하고, 저장 시점에 미매칭 0건.
 * 화면(편집기)과 서버(엑셀 읽기·AI 판독)가 같은 규칙을 쓴다.
 */
import type { BulkColumn } from "./item-bulk";
import { ITEM_UNITS, normalizeAlias, type ItemUnit, type StorageTemp } from "./master";

/** 한 입고예정에 넣을 수 있는 최대 라인 (서버 저장 규칙과 같음) */
export const PLAN_MAX_LINES = 300;
/** AI 판독에 한 번에 올릴 수 있는 이미지 수 */
export const AI_MAX_IMAGES = 3;
/** AI 판독 신뢰도가 이보다 낮으면 "확인 필요" */
export const LOW_CONFIDENCE = 0.8;

/** 매칭에 쓰는 화주사 품목 (사용 중인 품목만) */
export interface CatalogItem {
  id: number;
  code: string;
  name: string;
  baseUnit: ItemUnit;
  /** 단위별 기준 단위 환산 수량 (기준 단위는 1) */
  uoms: { unit: ItemUnit; qty: number }[];
  barcodes: { barcode: string; unit: ItemUnit }[];
  /** 정규화한 별칭 */
  aliases: string[];
  expiryManaged: boolean;
  lotManaged: boolean;
  /** 품목 찾기 창 표시·필터용 */
  storageTemp?: StorageTemp;
}

export type MatchedBy = "code" | "barcode" | "name" | "alias" | "ai";
export const MATCHED_BY_LABEL: Record<MatchedBy, string> = {
  code: "품목코드 일치",
  barcode: "바코드 일치",
  name: "품목명 일치",
  alias: "별칭 일치",
  ai: "AI 판독 매칭",
};

/** 엑셀·판독 원문 한 줄 → 편집기 초안 라인 */
export interface DraftLine {
  /** "엑셀 3행", "판독 2번째 줄" */
  origin: string;
  /** 원문 (사용자에게 보여 주는 그대로) */
  text: string;
  itemId: number | null;
  matchedBy: MatchedBy | null;
  /** 미매칭일 때 비슷한 품목 후보 (id) */
  candidates: number[];
  unit: ItemUnit | null;
  qty: number | null;
  expiryDate: string | null;
  lotNo: string | null;
  /** 원문 값 문제 (수량 형식·단위·날짜 등) — 편집기에서 고치게 안내 */
  issues: string[];
  /** AI 판독 신뢰도가 낮은 수량 — 원본과 대조했다고 확인해야 저장 */
  lowConfidence: boolean;
}

/* ───────── 원문 값 해석 ───────── */

const UNIT_WORDS: Record<string, ItemUnit> = {
  ea: "EA", 개: "EA", 낱개: "EA", 피스: "EA", pcs: "EA", pc: "EA", 봉: "EA", 병: "EA", 캔: "EA",
  box: "BOX", 박스: "BOX", 상자: "BOX", bx: "BOX", ctn: "BOX", 카톤: "BOX",
  plt: "PLT", pl: "PLT", 팔레트: "PLT", 파레트: "PLT", 빠레트: "PLT", pallet: "PLT",
};

/** "박스"·"box"·"BOX" → BOX. 모르면 null */
export function parseUnit(s: string | null | undefined): ItemUnit | null {
  const t = (s ?? "").trim().toLowerCase();
  if (!t) return null;
  const upper = t.toUpperCase();
  if ((ITEM_UNITS as readonly string[]).includes(upper)) return upper as ItemUnit;
  return UNIT_WORDS[t] ?? null;
}

/** "1,200" · "20개" · "30 BOX" → 정수. 0 이하·소수·숫자 없음은 null */
export function parseQty(s: string | number | null | undefined): number | null {
  if (typeof s === "number") return Number.isInteger(s) && s > 0 ? s : null;
  const m = (s ?? "").replace(/[,\s]/g, "").match(/^(\d+)(?:\.0+)?[^\d.]*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 999_999 ? n : null;
}

/** 2026-12-31 · 2026.12.31 · 2026/12/31 · 20261231 · 26.12.31 → YYYY-MM-DD. 잘못된 날짜는 null */
export function parseDate(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/) ?? t.match(/^(\d{4})(\d{2})(\d{2})$/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = t.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
    if (!m) return null;
    [y, mo, d] = [2000 + Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/* ───────── 매칭 ───────── */

export interface CatalogIndex {
  items: CatalogItem[];
  byId: Map<number, CatalogItem>;
  byCode: Map<string, CatalogItem>;
  byBarcode: Map<string, { item: CatalogItem; unit: ItemUnit }>;
  byName: Map<string, CatalogItem>;
  byAlias: Map<string, CatalogItem>;
}

export function buildIndex(items: CatalogItem[]): CatalogIndex {
  const idx: CatalogIndex = { items, byId: new Map(), byCode: new Map(), byBarcode: new Map(), byName: new Map(), byAlias: new Map() };
  for (const it of items) {
    idx.byId.set(it.id, it);
    idx.byCode.set(it.code.toUpperCase(), it);
    for (const b of it.barcodes) idx.byBarcode.set(b.barcode, { item: it, unit: b.unit });
    idx.byName.set(normalizeAlias(it.name), it);
    for (const a of it.aliases) idx.byAlias.set(a, it);
  }
  return idx;
}

/** 품목코드 → 바코드 → 품목명 → 별칭 순으로 정확히 같은 품목을 찾는다 (추측 매칭은 하지 않는다) */
export function matchItem(
  idx: CatalogIndex,
  src: { code?: string | null; barcode?: string | null; name?: string | null },
): { item: CatalogItem; by: MatchedBy; unit?: ItemUnit } | null {
  const code = src.code?.trim().toUpperCase();
  if (code && idx.byCode.has(code)) return { item: idx.byCode.get(code)!, by: "code" };
  const bc = src.barcode?.replace(/\s/g, "");
  if (bc && idx.byBarcode.has(bc)) {
    const hit = idx.byBarcode.get(bc)!;
    return { item: hit.item, by: "barcode", unit: hit.unit };
  }
  const name = src.name ? normalizeAlias(src.name) : "";
  if (name && idx.byName.has(name)) return { item: idx.byName.get(name)!, by: "name" };
  if (name && idx.byAlias.has(name)) return { item: idx.byAlias.get(name)!, by: "alias" };
  return null;
}

function bigrams(s: string) {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 원문과 비슷한 품목 후보 (품목명·별칭·코드 글자 2개씩 겹치는 정도) — 미매칭 라인에서 사용자가 고르게 */
export function candidatesFor(idx: CatalogIndex, text: string, limit = 5): number[] {
  const q = normalizeAlias(text);
  if (q.length < 2) return [];
  const qg = bigrams(q);
  const score = (s: string) => {
    if (!s) return 0;
    if (s.includes(q) || q.includes(s)) return 0.9 + Math.min(s.length, q.length) / Math.max(s.length, q.length) / 10;
    const g = bigrams(s);
    let hit = 0;
    for (const x of qg) if (g.has(x)) hit++;
    return (2 * hit) / (qg.size + g.size || 1);
  };
  return idx.items
    .map((it) => ({ id: it.id, s: Math.max(score(normalizeAlias(it.name)), score(it.code.toLowerCase()), ...it.aliases.map(score)) }))
    .filter((x) => x.s >= 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.id);
}

/** 매칭 결과에 단위를 정한다: 원문 단위 → 바코드 단위 → (품목 단위가 하나뿐이면) 그 단위 */
function pickUnit(item: CatalogItem | null, raw: ItemUnit | null, fromBarcode?: ItemUnit): { unit: ItemUnit | null; issue?: string } {
  const unit = raw ?? fromBarcode ?? null;
  if (!item) return { unit };
  if (unit && !item.uoms.some((u) => u.unit === unit)) return { unit: null, issue: `${item.name}에 ${unit} 단위가 등록되어 있지 않습니다.` };
  if (unit) return { unit };
  if (item.uoms.length === 1) return { unit: item.uoms[0].unit };
  return { unit: null, issue: "단위를 고르세요." };
}

/** 원문 한 줄(엑셀 행·판독 줄) → 초안 라인 */
export function toDraftLine(
  idx: CatalogIndex,
  src: {
    origin: string;
    code?: string | null;
    barcode?: string | null;
    name?: string | null;
    unit?: string | null;
    qty?: string | number | null;
    expiry?: string | null;
    lot?: string | null;
    /** AI가 고른 품목코드 (확인용 — 마스터에 있어야 매칭) */
    aiCode?: string | null;
    confidence?: number | null;
  },
): DraftLine {
  const issues: string[] = [];
  const text = [src.code, src.barcode, src.name].map((x) => x?.toString().trim()).filter(Boolean).join(" · ");
  let m = matchItem(idx, src);
  if (!m && src.aiCode) {
    const ai = idx.byCode.get(src.aiCode.trim().toUpperCase());
    if (ai) m = { item: ai, by: "ai" };
  }
  const rawUnit = parseUnit(src.unit);
  if (src.unit && !rawUnit) issues.push(`단위 '${src.unit}'을(를) 알 수 없습니다. EA·BOX·PLT 중에서 고르세요.`);
  const u = pickUnit(m?.item ?? null, rawUnit, m?.unit);
  if (u.issue && m) issues.push(u.issue);
  const qty = parseQty(src.qty ?? null);
  if (src.qty !== null && src.qty !== undefined && String(src.qty).trim() !== "" && qty === null)
    issues.push(`수량 '${src.qty}'을(를) 읽지 못했습니다. 1 이상의 정수로 입력하세요.`);
  else if (qty === null) issues.push("수량을 입력하세요.");
  const expiry = parseDate(src.expiry);
  if (src.expiry?.trim() && !expiry) issues.push(`유통기한 '${src.expiry}'을(를) 날짜로 읽지 못했습니다.`);
  return {
    origin: src.origin,
    text: text || "(품목 정보 없음)",
    itemId: m?.item.id ?? null,
    matchedBy: m?.by ?? null,
    candidates: m ? [] : candidatesFor(idx, src.name || src.code || ""),
    unit: u.unit,
    qty,
    expiryDate: expiry,
    lotNo: src.lot?.trim() || null,
    issues,
    lowConfidence: typeof src.confidence === "number" && src.confidence < LOW_CONFIDENCE,
  };
}

/* ───────── 엑셀 양식 ───────── */

export const PLAN_COLUMNS: BulkColumn[] = [
  { key: "code", header: "품목코드", required: false, width: 16, note: "품목코드·바코드·품목명 중 하나는 꼭 입력. 품목코드가 가장 정확합니다", example: "HB-1001" },
  { key: "barcode", header: "바코드", required: false, width: 18, note: "품목에 등록된 바코드. 단위별 바코드면 단위를 비워도 됩니다", example: "" },
  { key: "name", header: "품목명", required: false, width: 28, note: "품목명 또는 별칭. 코드·바코드가 없을 때 이름으로 찾습니다", example: "국산콩 두부 300g" },
  { key: "unit", header: "단위", required: false, width: 8, note: "EA / BOX / PLT (품목에 등록된 단위)", list: ITEM_UNITS, example: "BOX" },
  { key: "qty", header: "수량", required: true, width: 10, note: "1 이상의 정수", example: "20" },
  { key: "expiry", header: "유통기한", required: false, width: 12, note: "유통기한 관리 품목만. 예: 2026-12-31", example: "2026-12-31" },
  { key: "lot", header: "로트", required: false, width: 14, note: "로트 관리 품목만, 40자 이내", example: "" },
];

/** 엑셀에 품목을 알아볼 열(코드·바코드·이름)이 하나도 없는지 */
export const missingItemColumn = (keys: (string | null)[]) => !keys.some((k) => k === "code" || k === "barcode" || k === "name");

/** 예시 행(양식의 회색 행)인지 */
export const isPlanExampleRow = (raw: Record<string, string>) =>
  PLAN_COLUMNS.every((c) => (raw[c.key] ?? "") === c.example);

/* ───────── 편집기 라인 검사 (저장 전 화면 검사 — 서버도 같은 규칙으로 다시 검사) ───────── */

export interface EditorLineValue {
  itemId: number | null;
  unit: ItemUnit | null;
  qty: number | null;
  expiryDate: string | null;
  lotNo: string | null;
  lowConfidence?: boolean;
  confirmed?: boolean;
}

export function lineErrors(line: EditorLineValue, item: CatalogItem | undefined): Partial<Record<"itemId" | "unit" | "qty" | "expiryDate" | "lotNo", string>> {
  const e: Partial<Record<"itemId" | "unit" | "qty" | "expiryDate" | "lotNo", string>> = {};
  if (!line.itemId || !item) e.itemId = "품목을 매칭하세요.";
  if (!line.unit) e.unit = "단위를 고르세요.";
  else if (item && !item.uoms.some((u) => u.unit === line.unit)) e.unit = `${item.name}에 등록되지 않은 단위입니다.`;
  if (!line.qty || line.qty < 1) e.qty = "수량은 1 이상이어야 합니다.";
  else if (line.lowConfidence && !line.confirmed) e.qty = "판독 신뢰도가 낮은 수량입니다. 원본 이미지와 대조한 뒤 '원본과 대조함'에 체크하세요.";
  if (item?.expiryManaged && !line.expiryDate) e.expiryDate = "유통기한 관리 품목입니다.";
  if (item?.lotManaged && !line.lotNo?.trim()) e.lotNo = "로트 관리 품목입니다.";
  return e;
}

/** 같은 품목·단위·유통기한·로트 라인 (서버 C1 중복 규칙과 같음) — 중복된 라인 번호(0부터) */
export function duplicateLines(lines: EditorLineValue[], items: Map<number, CatalogItem>): Set<number> {
  const seen = new Map<string, number>();
  const dup = new Set<number>();
  lines.forEach((l, i) => {
    if (!l.itemId || !l.unit) return;
    const it = items.get(l.itemId);
    const key = `${l.itemId}:${l.unit}:${it?.expiryManaged ? l.expiryDate : null}:${it?.lotManaged ? l.lotNo?.trim() : null}`;
    if (seen.has(key)) {
      dup.add(i);
      dup.add(seen.get(key)!);
    } else seen.set(key, i);
  });
  return dup;
}
