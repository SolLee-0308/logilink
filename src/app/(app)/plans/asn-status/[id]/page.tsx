import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AsnDetailScreen } from "@/features/asn/AsnDetailScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { getAsnStatusDetail } from "@/server/asn/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "ASN 상세" };
export const dynamic = "force-dynamic";

/** ASN 상세 (3PL, 조회 전용) — 소속 센터 건만 */
export default async function AsnStatusDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me.roles, "asnStatus", "view")) return <Forbidden title="ASN·상차 현황" crumbs={["입고 계획", "ASN·상차 현황"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getAsnStatusDetail(me, id);
  if (!detail) notFound();
  return <AsnDetailScreen detail={detail} today={todayKst()} view="tpl" />;
}
