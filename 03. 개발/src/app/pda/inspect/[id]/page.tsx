import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaInspectScreen } from "@/features/pda/PdaInspectScreen";
import { RCV_DIFF_GROUP } from "@/domain/master";
import { getPdaRcv } from "@/server/rcv/queries";
import { listCodeOptions } from "@/server/master/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "입고검수" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STS = new Set(["todo", "working", "done"]);

/** PDA 입고검수 작업 — 품목 스캔·추가 수량·0 확인·사유·사진·검수 확정 (정의서 ⑥ · C7). 입고검수 목록에서 열면 ← 가 그 날짜·보기로 */
export default async function PdaInspectWorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  // ← 는 들어온 입고검수 목록(날짜·보기)으로 (2026-11-12 Sol: 검수 내역을 입고검수에 합침)
  const back = new URLSearchParams();
  if (typeof sp.from === "string" && DATE.test(sp.from)) back.set("date", sp.from);
  if (typeof sp.st === "string" && STS.has(sp.st)) back.set("st", sp.st);
  const [rcv, reasons] = await Promise.all([getPdaRcv(me, id), listCodeOptions(RCV_DIFF_GROUP)]);
  if (!rcv) notFound();
  return (
    <PdaShell
      user={me.name}
      org={me.clientName ?? me.centerName}
      roles={me.roles}
      back={back.size ? `/pda/inspect?${back}` : "/pda/inspect"}
      title={rcv.status === "WORKING" ? "입고검수" : "검수 결과"}
    >
      <PdaInspectScreen key={rcv.id} initial={rcv} reasons={reasons} />
    </PdaShell>
  );
}
