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

/* 입차·검수 시작·입차 취소 (정의서 v1.9 ⑥ · C11 · D25 · D26) */
test("검수 단계: 첫 입력 전이면 도착·검수 대기, 후면 검수중", async () => {
  const { rcvStageOf } = await import("./rcv-rules");
  assert.equal(rcvStageOf({ status: "WORKING", startedAt: null }), "ARRIVED");
  assert.equal(rcvStageOf({ status: "WORKING", startedAt: "2026-11-14T01:00:00Z" }), "WORKING");
  assert.equal(rcvStageOf({ status: "VOIDED", startedAt: null }), "VOIDED");
});

test("입차 취소: 첫 입력 전에만, 입력·0 확인이 있었으면 불가", async () => {
  const { arriveCancelBlock } = await import("./rcv-rules");
  assert.equal(arriveCancelBlock({ status: "WORKING", startedAt: null, inputCount: 0, zeroCount: 0 }), null);
  assert.ok(arriveCancelBlock({ status: "WORKING", startedAt: new Date(), inputCount: 0, zeroCount: 0 }));
  assert.ok(arriveCancelBlock({ status: "WORKING", startedAt: null, inputCount: 1, zeroCount: 0 })); // 취소한 입력도 센다
  assert.ok(arriveCancelBlock({ status: "WORKING", startedAt: null, inputCount: 0, zeroCount: 1 }));
  assert.ok(arriveCancelBlock({ status: "CONFIRMED", startedAt: null, inputCount: 0, zeroCount: 0 }));
});

test("K5 입차 취소 안내: 검수 시작 후에는 재입력·관리자 알림을 안내하고, 검수 확정을 권하지 않는다", async () => {
  const { arriveCancelBlock, ARRIVE_CANCEL_STARTED_MSG } = await import("./rcv-rules");
  const msg = arriveCancelBlock({ status: "WORKING", startedAt: new Date(), inputCount: 2, zeroCount: 0 });
  assert.equal(msg, ARRIVE_CANCEL_STARTED_MSG);
  assert.equal(
    msg,
    "이미 검수를 시작한 차량은 입차 취소할 수 없습니다. 차량이 맞으면 실제 검수 결과를 다시 입력해 주세요. 차량을 잘못 선택했다면 검수를 중단하고 3PL 관리자에게 알려 주세요.",
  );
  assert.ok(!msg!.includes("검수 확정하세요"));
});

test("Q2 전량 미도착: 예정 품목이 모두 0 확인이고 정상·반송·불일치 수량이 모두 0", async () => {
  const { isAllMissing } = await import("./rcv-rules");
  const z = { mismatch: false, zeroConfirm: true, good: 0, damaged: 0, mismatchQty: 0 };
  assert.equal(isAllMissing([z, z]), true); // 전량 미도착
  assert.equal(isAllMissing([z, { ...z, zeroConfirm: false, good: 5 }]), false); // 일부 미도착(정상 입고 있음)
  assert.equal(isAllMissing([z, { ...z, zeroConfirm: false, damaged: 2 }]), false); // 훼손 반송
  assert.equal(isAllMissing([z, { mismatch: true, zeroConfirm: false, good: 0, damaged: 0, mismatchQty: 3 }]), false); // 품목 불일치 반송(Q6)
  assert.equal(isAllMissing([]), false);
});

test("K4 검수 확정 조건: 유효한 입력 또는 직접 한 0 확인이 하나 이상", async () => {
  const { hasValidRcvRecord } = await import("./rcv-rules");
  // 입력 전 / 입력을 모두 취소함(취소된 입력은 hasInputs에 넣지 않는다)
  assert.equal(hasValidRcvRecord([]), false);
  assert.equal(hasValidRcvRecord([{ hasInputs: false, zeroConfirm: false }, { hasInputs: false, zeroConfirm: false }]), false);
  // 유효한 입력 1건 / 0(미도착) 확인만
  assert.equal(hasValidRcvRecord([{ hasInputs: true, zeroConfirm: false }, { hasInputs: false, zeroConfirm: false }]), true);
  assert.equal(hasValidRcvRecord([{ hasInputs: false, zeroConfirm: true }, { hasInputs: false, zeroConfirm: false }]), true);
});

test("입고검수 진입: 정확히 입력하고 1건이면 바로, 여럿이면 목록, 일부만 입력하면 1건이어도 목록", async () => {
  const { pickEntry } = await import("./rcv-rules");
  const rows = [
    { loadId: 1, loadNo: "LD-20261114-0001", orderNo: "LO-20261114-0001", vehicleNo: "12가3456" },
    { loadId: 2, loadNo: "LD-20261114-0002", orderNo: null, vehicleNo: "34나5678" },
    { loadId: 3, loadNo: "LD-20261113-0007", orderNo: null, vehicleNo: "34나5678" },
    { loadId: 4, loadNo: "LD-20261114-0003", orderNo: null, vehicleNo: "112가3456" },
  ];
  const direct = (q: string) => {
    const r = pickEntry(q, rows);
    return r.kind === "direct" ? r.row.loadId : r.kind;
  };
  assert.equal(direct("ld-20261114-0002"), 2); // 스캔·정확한 번호 (소문자·공백 허용)
  assert.equal(direct("LO-20261114-0001"), 1); // 상차지시서 번호
  assert.equal(direct("12가 3456"), 1); // 정확한 차량번호 — 112가3456이 포함돼도 정확히 일치하는 1건으로 바로
  const many = pickEntry("34나5678", rows); // 같은 차량번호 실적 2건
  assert.equal(many.kind, "list");
  assert.deepEqual(many.kind === "list" ? [many.exact, many.rows.map((r) => r.loadId)] : null, [true, [2, 3]]);
  const part = pickEntry("0002", rows); // 일부만 입력 → 1건이어도 목록
  assert.deepEqual(part.kind === "list" ? [part.exact, part.rows.map((r) => r.loadId)] : null, [false, [2]]);
  assert.equal(pickEntry("99하9999", rows).kind, "none");
});
