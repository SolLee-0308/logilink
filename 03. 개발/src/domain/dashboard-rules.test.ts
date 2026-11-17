import { test } from "node:test";
import assert from "node:assert/strict";
import { flowStage, lastBusinessDays, pctOf } from "./dashboard-rules";
import { isBusinessDay } from "./business-day";

test("흐름 단계 — 상차중·오는 중·도착·검수·입고완료", () => {
  assert.equal(flowStage({ status: "WORKING", arrivedAt: null, rcvs: [] }), "loading");
  assert.equal(flowStage({ status: "COMPLETED", arrivedAt: null, rcvs: [] }), "onTheWay");
  assert.equal(flowStage({ status: "COMPLETED", arrivedAt: new Date(), rcvs: [{ status: "WORKING" }] }), "arrived");
  assert.equal(flowStage({ status: "COMPLETED", arrivedAt: new Date(), rcvs: [{ status: "CONFIRMED" }] }), "received");
});

test("흐름 단계 — 입고취소 뒤 재검수 전은 도착·검수, 입차 취소는 오는 중", () => {
  assert.equal(flowStage({ status: "COMPLETED", arrivedAt: new Date(), rcvs: [{ status: "CANCELED" }] }), "arrived");
  assert.equal(flowStage({ status: "COMPLETED", arrivedAt: null, rcvs: [{ status: "VOIDED" }] }), "onTheWay");
  assert.equal(flowStage({ status: "COMPLETED", arrivedAt: new Date(), rcvs: [{ status: "CANCELED" }, { status: "CONFIRMED" }] }), "received");
});

test("최근 업무일 — 오늘 포함, 휴무일 건너뜀, 오래된 날이 앞", () => {
  // 2026-11-17 화요일, 일요일 정기 휴무 + 11-13(금) 휴무일
  const off = { weekly: [0], holidays: new Set(["2026-11-13"]) };
  const days = lastBusinessDays("2026-11-17", 5, (d) => isBusinessDay(d, off));
  assert.deepEqual(days, ["2026-11-11", "2026-11-12", "2026-11-14", "2026-11-16", "2026-11-17"]);
  assert.equal(lastBusinessDays("2026-11-17", 14, () => true).length, 14);
  assert.deepEqual(lastBusinessDays("2026-11-17", 3, () => false), []);
});

test("진행률", () => {
  assert.equal(pctOf(0, 0), 0);
  assert.equal(pctOf(5, 9), 56);
  assert.equal(pctOf(8, 20), 40);
});
