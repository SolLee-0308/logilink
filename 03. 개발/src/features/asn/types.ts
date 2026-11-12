import type { RcvView } from "@/features/rcv/types";
import type { ItemUnit } from "@/domain/master";
import type { AsnAction, AsnStatus } from "@/domain/asn-rules";
import type { PlanStatus } from "@/domain/plan-status";
import type { CenterOption } from "@/features/plans/types";
import type { LoadView } from "@/features/loads/types";
import type { Departure } from "@/domain/load-rules";

/** ASN 목록 탭 — 상차 대기(등록) / 상차 진행(상차중·상차완료) / 최근 입고완료 / 최근 취소 */
export type AsnTab = "wait" | "loading" | "done" | "canceled";

/** 3PL ASN·상차 현황 탭 — 상차 대기 / 상차중 / 검수 대기(상차완료) / 최근 입고완료 / 최근 취소 */
export type AsnStatusTab = "wait" | "loading" | "loaded" | "done" | "canceled";

export interface AsnRow {
  /** asn: ASN 1건 / load: ASN 없는 무지시 상차 실적 (D12) */
  kind: "asn" | "load";
  /** 목록 행 키 (asn-1, load-3) */
  key: string;
  /** 행을 누르면 갈 상세 주소 */
  href: string;
  id: number;
  clientId: number;
  clientName: string;
  /** 무지시 상차는 "" */
  asnNo: string;
  loadOrderNo: string | null;
  /** 상차 실적·상차확인서 번호 (상차를 시작한 뒤) */
  loadNo: string | null;
  /** 상차완료 차량의 출차 — 출차 전이면 null (2026-11-12 Sol) */
  departure: Departure | null;
  tab: AsnTab;
  status: AsnStatus;
  centerId: number;
  centerName: string;
  /** YYYY-MM-DD */
  shipDate: string;
  vehicleNo: string;
  driverName: string | null;
  driverTel: string | null;
  lineCount: number;
  planNos: string[];
  qtyByUnit: [ItemUnit, number][];
  /** 검색용 품목코드·품목명 */
  itemTexts: string[];
  createdAt: string;
  createdBy: string;
  /** 입고완료·취소 일시 (최근 탭) */
  closedAt: string | null;
}

/** 분배할 수 있는 입고예정 라인 — 수량은 입고예정 라인 단위 */
export interface DistLine {
  planLineId: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  /** 승인 수량 */
  qty: number;
  /** 단위 환산 (기준 단위 몇 개) */
  factor: number;
  baseUnit: ItemUnit;
  /** 다른 ASN에 이미 담은 수량 (라인 단위) */
  distributedQty: number;
  /** 이번에 담을 수 있는 수량 (라인 단위) */
  remainingQty: number;
  expiryDate: string | null;
  lotNo: string | null;
}

export interface DistPlan {
  id: number;
  planNo: string;
  centerId: number;
  /** YYYY-MM-DD */
  planDate: string;
  status: PlanStatus;
  approvedAt: string | null;
  memo: string | null;
  lines: DistLine[];
}

/** ASN 등록 화면 기준정보 */
export interface AsnOptions {
  centers: CenterOption[];
  defaultCenterId: string;
  /** 분배 잔량이 남은 승인·미종결 입고예정 (모든 이용 센터) */
  plans: DistPlan[];
  today: string;
}

export interface AsnLineView {
  lineNo: number;
  planId: number;
  planNo: string;
  planDate: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  qty: number;
  baseUnit: ItemUnit;
  baseQty: number;
  expiryDate: string | null;
  lotNo: string | null;
  /** 상차지시서용 — 이 단위(없으면 기준 단위) 바코드 */
  barcode: string | null;
}

export interface AsnHistoryView {
  id: string;
  action: AsnAction;
  actor: string;
  at: string;
  reasonName: string | null;
  reasonText: string | null;
}

export interface AsnDetail {
  id: number;
  asnNo: string;
  status: AsnStatus;
  version: number;
  clientName: string;
  centerId: number;
  centerName: string;
  shipDate: string;
  vehicleNo: string;
  driverName: string | null;
  driverTel: string | null;
  memo: string | null;
  loadOrder: { orderNo: string; issuedAt: string; issuedBy: string } | null;
  createdAt: string;
  createdBy: string;
  canceledAt: string | null;
  canceledBy: string | null;
  cancelReasonName: string | null;
  cancelReasonText: string | null;
  lines: AsnLineView[];
  lineCount: number;
  planNos: string[];
  qtyByUnit: [ItemUnit, number][];
  histories: AsnHistoryView[];
  /** 상차 실적 (상차지시서를 스캔한 뒤) */
  load: LoadView | null;
  /** 입고검수 (상차완료 뒤 검수를 시작하면) */
  rcv: RcvView | null;
}

/** 상차지시서 인쇄 — 발송인(화주사 법인)·수신(센터) 정보를 더한다 */
export interface LoadOrderPrint extends AsnDetail {
  sender: { name: string; bizNo: string; ceoName: string; address: string; tel: string | null; contact: string };
  receiver: { name: string; address: string; tel: string };
}
