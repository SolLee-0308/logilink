/**
 * 잔량 종결 규칙 — 근거: 정의서 v1.6 ⑦ · 4-2 · D17 · 5-1
 * 화면(잔량 종결·일마감)과 서버 검사가 이 파일을 같이 본다.
 *
 * - 잔량이 남은 입고예정(승인·부분입고)은 자동으로 닫지 않는다. 3PL이 더 입고되지 않는다고 판단하면 사유와 함께 종결한다(건별·일괄).
 * - 잔량 = 승인 − 입고 − 반송 − 종결 (기준 단위, 5-1). 종결하면 라인별 잔량을 종결 수량으로 옮기고 상태를 '종결'로 바꾼다.
 * - 아직 입고되지 않은 ASN(등록·상차중·상차완료)에 담긴 건은 종결하지 않는다 — 실물이 오는 중이므로 (2026-11-12 임시안).
 *   검수 확정으로 입고된 뒤 종결하거나, 화주사가 ASN을 취소한 뒤 종결한다.
 */
import type { PlanStatus } from "./plan-status";

/** 잔량 종결 대상 상태 — 승인·부분입고 (미종결) */
export const CLOSABLE: readonly PlanStatus[] = ["APPROVED", "PARTIAL"];

/** 라인 잔량 (기준 단위) */
export const remainOf = (l: { baseQty: number; rcvQty: number; returnQty: number; closeQty: number }) => Math.max(l.baseQty - l.rcvQty - l.returnQty - l.closeQty, 0);

/** 한 번에 종결할 수 있는 건수 (잘못 눌러 대량 종결하는 일을 막는다) */
export const MAX_CLOSE_BATCH = 50;

/**
 * 잔량 종결 가능 여부 — 불가하면 이유 문장, 가능하면 null
 * openAsnCount: 이 입고예정 라인이 담긴, 아직 입고되지 않은 ASN 수 (등록·상차중·상차완료)
 */
export function remainCloseBlock(p: { status: PlanStatus; openAsnCount: number; remain: number }): string | null {
  if (!CLOSABLE.includes(p.status)) return "승인·부분입고 상태인 입고예정만 잔량 종결할 수 있습니다.";
  if (p.openAsnCount > 0) return `아직 입고되지 않은 ASN ${p.openAsnCount}대에 담겨 있습니다. 검수 확정 뒤 종결하거나 화주사가 ASN을 취소해야 합니다.`;
  if (p.remain <= 0) return "남은 잔량이 없습니다.";
  return null;
}
