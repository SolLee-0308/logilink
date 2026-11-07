import { redirect } from "next/navigation";

/** 예전 엑셀 일괄 등록 주소 — 품목 등록 화면의 [엑셀로 여러 품목]으로 보낸다 */
export default async function ItemUploadRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = (await searchParams).client;
  redirect(`/master/items/new?mode=excel${typeof client === "string" ? `&client=${encodeURIComponent(client)}` : ""}`);
}
