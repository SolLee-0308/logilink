import { redirect } from "next/navigation";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 예전 PDA 검수 내역 주소 (2026-11-12 Sol: 검수 내역 메뉴를 입고검수에 합침)
 * 저장해 둔 주소·예전 링크로 들어와도 입고검수의 "완료" 보기로 보낸다.
 */
export default async function PdaInspectHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ st: "done" });
  if (typeof sp.date === "string" && DATE.test(sp.date)) q.set("date", sp.date);
  redirect(`/pda/inspect?${q}`);
}
