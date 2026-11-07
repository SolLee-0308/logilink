import type { Metadata } from "next";
import { ItemRequestsScreen } from "@/features/master/ItemRequestsScreen";
import { parseReqListQuery } from "@/features/master/item-request-list";
import { Forbidden } from "@/features/master/Forbidden";
import { can, canReviewItemRequests } from "@/domain/permissions";
import { listClientOptions, listItemKeys, listItemRequests } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "품목 등록 요청" };
export const dynamic = "force-dynamic";

/** 3PL: 요청 목록 → 상세에서 등록·반려 / 화주사: 내 요청 현황 → 상세에서 반려 건 재요청 */
export default async function ItemRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "itemRequests", "view")) return <Forbidden title="품목 등록 요청" />;
  const [rows, clients, itemKeys] = await Promise.all([listItemRequests(), listClientOptions(), listItemKeys()]);
  return (
    <ItemRequestsScreen
      rows={rows}
      clients={clients}
      itemKeys={itemKeys}
      canReview={canReviewItemRequests(me.roles)}
      initial={parseReqListQuery(await searchParams)}
    />
  );
}
