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
  /** 검수 대기면 null */
  rcvId: number | null;
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

export interface PdaRcvHome {
  today: string;
  waiting: PdaRcvRow[];
  working: PdaRcvRow[];
  doneCount: number;
}

export interface PdaRcvHistory {
  date: string;
  today: string;
  rows: PdaRcvRow[];
}

export interface PdaRcvDashboard {
  today: string;
  waiting: number;
  working: number;
  done: number;
  issueDone: number;
  myInputs: number;
  recent: PdaRcvRow[];
}

/** 차량번호로 찾았는데 검수할 차량이 여럿일 때 */
export interface RcvCandidate {
  loadId: number;
  loadNo: string;
  clientName: string;
  centerName: string;
  completedAt: string | null;
}
