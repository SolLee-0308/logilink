import type { Metadata } from "next";
import { AsnStatusScreen } from "@/features/asn/AsnStatusScreen";
import { parseAsnStatusQuery } from "@/features/asn/asn-status-list";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { db } from "@/server/db";
import { listAsnStatus } from "@/server/asn/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "ASN·상차 현황" };
export const dynamic = "force-dynamic";

/** 3PL ASN·상차 현황 — 소속 센터로 들어올 차량(ASN) 조회 */
export default async function AsnStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "asnStatus", "view")) return <Forbidden title="ASN·상차 현황" crumbs={["입고 계획", "ASN·상차 현황"]} />;
  const today = todayKst();
  const initial = parseAsnStatusQuery(await searchParams, today);
  const [{ rows, open }, client] = await Promise.all([
    listAsnStatus(me, { from: initial.from, to: initial.to }),
    initial.client ? db.client.findUnique({ where: { id: Number(initial.client) }, select: { id: true, name: true } }) : null,
  ]);
  return <AsnStatusScreen rows={rows} open={open} today={today} initial={initial} initialClient={client} multiCenter={!me.centerId} />;
}
