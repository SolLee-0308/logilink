import type { Metadata } from "next";
import { PdaHistoryScreen } from "@/features/pda/PdaHistoryScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { NoteBox } from "@/components/ui/NoteBox";
import { todayKst } from "@/lib/format";
import { pdaLoadHistory } from "@/server/loads/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "상차내역" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** PDA 상차내역 — 날짜별 상차완료 차량, 눌러서 상차확인서 번호·바코드 다시 보기 */
export default async function PdaLoadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const sp = await searchParams;
  const today = todayKst();
  const date = typeof sp.date === "string" && DATE.test(sp.date) && sp.date <= today ? sp.date : today;
  const history = await pdaLoadHistory(me, date);
  return (
    <PdaShell user={me.name} org={me.clientName} roles={me.roles} tab="loads">
      {history ? <PdaHistoryScreen history={history} /> : <NoteBox tone="error">상차내역을 볼 권한이 없는 계정입니다.</NoteBox>}
    </PdaShell>
  );
}
