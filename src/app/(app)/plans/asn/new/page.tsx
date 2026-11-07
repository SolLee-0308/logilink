import type { Metadata } from "next";
import { AsnNewScreen } from "@/features/asn/AsnNewScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { asnOptions } from "@/server/asn/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "새 ASN" };
export const dynamic = "force-dynamic";

/** ASN 등록 — 승인 입고예정을 차량에 담는다. 열 때마다 남은 수량을 새로 읽는다 */
export default async function AsnNewPage() {
  const me = await requireUser();
  const options = can(me.roles, "asn", "edit") ? await asnOptions(me) : null;
  if (!options) return <Forbidden title="ASN 등록" crumbs={["입고 계획", "ASN 등록"]} />;
  return <AsnNewScreen options={options} />;
}
