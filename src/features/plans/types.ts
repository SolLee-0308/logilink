import type { ItemUnit } from "@/domain/master";
import type { CatalogItem } from "@/domain/plan-entry";
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
  centerId: number;
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
  /** 기준 단위 누계 — 입고검수 확정 시 자동 배분으로 쌓인다 (5-1 잔량 = 승인 − 입고 − 반송 − 종결) */
  rcvQty: number;
  returnQty: number;
  closeQty: number;
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

/** 승인 상세 — 승인대기 순서 (처리 후 다음 건) */
export interface ApprovalQueue {
  position: number | null;
  total: number;
  prevId: number | null;
  nextId: number | null;
  afterId: number | null;
}

/* ───────── 화주사 입고예정 등록 ───────── */

/** 입고예정 등록 목록 탭 — 승인대기 / 반려·수정 필요 / 최근 승인 / 최근 취소 */
export type EntryTab = "wait" | "rej" | "approved" | "canceled";

export interface EntryRow extends Omit<ApprovalRow, "tab" | "processed"> {
  tab: EntryTab;
  /** 반려 사유 (반려 탭) */
  rejectReason: string | null;
  /** 승인·취소 일시 (최근 탭) */
  closedAt: string | null;
}

export interface CenterOption {
  id: number;
  name: string;
}

/** 등록·수정 화면에 필요한 기준정보 — 이용 센터, 사용 중인 품목, 앞으로 1년 휴무일 */
export interface EntryOptions {
  centers: CenterOption[];
  /** 센터 기본값 — 사용자 기본 센터, 없으면 이용 센터가 1곳일 때 그 센터 ("" = 고르지 않음) */
  defaultCenterId: string;
  items: CatalogItem[];
  holidays: { centerId: number; date: string; name: string }[];
  today: string;
  /** 최소 잔여 소비기한(일) — 입고예정일 + 이 일수보다 이른 소비기한은 입력 불가 */
  minExpiryDays: number;
}
