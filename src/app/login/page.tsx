import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/AuthCard";
import { LoginForm } from "@/features/auth/LoginForm";
import { getSessionUser } from "@/server/session";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

const safeNext = (v: string | string[] | undefined) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") && !s.startsWith("/login") ? s : "/";
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  const me = await getSessionUser();
  if (me) redirect(me.mustChangePw ? "/change-password" : next);
  return (
    <AuthCard title="로그인" desc="3PL·화주사 Web 계정으로 로그인하세요.">
      <LoginForm next={next} />
    </AuthCard>
  );
}
