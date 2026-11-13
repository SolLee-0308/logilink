import type { Metadata } from "next";
import { ClosingScreen } from "@/features/closing/ClosingScreen";
import type { ClosingTab } from "@/features/closing/types";
import { Forbidden } from "@/features/master/Forbidden";
import { REMAIN_CLOSE_GROUP } from "@/domain/master";
import { todayKst } from "@/lib/format";
import { listCodeOptions } from "@/server/master/queries";
import { canClosing, dailyCloseView, listRemainClose } from "@/server/plans/closing";
import { alertDays, inquiryCenters } from "@/server/plans/inquiry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "잔량 종결·일마감" };
export const dynamic = "force-dynamic";

/** 잔량 종결·일마감 (정의서 ⑦, 2026-11-12) — 3PL 관리자·운영담당. ?tab=daily 는 일마감(&center= 센터 고르기) */
export default async function ClosingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!canClosing(me)) return <Forbidden title="잔량 종결·일마감" crumbs={["입고 운영", "잔량 종결·일마감"]} />;
  const sp = await searchParams;
  const tab: ClosingTab = sp.tab === "daily" ? "daily" : "remain";
  // 일마감 탭 건수(⚠ 기한경과)를 보이려고 두 탭 데이터를 함께 읽는다 — 미종결·센터 수가 적다
  const [rows, reasons, days, centers, daily] = await Promise.all([
    listRemainClose(me),
    listCodeOptions(REMAIN_CLOSE_GROUP),
    alertDays(),
    inquiryCenters(me),
    dailyCloseView(me, typeof sp.center === "string" ? sp.center : ""),
  ]);
  return <ClosingScreen tab={tab} rows={rows} reasons={reasons} alertDays={days} today={todayKst()} centers={centers} daily={daily} />;
}
