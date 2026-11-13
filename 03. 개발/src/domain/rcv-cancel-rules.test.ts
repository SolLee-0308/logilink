import { test } from "node:test";
import assert from "node:assert/strict";
import { planStatusAfterReverse, rcvCancelBlock } from "./rcv-cancel-rules";

test("입고취소: 확정 + 일마감 전 + 배분 입고예정이 열려 있으면 가능", () => {
  assert.equal(rcvCancelBlock({ status: "CONFIRMED", dailyClosed: false, lockedPlanNos: [] }), null);
});

test("입고취소: 확정 아님·일마감됨·적치 시작·종결된 입고예정이면 막는다", () => {
  assert.ok(rcvCancelBlock({ status: "WORKING", dailyClosed: false, lockedPlanNos: [] })?.includes("검수 확정"));
  assert.ok(rcvCancelBlock({ status: "CONFIRMED", dailyClosed: true, lockedPlanNos: [] })?.includes("일마감"));
  assert.ok(rcvCancelBlock({ status: "CONFIRMED", dailyClosed: false, lockedPlanNos: [], putawayStarted: true })?.includes("적치"));
  assert.ok(rcvCancelBlock({ status: "CONFIRMED", dailyClosed: false, lockedPlanNos: ["IP-1"] })?.includes("IP-1"));
});

test("되돌린 뒤 입고예정 상태: 처리 0 → 승인, 잔량 남음 → 부분입고, 잔량 0 → 입고완료", () => {
  assert.equal(planStatusAfterReverse([{ baseQty: 10, rcvQty: 0, returnQty: 0, closeQty: 0 }]), "APPROVED");
  assert.equal(planStatusAfterReverse([{ baseQty: 10, rcvQty: 4, returnQty: 0, closeQty: 0 }]), "PARTIAL");
  assert.equal(planStatusAfterReverse([{ baseQty: 10, rcvQty: 8, returnQty: 2, closeQty: 0 }]), "COMPLETED");
});
