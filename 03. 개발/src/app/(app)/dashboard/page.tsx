import type { Metadata } from "next";
import { ShipperDashboardScreen } from "@/features/dashboard/ShipperDashboardScreen";
import { TplDashboardScreen } from "@/features/dashboard/TplDashboardScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { isShipperRole } from "@/domain/permissions";
import { shipperDashboard, tplDashboard } from "@/server/dashboard/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "대시보드" };
export const dynamic = "force-dynamic";

/** 웹 대시보드 (2026-11-11) — 3PL: 오늘 할 일·흐름·주의 건·일마감 상태 / 화주사: 할 일·흐름·주의 건·이용 센터 기준 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const center = (await searchParams).center;
  const centerParam = typeof center === "string" ? center : "";
  if (isShipperRole(me.roles)) {
    const data = await shipperDashboard(me, centerParam);
    return data ? <ShipperDashboardScreen data={data} /> : <Forbidden title="대시보드" crumbs={["현황", "대시보드"]} />;
  }
  const data = await tplDashboard(me, centerParam);
  return data ? <TplDashboardScreen data={data} /> : <Forbidden title="대시보드" crumbs={["현황", "대시보드"]} />;
}
