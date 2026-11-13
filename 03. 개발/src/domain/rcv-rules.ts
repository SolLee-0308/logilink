/**
 * 입고검수 규칙 — 근거: 정의서 v1.4 ⑥ · 4-2 · 5장 · C7 · C8 · D14 · D15 · D16
 * PDA 화면·웹 화면·서버 검사가 이 파일을 같이 본다.
 *
 * 2026-11-05 Sol 결정
 * - 작업자 잠금 없음(O1 → 상차와 같은 방식): 여러 검수자가 같은 차량에 입력 1건 = 추가 수량 1행을 쌓는다.
 * - 상차 실적에 있는 품목은 입고(ASN에 없으면 배분 2단계부터), 상차 실적에 없는 품목만 품목 불일치 반송.
 * - 차이·반송 라인은 사유 필수(RCV_DIFF), 0(미도착)은 "미도착"이 기본.
 * - 정상 → 입고 누계, 훼손 반송 → 반송 누계로 둘 다 배분, 품목 불일치 반송은 기록만.
 */
import type { StatusTone } from "./plan-status";

export const RCV_STATUSES = ["WORKING", "CONFIRMED", "CANCELED"] as const;
export type RcvStatus = (typeof RCV_STATUSES)[number];
export type RcvKind = "GOOD" | "DAMAGED" | "MISMATCH";
export type RcvAllocKind = "GOOD" | "RETURN";

export const RCV_STATUS_META: Record<RcvStatus, { label: string; tone: StatusTone }> = {
  WORKING: { label: "검수중", tone: "part" },
  CONFIRMED: { label: "검수확정", tone: "done" },
  CANCELED: { label: "입고취소", tone: "cancel" },
};
export const RCV_KIND_LABEL: Record<RcvKind, string> = { GOOD: "정상", DAMAGED: "훼손·오염 반송", MISMATCH: "품목 불일치 반송" };

/** 검수 번호 RC-YYYYMMDD-NNNN */
export const RCV_PREFIX = "RC";

/** 사유 코드 기본값 (RCV_DIFF 그룹, 시드 U1) */
export const RCV_REASON = { SHORT: "V01", OVER: "V02", DAMAGED: "V03", MISMATCH: "V04", MISSING: "V05" } as const;

/** 훼손 사진 — 품목당 최소 1장, 최대 5장, 한 장 1MB 이하 (DB 제약과 같다) */
export const RCV_IMAGE_MIN = 1;
export const RCV_IMAGE_MAX = 5;
export const RCV_IMAGE_BYTES = 1_048_576;

/** 검수 라인 — 기준 단위 수량 */
export interface RcvLineQty {
  expect: number;
  good: number;
  damaged: number;
  mismatchQty: number;
  mismatch: boolean;
  zeroConfirm: boolean;
  /** 취소되지 않은 입력이 있는지 */
  hasInputs: boolean;
}

/** 차이 = 정상 + 반송 − 기대 (C7). 품목 불일치 라인은 기대가 없으므로 차이를 따지지 않는다 */
export const lineDiff = (l: Pick<RcvLineQty, "expect" | "good" | "damaged" | "mismatch">) => (l.mismatch ? 0 : l.good + l.damaged - l.expect);

/** 검수자가 손을 댄 라인인지 — 입력이 있거나 0을 확인했다 (D15: 시스템이 임의로 0 처리하지 않는다) */
export const lineEntered = (l: Pick<RcvLineQty, "hasInputs" | "zeroConfirm">) => l.hasInputs || l.zeroConfirm;

/** 사유가 필요한 라인 — 차이가 있거나 반송이 있거나 품목 불일치 */
export const needsReason = (l: RcvLineQty) => l.mismatch || l.damaged > 0 || lineDiff(l) !== 0;

/** 라인 상태 표시 */
export type RcvLineState = "todo" | "short" | "match" | "over" | "zero" | "mismatch";
export const RCV_LINE_STATE_LABEL: Record<RcvLineState, string> = { todo: "미입력", short: "부족", match: "일치", over: "초과", zero: "0 확인", mismatch: "품목 불일치" };

export function rcvLineState(l: RcvLineQty): RcvLineState {
  if (l.mismatch) return "mismatch";
  if (!lineEntered(l)) return "todo";
  if (!l.hasInputs && l.zeroConfirm) return "zero";
  const d = lineDiff(l);
  return d < 0 ? "short" : d > 0 ? "over" : "match";
}

/**
 * 검수 차이 사유 — 사용자가 고르지 않고 수량으로 시스템이 정한다 (2026-11-13 Sol 결정, A안).
 * 부족·초과는 수량 비교로 이미 알 수 있어 드롭다운으로 다시 고르면 수량과 어긋난 사유가 저장될 수 있었다.
 * 한 라인에 사유는 하나 — 품목 불일치 > 미도착(0 확인) > 훼손 반송 > 수량 부족 > 수량 초과 순으로 정한다.
 * 사유가 필요 없는 라인(차이·반송 없음)은 null.
 */
