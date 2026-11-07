import type { Metadata } from "next";
import { PdaDashboardScreen } from "@/features/pda/PdaDashboardScreen";
import { PdaInspectDashboardScreen } from "@/features/pda/PdaInspectDashboardScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { NoteBox } from "@/components/ui/NoteBox";
import { isLoader } from "@/features/pda/menu";
import { pdaLoadDashboard } from "@/server/loads/queries";
import { pdaRcvDashboard } from "@/server/rcv/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "대시보드" };
export const dynamic = "force-dynamic";

/** PDA 대시보드 — 상차담당: 오늘 상차 현황(U41) / 입고검수자: 오늘 입고검수 현황(U45-⑦) */
export default async function PdaDashboardPage() {
  const me = await requirePdaUser();
  if (isLoader(me.roles)) {
    const data = await pdaLoadDashboard(me);
    return (
      <PdaShell user={me.name} org={me.clientName} roles={me.roles} tab="dashboard">
        {data ? <PdaDashboardScreen data={data} /> : <NoteBox tone="error">대시보드를 볼 권한이 없는 계정입니다.</NoteBox>}
      </PdaShell>
    );
  }
  const data = await pdaRcvDashboard(me);
  return (
    <PdaShell user={me.name} org={me.clientName ?? me.centerName} roles={me.roles} tab="dashboard">
      {data ? <PdaInspectDashboardScreen data={data} /> : <NoteBox tone="error">대시보드를 볼 권한이 없는 계정입니다.</NoteBox>}
    </PdaShell>
  );
}
