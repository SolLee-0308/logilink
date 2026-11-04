import type { Metadata } from "next";
import { ApprovalScreen } from "@/features/plans/ApprovalScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { PLAN_REJECT_GROUP } from "@/domain/master";
import { todayKst } from "@/lib/format";
import { listCodeOptions } from "@/server/master/queries";
import { listApproval } from "@/server/plans/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "승인 대기" };
export const dynamic = "force-dynamic";

export default async function ApprovalPage() {
  const me = await requireUser();
  if (!can(me.role, "approval", "view")) return <Forbidden title="승인 대기" crumbs={["입고 계획", "승인 대기"]} />;
  const [rows, reasons] = await Promise.all([listApproval(me), listCodeOptions(PLAN_REJECT_GROUP)]);
  return <ApprovalScreen rows={rows} reasons={reasons} today={todayKst()} />;
}
