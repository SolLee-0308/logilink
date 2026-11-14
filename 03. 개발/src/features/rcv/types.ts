import type { Departure } from "@/domain/load-rules";
import type { ItemUnit } from "@/domain/master";
import type { LoadType } from "@/domain/load-rules";
import type { RcvAllocKind, RcvKind, RcvLineState, RcvStatus } from "@/domain/rcv-rules";

/** 검수 품목 라인 (기준 단위). 보여 줄 때는 showUnit으로 묶어 표시한다 */
export interface RcvLineView {
  itemId: number;
  itemCode: string;
  itemName: string;
  baseUnit: ItemUnit;
  showUnit: ItemUnit;
  showFactor: number;
  expect: number;
  good: number;
  damaged: number;
  mismatchQty: number;
  mismatch: boolean;
  zeroConfirm: boolean;
  hasInputs: boolean;
  state: RcvLineState;
  diff: number;
  needsReason: boolean;
  reasonCode: string | null;
  reasonName: string | null;
  reasonText: string | null;
  /** 관리 품목 — 입고예정 값과 다르면 현장 입력 */
  expiryManaged: boolean;
  lotManaged: boolean;
  expiryDate: string | null;
  lotNo: string | null;
  /** 입고예정에 적힌 값 (ASN 라인이 가리키는 입고예정 라인) */
  planExpiry: string | null;
  planLot: string | null;
  imageIds: number[];
  /** 이 품목을 입력한 검수자 이름 */
  workers: string[];
}

export interface RcvInputView {
  id: number;
  itemId: number;
  itemName: string;
  kind: RcvKind;
  unit: ItemUnit;
  addQty: number;
  /** 기준 단위 수량 — 품목별·검수자별 합계용 (2026-11-12) */
  baseQty: number;
  workerName: string;
  inputAt: string;
  canceled: boolean;
  corrected: boolean;
  mine: boolean;
}

export interface RcvWorker {
  workerId: number;
  name: string;
  count: number;
  lastAt: string;
}

/** 확정 뒤 배분 결과 한 줄 */
export interface RcvAllocView {
  itemName: string;
  kind: RcvAllocKind;
  step: number;
  planNo: string | null;
  planId: number | null;
  qty: string;
}

export interface RcvView {
  id: number;
  rcvNo: string;
  status: RcvStatus;
  /** 검수 시작 = 첫 입력 시각 (v1.9 D26). 없으면 도착·검수 대기 */
  startedAt: string | null;
  /** 입차 (v1.9 D25) — 시각·처리자 */
  arrivedAt: string | null;
  arrivedBy: string | null;
  /** 출차 — 저장된 값 (사람·입차 처리(시스템)·일마감 처리(시스템)) */
  departure: Departure | null;
  /** 입차 취소한 전표 */
  voided: { at: string; by: string; reasonName: string; reasonText: string | null } | null;
  /** 입차 취소할 수 있는지 — 첫 입력 전(취소한 입력·0 확인 포함 기록 없음) */
  canVoid: boolean;
  clientName: string;
  centerName: string;
  vehicleNo: string;
  load: { id: number; loadNo: string; type: LoadType; completedAt: string | null; asnNo: string | null; orderNo: string | null; driverName: string | null };
  lines: RcvLineView[];
  inputs: RcvInputView[];
  workers: RcvWorker[];
  lastInputId: number;
  createdAt: string;
  createdBy: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  allocs: RcvAllocView[];
}

/** 스캔한 품목 미리 보기 */
export interface RcvScanPreview {
  scan: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  factor: number;
  baseUnit: ItemUnit;
  showUnit: ItemUnit;
  showFactor: number;
  expect: number;
  good: number;
  damaged: number;
  /** 상차 실적에 없는 품목 → 품목 불일치 반송만 */
  mismatch: boolean;
}

/** PDA 검수 첫 화면 행 */
export interface PdaRcvRow {
  /** 입차 전(또는 입고취소 뒤 재검수 전)이면 null */
  rcvId: number | null;
  /** 입차 시각 — 입차 전이면 null */
  arrivedAt: string | null;
  /** 검수 시작(첫 입력) 시각 — 도착·검수 대기면 null */
  startedAt: string | null;
  /** 입차 전 차량의 출차 — 없으면 출차 대기 */
  departure: Departure | null;
  rcvNo: string | null;
  loadId: number;
  loadNo: string;
  loadType: LoadType;
  vehicleNo: string;
  clientName: string;
  centerName: string;
  orderNo: string | null;
  lineCount: number;
  loadCompletedAt: string | null;
  inputCount: number;
  workerCount: number;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** 확정 건: 차이·반송이 있는 라인 수 */
  issueCount: number;
}

/** 입고검수 목록 거르기 (2026-11-12 Sol: 검수 내역 메뉴를 입고검수에 합침) */
export type PdaRcvFilter = "all" | "todo" | "working" | "done";

export interface PdaRcvHome {
  today: string;
  /** 조회 날짜 — 오늘 이하. 확정만 이 날짜(확정 시각 KST)로 거르고, 대기·검수 중은 날짜와 상관없이 모두 */
  date: string;
  /** 입차 전 — 이 센터로 오는 상차완료 차량 (출차 대기·운송 중) */
  waiting: PdaRcvRow[];
  /** 도착·검수 대기 — 입차했고 첫 입력 전 (입고취소 뒤 재검수 전 차량 포함) */
  arrived: PdaRcvRow[];
  /** 검수 중 — 첫 입력 이후 */
  working: PdaRcvRow[];
  /** 조회 날짜에 검수 확정한 차량, 최근이 앞 */
  done: PdaRcvRow[];
}

export interface PdaRcvHistory {
  date: string;
  today: string;
  rows: PdaRcvRow[];
}

export interface PdaRcvDashboard {
  today: string;
  waiting: number;
  arrived: number;
  working: number;
  done: number;
  issueDone: number;
  myInputs: number;
  recent: PdaRcvRow[];
}

/** 입고검수 첫 화면 — 일부만 입력했거나 정확히 일치하는 차량이 여럿일 때 고르는 후보 (v1.9) */
export interface RcvCandidate {
  loadId: number;
  loadNo: string;
  orderNo: string | null;
  vehicleNo: string;
  clientName: string;
  centerName: string;
  completedAt: string | null;
  /** 이미 입차한 차량 — 고르면 새 입차 없이 검수 화면으로 */
  arrived: boolean;
}
