import "server-only";
import ExcelJS from "exceljs";
import { STORAGE_TEMP_LABEL, type StorageTemp } from "@/domain/master";
import { BULK_MAX_ROWS, columnsOf, isExampleRow, mapColumns, missingHeaderMessage, type BulkColumn, type BulkKind, type RawRow } from "@/domain/item-bulk";

/**
 * 품목 엑셀 일괄 등록·요청 양식 만들기 / 올린 파일 읽기 (서버에서만)
 * 첫 시트 1행 = 머리글, 2행부터 데이터. 머리글 이름으로 열을 찾으므로 열 순서가 바뀌어도 된다.
 */

const TITLE: Record<BulkKind, string> = { ITEM: "품목 일괄 등록", REQUEST: "품목 등록 요청" };

/** 양식 한 종류 — 첫 시트 이름·열·최대 행·작성 안내·머리글 검사 */
export interface SheetSpec {
  title: string;
  columns: BulkColumn[];
  maxRows: number;
  guide: string[];
  isExample: (raw: RawRow) => boolean;
  /** 필수 열이 빠졌을 때 안내 (없으면 null) */
  headerError: (headers: string[], keys: (string | null)[], missing: string[]) => string | null;
}

function itemSpec(kind: BulkKind): SheetSpec {
  return {
    title: TITLE[kind],
    columns: columnsOf(kind),
    maxRows: BULK_MAX_ROWS,
    guide: [
      "올리면 먼저 행마다 검사 결과를 보여 주고, 오류가 없는 행만 등록합니다. 오류 행은 내려받아 고친 뒤 다시 올리면 됩니다.",
      ...(kind === "REQUEST" ? ["요청은 3PL이 검토한 뒤 품목으로 등록됩니다. 단위 환산(BOX·PLT 입수)과 추가 바코드는 3PL이 등록 후 보완합니다."] : []),
    ],
    isExample: (raw) => isExampleRow(kind, raw),
    headerError: (headers, _keys, missing) => (missing.length ? missingHeaderMessage(kind, headers, missing) : null),
  };
}

export const buildTemplate = (kind: BulkKind) => buildSheetTemplate(itemSpec(kind));
export const readRows = (kind: BulkKind, data: ArrayBuffer) => readSheet(itemSpec(kind), data);


/**
 * 엑셀 열 너비 — 머리글이 잘리지 않게 글자 폭으로 넓힌다 (한글·전각은 2칸, 굵은 머리글 여유 +3).
 * 2026-11-06 Sol: '화주사 품목코드' 머리글이 잘려 보이던 문제
 */
const WIDE_CHAR = /[ᄀ-ᇿ　-鿿가-힯＀-￯]/;
export const textWidth = (t: string) => [...t].reduce((w, ch) => w + (WIDE_CHAR.test(ch) ? 2 : 1), 0);
const fitWidth = (min: number, ...texts: string[]) => Math.max(min, ...texts.map((t) => textWidth(t) + 3));

