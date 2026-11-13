/**
 * 입고취소(역전표) 규칙 — 근거: 정의서 v1.6 ⑥ "입고취소 역전표 후 재검수 (적치 시작 전까지만)", 핵심 원칙 2, 2026-11-12 Sol
 * 화면(입고검수 실적)과 서버 검사가 이 파일을 같이 본다.
 *
 * - 확정된 검수 실적은 고치거나 지우지 않는다. 역전표(번호 RV-…)를 만들고 원래 배분을 "되돌림"으로 표시해 합계에서 뺀다.
 * - 되돌리면 입고예정 입고·반송 누계와 상태, ASN(입고완료 → 상차완료)을 되돌리고, 같은 차량을 다시 검수할 수 있다.
 * - 임시안: 3PL 관리자만, 사유 필수, **일마감 전 확정 실적만**. 적치 모듈이 생기면 "적치 시작 전" 조건을 여기에 더한다
 *   (정의서의 "적치 시작 전까지만"을 그때까지 일마감으로 대신한다 — 둘 다 지켜야 하는 조건).
 * - 배분된 입고예정이 그사이 종결·취소되었으면 되돌리지 않는다(종결된 잔량과 충돌).
 */
import type { PlanStatus } from "./plan-status";

/** 역전표 번호 RV-YYYYMMDD-NNNN (asn-rules의 nextDocNo로 만든다) */
export const RCV_REVERSE_PREFIX = "RV";

export function rcvCancelBlock(p: {
  status: string;
  /** 일마감으로 확정된 실적인가 */
  dailyClosed: boolean;
  /** 배분된 입고예정 중 되돌릴 수 없는 상태(종결·취소)인 것의 번호 */
  lockedPlanNos: string[];
  /** 적치가 시작되었는가 — 적치 모듈 전에는 항상 false */
  putawayStarted?: boolean;
}): string | null {
  if (p.status !== "CONFIRMED") return "검수 확정된 실적만 입고취소할 수 있습니다.";
  if (p.dailyClosed) return "일마감된 실적입니다. 입고취소는 일마감 전까지만 할 수 있습니다.";
  if (p.putawayStarted) return "적치가 시작된 실적입니다. 입고취소 대신 재고 조정으로 처리하세요.";
  if (p.lockedPlanNos.length) return `배분된 입고예정 ${p.lockedPlanNos.join(", ")}이(가) 종결·취소되어 되돌릴 수 없습니다.`;
  return null;
}

/** 배분을 되돌린 뒤 입고예정 상태 — 처리된 수량이 하나도 없으면 승인, 잔량이 남으면 부분입고, 없으면 입고완료 */
export function planStatusAfterReverse(lines: { baseQty: number; rcvQty: number; returnQty: number; closeQty: number }[]): PlanStatus {
  const done = lines.reduce((s, l) => s + l.rcvQty + l.returnQty + l.closeQty, 0);
  if (done <= 0) return "APPROVED";
  return lines.every((l) => l.baseQty - l.rcvQty - l.returnQty - l.closeQty <= 0) ? "COMPLETED" : "PARTIAL";
}

/** 되돌릴 수 없는 입고예정 상태 */
export const REVERSE_LOCKED_PLAN: readonly PlanStatus[] = ["CLOSED", "CANCELED"];
