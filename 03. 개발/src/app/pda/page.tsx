import type { Metadata } from "next";
import { PdaHomeScreen } from "@/features/pda/PdaHomeScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { NoteBox } from "@/components/ui/NoteBox";
import { pdaHome } from "@/server/loads/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "상차등록" };
export const dynamic = "force-dynamic";

/** PDA 첫 화면 — 상차지시서 스캔(지시 상차) 또는 무지시 상차 시작 (정의서 ④) */
export default async function PdaHomePage() {
  const me = await requirePdaUser();
  const home = await pdaHome(me);
  return (
    <PdaShell user={me.name} org={me.clientName}>
      {home ? <PdaHomeScreen home={home} /> : <NoteBox tone="error">상차등록 권한이 없는 계정입니다. 관리자에게 화주사 상차담당 역할을 요청하세요.</NoteBox>}
    </PdaShell>
  );
}
