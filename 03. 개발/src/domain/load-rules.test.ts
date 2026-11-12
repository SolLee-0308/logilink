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

/* 출차 (2026-11-12 Sol) — [출차]를 누르면 그 시각, 안 눌렀으면 상차완료한 업무일이 지나면 자동 출차 */
test("출차: 누른 출차가 있으면 그 시각·처리자", async () => {
  const { departureOf } = await import("./load-rules");
  const d = departureOf(
    { status: "COMPLETED", completedAt: new Date("2026-11-12T05:00:00Z"), departedAt: new Date("2026-11-12T05:30:00Z"), departedBy: "오세라" },
    "06:00",
    new Date("2026-11-20T00:00:00Z"),
  );
  assert.deepEqual(d, { at: "2026-11-12T05:30:00.000Z", by: "오세라", auto: false });
});

test("출차: 안 눌렀으면 같은 업무일에는 출차 전, 업무일이 바뀌면 자동 출차(그 업무일 끝 시각)", async () => {
  const { departureOf } = await import("./load-rules");
  // KST 11-12 14:00 완료 → 업무일 11-12 (06:00 시작), 11-13 05:59까지 같은 업무일
  const l = { status: "COMPLETED", completedAt: new Date("2026-11-12T05:00:00Z"), departedAt: null, departedBy: null };
  assert.equal(departureOf(l, "06:00", new Date("2026-11-12T20:59:00Z")), null); // KST 11-13 05:59
  assert.deepEqual(departureOf(l, "06:00", new Date("2026-11-12T21:00:00Z")), { at: "2026-11-12T21:00:00.000Z", by: null, auto: true }); // KST 11-13 06:00
});

test("출차: 상차 중이면 출차 없음", async () => {
  const { departureOf } = await import("./load-rules");
  assert.equal(departureOf({ status: "WORKING", completedAt: null, departedAt: null, departedBy: null }, "06:00", new Date("2026-12-01T00:00:00Z")), null);
});
