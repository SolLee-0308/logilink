import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoadConfirmSheet } from "@/features/loads/LoadConfirmSheet";
import { getLoadConfirmPrint } from "@/server/loads/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "상차확인서" };
export const dynamic = "force-dynamic";

/** 상차확인서 인쇄 (메뉴 없는 종이 화면) — 상차완료 실적만. 화주사 담당자는 자기 화주사, 3PL은 소속 센터 */
export default async function LoadConfirmPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = await getLoadConfirmPrint(me, id);
  if (!data) notFound();
  return <LoadConfirmSheet data={data} auto={(await searchParams).auto !== "0"} />;
}
