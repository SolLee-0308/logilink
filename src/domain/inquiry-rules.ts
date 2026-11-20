/**
 * 입고예정 조회 규칙 — 근거: 정의서 v1.4 ⑤ · 4-1 · C3 · D5 · O2
 * 화면 표시(조회 범위·경과 강조·버튼 노출)와 서버 검사(승인 건 취소)가 이 파일 하나를 같이 본다.
 */
import type { AsnStatus } from "./asn-rules";
import type { PlanStatus } from "./plan-status";

/** 조회 대상 — 승인 기준 (승인 전 건은 승인 대기·입고예정 등록 화면에서 본다) */
export const INQUIRY_PLAN: readonly PlanStatus[] = ["APPROVED", "PARTIAL", "COMPLETED", "CLOSED", "CANCELED"];

/** 미종결 — 잔량이 남아 아직 닫히지 않은 입고예정 (승인·부분입고) */
export const OPEN_PLAN: readonly PlanStatus[] = ["APPROVED", "PARTIAL"];

/** 차량별 탭 미종결 — 아직 입고(검수 확정)되지 않은 ASN */
export const OPEN_ASN: readonly AsnStatus[] = ["REGISTERED", "LOADING", "LOADED"];

/** 품목별 탭 상태 조건 — open: 미종결(기본) / all: 전체 / 그 외: 상태 하나 */
export const PLAN_STATE_FILTERS = ["open", "all", "APPROVED", "PARTIAL", "COMPLETED", "CLOSED", "CANCELED"] as const;
export type PlanStateFilter = (typeof PLAN_STATE_FILTERS)[number];

/** 차량별 탭 상태 조건 — open: 미입고(기본) / all: 전체(취소 제외) / 그 외: ASN 상태 하나 */
export const ASN_STATE_FILTERS = ["open", "all", "REGISTERED", "LOADING", "LOADED", "RECEIVED"] as const;
export type AsnStateFilter = (typeof ASN_STATE_FILTERS)[number];

export function planStatusesOf(f: string): PlanStatus[] {
  if (f === "all") return [...INQUIRY_PLAN];
  if ((INQUIRY_PLAN as readonly string[]).includes(f)) return [f as PlanStatus];
  return [...OPEN_PLAN];
}

export function asnStatusesOf(f: string): AsnStatus[] {
  if (f === "all") return ["REGISTERED", "LOADING", "LOADED", "RECEIVED"];
  if ((["REGISTERED", "LOADING", "LOADED", "RECEIVED"] as readonly string[]).includes(f)) return [f as AsnStatus];
  return [...OPEN_ASN];
}

/** 조회 기본 기간 — 오늘 기준 앞뒤 7일 */
export const DEFAULT_RANGE_DAYS = 7;

/** 경과 강조 기준 설정 키 (정의서 미결 O2, 운영 설정에서 바꾼다) */
export const ALERT_DAYS_KEY = "UNCLOSED_ALERT_DAYS";
export const DEFAULT_ALERT_DAYS = 3;

/** YYYY-MM-DD에 n일 더하기 */
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** 두 날짜 사이 일수 (to − from) */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * 경과일 — 미종결 건만, 입고예정일 다음 날부터 센다 (예정일 당일·이전이면 0).
 * 기준: 운영 설정 '미종결 알림 기준 경과일'의 설명대로 입고예정일 기준 (U46)
 */
export function elapsedDays(status: PlanStatus, planDate: string, today: string) {
  if (!OPEN_PLAN.includes(status)) return 0;
  return Math.max(daysBetween(planDate, today), 0);
}

/** 경과 기준 초과 — 경과일이 기준일 이상이면 강조 */
export const isOverdue = (elapsed: number, alertDays: number) => elapsed > 0 && elapsed >= alertDays;

/** 기준 초과가 되는 마지막 입고예정일 — 이 날짜 이전(포함) 미종결 건이 기준 초과 */
export const overdueCutoff = (today: string, alertDays: number) => addDays(today, -Math.max(alertDays, 1));

/**
 * 진행률(%) — (입고 + 반송 + 종결) ÷ 승인 수량, 기준 단위 합계.
 * 반송·종결도 "처리가 끝난 수량"으로 본다 (잔량 = 승인 − 입고 − 반송 − 종결, 5-1)
 */
