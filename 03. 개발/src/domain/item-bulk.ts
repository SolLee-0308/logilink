/**
 * 품목 엑셀 일괄 등록·일괄 요청 — 엑셀 한 행(문자열) → 저장할 값 + 오류.
 * 화면 미리보기와 서버 저장이 같은 규칙을 쓴다. DB 중복(기존 품목) 확인은 서버에서 따로 한다.
 *
 * - 3PL 일괄 등록(ITEM): 품목 1개 = 1행. 단위 환산·단위별 바코드·별칭까지 한 번에
 * - 화주사 일괄 요청(REQUEST): 품목 등록 요청 1건 = 1행. 단위 1개·바코드 1개 (U6: 환산·추가 바코드는 3PL이 등록 후 보완)
 */
import { BARCODE_PATTERN, ITEM_UNITS, STORAGE_TEMPS, STORAGE_TEMP_LABEL, normalizeAlias, type ItemUnit, type StorageTemp } from "./master";

/** 한 번에 올릴 수 있는 최대 행 수 */
export const BULK_MAX_ROWS = 1000;

export interface BulkColumn {
  key: string;
  header: string;
  required: boolean;
  /** 엑셀 열 너비 */
  width: number;
  /** 작성 안내 */
  note: string;
  /** 드롭다운 선택지 */
  list?: readonly string[];
  example: string;
}

const TEMP_NAMES = STORAGE_TEMPS.map((t) => STORAGE_TEMP_LABEL[t]);
const YN = ["Y", "N"] as const;

export const ITEM_COLUMNS: BulkColumn[] = [
  { key: "clientCode", header: "화주사 품목코드", required: false, width: 16, note: "화주사가 쓰는 자체 품목코드(선택), 같은 화주사 안에서 중복 불가, 40자 이내. 품목코드는 등록할 때 시스템이 매깁니다", example: "HB-1001" },
  { key: "name", header: "품목명", required: true, width: 28, note: "200자 이내", example: "국산콩 두부 300g" },
  { key: "storageTemp", header: "보관온도대", required: true, width: 11, note: "상온 / 냉장 / 냉동", list: TEMP_NAMES, example: "냉장" },
  { key: "baseUnit", header: "기준단위", required: true, width: 10, note: "수량 계산의 기준이 되는 가장 작은 단위: EA / BOX / PLT", list: ITEM_UNITS, example: "EA" },
  { key: "boxQty", header: "BOX입수", required: false, width: 10, note: "BOX 1개 = 기준단위 몇 개인지 (BOX를 쓸 때만, 2 이상)", example: "20" },
  { key: "pltQty", header: "PLT입수", required: false, width: 10, note: "PLT 1개 = 기준단위 몇 개인지 (PLT를 쓸 때만, 2 이상)", example: "800" },
  { key: "eaBarcode", header: "EA바코드", required: false, width: 18, note: "숫자 8~14자리. 여러 개면 쉼표(,)로 구분", example: "8801234500011" },
  { key: "boxBarcode", header: "BOX바코드", required: false, width: 18, note: "숫자 8~14자리. 여러 개면 쉼표(,)로 구분", example: "18801234500018" },
  { key: "pltBarcode", header: "PLT바코드", required: false, width: 18, note: "숫자 8~14자리. 여러 개면 쉼표(,)로 구분", example: "" },
  { key: "expiryManaged", header: "소비기한관리", required: false, width: 12, note: "Y / N (비우면 N)", list: YN, example: "Y" },
  { key: "lotManaged", header: "로트관리", required: false, width: 10, note: "Y / N (비우면 N)", list: YN, example: "N" },
  { key: "aliases", header: "별칭", required: false, width: 28, note: "AI 판독·엑셀 자동 매칭용 다른 표기. 여러 개면 쉼표(,)로 구분", example: "국산콩두부300, 두부 300g" },
];

