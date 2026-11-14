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

/* 출차 (2026-11-12 Sol, 정의서 v1.9) — 저장된 출차만 본다. 자동 출차(조회 시 판단)는 폐지 */
test("출차: 저장된 출차가 있으면 시각·처리자·구분", async () => {
  const { departureOf } = await import("./load-rules");
  const at = new Date("2026-11-12T05:30:00Z");
  assert.deepEqual(departureOf({ departedAt: at, departedBy: "오세라", departType: "MANUAL" }), { at: at.toISOString(), by: "오세라", type: "MANUAL", system: false });
  assert.deepEqual(departureOf({ departedAt: at, departedBy: "김검수", departType: "ARRIVAL" }), { at: at.toISOString(), by: "김검수", type: "ARRIVAL", system: true });
});

test("출차: 저장된 출차가 없으면 업무일이 지나도 출차 아님 (자동 출차 폐지)", async () => {
  const { departureOf } = await import("./load-rules");
  assert.equal(departureOf({ departedAt: null, departedBy: null, departType: null }), null);
});

test("출차 표시: 사람은 처리자, 시스템 처리는 구분 이름", async () => {
  const { departureOf, departureLabel } = await import("./load-rules");
  const at = new Date("2026-11-12T05:30:00Z");
  assert.equal(departureLabel(departureOf({ departedAt: at, departedBy: "오세라", departType: "MANUAL" })!), "오세라");
  assert.equal(departureLabel(departureOf({ departedAt: at, departedBy: "박운영", departType: "DAILY_CLOSE" })!), "일마감 처리(시스템)");
  assert.equal(departureLabel(departureOf({ departedAt: at, departedBy: "김검수", departType: "ARRIVAL" })!), "입차 처리(시스템)");
});

test("일마감 처리(시스템) 대상: 출차·입차 기록 없고 마감 업무일 전날까지 상차완료 (당일분 제외)", async () => {
  const { isDailyDepartTarget } = await import("./load-rules");
  const base = { status: "COMPLETED", departedAt: null, arrivedAt: null };
  // 마감 업무일 11-13, 업무일 시작 06:00 → KST 11-13 06:00 (= 11-12T21:00Z) 전에 완료한 차량만
  assert.equal(isDailyDepartTarget({ ...base, completedAt: new Date("2026-11-12T20:59:00Z") }, "2026-11-13", "06:00"), true); // KST 11-13 05:59 (11-12 업무일)
  assert.equal(isDailyDepartTarget({ ...base, completedAt: new Date("2026-11-12T21:00:00Z") }, "2026-11-13", "06:00"), false); // KST 11-13 06:00 (당일)
  const old = new Date("2026-11-10T05:00:00Z");
  assert.equal(isDailyDepartTarget({ ...base, completedAt: old, departedAt: old }, "2026-11-13", "06:00"), false); // 이미 출차
  assert.equal(isDailyDepartTarget({ ...base, completedAt: old, arrivedAt: old }, "2026-11-13", "06:00"), false); // 입차함
  assert.equal(isDailyDepartTarget({ ...base, status: "WORKING", completedAt: null }, "2026-11-13", "06:00"), false); // 상차 중
});
