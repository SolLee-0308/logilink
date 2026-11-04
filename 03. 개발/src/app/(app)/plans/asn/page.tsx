import type { Metadata } from "next";
import { AsnListScreen } from "@/features/asn/AsnListScreen";
import { parseAsnListQuery } from "@/features/asn/asn-list";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { countUndistributed, listMyAsns } from "@/server/asn/queries";
import { centerChoices } from "@/server/plans/entry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "ASN 등록" };
export const dynamic = "force-dynamic";

/** 화주사 ASN 등록 — 차량별 ASN 목록 + 새 등록 */
export default async function AsnListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "asn", "view") || !me.clientId) return <Forbidden title="ASN 등록" crumbs={["입고 계획", "ASN 등록"]} />;
  const [rows, choices, undistributed] = await Promise.all([listMyAsns(me), centerChoices(me), countUndistributed(me)]);
  return (
    <AsnListScreen
      rows={rows}
      centers={choices.centers}
      defaultCenterId={choices.defaultCenterId}
      undistributed={undistributed}
      today={todayKst()}
      initial={parseAsnListQuery(await searchParams)}
    />
  );
}
