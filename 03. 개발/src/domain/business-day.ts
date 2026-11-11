/**
 * 업무일·영업일 규칙 — 근거: 정의서 v1.4 ⑦ 일마감 · D18 · O3, 2026-11-11 Sol 결정
 *
 * - 업무일: 센터별 '업무일 시작 시각'(기본 06:00)부터 다음 날 그 시각 전까지를 하루로 센다.
 *   새벽 2시에 확정한 검수 실적은 전날 업무일 실적이다. 자정으로 자르면 새벽 입고분이 갈라지기 때문.
 * - 영업일: 그 센터의 정기 휴무 요일과 휴무일(tb_holiday — 공휴일·센터 휴무)을 뺀 날.
 *   토·일을 따로 쉬는 날로 가정하지 않는다 (2026-11-11 Sol: 주말 운영 센터가 있음) — 센터마다 정기 휴무 요일을 고른다(기본 없음).
 * - 기한경과 취소: 승인 전(승인대기·반려) 입고예정만 대상. 입고예정일 + 유예 영업일(기본 1)이 지난
 *   업무일의 일마감 때 취소 대상이 된다. 승인 이후 건은 날짜가 지나도 막거나 닫지 않는다.
 *
 * 대시보드·일마감 화면·서버 검사가 이 파일 하나를 같이 본다.
 */
import { addDays } from "./inquiry-rules";
import type { PlanStatus } from "./plan-status";

export const DEFAULT_BUSINESS_DAY_START = "06:00";
export const DEFAULT_EXPIRE_GRACE_DAYS = 1;
/** 유예 영업일 입력 범위 */
export const EXPIRE_GRACE_MAX = 30;

/** 기한경과 취소 대상이 될 수 있는 상태 — 실물이 움직이지 않은 승인 전 건 */
export const PRE_APPROVAL: readonly PlanStatus[] = ["WAITING", "REJECTED"];

const KST_MS = 9 * 3_600_000;
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** 그 시각이 속한 업무일 (YYYY-MM-DD) */
export function businessDateOf(at: Date, start: string = DEFAULT_BUSINESS_DAY_START): string {
  return new Date(at.getTime() + KST_MS - minutesOf(start) * 60_000).toISOString().slice(0, 10);
}

/** 업무일 하루의 [시작, 끝) — DB 조회 조건 */
export function businessDayRange(ymd: string, start: string = DEFAULT_BUSINESS_DAY_START): { gte: Date; lt: Date } {
  const gte = new Date(Date.parse(`${ymd}T00:00:00Z`) - KST_MS + minutesOf(start) * 60_000);
  return { gte, lt: new Date(gte.getTime() + 86_400_000) };
}

/* ───────── 정기 휴무 요일 ───────── */

/** 요일 번호 — 0 일 · 1 월 · … · 6 토 (JS getDay와 같음). 화면 순서는 월~일 */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_LABEL: Record<number, string> = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };

export const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** 저장 형식으로 정리 — 요일 순서(월~일), 중복 제거 */
export const normalizeWeeklyOff = (days: readonly number[]) => WEEKDAYS.filter((d) => days.includes(d));

/** 정기 휴무 요일 표시 — [6, 0] → "토·일", 없으면 "없음" */
export const weeklyOffLabel = (days: readonly number[]) => (days.length ? normalizeWeeklyOff(days).map((d) => WEEKDAY_LABEL[d]).join("·") : "없음");

/** 0~6만, 7일 모두 쉬면 영업일이 없어 계산이 끝나지 않으므로 막는다 */
export const isValidWeeklyOff = (days: readonly number[]) =>
  days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(days).size < 7;

/* ───────── 영업일 ───────── */

/** 센터의 쉬는 날 — 정기 휴무 요일 + 휴무일 날짜 */
export interface OffDays {
  weekly: readonly number[];
  holidays: ReadonlySet<string>;
}

export const NO_OFF_DAYS: OffDays = { weekly: [], holidays: new Set() };

export const isBusinessDay = (ymd: string, off: OffDays) => !off.weekly.includes(weekdayOf(ymd)) && !off.holidays.has(ymd);

/** n영업일 뒤 (n ≤ 0이면 그대로) */
export function addBusinessDays(ymd: string, n: number, off: OffDays): string {
  let d = ymd;
  // 잘못된 설정(모든 요일 휴무 등)으로 끝없이 돌지 않게 10년에서 멈춘다
  for (let left = n, guard = 0; left > 0 && guard < 3700; guard++) {
    d = addDays(d, 1);
    if (isBusinessDay(d, off)) left--;
  }
  return d;
}

/** 기한경과 취소 예정일 — 이 업무일(또는 그 뒤) 일마감 때 취소 대상 */
export const expireDueDate = (planDate: string, graceDays: number, off: OffDays) => addBusinessDays(planDate, Math.max(graceDays, 0), off);

/** 오늘(업무일) 일마감 때 기한경과 취소 대상인가 */
export function isExpireTarget(status: PlanStatus, planDate: string, today: string, graceDays: number, off: OffDays) {
  return PRE_APPROVAL.includes(status) && expireDueDate(planDate, graceDays, off) <= today;
}

/**
 * 오늘 기준으로 취소 대상이 되는 가장 늦은 입고예정일 — DB 조회 조건(planDate ≤ 이 날짜)으로 쓴다.
 * 예정일 d의 취소 예정일은 d가 늦을수록 늦어지므로(단조 증가), 하루씩 거슬러 올라가며 찾는다.
 */
export function expireCutoff(today: string, graceDays: number, off: OffDays): string {
  let d = today;
  for (let i = 0; i < 400 && expireDueDate(d, graceDays, off) > today; i++) d = addDays(d, -1);
  return d;
}

export const isValidGraceDays = (n: number) => Number.isInteger(n) && n >= 0 && n <= EXPIRE_GRACE_MAX;
