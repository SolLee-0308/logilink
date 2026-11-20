import { test } from "node:test";
import assert from "node:assert/strict";
import { INNER_QTY_RANGE_MSG, INNER_QTY_REQUIRED_MSG, innerQtyError, innerQtyOf } from "./master";
import { parseItemRow } from "./item-bulk";

test("입수: BOX 기준은 필수·2~100000 정수, 다른 기준 단위는 확인하지 않음", () => {
  assert.equal(innerQtyError("BOX", null), INNER_QTY_REQUIRED_MSG);
  assert.equal(innerQtyError("BOX", undefined), INNER_QTY_REQUIRED_MSG);
  assert.equal(innerQtyError("BOX", NaN), INNER_QTY_REQUIRED_MSG);
  assert.equal(innerQtyError("BOX", 1), INNER_QTY_RANGE_MSG);
  assert.equal(innerQtyError("BOX", 100001), INNER_QTY_RANGE_MSG);
  assert.equal(innerQtyError("BOX", 6), null);
  assert.equal(innerQtyError("EA", null), null);
  assert.equal(innerQtyError("PLT", null), null);
});

test("입수 표시: EA 기준은 BOX 환산, BOX 기준은 저장값, PLT 기준·환산 없음은 null", () => {
  assert.equal(innerQtyOf({ baseUnit: "EA", innerQty: null, uoms: [{ unit: "EA", qty: 1 }, { unit: "BOX", qty: 20 }] }), 20);
  assert.equal(innerQtyOf({ baseUnit: "EA", innerQty: null, uoms: [{ unit: "EA", qty: 1 }] }), null);
  assert.equal(innerQtyOf({ baseUnit: "BOX", innerQty: 6, uoms: [{ unit: "BOX", qty: 1 }] }), 6);
  assert.equal(innerQtyOf({ baseUnit: "BOX", innerQty: null, uoms: [{ unit: "BOX", qty: 1 }] }), null);
  assert.equal(innerQtyOf({ baseUnit: "PLT", innerQty: null, uoms: [{ unit: "PLT", qty: 1 }] }), null);
});

const boxRow = (o: Record<string, string> = {}) => ({
  clientCode: "", name: "키친타월 150매×6롤", storageTemp: "상온", baseUnit: "BOX", boxQty: "6", pltQty: "",
  eaBarcode: "", boxBarcode: "18801234500018", pltBarcode: "", expiryManaged: "", lotManaged: "", aliases: "", ...o,
});

test("엑셀: 기준단위 BOX면 BOX입수 = 입수(필수)", () => {
  const ok = parseItemRow(boxRow());
  assert.ok(ok.ok && ok.value.innerQty === 6 && ok.value.uoms.length === 1);
  const none = parseItemRow(boxRow({ boxQty: "" }));
  assert.ok(!none.ok && none.errors.some((e) => e.includes("BOX입수")));
  assert.ok(!parseItemRow(boxRow({ boxQty: "1" })).ok);
});

test("엑셀: 기준단위 EA면 입수는 저장하지 않고 BOX 환산으로 남음", () => {
  const r = parseItemRow(boxRow({ baseUnit: "EA", eaBarcode: "8801234500011", boxQty: "20" }));
  assert.ok(r.ok && r.value.innerQty === null && r.value.uoms.some((u) => u.unit === "BOX" && u.qty === 20));
});
