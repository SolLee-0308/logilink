import type { Metadata } from "next";
import { can } from "@/domain/permissions";
import { Forbidden } from "@/features/master/Forbidden";
import { CodesScreen } from "@/features/master/CodesScreen";
import { listCodeGroups, listCommonCodes } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "사유 코드" };
export const dynamic = "force-dynamic";

export default async function CodesPage() {
  const me = await requireUser();
  if (!can(me.roles, "codes", "view")) return <Forbidden title="사유 코드" />;
  const [groups, rows] = await Promise.all([listCodeGroups(), listCommonCodes()]);
  return <CodesScreen groups={groups} rows={rows} canEdit={can(me.roles, "codes", "edit")} />;
}
