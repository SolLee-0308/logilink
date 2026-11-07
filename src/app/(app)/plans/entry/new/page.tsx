import type { Metadata } from "next";
import { EntryNewScreen, type EntryMode } from "@/features/plans/entry/EntryNewScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { entryOptions } from "@/server/plans/entry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "입고예정 등록" };
export const dynamic = "force-dynamic";

const MODES: EntryMode[] = ["direct", "excel", "ai"];

/** 새 입고예정 — 직접 입력 / 엑셀 업로드 / 이미지 AI 판독 */
export default async function EntryNewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const options = can(me.roles, "planEntry", "edit") ? await entryOptions(me) : null;
  if (!options) return <Forbidden title="입고예정 등록" crumbs={["입고 계획", "입고예정 등록"]} />;
  const mode = (await searchParams).mode as EntryMode;
  return <EntryNewScreen options={options} defaultMode={MODES.includes(mode) ? mode : "direct"} />;
}
