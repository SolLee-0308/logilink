import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PdaHomeScreen } from "@/features/pda/PdaHomeScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { isInspector } from "@/features/pda/menu";
import { NoteBox } from "@/components/ui/NoteBox";
import { pdaHome } from "@/server/loads/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "상차등록" };
export const dynamic = "force-dynamic";

/** PDA 첫 화면 — 상차담당은 상차등록, 입고검수자는 입고검수로 (2026-11-05 PDA 메뉴 확정) */
export default async function PdaHomePage() {
  const me = await requirePdaUser();
  const home = await pdaHome(me);
  if (!home && isInspector(me.roles)) redirect("/pda/inspect");
  return (
    <PdaShell user={me.name} org={me.clientName} roles={me.roles} tab="load">
      {home ? <PdaHomeScreen home={home} /> : <NoteBox tone="error">상차등록 권한이 없는 계정입니다. 관리자에게 화주사 상차담당 역할을 요청하세요.</NoteBox>}
    </PdaShell>
  );
}
