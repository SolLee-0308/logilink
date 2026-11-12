import type { LoadType } from "@/domain/load-rules";

/** 입고검수 실적 보기 — 확정 / 검수 중 / 입고취소 (2026-11-12) */
export type RcvResultTab = "confirmed" | "working" | "canceled";

export interface RcvResultQuery {
  tab: RcvResultTab;
  /** 업무일 범위 (YYYY-MM-DD) — 확정은 확정 시각, 검수 중은 시작 시각, 입고취소는 역전표 시각의 센터 업무일 */
  from: string;
  to: string;
}

/** 입고검수 실적 한 줄 — 차량 1대 = 검수 1건 */
export interface RcvResultRow {
  id: number;
  rcvNo: string;
  version: number;
  status: "WORKING" | "CONFIRMED" | "CANCELED";
  /** 귀속 업무일 — 확정 시각(검수 중이면 시작 시각)의 센터 업무일 (D21) */
  businessDate: string;
  startedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  vehicleNo: string;
  clientId: number;
  clientName: string;
  centerId: number;
  centerName: string;
  loadType: LoadType;
  loadNo: string;
  asnNo: string | null;
  /** 상차 실적 대상 품목 수 (품목 불일치 제외) */
  lineCount: number;
  /** 입고(정상)·반송(훼손 + 품목 불일치) 합계 — 기준 단위 */
  goodBaseQty: number;
  returnBaseQty: number;
  /** 차이·반송 품목 수 */
  issueCount: number;
  /** 일마감 — 확정 건만. 마감 전이면 null */
  closedDate: string | null;
  workerCount: number;
  /** 입고취소할 수 없는 이유 — 확정 탭만, 할 수 있으면 null (rcv-cancel-rules.ts) */
  cancelBlock: string | null;
  /** 입고취소 역전표 — 입고취소 탭만 */
  reverse: { no: string; reasonName: string; reasonText: string | null; at: string; by: string; goodBaseQty: number; returnBaseQty: number } | null;
  /** 웹에서 검수 결과를 보는 곳 — 지시: ASN·상차 현황 상세 / 무지시: 상차 상세 */
  href: string;
  /** 검색용 품목코드·품목명 */
  itemTexts: string[];
}
