import type { Metadata } from "next";
import { CentersScreen } from "@/features/master/CentersScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { listCenterRows, listManagerCandidates } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "센터" };
export const dynamic = "force-dynamic";

export default async function CentersPage() {
  const me = await requireUser();
  if (!can(me.roles, "centers", "view")) return <Forbidden title="센터" />;
  const [rows, candidates] = await Promise.all([listCenterRows(), listManagerCandidates()]);
  return <CentersScreen rows={rows} candidates={candidates} canEdit={can(me.roles, "centers", "edit")} />;
}