export function progressPct(lines: { baseQty: number; rcvQty: number; returnQty: number; closeQty: number }[]) {
  const total = lines.reduce((s, l) => s + l.baseQty, 0);
  if (!total) return 0;
  const done = lines.reduce((s, l) => s + Math.min(l.rcvQty + l.returnQty + l.closeQty, l.baseQty), 0);
  return Math.floor((done / total) * 100);
}

/** 승인 건 취소 가능한 상태 — 승인만 (부분입고 이후는 검수 실적이 있으므로 불가, C3) */
export const APPROVED_CANCELABLE: readonly PlanStatus[] = ["APPROVED"];

/**
 * 승인 건 취소 가능 여부 — 3PL만, 승인 상태, 후행 전표(취소되지 않은 ASN·검수 배분)가 없을 때 (C3·D5·C10).
 * 취소된 ASN은 후행 전표로 보지 않는다 (U46).
 * 불가하면 이유 문장, 가능하면 null
 */
export function approvedCancelBlock(p: { status: PlanStatus; activeAsnCount: number; allocCount: number }): string | null {
  if (!APPROVED_CANCELABLE.includes(p.status)) return "승인 상태인 입고예정만 취소할 수 있습니다.";
  if (p.activeAsnCount > 0) return `ASN ${p.activeAsnCount}건에 분배되어 있어 취소할 수 없습니다. 화주사가 ASN을 먼저 취소해야 합니다.`;
  if (p.allocCount > 0) return "입고검수 실적이 배분되어 있어 취소할 수 없습니다.";
  return null;
}

/* ───────── 입고 대기 단계 (정의서 v1.9 ⑤ · 5-3 · D27) ───────── */

/**
 * 입고 대기 — ASN에 배정됐지만 아직 검수 확정되지 않은 수량("오는 중"에서 이름을 바꿈).
 * 우리 ASN은 상차 전에 등록되므로 "ASN 있음 = 운송 중"이 아니다. 차량(ASN)별 단계를 저장값으로 판단한다.
 */
export const WAIT_STAGES = ["BEFORE_LOAD", "LOADING", "DEPART_WAIT", "IN_TRANSIT", "ARRIVED", "INSPECTING"] as const;
export type WaitStage = (typeof WAIT_STAGES)[number];
export const WAIT_STAGE_LABEL: Record<WaitStage, string> = {
  BEFORE_LOAD: "상차 전",
  LOADING: "상차중",
  DEPART_WAIT: "출차 대기",
  IN_TRANSIT: "운송 중",
  ARRIVED: "도착·검수 대기",
  INSPECTING: "검수중",
};

/**
 * ASN 한 대의 입고 대기 단계 — 입고완료·취소면 null
 * load: 그 ASN의 상차 실적, rcv: 진행 중 검수 전표(검수중, 입차 취소·입고취소 제외)
 */
export function waitStageOf(p: {
  asnStatus: AsnStatus | "CANCELED";
  load: { status: string; departedAt: Date | string | null; arrivedAt: Date | string | null } | null;
  rcv: { startedAt: Date | string | null } | null;
}): WaitStage | null {
  if (p.asnStatus === "RECEIVED" || p.asnStatus === "CANCELED") return null;
  if (p.asnStatus === "REGISTERED" || !p.load) return "BEFORE_LOAD";
  if (p.asnStatus === "LOADING" || p.load.status !== "COMPLETED") return "LOADING";
  if (p.rcv) return p.rcv.startedAt ? "INSPECTING" : "ARRIVED";
  if (p.load.arrivedAt) return "ARRIVED"; // 입고취소 뒤 재검수 전 — 차량은 센터에 있다
  return p.load.departedAt ? "IN_TRANSIT" : "DEPART_WAIT";
}

/** 단계별 대수 요약 — "운송 중 1대 · 상차 전 1대" (진행 순서 역순: 센터에 가까운 단계가 앞) */
export function waitStageSummary(stages: (WaitStage | null)[]): string {
  const n = new Map<WaitStage, number>();
  for (const s of stages) if (s) n.set(s, (n.get(s) ?? 0) + 1);
  return [...WAIT_STAGES].reverse().filter((s) => n.has(s)).map((s) => `${WAIT_STAGE_LABEL[s]} ${n.get(s)}대`).join(" · ");
}
