import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoadOrderSheet } from "@/features/asn/LoadOrderSheet";
import { can } from "@/domain/permissions";
import { getLoadOrderPrint } from "@/server/asn/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "상차지시서" };
export const dynamic = "force-dynamic";

/** 상차지시서 인쇄 (메뉴·사이드바 없는 종이 화면) — 자기 화주사 ASN만 */
export default async function LoadOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  if (!can(me.roles, "asn", "view") || !me.clientId) notFound();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = await getLoadOrderPrint(me, id);
  if (!data) notFound();
  return <LoadOrderSheet data={data} auto={(await searchParams).auto !== "0"} />;
}
