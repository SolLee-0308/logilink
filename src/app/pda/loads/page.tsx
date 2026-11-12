import { redirect } from "next/navigation";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 예전 PDA 상차내역 주소 (2026-11-12 Sol: 상차내역 메뉴를 상차등록에 합침)
 * 저장해 둔 주소·예전 링크로 들어와도 상차등록의 "상차완료" 거르기로 보낸다.
 */
export default async function PdaLoadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ st: "done" });
  if (typeof sp.date === "string" && DATE.test(sp.date)) q.set("date", sp.date);
  redirect(`/pda?${q}`);
}
