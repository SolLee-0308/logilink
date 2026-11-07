/**
 * 미종결 전표 — 화주사 사용 안 함 전환·이용 센터 제외를 막는 기준
 * 근거: 98. 프롬프트/02. VS코드_프롬프트_화주사.md 2-2·4장
 * 입고예정(승인대기·반려·승인·부분입고) + ASN(등록·상차중) + 상차 실적(작업중) + 입고검수(검수중)
 */

export const UNCLOSED_KINDS = ["plan", "asn", "loading", "inspection"] as const;
export type UnclosedKind = (typeof UNCLOSED_KINDS)[number];

export const UNCLOSED_LABEL: Record<UnclosedKind, string> = {
  plan: "입고예정",
  asn: "ASN",
  loading: "상차 실적",
  inspection: "입고검수",
};

export type UnclosedCounts = Record<UnclosedKind, number>;

export const emptyUnclosed = (): UnclosedCounts => ({ plan: 0, asn: 0, loading: 0, inspection: 0 });

export const unclosedTotal = (c: UnclosedCounts) => UNCLOSED_KINDS.reduce((s, k) => s + c[k], 0);

/** 유형별 건수 문장: "입고예정 2건, ASN 1건" (0건 유형은 뺀다) */
export const unclosedBreakdown = (c: UnclosedCounts) =>
  UNCLOSED_KINDS.filter((k) => c[k] > 0)
    .map((k) => `${UNCLOSED_LABEL[k]} ${c[k]}건`)
    .join(", ");

/** 사용 안 함 전환 차단 문구 — 없으면 null */
export function deactivateBlock(c: UnclosedCounts): string | null {
  const n = unclosedTotal(c);
  return n > 0 ? `미종결 전표 ${n}건이 있어 사용 안 함으로 바꿀 수 없습니다. (${unclosedBreakdown(c)})` : null;
}

/** 이용 센터 제외 차단 문구 — 없으면 null */
export function removeCenterBlock(centerName: string, c: UnclosedCounts): string | null {
  const n = unclosedTotal(c);
  return n > 0 ? `${centerName}에 미종결 전표 ${n}건이 있어 이용 센터에서 뺄 수 없습니다.` : null;
}
