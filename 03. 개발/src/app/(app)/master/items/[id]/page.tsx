import { redirect } from "next/navigation";

/** 예전 상세 주소 — 목록에서 그 품목을 선택한 상태로 보낸다 */
export default async function ItemDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  redirect(Number.isInteger(id) && id > 0 ? `/master/items?item=${id}` : "/master/items");
}
