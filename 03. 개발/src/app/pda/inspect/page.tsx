import type { Metadata } from "next";
import { PdaShell } from "@/features/pda/PdaShell";
import { PdaInspectHomeScreen } from "@/features/pda/PdaInspectHomeScreen";
import { NoteBox } from "@/components/ui/NoteBox";
import type { PdaRcvFilter } from "@/features/rcv/types";
import { pdaRcvHome } from "@/server/rcv/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "입고검수" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS: readonly PdaRcvFilter[] = ["all", "todo", "working", "done"];

/**
 * PDA 입고검수 첫 화면 (정의서 ⑥) — 상차확인서·상차지시서 스캔 또는 차량번호로 시작, 상차완료 차량만
 * 2026-11-12 Sol: 검수 내역을 합침 — ?date=YYYY-MM-DD (오늘 이하), ?st=all|todo|working|done (기본 전체)
 */
export default async function PdaInspectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const sp = await searchParams;
  const date = typeof sp.date === "string" && DATE.test(sp.date) ? sp.date : undefined;
  const filter = FILTERS.find((f) => f === sp.st) ?? "all";
  const home = await pdaRcvHome(me, date);
  return (
    <PdaShell user={me.name} org={me.clientName ?? me.centerName} roles={me.roles} tab="inspect">
      {home ? <PdaInspectHomeScreen home={home} filter={filter} /> : <NoteBox tone="error">입고검수 권한이 없는 계정입니다. 관리자에게 3PL 입고검수자 역할을 요청하세요.</NoteBox>}
    </PdaShell>
  );
}
