import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdaLoadScreen } from "@/features/pda/PdaLoadScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { LOAD_DIFF_GROUP, LOAD_REOPEN_GROUP } from "@/domain/master";
import { getPdaLoad } from "@/server/loads/queries";
import { listCodeOptions } from "@/server/master/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "상차 작업" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** PDA 상차 작업 — 품목 스캔·추가수량 입력·본인 입력 정정·상차완료 (정의서 ④ · C5 · C6). 상차내역에서 열면 ← 가 상차내역으로 */
export default async function PdaLoadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  const from = typeof sp.from === "string" && DATE.test(sp.from) ? sp.from : null;
  const [load, reasons, reopenReasons] = await Promise.all([getPdaLoad(me, id), listCodeOptions(LOAD_DIFF_GROUP), listCodeOptions(LOAD_REOPEN_GROUP)]);
  if (!load) notFound();
  return (
    <PdaShell user={me.name} org={me.clientName} roles={me.roles} back={from ? `/pda/loads?date=${from}` : "/pda"} title={load.status === "WORKING" ? "상차 작업" : "상차확인서"}>
      <PdaLoadScreen key={load.id} initial={load} reasons={reasons} reopenReasons={reopenReasons} />
    </PdaShell>
  );
}
