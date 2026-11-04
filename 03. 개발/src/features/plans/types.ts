import type { ItemUnit } from "@/domain/master";
import type { PlanAction, PlanInputMethod, PlanStatus } from "@/domain/plan-status";

/** 승인 대기 탭 — wait: 승인대기 / rej: 반려·화주사 수정 중 / done: 오늘 내가 처리 */
export type ApprovalTab = "wait" | "rej" | "done";

/** 승인 대기 목록 행 */
export interface ApprovalRow {
  id: number;
  planNo: string;
  tab: ApprovalTab;
  clientId: number;
  clientName: string;
  centerName: string;
  /** YYYY-MM-DD */
  planDate: string;
  status: PlanStatus;
  revisionNo: number;
  version: number;
  inputMethod: PlanInputMethod;
  savedAt: string;
  savedBy: string;
  lineCount: number;
  /** 단위별 수량 합계: [["BOX", 245], ["PLT", 4]] */
  qtyByUnit: [ItemUnit, number][];
  /** 검색용 품목명·코드 */
  itemTexts: string[];
  /** 오늘 처리 탭: 내가 한 처리 */
  processed?: { action: "APPROVE" | "REJECT"; at: string };
}

export interface PlanLineView {
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  qty: number;
  baseUnit: ItemUnit;
  baseQty: number;
  expiryDate: string | null;
  lotNo: string | null;
  expiryManaged: boolean;
  lotManaged: boolean;
}

export interface RejectSnapshotView {
  revisionNo: number;
  reasonCode: string;
  reasonName: string;
  reasonText: string | null;
  rejectedBy: string;
  rejectedAt: string;
  planDate: string;
  lines: { lineNo: number; itemId: number; itemCode: string; itemName: string; unit: ItemUnit; qty: number }[];
}

export interface PlanHistoryView {
  id: string;
  action: PlanAction;
  version: number;
  revisionNo: number;
  actor: string;
  at: string;
  reasonName: string | null;
  reasonText: string | null;
}

/** 상세 패널 — 선택하는 순간 서버에서 다시 읽는다 (조회 시점 version 기억) */
export interface PlanDetail extends Omit<ApprovalRow, "tab" | "itemTexts" | "processed"> {
  memo: string | null;
  approvedRevisionNo: number | null;
  approvedAt: string | null;
  approvedBy: string | null;
  lines: PlanLineView[];
  /** 가장 최근 반려본 (재요청 건 비교·반려 건 사유 표시) */
  lastReject: RejectSnapshotView | null;
  histories: PlanHistoryView[];
}