export async function buildSheetTemplate(spec: SheetSpec): Promise<Buffer> {
  const cols = spec.columns;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LogiLink";
  const ws = wb.addWorksheet(spec.title, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => {
    const header = c.required ? `${c.header}*` : c.header;
    return { header, key: c.key, width: fitWidth(c.width, header, c.example) };
  });

  const head = ws.getRow(1);
  head.height = 22;
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.font = { bold: true, color: { argb: c.required ? "FFFFFFFF" : "FF18181B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FF6C5CE7" : "FFE4E4E7" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.note = c.note;
  });

  // 예시 1행 — 지우고 쓰도록 회색 기울임
  const ex = ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.example])));
  ex.font = { italic: true, color: { argb: "FF71717A" } };

  // 코드·바코드는 앞자리 0이 사라지거나 지수로 바뀌지 않게 텍스트 서식, 선택지는 드롭다운
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (/code|barcode|Barcode/i.test(c.key)) col.numFmt = "@";
    if (c.list) {
      for (let r = 2; r <= spec.maxRows + 1; r++) {
        ws.getCell(r, i + 1).dataValidation = {
          type: "list",
          allowBlank: !c.required,
          formulae: [`"${c.list.join(",")}"`],
          showErrorMessage: true,
          errorTitle: c.header,
          error: `${c.list.join(" / ")} 중에서 고르세요.`,
        };
      }
    }
  });

  const guide = wb.addWorksheet("작성 안내");
  guide.columns = [
    { header: "항목", key: "h", width: fitWidth(16, ...cols.map((c) => c.header)) },
    { header: "필수", key: "r", width: 8 },
    { header: "작성 방법", key: "n", width: 80 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const c of cols) guide.addRow({ h: c.header, r: c.required ? "필수" : "", n: c.note });
  guide.addRow({});
  guide.addRow({ h: "공통", n: `첫 번째 시트의 2행부터 입력합니다. 예시 행은 지우거나 덮어쓰세요. 한 번에 최대 ${spec.maxRows.toLocaleString()}행까지 올릴 수 있습니다.` });
  for (const n of spec.guide) guide.addRow({ h: "", n });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * 품목 목록 엑셀 다운로드 (U58, 2026-11-15 Sol) — 화면 조회조건에 걸린 품목만, 내려받기 전용(다시 올리기 없음)
 * 열: 품목코드 · 화주사 품목코드 · 품목명 · 보관온도대 · 단위별 입수(기준단위·BOX·PLT) · 단위별 바코드 · 별칭 · 사용여부
 */
export interface ItemExportRow {
  code: string;
  clientCode: string | null;
  name: string;
  storageTemp: StorageTemp;
  baseUnit: string;
  /** 입수 — BOX 기준 품목의 BOX 1개에 든 EA 수 (2026-11-17 Sol) */
  innerQty: number | null;
  isActive: boolean;
  uoms: { unit: string; qty: number }[];
  barcodes: { unit: string; barcode: string }[];
  aliases: { alias: string }[];
}

export async function buildItemListExport(rows: ItemExportRow[], sheetName: string): Promise<Buffer> {
  const cols: { header: string; key: string; width: number; text?: boolean; center?: boolean; value: (r: ItemExportRow) => string | number | null }[] = [
    { header: "품목코드", key: "code", width: 14, text: true, center: true, value: (r) => r.code },
    { header: "화주사 품목코드", key: "clientCode", width: 16, text: true, value: (r) => r.clientCode ?? "" },
    { header: "품목명", key: "name", width: 28, value: (r) => r.name },
    { header: "보관온도대", key: "storageTemp", width: 10, center: true, value: (r) => STORAGE_TEMP_LABEL[r.storageTemp] },
    { header: "기준단위", key: "baseUnit", width: 9, center: true, value: (r) => r.baseUnit },
    { header: "BOX입수", key: "boxQty", width: 9, value: (r) => (r.baseUnit === "BOX" ? r.innerQty : (r.uoms.find((u) => u.unit === "BOX")?.qty ?? null)) },
    { header: "PLT입수", key: "pltQty", width: 9, value: (r) => r.uoms.find((u) => u.unit === "PLT" && u.unit !== r.baseUnit)?.qty ?? null },
    ...(["EA", "BOX", "PLT"] as const).map((unit) => ({
      header: `${unit}바코드`,
      key: `${unit.toLowerCase()}Barcode`,
      width: 18,
      text: true,
      value: (r: ItemExportRow) => r.barcodes.filter((b) => b.unit === unit).map((b) => b.barcode).join(", "),
    })),
    { header: "별칭", key: "aliases", width: 28, value: (r) => r.aliases.map((a) => a.alias).join(", ") },
    { header: "사용여부", key: "isActive", width: 9, center: true, value: (r) => (r.isActive ? "사용" : "사용 안 함") },
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = "LogiLink";
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: fitWidth(c.width, c.header) }));
  // 코드·바코드는 앞자리 0이 사라지거나 지수로 바뀌지 않게 텍스트 서식
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.text) col.numFmt = "@";
    if (c.center) col.alignment = { horizontal: "center" };
  });
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF18181B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
    cell.alignment = { vertical: "middle", horizontal: "center" }; // 열 제목은 항상 가운데
  });
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.value(r)])));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 셀 값 → 문자열 (숫자·날짜·서식 있는 글자·수식 결과 모두) */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  // 큰 정수(바코드)도 지수 표기 없이
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("fullwide", { useGrouping: false }) : String(v);
  if (typeof v === "boolean") return v ? "Y" : "N";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v);
}

export type ReadResult = { ok: true; rows: { rowNo: number; raw: RawRow }[] } | { ok: false; error: string };

export async function readSheet(spec: SheetSpec, data: ArrayBuffer): Promise<ReadResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { ok: false, error: "엑셀 파일(.xlsx)을 읽지 못했습니다. 양식을 내려받아 작성한 파일인지 확인하세요." };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "시트가 없는 파일입니다." };

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= headerRow.cellCount; c++) headers.push(cellText(headerRow.getCell(c).value).trim());
  const { keys, missing } = mapColumns(spec.columns, headers);
  const headerError = spec.headerError(headers, keys, missing);
  if (headerError) return { ok: false, error: headerError };

  const rows: { rowNo: number; raw: RawRow }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: RawRow = {};
    keys.forEach((k, i) => {
      if (k) raw[k] = cellText(row.getCell(i + 1).value).trim();
    });
    if (Object.values(raw).every((v) => !v) || spec.isExample(raw)) continue; // 빈 행·예시 행
    rows.push({ rowNo: r, raw });
  }
  if (!rows.length) return { ok: false, error: "입력된 행이 없습니다. 2행부터 품목을 입력하세요." };
  if (rows.length > spec.maxRows) return { ok: false, error: `한 번에 ${spec.maxRows.toLocaleString()}행까지 올릴 수 있습니다 (지금 ${rows.length.toLocaleString()}행). 나눠서 올리세요.` };
  return { ok: true, rows };
}
