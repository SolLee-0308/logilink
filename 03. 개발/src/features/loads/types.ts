import type { ItemUnit } from "@/domain/master";
import type { AsnStatus } from "@/domain/asn-rules";
import type { LineState, LoadStatus, LoadType } from "@/domain/load-rules";
import type { CenterOption } from "@/features/plans/types";

/** 품목별 지시·상차 합계 (기준 단위). 보여 줄 때는 showUnit으로 묶어 표시한다 */
export interface LoadLineView {
  itemId: number;
  itemCode: string;
  itemName: string;
  baseUnit: ItemUnit;
  /** 보여 줄 단위 — ASN 지시 단위, 없으면 처음 스캔한 단위 */
  showUnit: ItemUnit;
  showFactor: number;
  orderBase: number;
  loadBase: number;
  state: LineState;
}

/** 상차 입력 행 — 입력 1건 = 추가로 실은 수량 */
export interface LoadInputView {
  id: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  addQty: number;
  baseQty: number;
  workerId: number;
  workerName: string;
  deviceId: string | null;
  inputAt: string;
  canceled: boolean;
  /** 정정으로 새로 넣은 행 */
  corrected: boolean;
  /** 내가 넣은 행 (PDA에서 취소·정정 가능) */
  mine: boolean;
}

export interface LoadWorker {
  workerId: number;
  name: string;
  /** 취소되지 않은 입력 건수 */
  count: number;
  lastAt: string;
}

export interface LoadView {
  id: number;
  loadNo: string;
  type: LoadType;
  status: LoadStatus;
  version: number;
  clientName: string;
  centerId: number;
  centerName: string;
  vehicleNo: string;
  /** 상차일 YYYY-MM-DD */
  loadDate: string;
  asn: { id: number; asnNo: string; status: AsnStatus; shipDate: string; orderNo: string | null; driverName: string | null; driverTel: string | null } | null;
  lines: LoadLineView[];
  /** 최근 입력이 앞 */
  inputs: LoadInputView[];
  workers: LoadWorker[];
  /** 지금까지 들어온 마지막 입력 id — 상차완료 때 그사이 다른 입력이 있었는지 확인한다 */
  lastInputId: number;
  hasDiff: boolean;
  createdAt: string;
  createdBy: string;
  completedAt: string | null;
  completedBy: string | null;
  diffReasonName: string | null;
  diffReasonText: string | null;
}

/** 상차확인서 인쇄 — 발송인(화주사 법인)·수신(센터) */
export interface LoadConfirmPrint extends LoadView {
  sender: { name: string; bizNo: string; ceoName: string; address: string; tel: string | null; contact: string };
  receiver: { name: string; address: string; tel: string };
}

/** PDA 첫 화면 — 오늘 상차할 지시서, 작업 중인 차량 */
export interface PdaOrderRow {
  orderNo: string;
  asnId: number;
  asnNo: string;
  asnStatus: AsnStatus;
  vehicleNo: string;
  driverName: string | null;
  shipDate: string;
  centerName: string;
  lineCount: number;
  loadId: number | null;
}

export interface PdaWorkingRow {
  loadId: number;
  loadNo: string;
  type: LoadType;
  vehicleNo: string;
  centerName: string;
  orderNo: string | null;
  inputCount: number;
  workerCount: number;
  /** 상차완료한 차량만 */
  completedAt: string | null;
  completedBy: string | null;
  diffReasonName: string | null;
}

/** PDA 상차내역 — 날짜별 상차완료 차량 (2026-11-05 PDA 메뉴 확정) */
export interface PdaHistory {
  date: string;
  today: string;
  rows: PdaWorkingRow[];
}

/** PDA 대시보드(상차담당) — 오늘 상차 현황 (임시안 U41) */
export interface PdaLoadDashboard {
  today: string;
  todo: number;
  working: number;
  done: number;
  unorderedDone: number;
  diffDone: number;
  myInputs: number;
  recent: PdaWorkingRow[];
}

export interface PdaHome {
  today: string;
  orders: PdaOrderRow[];
  working: PdaWorkingRow[];
  /** 오늘 상차완료한 차량 */
  done: PdaWorkingRow[];
  centers: CenterOption[];
  defaultCenterId: string;
}

/** 스캔한 품목 미리 보기 — 수량 입력 전에 품목·단위·지금 합계를 보여 준다 */
export interface ScanPreview {
  scan: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  factor: number;
  baseUnit: ItemUnit;
  showUnit: ItemUnit;
  showFactor: number;
  orderBase: number;
  loadBase: number;
  /** 바코드로 찾았는지, 품목코드로 찾았는지 */
  by: "barcode" | "code";
}
