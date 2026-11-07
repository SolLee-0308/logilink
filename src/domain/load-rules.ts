/**
 * 상차등록 규칙 — 근거: 정의서 v1.4 ④ · 4-2 · 9장 · C5 · C6 · D10~D13
 * PDA 화면·웹 화면·서버 검사가 이 파일을 같이 본다.
 *
 * 2026-11-05 Sol 결정: 지시수량 초과는 입력할 때 경고·확인만 받고, 사유는 상차완료 때 차이 사유로 한 번만 받는다.
 */
import type { ItemUnit } from "./master";
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
export const LOAD_DONE_MSG = "이미 상차완료된 차량입니다. 상차완료 뒤에는 입력할 수 없습니다. 차이는 입고검수에서 처리합니다.";
