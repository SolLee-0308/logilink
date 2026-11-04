import type { Metadata } from "next";
import { HolidaysScreen } from "@/features/master/HolidaysScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { fmtDateTime } from "@/lib/format";
import { listCenters, listHolidays } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "휴무일" };
export const dynamic = "force-dynamic";

export default async function HolidaysPage() {
  const me = await requireUser();
  if (!can(me.roles, "holidays", "view")) return <Forbidden title="휴무일" />;
  const [rows, centers] = await Promise.all([listHolidays(), listCenters()]);
  // 한국 시간 기준 오늘
  const today = fmtDateTime(new Date()).slice(0, 10);
  return <HolidaysScreen rows={rows} centers={centers} today={today} canEdit={can(me.roles, "holidays", "edit")} />;
}
