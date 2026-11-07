import type { Metadata } from "next";
import { ApprovalScreen } from "@/features/plans/ApprovalScreen";
import { parseApprovalListQuery } from "@/features/plans/approval-list";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { listApproval } from "@/server/plans/queries";
import { requireUser } from "@/server/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "승인 대기" };
export const dynamic = "force-dynamic";

/** 승인 대기 목록 — 행을 누르면 상세 화면에서 승인·반려 */
export default async function ApprovalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "approval", "view")) return <Forbidden title="승인 대기" crumbs={["입고 계획", "승인 대기"]} />;
  const initial = parseApprovalListQuery(await searchParams);
  const client = initial.client ? await db.client.findUnique({ where: { id: Number(initial.client) }, select: { id: true, name: true } }) : null;
  return <ApprovalScreen rows={await listApproval(me)} today={todayKst()} initial={initial} initialClient={client} />;
}
