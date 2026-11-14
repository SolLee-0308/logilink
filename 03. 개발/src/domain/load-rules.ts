/**
 * 상차등록 규칙 — 근거: 정의서 v1.4 ④ · 4-2 · 9장 · C5 · C6 · D10~D13
 * PDA 화면·웹 화면·서버 검사가 이 파일을 같이 본다.
 *
 * 2026-11-05 Sol 결정: 지시수량 초과는 입력할 때 경고·확인만 받고, 사유는 상차완료 때 차이 사유로 한 번만 받는다.
 */
import type { ItemUnit } from "./master";
import { businessDayRange } from "./business-day";
import type { StatusTone } from "./plan-status";

export const LOAD_STATUSES = ["WORKING", "COMPLETED"] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];
export type LoadType = "ORDERED" | "UNORDERED";

export const LOAD_STATUS_META: Record<LoadStatus, { label: string; tone: StatusTone }> = {
  WORKING: { label: "작업중", tone: "part" },
  COMPLETED: { label: "상차완료", tone: "done" },
};
export const LOAD_TYPE_LABEL: Record<LoadType, string> = { ORDERED: "지시 상차", UNORDERED: "무지시 상차" };

/** 상차 실적·상차확인서 번호 LD-YYYYMMDD-NNNN (asn-rules의 nextDocNo로 만든다) */
export const LOAD_PREFIX = "LD";

/** 무지시 상차 차이 사유 기본값 — "예정 외 차량(무지시)" (정의서 ④) */
export const UNORDERED_REASON_CODE = "L04";

/** 상차를 받을 수 있는 ASN — 등록(상차 전)·상차중 */
export const LOADABLE_ASN = ["REGISTERED", "LOADING"] as const;

/** "당일 ASN 품목"(C5·D10)을 셀 때 넣는 ASN — 취소만 뺀다 */
export const TODAY_ASN_COUNTED = ["REGISTERED", "LOADING", "LOADED", "RECEIVED"] as const;

/** 한 번에 입력할 수 있는 수량 상한 (오타 방지) */
export const MAX_ADD_QTY = 99_999;

export function addQtyError(qty: number): string | null {
  if (!Number.isInteger(qty) || qty <= 0) return "수량은 1 이상 정수로 입력하세요.";
  if (qty > MAX_ADD_QTY) return `한 번에 ${MAX_ADD_QTY.toLocaleString()}개까지 입력할 수 있습니다.`;
  return null;
}

/** 품목별 지시·상차 비교 결과 */
export type LineState = "short" | "match" | "over" | "extra";
export const LINE_STATE_LABEL: Record<LineState, string> = { short: "부족", match: "일치", over: "초과", extra: "지시 외" };

export function lineState(orderBase: number, loadBase: number): LineState {
  if (orderBase === 0) return "extra";
  if (loadBase < orderBase) return "short";
  if (loadBase > orderBase) return "over";
  return "match";
}

/**
 * 입력 전 경고 — 지시 외 품목이거나, 이번 입력으로 지시수량을 넘으면 확인을 받는다 (C5: 경고, 차단 아님).
 * 무지시 상차는 모든 품목이 지시 외이므로 경고하지 않는다 (상차완료 때 차이 사유로 받는다).
 */
export function overWarning(p: { ordered: boolean; orderBase: number; loadBase: number; addBase: number }): "extra" | "over" | null {
  if (!p.ordered) return null;
  if (p.orderBase === 0) return "extra";
  if (p.loadBase + p.addBase > p.orderBase) return "over";
  return null;
}

/** ASN 대비 차이가 있는지 — 무지시 상차는 전량이 차이 (C6) */
export function hasLoadDiff(ordered: boolean, lines: { orderBase: number; loadBase: number }[]) {
  if (!ordered) return true;
  return lines.some((l) => l.orderBase !== l.loadBase);
}

/**
 * 기준 단위 수량을 보기 쉬운 단위로 — 예: 기준 EA 125개, BOX = 12EA → "10 BOX 5 EA".
 * factor가 1이거나 단위가 기준 단위면 그대로.
 */
