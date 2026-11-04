import type { Metadata } from "next";
import { HolidaysScreen } from "@/features/master/HolidaysScreen";
import { fmtDateTime } from "@/lib/format";
import { listCenters, listHolidays } from "@/server/master/queries";

export const metadata: Metadata = { title: "휴무일" };
export const dynamic = "force-dynamic";

export default async function HolidaysPage() {
  const [rows, centers] = await Promise.all([listHolidays(), listCenters()]);
  // 한국 시간 기준 오늘
  const today = fmtDateTime(new Date()).slice(0, 10);
  return <HolidaysScreen rows={rows} centers={centers} today={today} />;
}
