import type { Metadata } from "next";
import { SettingsScreen } from "@/features/master/SettingsScreen";
import { listSettings } from "@/server/master/queries";

export const metadata: Metadata = { title: "운영 설정" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return <SettingsScreen rows={await listSettings()} />;
}
