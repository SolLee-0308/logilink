import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Forbidden } from "@/features/master/Forbidden";
import { LoadDetailScreen } from "@/features/loads/LoadDetailScreen";
import { getLoadView, webLoadScope } from "@/server/loads/queries";
import { getRcvOfLoad } from "@/server/rcv/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "상차 실적" };
export const dynamic = "force-dynamic";

/**
 * 상차 실적 상세 (웹, 조회 전용) — ASN 없는 무지시 상차를 본다.
 * 지시 상차는 ASN 상세 안에 함께 나오므로 그쪽으로 보낸다.
 */
export default async function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const scope = webLoadScope(me);
  if (!scope) return <Forbidden title="상차 실적" crumbs={["입고 계획", "상차 실적"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const load = await getLoadView(me, id);
  if (!load) notFound();
  const shipper = !!me.clientId;
  if (load.asn) redirect(shipper ? `/plans/asn/${load.asn.id}` : `/plans/asn-status/${load.asn.id}`);
  return <LoadDetailScreen load={load} view={shipper ? "shipper" : "tpl"} rcv={await getRcvOfLoad(load.id)} />;
}
