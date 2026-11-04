import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, candidatesFor, duplicateLines, lineErrors, matchItem, parseDate, parseQty, parseUnit, toDraftLine, type CatalogItem } from "./plan-entry";

const tofu: CatalogItem = {
  id: 1, code: "HB-1001", name: "국산콩 두부 300g", baseUnit: "EA",
  uoms: [{ unit: "EA", qty: 1 }, { unit: "BOX", qty: 20 }],
  barcodes: [{ barcode: "8801100010011", unit: "EA" }, { barcode: "18801100010018", unit: "BOX" }],
  aliases: ["두부300"], expiryManaged: true, lotManaged: false,
};
const water: CatalogItem = {
  id: 2, code: "HB-2001", name: "생수 2L", baseUnit: "EA",
  uoms: [{ unit: "PLT", qty: 600 }], barcodes: [], aliases: [], expiryManaged: false, lotManaged: false,
};
const idx = buildIndex([tofu, water]);

test("원문 단위·수량·날짜 해석", () => {
  assert.equal(parseUnit("박스"), "BOX");
  assert.equal(parseUnit("box"), "BOX");
  assert.equal(parseUnit("파레트"), "PLT");
  assert.equal(parseUnit("kg"), null);
  assert.equal(parseQty("1,200"), 1200);
  assert.equal(parseQty("20개"), 20);
  assert.equal(parseQty("0"), null);
  assert.equal(parseQty("1.5"), null);
  assert.equal(parseDate("2026.12.31"), "2026-12-31");
  assert.equal(parseDate("20261231"), "2026-12-31");
  assert.equal(parseDate("26/1/5"), "2026-01-05");
  assert.equal(parseDate("2026-02-30"), null);
});

test("매칭 순서: 코드 → 바코드(단위 포함) → 품목명 → 별칭", () => {
  assert.equal(matchItem(idx, { code: "hb-1001" })?.by, "code");
  const bc = matchItem(idx, { barcode: "18801100010018" });
  assert.equal(bc?.by, "barcode");
  assert.equal(bc?.unit, "BOX");
  assert.equal(matchItem(idx, { name: "국산콩두부 300G" })?.by, "name");
  assert.equal(matchItem(idx, { name: "두부 300" })?.by, "alias");
  assert.equal(matchItem(idx, { name: "두부" }), null);
  assert.deepEqual(candidatesFor(idx, "국산콩 두부"), [1]);
});

test("초안 라인: 단위 자동·없는 단위·수량 오류·미매칭 후보", () => {
  const a = toDraftLine(idx, { origin: "엑셀 2행", barcode: "18801100010018", qty: "30" });
  assert.equal(a.itemId, 1);
  assert.equal(a.unit, "BOX");
  assert.deepEqual(a.issues, []);
  const b = toDraftLine(idx, { origin: "엑셀 3행", code: "HB-2001", qty: "2" });
  assert.equal(b.unit, "PLT", "단위가 하나뿐이면 그 단위");
  const c = toDraftLine(idx, { origin: "엑셀 4행", code: "HB-2001", unit: "BOX", qty: "abc" });
  assert.equal(c.unit, null);
  assert.equal(c.issues.length, 2);
  const d = toDraftLine(idx, { origin: "판독 1", name: "국산콩 두부", qty: 5, confidence: 0.5 });
  assert.equal(d.itemId, null);
  assert.deepEqual(d.candidates, [1]);
  assert.equal(d.lowConfidence, true);
  const e = toDraftLine(idx, { origin: "판독 2", name: "두부 한모", aiCode: "HB-1001", qty: 5 });
  assert.equal(e.matchedBy, "ai");
});

test("편집기 라인 검사·중복", () => {
  const items = new Map([[1, tofu], [2, water]]);
  assert.deepEqual(Object.keys(lineErrors({ itemId: 1, unit: "BOX", qty: 3, expiryDate: null, lotNo: null }, tofu)), ["expiryDate"]);
  assert.equal(lineErrors({ itemId: 2, unit: "EA", qty: 3, expiryDate: null, lotNo: null }, water).unit, "생수 2L에 등록되지 않은 단위입니다.");
  assert.ok(lineErrors({ itemId: 2, unit: "PLT", qty: 3, expiryDate: null, lotNo: null, lowConfidence: true }, water).qty);
  const dup = duplicateLines(
    [
      { itemId: 1, unit: "BOX", qty: 1, expiryDate: "2026-12-31", lotNo: null },
      { itemId: 1, unit: "BOX", qty: 2, expiryDate: "2026-12-31", lotNo: null },
      { itemId: 1, unit: "BOX", qty: 2, expiryDate: "2027-01-31", lotNo: null },
    ],
    items,
  );
  assert.deepEqual([...dup].sort(), [0, 1]);
});
