import type { Metadata } from "next";
import { UsersScreen } from "@/features/master/UsersScreen";
import { can } from "@/domain/permissions";
import { listCenters, listClientOptions, listUsers } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "사용자·역할" };
export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const client = Number((await searchParams).client);
  const [rows, clients, centers] = await Promise.all([listUsers(), listClientOptions(), listCenters()]);
  return (
    <UsersScreen
      rows={rows}
      clients={clients}
      centers={centers}
      viewerRole={me.role}
      canEdit={can(me.role, "users", "edit")}
      canManageAccounts={can(me.role, "accounts", "edit")}
      initialClientId={Number.isInteger(client) && client > 0 ? client : undefined}
    />
  );
}
