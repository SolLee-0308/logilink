import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PdaHomeScreen } from "@/features/pda/PdaHomeScreen";
import { PdaShell } from "@/features/pda/PdaShell";
import { Icon } from "@/features/pda/PdaParts";
import styles from "@/features/pda/Pda.module.css";
import { isInspector } from "@/features/pda/menu";
import { NoteBox } from "@/components/ui/NoteBox";
import { pdaHome } from "@/server/loads/queries";
import { requirePdaUser } from "@/server/session";

export const metadata: Metadata = { title: "상차등록" };
export const dynamic = "force-dynamic";

/** PDA 첫 화면 — 상차담당은 상차등록, 입고검수자는 입고검수로 (2026-11-05 PDA 메뉴 확정) */
export default async function PdaHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePdaUser();
  const home = await pdaHome(me);
  const openFree = (await searchParams).free === "1";
  if (!home && isInspector(me.roles)) redirect("/pda/inspect");
  return (
    <PdaShell
      user={me.name}
      org={me.clientName}
      roles={me.roles}
      tab="load"
      // [무지시 상차]는 머리 오른쪽 (2026-11-06 Sol: 예전 로그아웃 자리)
      action={
        home ? (
          <Link href="/pda?free=1" className={styles.barPill} scroll={false}>
            <Icon name="truck" size={16} /> 무지시 상차
          </Link>
        ) : undefined
      }
    >
      {home ? <PdaHomeScreen home={home} openFree={openFree} /> : <NoteBox tone="error">상차등록 권한이 없는 계정입니다. 관리자에게 화주사 상차담당 역할을 요청하세요.</NoteBox>}
    </PdaShell>
  );
}
