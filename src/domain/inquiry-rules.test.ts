import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedCancelBlock, asnStatusesOf, elapsedDays, isOverdue, overdueCutoff, planStatusesOf, progressPct } from "./inquiry-rules";
import { defaultInquiry, inquirySearch, parseInquiryQuery } from "@/features/plans/inquiry/inquiry-list";

test("상태 조건: 기본은 미종결, 모르는 값도 미종결", () => {
  assert.deepEqual(planStatusesOf("open"), ["APPROVED", "PARTIAL"]);
  assert.deepEqual(planStatusesOf("xx"), ["APPROVED", "PARTIAL"]);
  assert.deepEqual(planStatusesOf("CLOSED"), ["CLOSED"]);
  assert.ok(!planStatusesOf("all").includes("WAITING"));
  assert.deepEqual(asnStatusesOf("open"), ["REGISTERED", "LOADING", "LOADED"]);
  assert.ok(!asnStatusesOf("all").includes("CANCELED"));
});

test("경과일: 미종결만, 입고예정일 다음 날부터", () => {
  assert.equal(elapsedDays("APPROVED", "2026-11-05", "2026-11-05"), 0);
  assert.equal(elapsedDays("APPROVED", "2026-11-07", "2026-11-05"), 0);
  assert.equal(elapsedDays("PARTIAL", "2026-11-01", "2026-11-05"), 4);
  assert.equal(elapsedDays("COMPLETED", "2026-11-01", "2026-11-05"), 0);
  assert.ok(isOverdue(3, 3));
  assert.ok(!isOverdue(2, 3));
  assert.ok(!isOverdue(0, 0));
  assert.equal(overdueCutoff("2026-11-05", 3), "2026-11-02");
});

test("진행률: (입고+반송+종결)/승인, 넘친 수량은 100%까지", () => {
  assert.equal(progressPct([]), 0);
  assert.equal(progressPct([{ baseQty: 100, rcvQty: 30, returnQty: 10, closeQty: 0 }]), 40);
  assert.equal(progressPct([{ baseQty: 100, rcvQty: 150, returnQty: 0, closeQty: 0 }, { baseQty: 100, rcvQty: 0, returnQty: 0, closeQty: 0 }]), 50);
  assert.equal(progressPct([{ baseQty: 3, rcvQty: 2, returnQty: 0, closeQty: 0 }]), 66);
});

test("승인 건 취소: 승인 상태 + 후행 전표 없음", () => {
  assert.equal(approvedCancelBlock({ status: "APPROVED", activeAsnCount: 0, allocCount: 0 }), null);
  assert.match(approvedCancelBlock({ status: "APPROVED", activeAsnCount: 1, allocCount: 0 })!, /ASN/);
  assert.match(approvedCancelBlock({ status: "APPROVED", activeAsnCount: 0, allocCount: 2 })!, /검수/);
  assert.ok(approvedCancelBlock({ status: "PARTIAL", activeAsnCount: 0, allocCount: 0 }));
  assert.ok(approvedCancelBlock({ status: "CANCELED", activeAsnCount: 0, allocCount: 0 }));
});

test("조회조건 주소: 기본값은 주소에 남기지 않고, 빈 기간은 '-'", () => {
  const today = "2026-11-05";
  const d = defaultInquiry(today);
  assert.equal(d.from, "2026-10-29");
  assert.equal(d.to, "2026-11-12");
  assert.equal(inquirySearch(d, today), "");
  assert.deepEqual(parseInquiryQuery({}, today), d);
  const custom = { ...d, tab: "vehicle" as const, st: "RECEIVED", from: "", to: "2026-11-02", item: "라면" };
  assert.deepEqual(parseInquiryQuery(Object.fromEntries(new URLSearchParams(inquirySearch(custom, today))), today), custom);
  // 탭에 없는 상태는 미종결로
  assert.equal(parseInquiryQuery({ tab: "vehicle", st: "CLOSED" }, today).st, "open");
});