export function qtyInUnit(base: number, unit: ItemUnit, factor: number, baseUnit: ItemUnit): string {
  if (unit === baseUnit || factor <= 1) return `${base.toLocaleString()} ${baseUnit}`;
  const whole = Math.floor(base / factor);
  const rest = base - whole * factor;
  if (!rest) return `${whole.toLocaleString()} ${unit}`;
  if (!whole) return `${rest.toLocaleString()} ${baseUnit}`;
  return `${whole.toLocaleString()} ${unit} ${rest.toLocaleString()} ${baseUnit}`;
}

/** 스캔값 정리 — 앞뒤 공백 제거, 스캐너가 붙이는 줄바꿈 제거 */
export const normalizeScan = (s: string) => s.replace(/[\r\n\t]/g, "").trim();

/** 상차지시서 번호 정리 — 소문자·공백 허용 (lo-20261105-0001 → LO-20261105-0001) */
export const normalizeDocNo = (s: string) => normalizeScan(s).replace(/\s+/g, "").toUpperCase();

export const LOAD_CONFLICT_MSG = "그사이 다른 작업자가 입력했습니다. 최신 합계를 다시 확인한 뒤 상차완료하세요.";
export const LOAD_DONE_MSG = "이미 상차완료된 차량입니다. 더 실어야 하면 출차·입고검수 전에 [상차 재개]를 누르세요(지시 상차만).";

/* ───────── 출차 (2026-11-12 Sol, 정의서 v1.9 수정) ───────── */

/**
 * 출차 — PDA 상차담당이 차량이 실제로 떠날 때 [출차]를 누른다. 출차 후에는 상차 재개 불가(되돌리기 없음).
 * 자동 출차(조회 시 판단)는 폐지(v1.8·v1.9). 누락된 출차는 시스템이 입차 때(입차 처리) 또는
 * 일마감 때(일마감 처리, 전날까지 상차완료분) 저장한다. 화면은 저장된 값만 보여 준다.
 */
export const DEPART_TYPES = ["MANUAL", "ARRIVAL", "DAILY_CLOSE"] as const;
export type DepartType = (typeof DEPART_TYPES)[number];
export const DEPART_TYPE_LABEL: Record<DepartType, string> = {
  MANUAL: "사람",
  ARRIVAL: "입차 처리(시스템)",
  DAILY_CLOSE: "일마감 처리(시스템)",
};

export interface Departure {
  at: string;
  by: string | null;
  type: DepartType;
  /** 시스템 처리(입차·일마감) 여부 */
  system: boolean;
}

export function departureOf(l: { departedAt: Date | null; departedBy: string | null; departType: DepartType | null }): Departure | null {
  if (!l.departedAt) return null;
  const type = l.departType ?? "MANUAL";
  return { at: l.departedAt.toISOString(), by: l.departedBy, type, system: type !== "MANUAL" };
}

/** 출차 표시 문구 — "사람"은 처리자 이름, 시스템 처리는 구분 이름 */
export const departureLabel = (d: Departure) => (d.system ? DEPART_TYPE_LABEL[d.type] : d.by ?? DEPART_TYPE_LABEL.MANUAL);

/**
 * 일마감 처리(시스템) 대상 — 출차·입차 기록이 없고 일마감하는 업무일 "전날까지" 상차완료한 차량 (v1.9 ⑦·D23).
 * 당일 상차분은 빼서 저녁에 싣고 다음 날 아침 떠나는 차량이 출발 전에 출차로 기록되지 않게 한다.
 * 반환값: 상차완료 시각이 이 시각보다 앞서면 대상 (= 마감 업무일의 시작 시각)
 */
export const dailyDepartBefore = (closeBusinessDate: string, businessDayStart: string) => businessDayRange(closeBusinessDate, businessDayStart).gte;

export function isDailyDepartTarget(
  l: { status: string; completedAt: Date | null; departedAt: Date | null; arrivedAt: Date | null },
  closeBusinessDate: string,
  businessDayStart: string,
) {
  return l.status === "COMPLETED" && !!l.completedAt && !l.departedAt && !l.arrivedAt && l.completedAt < dailyDepartBefore(closeBusinessDate, businessDayStart);
}

export const DEPART_CONFIRM_MSG = "출차하면 상차를 다시 열 수 없습니다. 차량 문을 닫고 상차확인서를 기사에게 넘긴 뒤 누르세요.";
