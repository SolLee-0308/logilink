/**
 * 품목 목록 엑셀 다운로드 점검 (개발용, 읽기 전용) — 조회조건 거르기·엑셀 열·행 수 확인 (U58)
 * 실행: npm run check:test -- scripts/check-item-export.ts
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { db } from "@/server/db";
import { matchItem } from "@/domain/item-list-filter";
import { buildItemListExport } from "@/server/master/excel";

async function main() {
  const client = await db.client.findFirst({ where: { items: { some: {} } }, orderBy: { code: "asc" } });
  if (!client) throw new Error("품목 있는 화주사 없음");
  const items = await db.item.findMany({ where: { clientId: client.id }, include: { uoms: true, barcodes: true, aliases: true }, orderBy: { code: "asc" } });
  const all = items.filter((r) => matchItem(r, { client: "", temp: "all", active: "all", q: "" }));
  const on = items.filter((r) => matchItem(r, { client: "", temp: "all", active: "on", q: "" }));
  const q = items[0]?.name.slice(0, 2) ?? "";
  const byQ = items.filter((r) => matchItem(r, { client: "", temp: "all", active: "all", q }));
  console.log(`${client.name}: 전체 ${all.length} / 사용 ${on.length} / '${q}' 검색 ${byQ.length}`);

  const buf = await buildItemListExport(on, "품목 목록");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(buf).buffer);
  const ws = wb.worksheets[0];
  console.log("시트:", ws.name, "행:", ws.rowCount - 1, "(기대", on.length, ")");
  console.log("머리글:", (ws.getRow(1).values as unknown[]).slice(1).join(" | "));
  for (let r = 2; r <= Math.min(4, ws.rowCount); r++) console.log((ws.getRow(r).values as unknown[]).slice(1).join(" | "));
  await db.$disconnect();
}
main();
