import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemRequestDetailScreen } from "@/features/master/ItemRequestDetail";
import { Forbidden } from "@/features/master/Forbidden";
import { ITEM_REQ_REJECT_GROUP } from "@/domain/master";
import { can, canReviewItemRequests } from "@/domain/permissions";
import { itemRequestQueue, listCodeOptions, listItemKeys, listItemRequests } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "품목 등록 요청 상세" };
export const dynamic = "force-dynamic";

/** 품목 등록 요청 상세 — 열 때마다 최신 내용·version을 읽는다. 화주사는 자기 요청만 */
export default async function ItemRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me.roles, "itemRequests", "view")) return <Forbidden title="품목 등록 요청" />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await listItemRequests(id);
  if (!row) notFound();
  const canReview = canReviewItemRequests(me.roles);
  const [queue, itemKeys, reasons] = await Promise.all([
    itemRequestQueue(row),
    canReview ? listItemKeys(row.clientId) : Promise.resolve([]),
    canReview ? listCodeOptions(ITEM_REQ_REJECT_GROUP) : Promise.resolve([]),
  ]);
  return (
    <ItemRequestDetailScreen
      key={`${row.id}-${row.version}`}
      row={row}
      queue={queue}
      itemKeys={itemKeys}
      reasons={reasons}
      canReview={canReview}
      clientName={me.clientName ?? ""}
    />
  );
}