export const REQUEST_COLUMNS: BulkColumn[] = [
  { key: "clientCode", header: "화주사 품목코드", required: false, width: 16, note: "화주사에서 쓰는 자체 품목코드(선택), 40자 이내. 품목코드는 3PL이 등록할 때 시스템이 매깁니다", example: "HB-1001" },
  { key: "name", header: "품목명", required: true, width: 28, note: "200자 이내", example: "국산콩 두부 300g" },
  { key: "unit", header: "단위", required: true, width: 8, note: "EA / BOX / PLT", list: ITEM_UNITS, example: "EA" },
  { key: "barcode", header: "바코드", required: true, width: 18, note: "숫자 8~14자리", example: "8801234500011" },
  { key: "storageTemp", header: "보관온도대", required: false, width: 11, note: "상온 / 냉장 / 냉동 (모르면 비워 두세요)", list: TEMP_NAMES, example: "냉장" },
  { key: "expiryManaged", header: "소비기한관리", required: false, width: 12, note: "Y / N (모르면 비워 두세요)", list: YN, example: "Y" },
  { key: "lotManaged", header: "로트관리", required: false, width: 10, note: "Y / N (모르면 비워 두세요)", list: YN, example: "" },
  { key: "note", header: "메모", required: false, width: 30, note: "3PL에 전달할 내용, 500자 이내", example: "11월 신상품" },
];

export type BulkKind = "ITEM" | "REQUEST";
export const columnsOf = (kind: BulkKind) => (kind === "ITEM" ? ITEM_COLUMNS : REQUEST_COLUMNS);

/** 엑셀 머리글 → 키. 공백·대소문자·별표(*)를 무시하고 비교한다 */
export function mapHeaders(kind: BulkKind, headers: string[]): { keys: (string | null)[]; missing: string[] } {
  return mapColumns(columnsOf(kind), headers);
}

/** 머리글 이름(공백·*·괄호 무시)으로 열을 찾는다 — 열 순서가 바뀌어도 된다 */
export function mapColumns(cols: BulkColumn[], headers: string[]): { keys: (string | null)[]; missing: string[] } {
  const norm = (s: string) => s.replace(/[\s*()（）]/g, "").toLowerCase();
  const keys = headers.map((h) => cols.find((c) => norm(c.header) === norm(h))?.key ?? null);
  const missing = cols.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.header);
  return { keys, missing };
}

/**
 * 머리글이 다른 양식(3PL 품목 일괄 등록 ↔ 화주사 품목 등록 요청)과 맞는지 — 양식을 바꿔 올렸을 때 안내용.
 * 다른 양식의 필수 열이 모두 있고 이 양식의 필수 열이 빠졌으면 그 양식이다.
 */
export function isOtherTemplate(kind: BulkKind, headers: string[]) {
  const other: BulkKind = kind === "ITEM" ? "REQUEST" : "ITEM";
  return mapHeaders(kind, headers).missing.length > 0 && mapHeaders(other, headers).missing.length === 0;
}

/** 필수 열이 빠진 파일 안내 문구 */
export function missingHeaderMessage(kind: BulkKind, headers: string[], missing: string[]) {
  if (isOtherTemplate(kind, headers)) {
    return kind === "REQUEST"
      ? "3PL의 '품목 일괄 등록' 양식으로 작성한 파일입니다. 품목 등록 요청은 '품목 등록 요청' 양식(단위·바코드 열)을 써야 합니다. 위 [양식 내려받기]로 요청 양식을 받아 내용을 옮겨 작성하세요. 이미 등록된 품목이면 요청할 필요 없이 품목 조회에서 확인할 수 있습니다."
      : "화주사의 '품목 등록 요청' 양식으로 작성한 파일입니다. 품목 일괄 등록은 '품목 일괄 등록' 양식(기준단위·입수·단위별 바코드 열)을 써야 합니다. 위 [양식 내려받기]로 등록 양식을 받아 내용을 옮겨 작성하세요.";
  }
  return `필수 열이 없습니다: ${missing.join(", ")}. 양식을 내려받아 머리글을 그대로 두고 작성하세요.`;
}

