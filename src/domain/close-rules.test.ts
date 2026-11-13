import { test } from "node:test";
import assert from "node:assert/strict";
import { remainCloseBlock, remainOf } from "./close-rules";

test("잔량 = 승인 − 입고 − 반송 − 종결, 음수는 0", () => {
  assert.equal(remainOf({ baseQty: 100, rcvQty: 60, returnQty: 5, closeQty: 0 }), 35);
  assert.equal(remainOf({ baseQty: 100, rcvQty: 120, returnQty: 0, closeQty: 0 }), 0);
});

test("잔량 종결: 승인·부분입고 + 오는 중 ASN 없음 + 잔량 있음이면 가능", () => {
  assert.equal(remainCloseBlock({ status: "PARTIAL", openAsnCount: 0, remain: 10 }), null);
  assert.equal(remainCloseBlock({ status: "APPROVED", openAsnCount: 0, remain: 10 }), null);
});

test("잔량 종결: 상태·오는 중 ASN·잔량 없음이면 막는다", () => {
  assert.ok(remainCloseBlock({ status: "COMPLETED", openAsnCount: 0, remain: 0 })?.includes("승인·부분입고"));
  assert.ok(remainCloseBlock({ status: "PARTIAL", openAsnCount: 2, remain: 10 })?.includes("ASN 2대"));
  assert.ok(remainCloseBlock({ status: "PARTIAL", openAsnCount: 0, remain: 0 })?.includes("잔량이 없습니다"));
});
