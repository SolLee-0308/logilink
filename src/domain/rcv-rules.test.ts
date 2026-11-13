import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, autoReason, lineDiff, needsReason, planStatusAfterReceive, rcvLineState } from "./rcv-rules";

/**
 * 정의서 5-2 예시 — IP-0001: A100·C100·F100 / IP-0002: A100·C30·F80, 모두 ASN 분배수량 = 승인수량
 * 입고예정 라인 id: IP1A=11, IP1C=12, IP1F=13, IP2A=21, IP2C=22, IP2F=23. ASN 라인 id는 ASN 번호 + 품목
 */
test("자동 배분: 정의서 5-2 예시 표를 순서대로 재현한다", () => {
  const cap = new Map([[11, 100], [12, 100], [13, 100], [21, 100], [22, 30], [23, 80]]);
  const order = { A: [11, 21], C: [12, 22], F: [13, 23] }; // 승인 시각 순 (IP-0001이 먼저)
  const run = (qty: number, step1: { asnLineId: number; planLineId: number; cap: number }[], item: keyof typeof order) => {
    const rows = allocate([{ kind: "GOOD", qty }], step1, order[item], cap);
    for (const r of rows) if (r.planLineId) cap.set(r.planLineId, cap.get(r.planLineId)! - r.qty);
    return rows.map((r) => [r.step, r.planLineId, r.qty]);
  };
  // ASN-001 A 50 → IP-0001 A (1단계)
  assert.deepEqual(run(50, [{ asnLineId: 1001, planLineId: 11, cap: 50 }], "A"), [[1, 11, 50]]);
  // ASN-011 A 100 → IP-0002 A
  assert.deepEqual(run(100, [{ asnLineId: 1011, planLineId: 21, cap: 100 }], "A"), [[1, 21, 100]]);
  // 무지시 A 50 → 2단계: IP-0001 A 잔량 50
  assert.deepEqual(run(50, [], "A"), [[2, 11, 50]]);
  // ASN-002 C 50 → IP-0001 C, 무지시 C 50 → IP-0001 C 잔량 50
  assert.deepEqual(run(50, [{ asnLineId: 2002, planLineId: 12, cap: 50 }], "C"), [[1, 12, 50]]);
  assert.deepEqual(run(50, [], "C"), [[2, 12, 50]]);
  // ASN-003 F 90 → IP-0001 F 90
  assert.deepEqual(run(90, [{ asnLineId: 3003, planLineId: 13, cap: 90 }], "F"), [[1, 13, 90]]);
  // ASN-012 F 90 → IP-0002 F 80(상한) + 남은 10 → IP-0001 F 잔량 10
  assert.deepEqual(run(90, [{ asnLineId: 3012, planLineId: 23, cap: 90 }], "F"), [[1, 23, 80], [2, 13, 10]]);
  assert.equal(cap.get(13), 0);
  assert.equal(cap.get(23), 0);
});

test("자동 배분: 남으면 3단계 초과, 정상 먼저 채우고 반송이 이어서 채운다", () => {
  const rows = allocate(
    [{ kind: "GOOD", qty: 8 }, { kind: "RETURN", qty: 5 }],
    [{ asnLineId: 1, planLineId: 10, cap: 10 }],
    [10, 20],
    new Map([[10, 10], [20, 1]]),
  );
  assert.deepEqual(rows, [
    { kind: "GOOD", step: 1, planLineId: 10, asnLineId: 1, qty: 8 },
    { kind: "RETURN", step: 1, planLineId: 10, asnLineId: 1, qty: 2 },
    { kind: "RETURN", step: 2, planLineId: 20, asnLineId: null, qty: 1 },
    { kind: "RETURN", step: 3, planLineId: null, asnLineId: null, qty: 2 },
  ]);
  // 배분 합계 = 검수 수량 (C8)
  assert.equal(rows.reduce((s, r) => s + r.qty, 0), 13);
});

test("자동 배분: 1단계에서 채운 입고예정 라인은 2단계 칸이 그만큼 줄어 있다", () => {
  const rows = allocate([{ kind: "GOOD", qty: 15 }], [{ asnLineId: 1, planLineId: 10, cap: 10 }], [10], new Map([[10, 12]]));
  assert.deepEqual(rows.map((r) => [r.step, r.planLineId, r.qty]), [[1, 10, 10], [2, 10, 2], [3, null, 3]]);
});

test("검수 라인: 차이·상태·사유 필요 여부", () => {
  const base = { expect: 10, good: 0, damaged: 0, mismatchQty: 0, mismatch: false, zeroConfirm: false, hasInputs: false };
  assert.equal(rcvLineState(base), "todo");
  assert.equal(rcvLineState({ ...base, zeroConfirm: true }), "zero");
  assert.equal(needsReason({ ...base, zeroConfirm: true }), true); // 0 확인 = 전량 부족
  const ok = { ...base, good: 10, hasInputs: true };
  assert.equal(rcvLineState(ok), "match");
  assert.equal(needsReason(ok), false);
  assert.equal(lineDiff({ ...ok, good: 8, damaged: 1 }), -1);
  assert.equal(needsReason({ ...ok, good: 9, damaged: 1 }), true); // 차이는 0이어도 반송이 있으면 사유
  assert.equal(rcvLineState({ ...ok, good: 12 }), "over");
  assert.equal(rcvLineState({ ...base, expect: 0, mismatch: true, mismatchQty: 3, hasInputs: true }), "mismatch");
});

test("검수 사유: 수량으로 시스템이 정한다 (2026-11-13 A안)", () => {
  const base = { expect: 10, good: 0, damaged: 0, mismatchQty: 0, mismatch: false, zeroConfirm: false, hasInputs: true };
  assert.equal(autoReason({ ...base, good: 10 }), null); // 일치 — 사유 없음
  assert.equal(autoReason({ ...base, good: 8 }), "V01"); // 부족
  assert.equal(autoReason({ ...base, good: 12 }), "V02"); // 초과
  assert.equal(autoReason({ ...base, good: 9, damaged: 1 }), "V03"); // 훼손 반송
  assert.equal(autoReason({ ...base, good: 8, damaged: 1 }), "V03"); // 훼손 + 부족 → 훼손이 먼저
  assert.equal(autoReason({ ...base, hasInputs: false, zeroConfirm: true }), "V05"); // 0 확인 = 미도착
  assert.equal(autoReason({ ...base, expect: 0, mismatch: true, mismatchQty: 3 }), "V04"); // 품목 불일치
  // 사유가 필요한 라인에는 항상 자동 사유가 있다
  for (const l of [{ ...base, good: 8 }, { ...base, good: 12 }, { ...base, good: 9, damaged: 1 }, { ...base, hasInputs: false, zeroConfirm: true }])
    assert.equal(needsReason(l), autoReason(l) !== null);
});

test("입고예정 상태: 모든 라인 잔량 0 이하 → 입고완료, 아니면 부분입고", () => {
  assert.equal(planStatusAfterReceive([{ baseQty: 10, rcvQty: 8, returnQty: 2, closeQty: 0 }]), "COMPLETED");
  assert.equal(planStatusAfterReceive([{ baseQty: 10, rcvQty: 8, returnQty: 0, closeQty: 0 }, { baseQty: 5, rcvQty: 5, returnQty: 0, closeQty: 0 }]), "PARTIAL");
});
