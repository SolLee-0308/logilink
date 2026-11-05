import type { Metadata } from "next";
import { PdaDashboardScreen } from "@/features/pda/PdaDashboardScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaPending } from "@/features/pda/PdaPending";
import { isLoader } from "@/features/pda/menu";
import { pdaLoadDashboard } from "@/server/loads/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "대시보드" };
export const dynamic = "force-dynamic";

/** PDA 대시보드 — 상차담당: 오늘 상차 현황(임시안 U41) / 입고검수자: 입고검수 개발 때 채운다 */
export default async function PdaDashboardPage() {
  const me = await requirePdaUser();
  const data = isLoader(me.roles) ? await pdaLoadDashboard(me) : null;
  return (
    <PdaShell user={me.name} org={me.clientName} roles={me.roles} tab="dashboard">
      {data ? <PdaDashboardScreen data={data} /> : <PdaPending title="입고검수 대시보드" />}
    </PdaShell>
  );
}
