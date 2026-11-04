import type { Metadata } from "next";
import { ItemNewScreen } from "@/features/master/ItemPages";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { listClientOptions } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "품목 등록" };
export const dynamic = "force-dynamic";

/** 3PL 품목 등록 — 단건 / 엑셀 일괄 (화주사는 품목 등록 요청 화면에서 신청) */
export default async function ItemNewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "items", "edit")) return <Forbidden title="품목 등록" />;
  const sp = await searchParams;
  return (
    <ItemNewScreen
      clients={await listClientOptions()}
      defaultClientId={typeof sp.client === "string" ? sp.client : ""}
      defaultMode={sp.mode === "excel" ? "excel" : "single"}
    />
  );
}
