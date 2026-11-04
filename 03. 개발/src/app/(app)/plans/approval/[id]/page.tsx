import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApprovalDetailScreen } from "@/features/plans/ApprovalDetailScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { PLAN_REJECT_GROUP } from "@/domain/master";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { listCodeOptions } from "@/server/master/queries";
import { approvalQueue, getPlanDetail } from "@/server/plans/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "승인 상세" };
export const dynamic = "force-dynamic";

/** 승인 상세 — 열 때마다 최신 내용·version을 읽는다. 3PL 소속 센터 건만 */
export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me.roles, "approval", "view")) return <Forbidden title="승인 대기" crumbs={["입고 계획", "승인 대기"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [detail, queue, reasons] = await Promise.all([getPlanDetail(me, id), approvalQueue(me, id), listCodeOptions(PLAN_REJECT_GROUP)]);
  if (!detail) notFound();
  return <ApprovalDetailScreen key={`${detail.id}-${detail.version}`} detail={detail} queue={queue} reasons={reasons} today={todayKst()} />;
}
