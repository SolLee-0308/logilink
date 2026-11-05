import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdaLoadScreen } from "@/features/pda/PdaLoadScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { LOAD_DIFF_GROUP } from "@/domain/master";
import { getPdaLoad } from "@/server/loads/queries";
import { listCodeOptions } from "@/server/master/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "상차 작업" };
export const dynamic = "force-dynamic";

/** PDA 상차 작업 — 품목 스캔·추가수량 입력·본인 입력 정정·상차완료 (정의서 ④ · C5 · C6) */
export default async function PdaLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePdaUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [load, reasons] = await Promise.all([getPdaLoad(me, id), listCodeOptions(LOAD_DIFF_GROUP)]);
  if (!load) notFound();
  return (
    <PdaShell user={me.name} org={me.clientName} back>
      <PdaLoadScreen key={load.id} initial={load} reasons={reasons} />
    </PdaShell>
  );
}
