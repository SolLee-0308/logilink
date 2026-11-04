import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntryDetailScreen } from "@/features/plans/entry/EntryDetailScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { CANCEL_GROUP } from "@/domain/master";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { listCodeOptions } from "@/server/master/queries";
import { getPlanDetail } from "@/server/plans/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "입고예정 상세" };
export const dynamic = "force-dynamic";

/** 입고예정 상세 (화주사) — 열 때마다 최신 내용·version을 읽는다. 자기 화주사 건만 */
export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me.roles, "planEntry", "view") || !me.clientId) return <Forbidden title="입고예정 등록" crumbs={["입고 계획", "입고예정 등록"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [detail, reasons] = await Promise.all([getPlanDetail(me, id), listCodeOptions(CANCEL_GROUP)]);
  if (!detail) notFound();
  return <EntryDetailScreen key={`${detail.id}-${detail.version}`} detail={detail} cancelReasons={reasons} today={todayKst()} />;
}
