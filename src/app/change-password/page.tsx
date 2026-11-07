import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/AuthCard";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { getAnySessionUser, loginUrl } from "@/server/session";

export const metadata: Metadata = { title: "비밀번호 변경" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getAnySessionUser();
  if (!me) redirect(await loginUrl("/change-password"));
  const raw = (await searchParams).next;
  const goto = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return (
    <AuthCard
      title="비밀번호 변경"
      desc={
        me.mustChangePw
          ? `${me.name}님, 관리자가 비밀번호를 초기화했습니다. 계속하려면 새 비밀번호로 바꾸세요.`
          : `${me.name}님의 비밀번호를 바꿉니다.`
      }
    >
      <ChangePasswordForm goto={goto} />
    </AuthCard>
  );
}
