import type { Metadata } from "next";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaInspectHistoryScreen } from "@/features/pda/PdaInspectHistoryScreen";
import { NoteBox } from "@/components/ui/NoteBox";
import { todayKst } from "@/lib/format";
import { pdaRcvHistory } from "@/server/rcv/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "검수 내역" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** PDA 검수 내역 — 날짜별 검수 확정 차량, 눌러서 검수 결과·배분 다시 보기 */
export default async function PdaInspectHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const sp = await searchParams;
  const today = todayKst();
  const date = typeof sp.date === "string" && DATE.test(sp.date) && sp.date <= today ? sp.date : today;
  const history = await pdaRcvHistory(me, date);
  return (
    <PdaShell user={me.name} org={me.clientName ?? me.centerName} roles={me.roles} tab="inspects">
      {history ? <PdaInspectHistoryScreen history={history} /> : <NoteBox tone="error">검수 내역을 볼 권한이 없는 계정입니다.</NoteBox>}
    </PdaShell>
  );
}
