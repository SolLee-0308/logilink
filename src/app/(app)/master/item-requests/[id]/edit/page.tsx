import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ItemRequestDetailScreen } from "@/features/master/ItemRequestDetail";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { listItemRequests } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "품목 등록 재요청" };
export const dynamic = "force-dynamic";

/** 화주사 — 반려된 요청을 고쳐 다시 보낸다. 반려 상태가 아니면 상세로 돌려보낸다 */
export default async function ItemRequestEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me.roles, "itemRequests", "edit") || !me.clientId) return <Forbidden title="품목 등록 재요청" />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await listItemRequests(id);
  if (!row) notFound();
  if (row.status !== "REJECTED") redirect(`/master/item-requests/${row.id}`);
  return (
    <ItemRequestDetailScreen
      key={`${row.id}-${row.version}`}
      row={row}
      queue={{ position: null, total: 0, prevId: null, nextId: null, afterId: null }}
      itemKeys={[]}
      reasons={[]}
      canReview={false}
      clientName={me.clientName ?? ""}
      editing
    />
  );
}
