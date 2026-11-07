/**
 * 입고예정 상태 전이 규칙 — 근거: 정의서 v1.4 4-1 · 6장 C1~C3
 * 화면 버튼 노출과 서버 검사가 이 파일 하나를 같이 본다. 상태값이 바뀌면 여기만 고친다.
 */
import type { PlanStatus } from "./plan-status";

/** 화주사가 수정·취소할 수 있는 상태 — 승인 전(승인대기·반려)만 (C1) */
export const SHIPPER_EDITABLE: readonly PlanStatus[] = ["WAITING", "REJECTED"];

/** 3PL이 승인·반려할 수 있는 상태 (C2) */
export const REVIEWABLE: readonly PlanStatus[] = ["WAITING"];

/** 미종결 — 화주사 사용 안 함·이용 센터 제외를 막는 입고예정 상태 */
export const UNCLOSED_PLAN: readonly PlanStatus[] = ["WAITING", "REJECTED", "APPROVED", "PARTIAL"];

export const canShipperEdit = (s: PlanStatus) => SHIPPER_EDITABLE.includes(s);
export const canReview = (s: PlanStatus) => REVIEWABLE.includes(s);

/** 처리 시점 version 불일치 안내 (C2, 정의서 ② 문구) */
export const CONFLICT_MSG = "화주사가 수정한 건입니다. 변경 내용을 확인 후 다시 처리하세요.";

/** 저장 시점 version 불일치 (화주사가 수정 중에 다른 사람이 먼저 저장·처리) */
export const SAVE_CONFLICT_MSG = "다른 사용자가 먼저 저장했거나 3PL이 처리한 건입니다. 최신 내용을 확인한 뒤 다시 저장하세요.";

/** 입고예정번호 IP-YYYYMMDD-NNNN */
export const planNoPrefix = (ymd: string) => `IP-${ymd.replaceAll("-", "")}-`;
export function nextPlanNo(ymd: string, used: string[]) {
  const prefix = planNoPrefix(ymd);
  const max = used.filter((n) => n.startsWith(prefix)).reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** 입고예정일 기준 D-day 표시 — 날짜 문자열(YYYY-MM-DD)끼리 비교 */
export function dday(planDate: string, today: string) {
  const ms = Date.parse(`${planDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
export const ddayLabel = (n: number) => (n < 0 ? `D+${-n}` : n === 0 ? "오늘" : `D-${n}`);

/** 반려본 대비 라인 비교 키 — 같은 품목·단위면 같은 라인으로 본다 */
export const lineKey = (l: { itemId: number; unit: string }) => `${l.itemId}:${l.unit}`;

export type LineDiff = { kind: "same" } | { kind: "changed"; prev: number } | { kind: "new" };

/** 현재 라인들을 직전 라인들과 비교 + 빠진 라인 목록 */
export function diffLines<C extends { itemId: number; unit: string; qty: number }, P extends { itemId: number; unit: string; qty: number }>(
  current: C[],
  previous: P[],
): { diffs: LineDiff[]; removed: P[] } {
  const prev = new Map(previous.map((p) => [lineKey(p), p]));
  const diffs = current.map((c): LineDiff => {
    const p = prev.get(lineKey(c));
    if (!p) return { kind: "new" };
    return p.qty === c.qty ? { kind: "same" } : { kind: "changed", prev: p.qty };
  });
  const keys = new Set(current.map(lineKey));
  return { diffs, removed: previous.filter((p) => !keys.has(lineKey(p))) };
}
