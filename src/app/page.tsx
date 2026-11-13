import { redirect } from "next/navigation";
import { homePathOf } from "@/domain/permissions";
import { dashboardReady, webWorkHome } from "@/lib/demo";
import { getSessionUser } from "@/server/session";

export const dynamic = "force-dynamic";

/** 로그인 후 첫 화면 — 역할마다 다르다 (로그인·비밀번호 변경 후 기본 이동 주소가 "/") */
export default async function Home() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  // 시연 링크는 대시보드를 막아 두므로 업무 첫 화면으로 (2026-11-13 Sol)
  redirect(dashboardReady() ? homePathOf(me.roles) : webWorkHome(me.roles));
}
