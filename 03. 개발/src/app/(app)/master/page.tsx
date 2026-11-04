import { redirect } from "next/navigation";
import { can } from "@/domain/permissions";
import { requireUser } from "@/server/session";

/** 기준정보 첫 화면 — 볼 수 있는 첫 메뉴로 보낸다 */
export default async function MasterHome() {
  const me = await requireUser();
  redirect(can(me.role, "company", "view") ? "/master/company" : "/master/items");
}
