import type { Metadata } from "next";
import { TplDashboardScreen } from "@/features/dashboard/TplDashboardScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { tplDashboard } from "@/server/dashboard/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "대시보드" };
export const dynamic = "force-dynamic";

/** 3PL 대시보드 — 오늘 할 일 · 오늘 흐름 · 주의할 건 · 일마감 상태 (2026-11-11 Sol). 화주사 대시보드는 다음 차례 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const data = await tplDashboard(me, typeof sp.center === "string" ? sp.center : "");
  if (!data) return <Forbidden title="대시보드" crumbs={["현황", "대시보드"]} />;
  return <TplDashboardScreen data={data} />;
}
