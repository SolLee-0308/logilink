import { test } from "node:test";
import assert from "node:assert/strict";
import { canReview, canShipperEdit, dday, ddayLabel, diffLines, nextPlanNo } from "./plan-rules";

test("승인 전(승인대기·반려)만 화주사 수정·취소", () => {
  assert.equal(canShipperEdit("WAITING"), true);
  assert.equal(canShipperEdit("REJECTED"), true);
  for (const s of ["APPROVED", "PARTIAL", "COMPLETED", "CLOSED", "CANCELED"] as const) assert.equal(canShipperEdit(s), false);
});

test("승인·반려는 승인대기만", () => {
  assert.equal(canReview("WAITING"), true);
  assert.equal(canReview("REJECTED"), false);
  assert.equal(canReview("APPROVED"), false);
});

test("입고예정번호는 날짜별 일련번호", () => {
  assert.equal(nextPlanNo("2026-11-03", []), "IP-20261103-0001");
  assert.equal(nextPlanNo("2026-11-03", ["IP-20261103-0001", "IP-20261103-0007", "IP-20261102-0099"]), "IP-20261103-0008");
});

test("D-day 표시", () => {
  assert.equal(ddayLabel(dday("2026-11-03", "2026-11-03")), "오늘");
  assert.equal(ddayLabel(dday("2026-11-05", "2026-11-03")), "D-2");
  assert.equal(ddayLabel(dday("2026-11-01", "2026-11-03")), "D+2");
});

test("직전 반려본 대비 라인 비교", () => {
  const prev = [
    { itemId: 1, unit: "BOX", qty: 80 },
    { itemId: 2, unit: "BOX", qty: 40 },
    { itemId: 3, unit: "BOX", qty: 20 },
  ];
  const cur = [
    { itemId: 1, unit: "BOX", qty: 60 },
    { itemId: 2, unit: "BOX", qty: 40 },
    { itemId: 4, unit: "BOX", qty: 30 },
  ];
  const { diffs, removed } = diffLines(cur, prev);
  assert.deepEqual(diffs, [{ kind: "changed", prev: 80 }, { kind: "same" }, { kind: "new" }]);
  assert.deepEqual(removed.map((r) => r.itemId), [3]);
});
