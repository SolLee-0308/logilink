import type { Metadata } from "next";
import { RcvResultsScreen } from "@/features/rcv-results/RcvResultsScreen";
import type { RcvResultQuery } from "@/features/rcv-results/types";
import { Forbidden } from "@/features/master/Forbidden";
import { addDays } from "@/domain/inquiry-rules";
import { todayKst } from "@/lib/format";
import { can } from "@/domain/permissions";
import { RCV_CANCEL_GROUP } from "@/domain/master";
import { listCodeOptions } from "@/server/master/queries";
import { inquiryCenters } from "@/server/plans/inquiry";
import { canRcvResults, listRcvResults } from "@/server/rcv/results";
import { requireUser } from "@/server/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "입고검수 실적" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 입고검수 실적 (2026-11-12) — 3PL 조회 + 입고취소(3PL 관리자). ?tab=confirmed|working|canceled, ?from=&to= (업무일, "-"이면 비움).
 * 처음 조건: 확정 탭, 업무일 최근 7일(오늘 포함).
 */
export default async function RcvResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!canRcvResults(me)) return <Forbidden title="입고검수 실적" crumbs={["입고 운영", "입고검수 실적"]} />;
  const sp = await searchParams;
  const today = todayKst();
  const day = (v: unknown, dflt: string) => (v === "-" ? "" : typeof v === "string" && DATE.test(v) ? v : dflt);
  const one = (v: unknown) => (typeof v === "string" ? v : "");
  const q: RcvResultQuery = {
    tab: sp.tab === "working" ? "working" : sp.tab === "canceled" ? "canceled" : "confirmed",
    from: day(sp.from, addDays(today, -6)),
    to: day(sp.to, today),
    client: /^\d+$/.test(one(sp.client)) ? one(sp.client) : "",
    center: /^\d+$/.test(one(sp.center)) ? one(sp.center) : "",
    closed: sp.closed === "open" || sp.closed === "closed" ? sp.closed : "all",
    issue: sp.issue === "issue" ? "issue" : "all",
    q: one(sp.q).slice(0, 50),
  };
  const canCancel = can(me.roles, "rcvResults", "edit");
  const [rows, centers, reasons, client] = await Promise.all([
    listRcvResults(me, q),
    inquiryCenters(me),
    canCancel ? listCodeOptions(RCV_CANCEL_GROUP) : [],
    q.client ? db.client.findUnique({ where: { id: Number(q.client) }, select: { id: true, name: true } }) : null,
  ]);
  return <RcvResultsScreen query={q} rows={rows} centers={centers} today={today} canCancel={canCancel} cancelReasons={reasons} initialClient={client} />;
}