export type RawRow = Record<string, string>;

export interface ItemDraft {
  /** 화주사 품목코드 (선택) */
  clientCode: string | null;
  name: string;
  storageTemp: StorageTemp;
  baseUnit: ItemUnit;
  uoms: { unit: ItemUnit; qty: number }[];
  barcodes: { unit: ItemUnit; barcode: string; isPrimary: boolean }[];
  expiryManaged: boolean;
  lotManaged: boolean;
  aliases: string[];
}

export interface RequestDraft {
  /** 화주사 품목코드 (선택) */
  clientCode: string | null;
  name: string;
  unit: ItemUnit;
  barcode: string;
  storageTemp: StorageTemp | null;
  expiryManaged: boolean | null;
  lotManaged: boolean | null;
  note: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const cell = (r: RawRow, k: string) => (r[k] ?? "").trim();
const splitList = (s: string) =>
  s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function parseTemp(s: string): StorageTemp | null | undefined {
  if (!s) return null;
  const t = STORAGE_TEMPS.find((x) => STORAGE_TEMP_LABEL[x] === s || x === s.toUpperCase());
  return t ?? undefined;
}

function parseUnit(s: string): ItemUnit | null | undefined {
  if (!s) return null;
  const u = s.toUpperCase();
  return (ITEM_UNITS as readonly string[]).includes(u) ? (u as ItemUnit) : undefined;
}

/** Y/N (예/아니오, O/X, TRUE/FALSE도 허용). 빈 값은 null */
function parseYn(s: string): boolean | null | undefined {
  if (!s) return null;
  const v = s.toUpperCase();
  if (["Y", "YES", "예", "O", "TRUE", "1"].includes(v)) return true;
  if (["N", "NO", "아니오", "X", "FALSE", "0"].includes(v)) return false;
  return undefined;
}

/** 엑셀이 숫자로 바꾼 바코드(지수 표기·소수점)를 되돌리지 못하면 오류로 둔다 */
const cleanBarcode = (s: string) => s.replace(/\s/g, "");

function parseQty(s: string, label: string, errors: string[]): number | null {
  if (!s) return null;
  if (!/^\d+$/.test(s)) {
    errors.push(`${label}는 숫자로 입력하세요.`);
    return null;
  }
  const n = Number(s);
  if (n < 2 || n > 100000) {
    errors.push(`${label}는 2 이상 100000 이하로 입력하세요.`);
    return null;
  }
  return n;
}

/** 화주사 품목코드 — 선택, 40자 이내 */
function clientCodeOf(r: RawRow, errors: string[]): string | null {
  const v = cell(r, "clientCode");
  if (v.length > 40) errors.push("화주사 품목코드는 40자 이내로 입력하세요.");
  return v || null;
}

function textError(v: string, label: string, max: number) {
  if (!v) return `${label}을(를) 입력하세요.`;
  if (v.length > max) return `${label}은(는) ${max}자 이내로 입력하세요.`;
  return null;
}

/** 3PL 일괄 등록 한 행 */
export function parseItemRow(r: RawRow): Parsed<ItemDraft> {
  const errors: string[] = [];
  const clientCode = clientCodeOf(r, errors);
  const name = cell(r, "name");
  const nameErr = textError(name, "품목명", 200);
  if (nameErr) errors.push(nameErr);

  const temp = parseTemp(cell(r, "storageTemp"));
  if (temp === null) errors.push("보관온도대를 입력하세요 (상온/냉장/냉동).");
  if (temp === undefined) errors.push(`보관온도대 '${cell(r, "storageTemp")}'은(는) 상온/냉장/냉동 중 하나로 입력하세요.`);

  const base = parseUnit(cell(r, "baseUnit"));
  if (base === null) errors.push("기준단위를 입력하세요 (EA/BOX/PLT).");
  if (base === undefined) errors.push(`기준단위 '${cell(r, "baseUnit")}'은(는) EA/BOX/PLT 중 하나로 입력하세요.`);

  const qtyOf: Partial<Record<ItemUnit, number | null>> = {
    BOX: parseQty(cell(r, "boxQty"), "BOX입수", errors),
    PLT: parseQty(cell(r, "pltQty"), "PLT입수", errors),
  };
  const barcodeCells: Record<ItemUnit, string[]> = {
    EA: splitList(cleanBarcode(cell(r, "eaBarcode"))),
    BOX: splitList(cleanBarcode(cell(r, "boxBarcode"))),
    PLT: splitList(cleanBarcode(cell(r, "pltBarcode"))),
  };

  const uoms: ItemDraft["uoms"] = [];
  if (base) {
    uoms.push({ unit: base, qty: 1 });
    if (base !== "EA" && barcodeCells.EA.length) errors.push(`기준단위가 ${base}이면 EA바코드를 넣을 수 없습니다.`);
    for (const u of ["BOX", "PLT"] as const) {
      if (u === base) {
        if (qtyOf[u]) errors.push(`${u}가 기준단위이면 ${u}입수는 비워 두세요.`);
        continue;
      }
      if (base === "PLT" && u === "BOX" && (qtyOf.BOX || barcodeCells.BOX.length)) {
        errors.push("기준단위가 PLT이면 BOX를 쓸 수 없습니다.");
        continue;
      }
      if (qtyOf[u]) uoms.push({ unit: u, qty: qtyOf[u]! });
      else if (barcodeCells[u].length) errors.push(`${u}바코드를 넣으려면 ${u}입수를 입력하세요.`);
    }
    if (qtyOf.BOX && qtyOf.PLT && base === "EA" && qtyOf.PLT <= qtyOf.BOX) errors.push("PLT입수는 BOX입수보다 커야 합니다.");
  }

  const barcodes: ItemDraft["barcodes"] = [];
  const seen = new Set<string>();
  for (const u of ITEM_UNITS) {
    if (!uoms.some((x) => x.unit === u)) continue;
    for (const b of barcodeCells[u]) {
      if (!BARCODE_PATTERN.test(b)) {
        errors.push(`${u}바코드 '${b}'은(는) 숫자 8~14자리로 입력하세요. 엑셀에서 숫자가 지수(1.23E+12)로 바뀌지 않게 텍스트 서식을 쓰세요.`);
        continue;
      }
      if (seen.has(b)) {
        errors.push(`바코드 ${b}이(가) 두 번 들어 있습니다.`);
        continue;
      }
      seen.add(b);
      barcodes.push({ unit: u, barcode: b, isPrimary: false });
    }
  }
  if (base && !barcodes.length && !errors.some((e) => e.includes("바코드"))) errors.push("바코드를 하나 이상 입력하세요 (PDA 스캔 기준).");
  // 대표 바코드: 기준단위 바코드의 첫 번째, 없으면 첫 바코드
  if (barcodes.length) (barcodes.find((b) => b.unit === base) ?? barcodes[0]).isPrimary = true;

  const expiry = parseYn(cell(r, "expiryManaged"));
  const lot = parseYn(cell(r, "lotManaged"));
  if (expiry === undefined) errors.push("소비기한관리는 Y 또는 N으로 입력하세요.");
  if (lot === undefined) errors.push("로트관리는 Y 또는 N으로 입력하세요.");

  const aliases: string[] = [];
  const aliasSeen = new Set<string>([normalizeAlias(name)]);
  for (const a of splitList(cell(r, "aliases"))) {
    if (a.length > 200) {
      errors.push(`별칭 '${a.slice(0, 20)}…'은(는) 200자 이내로 입력하세요.`);
      continue;
    }
    const n = normalizeAlias(a);
    if (aliasSeen.has(n)) continue; // 품목명과 같거나 중복된 별칭은 조용히 뺀다
    aliasSeen.add(n);
    aliases.push(a);
  }

  if (errors.length || !temp || !base) return { ok: false, errors };
  return {
    ok: true,
    value: { clientCode, name, storageTemp: temp, baseUnit: base, uoms, barcodes, expiryManaged: expiry ?? false, lotManaged: lot ?? false, aliases },
  };
}

/** 화주사 일괄 요청 한 행 */
export function parseRequestRow(r: RawRow): Parsed<RequestDraft> {
  const errors: string[] = [];
  const clientCode = clientCodeOf(r, errors);
  const name = cell(r, "name");
  const nameErr = textError(name, "품목명", 200);
  if (nameErr) errors.push(nameErr);
  const unit = parseUnit(cell(r, "unit"));
  if (unit === null) errors.push("단위를 입력하세요 (EA/BOX/PLT).");
  if (unit === undefined) errors.push(`단위 '${cell(r, "unit")}'은(는) EA/BOX/PLT 중 하나로 입력하세요.`);
  const barcode = cleanBarcode(cell(r, "barcode"));
  if (!barcode) errors.push("바코드를 입력하세요.");
  else if (!BARCODE_PATTERN.test(barcode)) errors.push(`바코드 '${barcode}'은(는) 숫자 8~14자리로 입력하세요.`);
  const temp = parseTemp(cell(r, "storageTemp"));
  if (temp === undefined) errors.push(`보관온도대 '${cell(r, "storageTemp")}'은(는) 상온/냉장/냉동 중 하나로 입력하세요.`);
  const expiry = parseYn(cell(r, "expiryManaged"));
  const lot = parseYn(cell(r, "lotManaged"));
  if (expiry === undefined) errors.push("소비기한관리는 Y 또는 N으로 입력하세요.");
  if (lot === undefined) errors.push("로트관리는 Y 또는 N으로 입력하세요.");
  const note = cell(r, "note");
  if (note.length > 500) errors.push("메모는 500자 이내로 입력하세요.");
  if (errors.length || !unit || temp === undefined || expiry === undefined || lot === undefined) return { ok: false, errors };
  return { ok: true, value: { clientCode, name, unit, barcode, storageTemp: temp, expiryManaged: expiry, lotManaged: lot, note: note || null } };
}

/** 같은 파일 안의 화주사 품목코드·바코드·별칭 중복 — 엑셀 행 번호별 오류 (먼저 나온 행은 그대로 두고 뒤 행에 표시) */
export function fileDuplicates(rows: { rowNo: number; clientCode: string | null; barcodes: string[]; aliases?: string[] }[]) {
  const errors = new Map<number, string[]>();
  const add = (rowNo: number, msg: string) => errors.set(rowNo, [...(errors.get(rowNo) ?? []), msg]);
  const codes = new Map<string, number>();
  const barcodes = new Map<string, number>();
  const aliases = new Map<string, number>();
  for (const r of rows) {
    if (r.clientCode) {
      const c = codes.get(r.clientCode);
      if (c !== undefined) add(r.rowNo, `화주사 품목코드 ${r.clientCode}이(가) 파일의 ${c}행과 겹칩니다.`);
      else codes.set(r.clientCode, r.rowNo);
    }
    for (const b of r.barcodes) {
      const p = barcodes.get(b);
      if (p !== undefined) add(r.rowNo, `바코드 ${b}이(가) 파일의 ${p}행과 겹칩니다.`);
      else barcodes.set(b, r.rowNo);
    }
    for (const a of r.aliases ?? []) {
      const n = normalizeAlias(a);
      const p = aliases.get(n);
      if (p !== undefined) add(r.rowNo, `별칭 '${a}'이(가) 파일의 ${p}행과 겹칩니다.`);
      else aliases.set(n, r.rowNo);
    }
  }
  return errors;
}

/** 양식의 예시 행을 지우지 않고 올린 경우 — 건너뛴다 */
export const isExampleRow = (kind: BulkKind, raw: RawRow) =>
  columnsOf(kind).every((c) => (raw[c.key] ?? "").trim() === c.example);
