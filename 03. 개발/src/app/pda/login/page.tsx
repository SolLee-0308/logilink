import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/AuthCard";
import { LoginForm } from "@/features/auth/LoginForm";
import { getPdaSessionUser } from "@/server/session";
import { dashboardReady, pdaWorkHome } from "@/lib/demo";

export const metadata: Metadata = { title: "PDA 로그인" };
export const dynamic = "force-dynamic";

const safeNext = (v: string | string[] | undefined) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/pda/") && !s.startsWith("/pda/login") ? s : "/pda/dashboard"; // 첫 화면 = 대시보드 (2026-11-06 Sol)
};

/** PDA 로그인 — 화주사 상차담당 등 PDA 역할이 있는 계정 */
export default async function PdaLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  const me = await getPdaSessionUser();
  // 시연 링크는 PDA 대시보드를 막아 두므로 업무 첫 화면으로 (2026-11-13 Sol)
  const dest = me && next === "/pda/dashboard" && !dashboardReady() ? pdaWorkHome(me.roles) : next;
  if (me) redirect(me.mustChangePw ? `/change-password?next=${encodeURIComponent(dest)}` : dest);
  return (
    <AuthCard title="PDA 로그인" desc="상차담당 계정으로 로그인하세요.">
      <LoginForm next={next} pda />
    </AuthCard>
  );
}
