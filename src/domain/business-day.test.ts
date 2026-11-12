import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_OFF_DAYS,
  addBusinessDays,
  businessDateOf,
  businessDayRange,
  expireCutoff,
  expireDueDate,
  isExpireTarget,
  isValidWeeklyOff,
  normalizeWeeklyOff,
  weeklyOffLabel,
  type OffDays,
} from "./business-day";

const NONE = NO_OFF_DAYS;
const off = (weekly: number[], holidays: string[] = []): OffDays => ({ weekly, holidays: new Set(holidays) });
const SAT_SUN = off([6, 0]);

test("업무일: 06:00 시작이면 새벽 2시 검수는 전날 업무일", () => {
  assert.equal(businessDateOf(new Date("2026-11-12T02:00:00+09:00"), "06:00"), "2026-11-11");
  assert.equal(businessDateOf(new Date("2026-11-12T05:59:00+09:00"), "06:00"), "2026-11-11");
  assert.equal(businessDateOf(new Date("2026-11-12T06:00:00+09:00"), "06:00"), "2026-11-12");
  assert.equal(businessDateOf(new Date("2026-11-11T23:30:00+09:00"), "06:00"), "2026-11-11");
});

test("업무일: 00:00 시작이면 달력 날짜와 같다", () => {
  assert.equal(businessDateOf(new Date("2026-11-12T00:10:00+09:00"), "00:00"), "2026-11-12");
  assert.equal(businessDateOf(new Date("2026-11-11T23:59:00+09:00"), "00:00"), "2026-11-11");
});

test("업무일 범위: 11-11 06:00 ~ 11-12 06:00 (KST)", () => {
  const r = businessDayRange("2026-11-11", "06:00");
  assert.equal(r.gte.toISOString(), new Date("2026-11-11T06:00:00+09:00").toISOString());
  assert.equal(r.lt.toISOString(), new Date("2026-11-12T06:00:00+09:00").toISOString());
});

test("영업일: 정기 휴무가 없으면 토·일도 영업일 (주말을 쉬는 날로 가정하지 않음)", () => {
  // 2026-11-13 금 → 1영업일 뒤 = 11-14 토
  assert.equal(addBusinessDays("2026-11-13", 1, NONE), "2026-11-14");
  assert.equal(addBusinessDays("2026-11-11", 0, NONE), "2026-11-11");
});

test("영업일: 정기 휴무 요일과 휴무일을 함께 건너뛴다", () => {
  assert.equal(addBusinessDays("2026-11-13", 1, SAT_SUN), "2026-11-16");
  // 일요일만 쉬는 센터 → 토요일은 영업일
  assert.equal(addBusinessDays("2026-11-13", 1, off([0])), "2026-11-14");
  assert.equal(addBusinessDays("2026-11-14", 1, off([0])), "2026-11-16");
  // 토·일 휴무 + 월요일 공휴일 → 화요일
  assert.equal(addBusinessDays("2026-11-13", 1, off([6, 0], ["2026-11-16"])), "2026-11-17");
});

test("기한경과: 유예 1영업일 — 11-11(수) 예정은 11-12 마감 때 대상", () => {
  assert.equal(expireDueDate("2026-11-11", 1, NONE), "2026-11-12");
  assert.equal(isExpireTarget("WAITING", "2026-11-11", "2026-11-11", 1, NONE), false);
  assert.equal(isExpireTarget("WAITING", "2026-11-11", "2026-11-12", 1, NONE), true);
  assert.equal(isExpireTarget("REJECTED", "2026-11-10", "2026-11-12", 1, NONE), true);
});

test("기한경과: 승인 이후 건은 날짜가 지나도 대상이 아니다", () => {
  for (const s of ["APPROVED", "PARTIAL", "COMPLETED", "CLOSED", "CANCELED"] as const) {
    assert.equal(isExpireTarget(s, "2026-11-01", "2026-11-12", 1, NONE), false);
  }
});

test("기한경과: 금요일 예정 — 정기 휴무 없으면 토요일, 토·일 휴무면 월요일 마감 때 대상", () => {
  assert.equal(isExpireTarget("WAITING", "2026-11-13", "2026-11-14", 1, NONE), true);
  assert.equal(isExpireTarget("WAITING", "2026-11-13", "2026-11-14", 1, SAT_SUN), false);
  assert.equal(isExpireTarget("WAITING", "2026-11-13", "2026-11-16", 1, SAT_SUN), true);
});

test("기한경과 기준일: 오늘 대상이 되는 가장 늦은 입고예정일", () => {
  assert.equal(expireCutoff("2026-11-12", 1, NONE), "2026-11-11");
  assert.equal(expireCutoff("2026-11-16", 1, NONE), "2026-11-15");
  // 토·일 휴무 센터의 월요일 마감: 금·토·일 예정 건이 모두 대상
  assert.equal(expireCutoff("2026-11-16", 1, SAT_SUN), "2026-11-15");
  assert.equal(expireCutoff("2026-11-12", 0, NONE), "2026-11-12");
});

test("정기 휴무 요일: 표시·정리·검사", () => {
  assert.equal(weeklyOffLabel([0, 6]), "토·일");
  assert.equal(weeklyOffLabel([]), "없음");
  assert.deepEqual(normalizeWeeklyOff([0, 6, 6, 1]), [1, 6, 0]);
  assert.equal(isValidWeeklyOff([6, 0]), true);
  assert.equal(isValidWeeklyOff([0, 1, 2, 3, 4, 5, 6]), false);
  assert.equal(isValidWeeklyOff([7]), false);
});
