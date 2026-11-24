import type { Metadata } from "next";
import { can } from "@/domain/permissions";
import { Forbidden } from "@/features/master/Forbidden";
import { SettingsScreen } from "@/features/master/SettingsScreen";
import { listSettings } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "운영 설정" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireUser();
  if (!can(me.roles, "settings", "view")) return <Forbidden title="운영 설정" />;
  return <SettingsScreen rows={await listSettings()} canEdit={can(me.roles, "settings", "edit")} />;
}
