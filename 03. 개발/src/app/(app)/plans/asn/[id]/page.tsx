import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AsnDetailScreen } from "@/features/asn/AsnDetailScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { CANCEL_GROUP } from "@/domain/master";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { listCodeOptions } from "@/server/master/queries";
import { getAsnDetail } from "@/server/asn/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "ASN 상세" };
export const dynamic = "force-dynamic";

/** ASN 상세 (화주사) — 자기 화주사 건만. ?issued=1이면 방금 발행한 상차지시서 안내 */
export default async function AsnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  if (!can(me.roles, "asn", "view") || !me.clientId) return <Forbidden title="ASN 등록" crumbs={["입고 계획", "ASN 등록"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [detail, reasons] = await Promise.all([getAsnDetail(me, id), listCodeOptions(CANCEL_GROUP)]);
  if (!detail) notFound();
  const issued = (await searchParams).issued === "1";
  return <AsnDetailScreen key={`${detail.id}-${detail.version}`} detail={detail} cancelReasons={reasons} today={todayKst()} issued={issued} />;
}
