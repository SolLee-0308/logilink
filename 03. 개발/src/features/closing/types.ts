import type { ItemUnit } from "@/domain/master";
import type { PlanStatus } from "@/domain/plan-status";

/** 잔량 종결·일마감 탭 (정의서 ⑦, 2026-11-12) */
export type ClosingTab = "remain" | "daily";

/** 잔량 종결 목록 한 줄 — 미종결(승인·부분입고) 입고예정 */
export interface RemainCloseRow {
  id: number;
  version: number;
  planNo: string;
  clientId: number;
  clientName: string;
  centerId: number;
  centerName: string;
  /** YYYY-MM-DD */
  planDate: string;
  status: PlanStatus;
  lineCount: number;
  /** 잔량이 남은 품목 수 */
  remainLineCount: number;
  /** 잔량 합계 — 입력 단위로 나눠지면 그 단위, 아니면 기준 단위로 */
  remainByUnit: [ItemUnit, number][];
  /** 진행률(%) — (입고 + 반송 + 종결) ÷ 승인 */
  pct: number;
  /** 아직 입고되지 않은 ASN(등록·상차중·상차완료) 수 — 있으면 종결할 수 없다 */
  openAsnCount: number;
  /** 마지막 검수 배분 시각 (ISO) — 없으면 아직 입고 없음 */
  lastRcvAt: string | null;
  /** 화주사 "잔량 종결 요청" 메모 */
  closeReqMemo: string | null;
  /** 검색용 품목코드·품목명 */
  itemTexts: string[];
}

/* ═════════ 일마감 탭 (정의서 ⑦·D18·D21, 2026-11-12) ═════════ */

/** 일마감할 센터 — 센터마다 업무일·일마감 시각이 다르다 */
export interface DailyCenter {
  id: number;
  name: string;
  /** 지금 업무일 (YYYY-MM-DD) */
  businessDate: string;
  businessDayStart: string;
  dailyCloseTime: string;
  expireGraceDays: number;
  /** 이 업무일 일마감 — 아직이면 null */
  closed: { at: string; by: string; rcvCount: number; expireCount: number } | null;
}

/** 이번 일마감으로 확정할 검수 실적 — 아직 일마감되지 않은 검수 확정 건 */
export interface DailyRcvRow {
  id: number;
  rcvNo: string;
  /** 귀속 업무일 — 확정 시각 기준 (D21) */
  businessDate: string;
  confirmedAt: string;
  confirmedBy: string | null;
  vehicleNo: string;
  clientName: string;
  loadType: "ORDERED" | "UNORDERED";
  lineCount: number;
  /** 입고(정상)·반송(훼손·품목 불일치) 합계 — 기준 단위 */
  goodBaseQty: number;
  returnBaseQty: number;
  /** 차이·반송 품목 수 */
  issueCount: number;
  /** 웹에서 검수 결과를 보는 곳 */
  href: string;
}

/** 이번 일마감 때 기한경과로 취소될 승인 전 입고예정 */
export interface DailyExpireRow {
  id: number;
  planNo: string;
  clientName: string;
  planDate: string;
  status: "WAITING" | "REJECTED";
  /** 취소 예정 업무일 (입고예정일 + 유예 영업일) */
  dueDate: string;
}

export interface DailyHistoryRow {
  id: number;
  businessDate: string;
  closedAt: string;
  closedBy: string;
  rcvCount: number;
  rcvLineCount: number;
  goodBaseQty: number;
  returnBaseQty: number;
  expireCount: number;
}

export interface DailyView {
  /** 고를 수 있는 센터 — 2곳 이상이면 고르기 */
  centerOptions: { id: number; name: string }[];
  center: DailyCenter;
  rcvs: DailyRcvRow[];
  expire: DailyExpireRow[];
  /** 미종결 입고예정 수 · 그중 경과 기준 초과 — 일마감과 무관, 잔량 종결 탭으로 */
  unclosedCount: number;
  unclosedOverdue: number;
  alertDays: number;
  history: DailyHistoryRow[];
}
