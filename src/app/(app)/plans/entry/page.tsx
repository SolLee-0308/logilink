import type { Metadata } from "next";
import { EntryListScreen } from "@/features/plans/entry/EntryListScreen";
import { parseEntryListQuery } from "@/features/plans/entry/entry-list";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { entryOptions, listMyPlans } from "@/server/plans/entry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "입고예정 등록" };
export const dynamic = "force-dynamic";

/** 화주사 입고예정 등록 — 승인 전 건 관리 + 새 등록 */
export default async function EntryListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "planEntry", "view") || !me.clientId) return <Forbidden title="입고예정 등록" crumbs={["입고 계획", "입고예정 등록"]} />;
  const [rows, options] = await Promise.all([listMyPlans(me), entryOptions(me)]);
  return (
    <EntryListScreen
      rows={rows}
      centers={options?.centers ?? []}
      defaultCenterId={options?.defaultCenterId ?? ""}
      today={todayKst()}
      initial={parseEntryListQuery(await searchParams)}
    />
  );
}
