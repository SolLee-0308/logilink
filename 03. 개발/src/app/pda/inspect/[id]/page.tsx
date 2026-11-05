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

/** PDA 입고검수 작업 — 품목 스캔·추가 수량·0 확인·사유·사진·검수 확정 (정의서 ⑥ · C7). 검수 내역에서 열면 ← 가 검수 내역으로 */
export default async function PdaInspectWorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  const from = typeof sp.from === "string" && DATE.test(sp.from) ? sp.from : null;
  const [rcv, reasons] = await Promise.all([getPdaRcv(me, id), listCodeOptions(RCV_DIFF_GROUP)]);
  if (!rcv) notFound();
  return (
    <PdaShell
      user={me.name}
      org={me.clientName ?? me.centerName}
      roles={me.roles}
      back={from ? `/pda/inspect/history?date=${from}` : "/pda/inspect"}
      title={rcv.status === "WORKING" ? "입고검수" : "검수 결과"}
    >
      <PdaInspectScreen key={rcv.id} initial={rcv} reasons={reasons} />
    </PdaShell>
  );
}
