import type { Metadata } from "next";
import { ItemRequestNewScreen } from "@/features/master/ItemPages";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "품목 등록 요청" };
export const dynamic = "force-dynamic";

/** 화주사 품목 등록 요청 — 단건 / 엑셀 일괄 */
export default async function ItemRequestNewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "itemRequests", "edit") || !me.clientId) return <Forbidden title="품목 등록 요청" />;
  const mode = (await searchParams).mode;
  return <ItemRequestNewScreen clientName={me.clientName ?? ""} defaultMode={mode === "excel" ? "excel" : "single"} />;
}
