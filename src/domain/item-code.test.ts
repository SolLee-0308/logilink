import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanClientCode, composeItemCode, nextItemSerial } from "./item-code";

test("품목코드 형식: 화주사코드-순번 5자리", () => {
  assert.equal(composeItemCode("HB01", 1), "HB01-00001");
  assert.equal(composeItemCode("GM01", 123), "GM01-00123");
});

test("다음 순번: 같은 화주사 형식의 최대 + 1, 다른 형식·다른 화주사 무시", () => {
  assert.equal(nextItemSerial("HB01", []), 1);
  assert.equal(nextItemSerial("HB01", ["HB01-00001", "HB01-00007", "HB-1001", "GM01-00099", "HB011-00050"]), 8);
});

test("화주사 품목코드: 공백 정리, 비우면 null", () => {
  assert.equal(cleanClientCode("  HB-1001 "), "HB-1001");
  assert.equal(cleanClientCode("   "), null);
  assert.equal(cleanClientCode(undefined), null);
});
