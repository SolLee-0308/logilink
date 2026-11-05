import type { Metadata } from "next";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaPending } from "@/features/pda/PdaPending";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "검수 내역" };
export const dynamic = "force-dynamic";

/** PDA 검수 내역 — 메뉴 자리만. 입고검수와 함께 만든다 */
export default async function PdaInspectHistoryPage() {
  const me = await requirePdaUser();
  return (
    <PdaShell user={me.name} org={me.clientName ?? me.centerName} roles={me.roles} tab="inspects">
      <PdaPending title="검수 내역" />
    </PdaShell>
  );
}
