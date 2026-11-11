/**
 * ASN 상태·규칙 — 근거: 정의서 v1.4 ③ · 4-2 · C4 · C10 · D7~D9
 * 화면 버튼 노출과 서버 검사가 이 파일 하나를 같이 본다.
 */
import type { PlanStatus } from "./plan-status";
import type { StatusTone } from "./plan-status";

export const ASN_STATUSES = ["REGISTERED", "LOADING", "LOADED", "RECEIVED", "CANCELED"] as const;
export type AsnStatus = (typeof ASN_STATUSES)[number];

export const ASN_STATUS_META: Record<AsnStatus, { label: string; tone: StatusTone }> = {
  REGISTERED: { label: "등록", tone: "ok" },
  LOADING: { label: "상차중", tone: "part" },
  LOADED: { label: "상차완료", tone: "done" },
  RECEIVED: { label: "입고완료", tone: "done" },
  CANCELED: { label: "취소", tone: "cancel" },
};

export const ASN_ACTION_LABEL = { CREATE: "등록 · 상차지시서 발행", CANCEL: "취소", LOAD_START: "상차 시작", LOAD_COMPLETE: "상차완료 · 상차확인서 발행", RECEIVE: "입고검수 확정 · 입고완료", LOAD_REOPEN: "상차 재개" } as const;
export type AsnAction = keyof typeof ASN_ACTION_LABEL;

/** ASN에 담을 수 있는 입고예정 — 승인·미종결(승인·부분입고) (D8) */
export const DISTRIBUTABLE_PLAN: readonly PlanStatus[] = ["APPROVED", "PARTIAL"];

/** 화주사가 취소할 수 있는 ASN — 상차 시작 전(등록)만 (4-2) */
export const ASN_CANCELABLE: readonly AsnStatus[] = ["REGISTERED"];

/** 미종결 ASN — 화주사 사용 안 함·이용 센터 제외를 막는다 (등록·상차중) */
export const UNCLOSED_ASN: readonly AsnStatus[] = ["REGISTERED", "LOADING"];

/** 분배 수량에 들어가는 ASN — 취소만 뺀다 (검수 배분 2단계의 "ASN으로 분배된 라인" 기준) */
export const ASN_COUNTED: readonly AsnStatus[] = ["REGISTERED", "LOADING", "LOADED", "RECEIVED"];

/** 아직 입고되지 않은 ASN — 남은 분배 수량을 셀 때 지시수량으로 센다 (입고완료 ASN은 실제 입고·반송 누계로 센다) */
export const ASN_OPEN: readonly AsnStatus[] = ["REGISTERED", "LOADING", "LOADED"];

export const canCancelAsn = (s: AsnStatus) => ASN_CANCELABLE.includes(s);

export const ASN_CONFLICT_MSG = "다른 사용자가 먼저 처리한 ASN입니다. 최신 내용을 확인한 뒤 다시 처리하세요.";
export const DISTRIBUTE_CONFLICT_MSG = "그사이 다른 ASN에 분배되어 남은 수량이 바뀌었습니다. 남은 수량을 다시 불러와 확인하세요.";

/** 전표 번호 PREFIX-YYYYMMDD-NNNN — 같은 날 쓴 번호 중 가장 큰 번호 + 1 */
export const docNoPrefix = (prefix: string, ymd: string) => `${prefix}-${ymd.replaceAll("-", "")}-`;
export function nextDocNo(prefix: string, ymd: string, used: string[]) {
  const p = docNoPrefix(prefix, ymd);
  const max = used.filter((n) => n.startsWith(p)).reduce((m, n) => Math.max(m, Number(n.slice(p.length)) || 0), 0);
  return `${p}${String(max + 1).padStart(4, "0")}`;
}
export const ASN_PREFIX = "ASN";
export const LOAD_ORDER_PREFIX = "LO";

/** 차량번호 — 공백을 빼고 영문은 대문자로 (PDA 무지시 상차·검수에서 같은 값으로 찾는다) */
export const normalizeVehicleNo = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** 보통 번호판 모양(12가3456 · 123가4567 · 서울12가3456)인지 — 아니면 저장은 하되 한 번 더 확인하게 안내 */
export const looksLikeVehicleNo = (s: string) => /^([가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(normalizeVehicleNo(s));

/**
 * 입고예정 라인의 분배 잔량 (기준 단위) — C4: 라인별 분배 합계 ≤ 승인 잔량
 * = 승인 수량 − 종결 수량 − 입고 누계 − 반송 누계 − 아직 입고되지 않은 ASN에 담은 수량
 * 입고완료 ASN은 지시수량 대신 검수 확정으로 실제 배분된 입고·반송 누계로 센다 (2026-11-05 입고검수).
 * 그래서 덜 들어온 수량(부족분)은 다시 다른 차량에 담을 수 있다 (5-1: 부족분은 잔량에 남는다).
 */
export function remainingBase(line: { baseQty: number; closeQty: number; rcvQty?: number; returnQty?: number }, openDistributedBase: number) {
  return Math.max(line.baseQty - line.closeQty - (line.rcvQty ?? 0) - (line.returnQty ?? 0) - openDistributedBase, 0);
}

/** 기준 단위 잔량 → 입고예정 라인 단위 수량 (나누어떨어지지 않는 낱개는 버린다) */
export const toLineUnitQty = (base: number, factor: number) => Math.floor(base / Math.max(factor, 1));

/** 분배 입력 한 줄 검사 — 오류 문장 또는 null */
export function distributeError(qty: number, remainingQty: number): string | null {
  if (!Number.isInteger(qty) || qty <= 0) return "수량은 1 이상 정수로 입력하세요.";
  if (qty > remainingQty) return `남은 수량(${remainingQty.toLocaleString()})보다 많이 담을 수 없습니다.`;
  return null;
}
