import type { ItemUnit } from "@/domain/master";
import type { AsnStatus } from "@/domain/asn-rules";
import type { PlanStatus } from "@/domain/plan-status";
import type { PlanDetail } from "../types";

/** 입고예정 조회 탭 — plan: 품목별(입고예정 기준) / vehicle: 차량별(ASN 기준) */
export type InquiryTab = "plan" | "vehicle";

/** 품목별 탭의 품목 라인 — 수량은 모두 기준 단위 (화면에서 입고예정 단위로 바꿔 보인다) */
export interface InquiryPlanLine {
  lineNo: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  qty: number;
  baseUnit: ItemUnit;
  /** 입고예정 단위 1개 = 기준 단위 몇 개 */
  factor: number;
  baseQty: number;
  /** 오는 중 — 아직 입고(검수 확정)되지 않은 ASN에 담긴 수량 */
  incomingQty: number;
  rcvQty: number;
  returnQty: number;
  closeQty: number;
}

export interface InquiryPlanRow {
  id: number;
  planNo: string;
  clientId: number;
  clientName: string;
  centerId: number;
  centerName: string;
  planDate: string;
  status: PlanStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  /** 이 입고예정이 실린 차량(취소 제외) 수 */
  vehicleCount: number;
  lines: InquiryPlanLine[];
}

/** 차량별 탭의 라인 — ASN 라인(입고예정 라인 1개에서 이 차량에 담은 수량) */
export interface InquiryVehicleLine {
  key: string;
  planId: number;
  planNo: string;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  baseUnit: ItemUnit;
  factor: number;
  /** 지시수량 (기준 단위) */
  orderQty: number;
  /** 이 차량에서 들어와 이 라인에 배분된 입고·반송 (검수 확정 뒤) */
  rcvQty: number;
  returnQty: number;
  /** 오는 중 — ASN이 아직 입고 전이면 지시수량, 입고완료면 0 */
  incomingQty: number;
  /** 입고예정 라인 전체 잔량 (승인 − 입고 − 반송 − 종결) */
  planRemainQty: number;
}

export interface InquiryVehicleRow {
  id: number;
  asnNo: string;
  clientId: number;
  clientName: string;
  centerId: number;
  centerName: string;
  shipDate: string;
  vehicleNo: string;
  driverName: string | null;
  driverTel: string | null;
  status: AsnStatus;
  /** 입고(검수 확정) 시각 */
  receivedAt: string | null;
  planNos: string[];
  lines: InquiryVehicleLine[];
}

export interface CenterOption {
  id: number;
  name: string;
}

/** 상세 — 공통 상세 + 오는 중·차량·배분 이력·취소 가능 여부 */
export interface InquiryDetail extends PlanDetail {
  /** 라인 번호 → 오는 중(기준 단위) */
  incoming: Record<number, number>;
  vehicles: {
    id: number;
    asnNo: string;
    shipDate: string;
    vehicleNo: string;
    status: AsnStatus;
    /** 이 입고예정에서 담은 수량 [단위, 수량] */
    qtyByUnit: [ItemUnit, number][];
    lineCount: number;
  }[];
  allocs: {
    id: number;
    confirmedAt: string | null;
    rcvNo: string;
    vehicleNo: string;
    asnNo: string | null;
    step: number;
    kind: "GOOD" | "RETURN";
    lineNo: number;
    itemCode: string;
    itemName: string;
    unit: ItemUnit;
    baseUnit: ItemUnit;
    factor: number;
    qty: number;
  }[];
  /** 승인 건 취소를 막는 이유 (null = 취소 가능) */
  cancelBlock: string | null;
  canCancel: boolean;
  alertDays: number;
  cancelReasonName: string | null;
  cancelReasonText: string | null;
  canceledAt: string | null;
  canceledBy: string | null;
}
