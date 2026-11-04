import "server-only";
import ExcelJS from "exceljs";
import { BULK_MAX_ROWS, columnsOf, isExampleRow, mapHeaders, missingHeaderMessage, type BulkKind, type RawRow } from "@/domain/item-bulk";

/**
 * 품목 엑셀 일괄 등록·요청 양식 만들기 / 올린 파일 읽기 (서버에서만)
 * 첫 시트 1행 = 머리글, 2행부터 데이터. 머리글 이름으로 열을 찾으므로 열 순서가 바뀌어도 된다.
 */

const TITLE: Record<BulkKind, string> = { ITEM: "품목 일괄 등록", REQUEST: "품목 등록 요청" };

export async function buildTemplate(kind: BulkKind): Promise<Buffer> {
  const cols = columnsOf(kind);
  const wb = new ExcelJS.Workbook();
  wb.creator = "LogiLink";
  const ws = wb.addWorksheet(TITLE[kind], { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.required ? `${c.header}*` : c.header, key: c.key, width: c.width }));

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
      for (let r = 2; r <= BULK_MAX_ROWS + 1; r++) {
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
    { header: "항목", key: "h", width: 16 },
    { header: "필수", key: "r", width: 8 },
    { header: "작성 방법", key: "n", width: 80 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const c of cols) guide.addRow({ h: c.header, r: c.required ? "필수" : "", n: c.note });
  guide.addRow({});
  guide.addRow({ h: "공통", n: `첫 번째 시트의 2행부터 입력합니다. 예시 행은 지우거나 덮어쓰세요. 한 번에 최대 ${BULK_MAX_ROWS.toLocaleString()}행까지 올릴 수 있습니다.` });
  guide.addRow({ h: "", n: "올리면 먼저 행마다 검사 결과를 보여 주고, 오류가 없는 행만 등록합니다. 오류 행은 내려받아 고친 뒤 다시 올리면 됩니다." });
  if (kind === "REQUEST")
    guide.addRow({ h: "", n: "요청은 3PL이 검토한 뒤 품목으로 등록됩니다. 단위 환산(BOX·PLT 입수)과 추가 바코드는 3PL이 등록 후 보완합니다." });

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

export async function readRows(kind: BulkKind, data: ArrayBuffer): Promise<ReadResult> {
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
  const { keys, missing } = mapHeaders(kind, headers);
  if (missing.length) return { ok: false, error: missingHeaderMessage(kind, headers, missing) };

  const rows: { rowNo: number; raw: RawRow }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: RawRow = {};
    keys.forEach((k, i) => {
      if (k) raw[k] = cellText(row.getCell(i + 1).value).trim();
    });
    if (Object.values(raw).every((v) => !v) || isExampleRow(kind, raw)) continue; // 빈 행·예시 행
    rows.push({ rowNo: r, raw });
  }
  if (!rows.length) return { ok: false, error: "입력된 행이 없습니다. 2행부터 품목을 입력하세요." };
  if (rows.length > BULK_MAX_ROWS) return { ok: false, error: `한 번에 ${BULK_MAX_ROWS.toLocaleString()}행까지 올릴 수 있습니다 (지금 ${rows.length.toLocaleString()}행). 나눠서 올리세요.` };
  return { ok: true, rows };
}
