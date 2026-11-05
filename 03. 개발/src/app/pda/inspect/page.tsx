import type { Metadata } from "next";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaPending } from "@/features/pda/PdaPending";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "입고검수" };
export const dynamic = "force-dynamic";

/** PDA 입고검수 (정의서 ⑥) — 메뉴 자리만. 화면은 3단계(입차·실제 입고 건·PDA 검수)에서 만든다 */
export default async function PdaInspectPage() {
  const me = await requirePdaUser();
  return (
    <PdaShell user={me.name} org={me.clientName ?? me.centerName} roles={me.roles} tab="inspect">
      <PdaPending title="입고검수" />
    </PdaShell>
  );
}
