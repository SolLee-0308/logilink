import { AppShell } from "@/components/layout/AppShell";
import { ORG_LABEL, ROLE_META, rolesLabel } from "@/domain/master";
import { countWaitingItemRequests } from "@/server/master/queries";
import { countApprovalWaiting } from "@/server/plans/queries";
import { countMyRejected } from "@/server/plans/entry";
import { requireUser } from "@/server/session";

// 로그인 사용자·사이드바 건수는 요청마다 DB에서 읽는다
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [itemRequestWaiting, approvalWaiting, planRejected] = await Promise.all([countWaitingItemRequests(), countApprovalWaiting(me), countMyRejected(me)]);
  const meta = ROLE_META[me.roles[0]];
  const viewer = {
    name: me.name,
    roles: me.roles,
    roleLabel: rolesLabel(me.roles),
    orgLabel: `${ORG_LABEL[meta.org]} · ${me.clientName ?? me.centerName ?? ""}`,
  };
  return (
    <AppShell serverCounts={{ itemRequestWaiting, approvalWaiting, planRejected }} viewer={viewer}>
      {children}
    </AppShell>
  );
}
