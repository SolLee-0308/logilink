import type { Metadata } from "next";
import { InquiryScreen } from "@/features/plans/inquiry/InquiryScreen";
import { parseInquiryQuery } from "@/features/plans/inquiry/inquiry-list";
import { Forbidden } from "@/features/master/Forbidden";
import { isShipperRole } from "@/domain/permissions";
import { todayKst } from "@/lib/format";
import { db } from "@/server/db";
import { alertDays, canInquiry, countInquiryStates, countOverdue, inquiryCenters, listInquiryPlans, listInquiryVehicles } from "@/server/plans/inquiry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "입고예정 조회" };
export const dynamic = "force-dynamic";

/** 입고예정 조회 (정의서 ⑤) — 화주사 담당자·3PL 관리자·운영담당 공통. 상태 탭 + 보기 전환(입고예정별·차량별) */
export default async function InquiryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!canInquiry(me)) return <Forbidden title="입고예정 조회" crumbs={["입고 계획", "입고예정 조회"]} />;
  const today = todayKst();
  const q = parseInquiryQuery(await searchParams, today);
  const shipper = isShipperRole(me.roles);
  const days = await alertDays();
  const [plans, vehicles, stateCounts, overdue, centers, client] = await Promise.all([
    q.tab === "plan" ? listInquiryPlans(me, q) : [],
    q.tab === "vehicle" ? listInquiryVehicles(me, q) : [],
    countInquiryStates(me, q),
    countOverdue(me, q, days),
    inquiryCenters(me),
    q.client && !shipper ? db.client.findUnique({ where: { id: Number(q.client) }, select: { id: true, name: true } }) : null,
  ]);
  return (
    <InquiryScreen
      initial={q}
      initialClient={client}
      plans={plans}
      vehicles={vehicles}
      stateCounts={stateCounts}
      overdueCount={overdue}
      alertDays={days}
      centers={centers}
      shipper={shipper}
      multiCenter={centers.length > 1}
      today={today}
    />
  );
}