export function autoReason(l: RcvLineQty): string | null {
  if (l.mismatch) return RCV_REASON.MISMATCH;
  if (!l.hasInputs && l.zeroConfirm) return RCV_REASON.MISSING;
  if (l.damaged > 0) return RCV_REASON.DAMAGED;
  const d = lineDiff(l);
  if (d < 0) return RCV_REASON.SHORT;
  if (d > 0) return RCV_REASON.OVER;
  return null;
}

/* ═════════ 자동 배분 (5-2) ═════════ */

export interface AllocRow {
  kind: RcvAllocKind;
  step: 1 | 2 | 3;
  planLineId: number | null;
  asnLineId: number | null;
  qty: number;
}

/**
 * 검수 라인 1개의 수량을 입고예정 라인에 나눈다 — 같은 입력이면 늘 같은 결과(재현성).
 * @param parts   배분할 수량 (정상 먼저, 그다음 반송 — 같은 순서로 같은 칸을 채운다)
 * @param step1   원 ASN 라인 (라인 번호 순). cap = 그 ASN 라인 지시수량 − 이미 배분된 수량
 * @param step2   같은 화주사·같은 센터 미종결 입고예정 중 이 품목이 ASN으로 분배된 라인 (승인 시각이 오래된 순)
 * @param planCap 입고예정 라인별 남은 칸 = ASN 분배수량 − 이미 배분된 수량 (승인 잔량도 넘지 않게 호출하는 쪽에서 줄여 둔다)
 * 1단계 → 2단계 → 3단계(초과) 순서. 1단계에서 채운 입고예정 라인은 2단계에서 그만큼 칸이 줄어 있다.
 */
export function allocate(
  parts: { kind: RcvAllocKind; qty: number }[],
  step1: { asnLineId: number; planLineId: number; cap: number }[],
  step2: number[],
  planCap: Map<number, number>,
): AllocRow[] {
  const cap = new Map(planCap);
  const asnCap = new Map(step1.map((s) => [s.asnLineId, s.cap]));
  const rows: AllocRow[] = [];
  const push = (r: AllocRow) => {
    const same = rows.find((x) => x.kind === r.kind && x.step === r.step && x.planLineId === r.planLineId && x.asnLineId === r.asnLineId);
    if (same) same.qty += r.qty;
    else rows.push(r);
  };
  for (const part of parts) {
    let left = part.qty;
    for (const s of step1) {
      if (left <= 0) break;
      const n = Math.min(left, asnCap.get(s.asnLineId) ?? 0, cap.get(s.planLineId) ?? 0);
      if (n <= 0) continue;
      asnCap.set(s.asnLineId, (asnCap.get(s.asnLineId) ?? 0) - n);
      cap.set(s.planLineId, (cap.get(s.planLineId) ?? 0) - n);
      push({ kind: part.kind, step: 1, planLineId: s.planLineId, asnLineId: s.asnLineId, qty: n });
      left -= n;
    }
    for (const pl of step2) {
      if (left <= 0) break;
      const n = Math.min(left, cap.get(pl) ?? 0);
      if (n <= 0) continue;
      cap.set(pl, (cap.get(pl) ?? 0) - n);
      push({ kind: part.kind, step: 2, planLineId: pl, asnLineId: null, qty: n });
      left -= n;
    }
    if (left > 0) push({ kind: part.kind, step: 3, planLineId: null, asnLineId: null, qty: left });
  }
  return rows;
}

/** 입고예정 라인 잔량 (기준 단위) = 승인 − 정상 입고 누계 − 반송 누계 − 종결 (5-1) */
export const planLineRemain = (l: { baseQty: number; rcvQty: number; returnQty: number; closeQty: number }) => l.baseQty - l.rcvQty - l.returnQty - l.closeQty;

/** 배분 뒤 입고예정 상태 — 모든 라인 잔량 ≤ 0 이면 입고완료, 아니면 부분입고 (D17) */
export const planStatusAfterReceive = (lines: { baseQty: number; rcvQty: number; returnQty: number; closeQty: number }[]) =>
  lines.every((l) => planLineRemain(l) <= 0) ? ("COMPLETED" as const) : ("PARTIAL" as const);

export const RCV_CONFLICT_MSG = "그사이 다른 검수자가 입력했습니다. 최신 합계를 다시 확인한 뒤 확정하세요.";
export const RCV_DONE_MSG = "이미 검수 확정된 차량입니다. 확정 뒤에는 고칠 수 없습니다. 잘못 확정했으면 3PL 관리자가 일마감 전에 입고취소한 뒤 다시 검수합니다.";
