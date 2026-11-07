import type { Metadata } from "next";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaInspectHomeScreen } from "@/features/pda/PdaInspectHomeScreen";
import { NoteBox } from "@/components/ui/NoteBox";
import { pdaRcvHome } from "@/server/rcv/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "입고검수" };
export const dynamic = "force-dynamic";

/** PDA 입고검수 첫 화면 (정의서 ⑥) — 상차확인서·상차지시서 스캔 또는 차량번호로 시작, 상차완료 차량만 */
export default async function PdaInspectPage() {
  const me = await requirePdaUser();
  const home = await pdaRcvHome(me);
  return (
    <PdaShell user={me.name} org={me.clientName ?? me.centerName} roles={me.roles} tab="inspect">
      {home ? <PdaInspectHomeScreen home={home} /> : <NoteBox tone="error">입고검수 권한이 없는 계정입니다. 관리자에게 3PL 입고검수자 역할을 요청하세요.</NoteBox>}
    </PdaShell>
  );
}
