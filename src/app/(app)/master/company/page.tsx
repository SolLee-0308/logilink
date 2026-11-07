import type { Metadata } from "next";
import { Forbidden } from "@/features/master/Forbidden";
import { CompanyScreen } from "@/features/master/CompanyScreen";
import { can } from "@/domain/permissions";
import { getCompany } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "회사 정보" };
export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  const me = await requireUser();
  if (!can(me.roles, "company", "view")) return <Forbidden title="회사 정보" />;
  return <CompanyScreen company={await getCompany()} canEdit={can(me.roles, "company", "edit")} />;
}
