import "server-only";
import { db } from "@/server/db";
import { UNCLOSED_PLAN } from "@/domain/plan-rules";
import { UNCLOSED_ASN } from "@/domain/asn-rules";
import { emptyUnclosed, type UnclosedCounts } from "@/domain/unclosed";

/**
 * 화주사(·센터)의 미종결 전표 건수.
 * 입고예정: 승인대기·반려·승인·부분입고 (plan-rules.ts UNCLOSED_PLAN).
 * ASN: 등록·상차중 (asn-rules.ts UNCLOSED_ASN).
 * 상차 실적·입고검수는 테이블이 생기면 같은 방식으로 더한다 — 화면·차단 규칙은 이미 이 값을 쓴다.
 */
export async function countUnclosed(clientIds: number[], centerCode?: string): Promise<Map<number, UnclosedCounts>> {
  const out = new Map(clientIds.map((id) => [id, emptyUnclosed()]));
  if (clientIds.length === 0) return out;
  const plans = await db.inboundPlan.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clientIds }, status: { in: [...UNCLOSED_PLAN] }, ...(centerCode ? { center: { code: centerCode } } : {}) },
    _count: { _all: true },
  });
  for (const p of plans) out.get(p.clientId)!.plan = p._count._all;
  const asns = await db.asn.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clientIds }, status: { in: [...UNCLOSED_ASN] }, ...(centerCode ? { center: { code: centerCode } } : {}) },
    _count: { _all: true },
  });
  for (const a of asns) out.get(a.clientId)!.asn = a._count._all;
  return out;
}
