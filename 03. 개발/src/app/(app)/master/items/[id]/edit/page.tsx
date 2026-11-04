import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemEditScreen } from "@/features/master/ItemPages";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { listItems } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "품목 수정" };
export const dynamic = "force-dynamic";

/** 3PL 품목 수정 — 열 때마다 최신 내용·version을 읽는다 */
export default async function ItemEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me.roles, "items", "edit")) return <Forbidden title="품목 수정" />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await listItems(id);
  if (!row) notFound();
  return <ItemEditScreen row={row} />;
}
