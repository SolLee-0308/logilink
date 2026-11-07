import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InquiryDetailScreen } from "@/features/plans/inquiry/InquiryDetailScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { CANCEL_GROUP } from "@/domain/master";
import { todayKst } from "@/lib/format";
import { listCodeOptions } from "@/server/master/queries";
import { canInquiry, getInquiryDetail } from "@/server/plans/inquiry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "입고예정 조회 상세" };
export const dynamic = "force-dynamic";

/** 기한경과 취소 사유는 일마감 자동 처리 전용 — 사람이 고르는 목록에서 뺀다 */
const AUTO_ONLY = new Set(["X04"]);

/** 입고예정 조회 상세 — 라인별 입고·반송·잔량, 차량, 배분 이력, 처리 이력, 3PL 승인 건 취소 */
export default async function InquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canInquiry(me)) return <Forbidden title="입고예정 조회" crumbs={["입고 계획", "입고예정 조회"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [detail, reasons] = await Promise.all([getInquiryDetail(me, id), listCodeOptions(CANCEL_GROUP)]);
  if (!detail) notFound();
  return (
    <InquiryDetailScreen
      key={`${detail.id}-${detail.version}`}
      detail={detail}
      cancelReasons={reasons.filter((r) => !AUTO_ONLY.has(r.code))}
      today={todayKst()}
    />
  );
}
