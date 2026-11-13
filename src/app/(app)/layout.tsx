import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/AppShell";
import { dashboardReady } from "@/lib/demo";
import { NAV_COOKIE } from "@/components/layout/nav-cookie";
import { ORG_LABEL, ROLE_META, rolesLabel } from "@/domain/master";
import { isShipperRole } from "@/domain/permissions";
import { countRejectedItemRequests, countWaitingItemRequests } from "@/server/master/queries";
import { countApprovalWaiting } from "@/server/plans/queries";
import { countMyRejected } from "@/server/plans/entry";
import { requireUser } from "@/server/session";

// 로그인 사용자·사이드바 건수는 요청마다 DB에서 읽는다
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [itemRequestWaiting, itemRequestRejected, approvalWaiting, planRejected] = await Promise.all([
    countWaitingItemRequests(),
    isShipperRole(me.roles) ? countRejectedItemRequests() : Promise.resolve(0),
    countApprovalWaiting(me),
    countMyRejected(me),
  ]);
  const navCollapsed = (await cookies()).get(NAV_COOKIE)?.value === "collapsed";
  const meta = ROLE_META[me.roles[0]];
  const viewer = {
    name: me.name,
    roles: me.roles,
    roleLabel: rolesLabel(me.roles),
    orgLabel: `${ORG_LABEL[meta.org]} · ${me.clientName ?? me.centerName ?? ""}`,
    dashboardReady: dashboardReady(),
  };
  return (
    <AppShell serverCounts={{ itemRequestWaiting, itemRequestRejected, approvalWaiting, planRejected }} viewer={viewer} navCollapsed={navCollapsed}>
      {children}
    </AppShell>
  );
}
