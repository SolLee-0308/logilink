import type { Metadata } from "next";
import { CodesScreen } from "@/features/master/CodesScreen";
import { listCodeGroups, listCommonCodes } from "@/server/master/queries";

export const metadata: Metadata = { title: "사유 코드" };
export const dynamic = "force-dynamic";

export default async function CodesPage() {
  const [groups, rows] = await Promise.all([listCodeGroups(), listCommonCodes()]);
  return <CodesScreen groups={groups} rows={rows} />;
}
