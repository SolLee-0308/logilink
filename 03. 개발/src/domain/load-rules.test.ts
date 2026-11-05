import { test } from "node:test";
import assert from "node:assert/strict";
import { addQtyError, hasLoadDiff, lineState, normalizeDocNo, normalizeScan, overWarning, qtyInUnit } from "./load-rules";

test("상차 수량: 1 이상 정수, 상한", () => {
  assert.equal(addQtyError(1), null);
  assert.ok(addQtyError(0));
  assert.ok(addQtyError(-3));
  assert.ok(addQtyError(1.5));
  assert.ok(addQtyError(100_000));
});

test("지시 대비 상태: 부족·일치·초과·지시 외", () => {
  assert.equal(lineState(10, 5), "short");
  assert.equal(lineState(10, 10), "match");
  assert.equal(lineState(10, 12), "over");
  assert.equal(lineState(0, 3), "extra");
});

test("입력 전 경고: 지시 상차만, 지시 외 품목·초과", () => {
  assert.equal(overWarning({ ordered: true, orderBase: 10, loadBase: 4, addBase: 6 }), null);
  assert.equal(overWarning({ ordered: true, orderBase: 10, loadBase: 4, addBase: 7 }), "over");
  assert.equal(overWarning({ ordered: true, orderBase: 0, loadBase: 0, addBase: 1 }), "extra");
  assert.equal(overWarning({ ordered: false, orderBase: 0, loadBase: 0, addBase: 99 }), null);
});

test("차이 판단: 무지시는 항상 차이, 지시는 품목 하나라도 다르면", () => {
  assert.equal(hasLoadDiff(false, []), true);
  assert.equal(hasLoadDiff(true, [{ orderBase: 5, loadBase: 5 }]), false);
  assert.equal(hasLoadDiff(true, [{ orderBase: 5, loadBase: 5 }, { orderBase: 3, loadBase: 0 }]), true);
  assert.equal(hasLoadDiff(true, [{ orderBase: 0, loadBase: 2 }]), true);
});

test("단위 표시: 묶음 + 낱개", () => {
  assert.equal(qtyInUnit(125, "BOX", 12, "EA"), "10 BOX 5 EA");
  assert.equal(qtyInUnit(120, "BOX", 12, "EA"), "10 BOX");
  assert.equal(qtyInUnit(5, "BOX", 12, "EA"), "5 EA");
  assert.equal(qtyInUnit(7, "EA", 1, "EA"), "7 EA");
  assert.equal(qtyInUnit(1200, "EA", 1, "EA"), "1,200 EA");
});

test("스캔값 정리", () => {
  assert.equal(normalizeScan(" 8801234567890\r\n"), "8801234567890");
  assert.equal(normalizeDocNo(" lo-20261105-0001 "), "LO-20261105-0001");
});
