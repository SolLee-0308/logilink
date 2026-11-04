import { redirect } from "next/navigation";

/** 예전 엑셀 일괄 요청 주소 — 등록 요청 화면의 [엑셀 일괄 요청] 탭으로 보낸다 */
export default function ItemRequestUploadRedirect() {
  redirect("/master/item-requests/new?mode=excel");
}
