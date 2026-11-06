import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEM_COLUMNS, REQUEST_COLUMNS, fileDuplicates, isExampleRow, isOtherTemplate, mapHeaders, missingHeaderMessage, parseItemRow, parseRequestRow } from "./item-bulk";

const item = (o: Record<string, string> = {}) => ({
  clientCode: "HB-1", name: "두부", storageTemp: "냉장", baseUnit: "EA", boxQty: "20", pltQty: "", eaBarcode: "8801234500011",
  boxBarcode: "18801234500018", pltBarcode: "", expiryManaged: "Y", lotManaged: "", aliases: "두부 300, 두부", ...o,
});

test("품목 행: 단위 환산·바코드·대표 바코드·별칭", () => {
  const r = parseItemRow(item());
  assert.ok(r.ok);
  assert.deepEqual(r.value.uoms, [{ unit: "EA", qty: 1 }, { unit: "BOX", qty: 20 }]);
  assert.deepEqual(r.value.barcodes.map((b) => [b.unit, b.isPrimary]), [["EA", true], ["BOX", false]]);
  assert.equal(r.value.storageTemp, "CHILLED");
  assert.equal(r.value.expiryManaged, true);
  assert.equal(r.value.lotManaged, false);
  // 품목명과 같은 별칭은 뺀다
  assert.deepEqual(r.value.aliases, ["두부 300"]);
});

test("품목 행: 필수·형식 오류를 모두 모아 알려 준다", () => {
  const r = parseItemRow(item({ name: "", storageTemp: "실온", baseUnit: "KG", eaBarcode: "12" }));
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes("품목명")));
  assert.ok(r.errors.some((e) => e.includes("보관온도대")));
  assert.ok(r.errors.some((e) => e.includes("기준단위")));
});

test("품목 행: 화주사 품목코드는 선택 — 비우면 null, 40자 넘으면 오류", () => {
  const r = parseItemRow(item({ clientCode: "" }));
  assert.ok(r.ok && r.value.clientCode === null);
  assert.ok(!parseItemRow(item({ clientCode: "X".repeat(41) })).ok);
});

test("품목 행: 입수 없이 BOX 바코드만 있으면 오류, 바코드가 하나도 없으면 오류", () => {
  assert.ok(!parseItemRow(item({ boxQty: "" })).ok);
  const none = parseItemRow(item({ eaBarcode: "", boxBarcode: "" }));
  assert.ok(!none.ok && none.errors.some((e) => e.includes("바코드를 하나 이상")));
});

test("품목 행: 기준단위가 BOX면 EA 바코드 불가, PLT입수는 BOX보다 커야", () => {
  assert.ok(!parseItemRow(item({ baseUnit: "BOX", boxQty: "" })).ok);
  assert.ok(!parseItemRow(item({ pltQty: "10" })).ok);
  assert.ok(parseItemRow(item({ pltQty: "800" })).ok);
});

test("요청 행: 보관·관리 여부는 비워 두면 모름(null)", () => {
  const r = parseRequestRow({ clientCode: "A1", name: "새우", unit: "box", barcode: "8801234500011", storageTemp: "", expiryManaged: "", lotManaged: "N", note: "" });
  assert.ok(r.ok);
  assert.equal(r.value.unit, "BOX");
  assert.equal(r.value.storageTemp, null);
  assert.equal(r.value.expiryManaged, null);
  assert.equal(r.value.lotManaged, false);
});

test("파일 안 중복은 뒤에 나온 행에 표시한다", () => {
  const e = fileDuplicates([
    { rowNo: 2, clientCode: "A", barcodes: ["1111111111111"] },
    { rowNo: 3, clientCode: "A", barcodes: ["2222222222222"] },
    { rowNo: 4, clientCode: "B", barcodes: ["1111111111111"] },
    { rowNo: 5, clientCode: null, barcodes: ["3333333333333"] },
    { rowNo: 6, clientCode: null, barcodes: ["4444444444444"] },
  ]);
  assert.equal(e.get(2), undefined);
  assert.match(e.get(3)![0], /2행/);
  assert.match(e.get(4)![0], /2행/);
  assert.equal(e.get(6), undefined, "화주사 품목코드가 비어 있는 행끼리는 겹친다고 보지 않는다");
});

test("머리글: 별표·공백 무시, 필수 열 누락 알림, 예시 행 건너뛰기", () => {
  const m = mapHeaders("REQUEST", ["화주사 품목코드", " 품목명* ", "단위*", "기타"]);
  assert.deepEqual(m.keys, ["clientCode", "name", "unit", null]);
  assert.deepEqual(m.missing, ["바코드"]);
  assert.ok(isExampleRow("REQUEST", { clientCode: "HB-1001", name: "국산콩 두부 300g", unit: "EA", barcode: "8801234500011", storageTemp: "냉장", expiryManaged: "Y", lotManaged: "", note: "11월 신상품" }));
});

test("다른 양식을 올리면 그 양식이라고 안내", () => {
  const itemHeaders = ITEM_COLUMNS.map((c) => c.header);
  const reqHeaders = REQUEST_COLUMNS.map((c) => c.header);
  assert.equal(isOtherTemplate("REQUEST", itemHeaders), true);
  assert.equal(isOtherTemplate("ITEM", reqHeaders), true);
  assert.equal(isOtherTemplate("REQUEST", reqHeaders), false);
  assert.match(missingHeaderMessage("REQUEST", itemHeaders, ["단위", "바코드"]), /품목 일괄 등록' 양식으로 작성한 파일/);
  // 그냥 열이 빠진 경우는 기존 안내
  assert.match(missingHeaderMessage("REQUEST", ["품목코드", "품목명"], ["단위", "바코드"]), /^필수 열이 없습니다: 단위, 바코드/);
});
