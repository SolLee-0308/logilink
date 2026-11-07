import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EntryEditScreen } from "@/features/plans/entry/EntryEditScreen";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { canShipperEdit } from "@/domain/plan-rules";
import { getPlanDetail } from "@/server/plans/queries";
import { catalogByIds, entryOptions } from "@/server/plans/entry";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "입고예정 수정" };
export const dynamic = "force-dynamic";

/** 입고예정 수정·재요청 — 승인 전(승인대기·반려)만. 그 밖의 상태면 상세로 돌려보낸다 */
export default async function EntryEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const options = can(me.roles, "planEntry", "edit") ? await entryOptions(me) : null;
  if (!options) return <Forbidden title="입고예정 수정" crumbs={["입고 계획", "입고예정 등록"]} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getPlanDetail(me, id);
  if (!detail) notFound();
  if (!canShipperEdit(detail.status)) redirect(`/plans/entry/${id}`);
  const items = await catalogByIds(me.clientId!, detail.lines.map((l) => l.itemId));
  return <EntryEditScreen detail={detail} options={{ ...options, items }} />;
}
