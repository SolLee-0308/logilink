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
const STS = new Set(["todo", "working", "done"]);

/** PDA 상차 작업 — 품목 스캔·추가수량 입력·본인 입력 정정·상차완료 (정의서 ④ · C5 · C6). 상차등록 목록에서 열면 ← 가 그 날짜·거르기로 */
export default async function PdaLoadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  // ← 는 들어온 상차등록 목록(날짜·거르기)으로 돌아간다 (2026-11-12 Sol: 상차내역을 상차등록에 합침)
  const back = new URLSearchParams();
  if (typeof sp.from === "string" && DATE.test(sp.from)) back.set("date", sp.from);
  if (typeof sp.st === "string" && STS.has(sp.st)) back.set("st", sp.st);
  const [load, reasons, reopenReasons] = await Promise.all([getPdaLoad(me, id), listCodeOptions(LOAD_DIFF_GROUP), listCodeOptions(LOAD_REOPEN_GROUP)]);
  if (!load) notFound();
  return (
    <PdaShell user={me.name} org={me.clientName} roles={me.roles} back={back.size ? `/pda?${back}` : "/pda"} title={load.status === "WORKING" ? "상차 작업" : "상차확인서"}>
      <PdaLoadScreen key={load.id} initial={load} reasons={reasons} reopenReasons={reopenReasons} />
    </PdaShell>
  );
}
