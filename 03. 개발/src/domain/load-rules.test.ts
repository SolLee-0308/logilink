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

/* ───────── 품목별 차이 사유 (정의서 v2.0 D28) ───────── */
import { checkLineReasons, codeFits, lineDiffState, lineReasonSummary, type DiffCode } from "./load-rules";

const CODES: DiffCode[] = [
  { code: "L01", name: "재고 부족(결품)", requiresText: false, appliesTo: ["short"] },
  { code: "L03", name: "타 차량 이관", requiresText: false, appliesTo: ["short", "over", "extra"] },
  { code: "L04", name: "예정 외 차량(무지시)", requiresText: false, appliesTo: [] },
  { code: "L06", name: "화주사 추가 출고 요청", requiresText: false, appliesTo: ["over", "extra"] },
  { code: "L99", name: "기타", requiresText: true, appliesTo: ["short", "over", "extra"] },
];
const LINES = [
  { itemId: 1, itemLabel: "A", orderBase: 10, loadBase: 8 }, // 부족
  { itemId: 2, itemLabel: "B", orderBase: 10, loadBase: 12 }, // 초과
  { itemId: 3, itemLabel: "C", orderBase: 0, loadBase: 5 }, // 지시 외
  { itemId: 4, itemLabel: "D", orderBase: 10, loadBase: 10 }, // 일치
  { itemId: 5, itemLabel: "E", orderBase: 0, loadBase: 0 }, // 입력을 모두 취소한 줄
];

test("차이 사유를 받는 품목 상태", () => {
  assert.equal(lineDiffState(10, 8), "short");
  assert.equal(lineDiffState(10, 12), "over");
  assert.equal(lineDiffState(0, 5), "extra");
  assert.equal(lineDiffState(10, 10), null);
  assert.equal(lineDiffState(0, 0), null);
  assert.ok(codeFits(["short"], "short") && !codeFits(["short"], "over") && !codeFits([], "extra"));
});

test("부족·초과·지시 외가 섞여도 품목마다 다른 사유", () => {
  const r = checkLineReasons(LINES, [{ itemId: 1, code: "L01" }, { itemId: 2, code: "L06" }, { itemId: 3, code: "L03" }, { itemId: 4, code: "L01" }], CODES);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual([...r.reasons.keys()].sort(), [1, 2, 3]); // 일치 품목(4)에 온 사유는 무시
    assert.equal(r.reasons.get(1)?.code, "L01");
    assert.equal(r.reasons.get(2)?.code, "L06");
  }
});

test("빠진 사유·상태에 맞지 않는 사유·기타 텍스트 누락은 품목별 오류", () => {
  const r = checkLineReasons(LINES, [{ itemId: 1, code: "L06" }, { itemId: 2, code: "L99", text: "  " }], CODES);
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.match(r.errors.get(1)!, /부족 품목에 쓸 수 없는/); // 초과·지시 외 전용 코드
    assert.match(r.errors.get(2)!, /상세 내용/);
    assert.match(r.errors.get(3)!, /지시 외 사유를 고르세요/);
    assert.equal(r.errors.has(4), false);
    assert.equal(r.errors.has(5), false);
  }
  const l04 = checkLineReasons([LINES[0]], [{ itemId: 1, code: "L04" }], CODES);
  assert.ok(!l04.ok, "무지시 전용(적용 상태 없음) 코드는 고를 수 없다");
  const unknown = checkLineReasons([LINES[0]], [{ itemId: 1, code: "X03" }], CODES);
  assert.ok(!unknown.ok, "목록에 없는 코드");
});

test("이력 요약은 500자 이내", () => {
  const s = lineReasonSummary([{ label: "HF-1001", state: "short", name: "재고 부족(결품)", text: null }]);
  assert.equal(s.name, "품목별 사유 · 차이 1품목");
  assert.equal(s.text, "HF-1001 부족: 재고 부족(결품)");
  const long = lineReasonSummary(Array.from({ length: 40 }, (_, i) => ({ label: `HF-${1000 + i}`, state: "over" as const, name: "기타", text: "기사 요청으로 더 실음" })));
  assert.ok(long.text!.length <= 500);
});
