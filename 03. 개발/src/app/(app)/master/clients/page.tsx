import type { Metadata } from "next";
import { ClientsScreen } from "@/features/master/ClientsScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { listCenterPicks, listClients, listManagerCandidates } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "화주사" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const me = await requireUser();
  if (!can(me.role, "clients", "view")) return <Forbidden title="화주사" />;
  const [rows, centers, candidates] = await Promise.all([listClients(), listCenterPicks(), listManagerCandidates()]);
  return <ClientsScreen rows={rows} centers={centers} candidates={candidates} canEdit={can(me.role, "clients", "edit")} />;
}
