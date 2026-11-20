"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { fmtShortDateTime } from "@/lib/format";
import { HeadActions, More, Tile, TrendChart, VehicleFlow, WatchGrid, centerCol, clientCol } from "./DashboardParts";
import type { DashAsnRow, DashPlanRow, DashRcvRow, TplDashboard } from "./types";
import styles from "./Dashboard.module.css";

/**
 * 3PL 대시보드 (2026-11-17 Sol 재구성, 시안 v0.1) — 처리할 일 · 오늘 차량 흐름 · 주의할 건 · 추이(14업무일).
 * 숫자 칸·범례·목록 줄을 누르면 해당 화면으로 간다. "오늘" = 센터별 업무일. 일마감 상태는 머리 줄에.
 */
export function TplDashboardScreen({ data }: { data: TplDashboard }) {
  const router = useRouter();
  const { todo, flow, watch, centers, trend } = data;
  const multi = centers.length > 1;
  const today = centers[0]?.businessDate ?? "";

  return (
    <>
      <PageHeader crumbs={["현황", "대시보드"]} title="대시보드" actions={<HeadActions {...data} showClose />} />

      <div className={styles.page}>
        {/* ① 처리할 일 */}
        <section aria-labelledby="dash-todo">
          <h2 id="dash-todo" className={styles.secTitle}>
            처리할 일
          </h2>
          <div className={styles.tiles}>
            <Tile href="/plans/approval" label="승인 대기" value={todo.approvalWaiting} unit="건" note="승인·반려할 입고예정" />
            <Tile href="/master/item-requests" label="품목 등록 요청" value={todo.itemRequests} unit="건" note="화주사가 요청한 신규 품목" />
            <Tile
              href="/plans/asn-status?tab=loaded"
              label="도착·검수 대기"
              value={todo.arrivedWaiting}
              unit="대"
              note={
                <>
                  입차했고 검수 시작 전 · 오는 중 <span className="mono">{todo.onTheWay}</span>대
                </>
              }
            />
            <Tile href="/rcv-results?tab=working&from=-&to=-" label="검수 중" value={todo.inspecting} unit="대" note="PDA에서 검수 진행 중" />
            <Tile href="#dash-expire" label="기한경과 취소 대상" value={todo.expireTargets} unit="건" note="오늘 일마감 때 취소될 승인 전 건" danger />
          </div>
        </section>

        {/* ② 오늘 차량 흐름 */}
        <VehicleFlow
          flow={flow}
          title="오늘 차량 흐름"
          note="오늘 출고일인 ASN 차량과 오늘 상차한 무지시 차량입니다. 범례를 누르면 그 상태의 목록으로 갑니다."
          links={{
            waiting: "/plans/asn-status?tab=wait",
            loading: "/plans/asn-status?tab=loading",
            onTheWay: "/plans/asn-status?tab=loaded",
            arrived: "/rcv-results?tab=working&from=-&to=-",
            received: `/rcv-results?from=${today}&to=${today}`,
          }}
        />

        {/* ③ 주의할 건 */}
        <WatchGrid
          items={[
            {
              key: "expire",
              anchorId: "dash-expire",
              title: "기한경과 취소 대상",
              count: watch.expireCount,
              grow: 2,
              description: "승인 전(승인대기·반려)이고 유예 영업일이 지난 건입니다. 오늘 일마감 때 취소됩니다. 살릴 건은 마감 전에 승인하세요.",
              body: (
                <>
                  <DataTable
                    compact
                    caption="기한경과 취소 대상"
                    columns={expireColumns(multi)}
                    rows={watch.expire}
                    rowKey={(r) => String(r.id)}
                    onActivate={(k) => router.push(`/plans/approval/${k}`)}
                    empty="오늘 취소될 건이 없습니다."
                  />
                  <More shown={watch.expire.length} total={watch.expireCount} href="/plans/approval" />
                </>
              ),
            },
            {
              key: "issueRcv",
              title: "오늘 검수 차이",
              count: watch.issueCount,
              grow: 1.2,
              description: "부족·초과·훼손·품목 불일치가 있었던 검수 확정 차량입니다.",
              body: (
                <>
                  <DataTable
                    compact
                    caption="오늘 검수 차이"
                    columns={rcvColumns(multi)}
                    rows={watch.issueRcv}
                    rowKey={(r) => r.href}
                    onActivate={(k) => router.push(k)}
                    empty="차이 난 차량이 없습니다."
                  />
                  <More shown={watch.issueRcv.length} total={watch.issueCount} href={`/rcv-results?from=${today}&to=${today}&issue=issue`} />
                </>
              ),
            },
            {
              key: "overdueAsn",
              title: "출고일 지난 상차 대기",
              count: watch.overdueAsnCount,
              grow: 1.5,
              description: "출고일이 지났는데 상차를 시작하지 않은 ASN 차량입니다. 화주사에 상황을 확인하세요.",
              body: (
                <>
                  <DataTable
                    compact
                    caption="출고일 지난 상차 대기"
                    columns={asnColumns(multi)}
                    rows={watch.overdueAsn}
                    rowKey={(r) => String(r.id)}
                    onActivate={(k) => router.push(`/plans/asn-status/${k}`)}
                    empty="없습니다."
                  />
                  <More shown={watch.overdueAsn.length} total={watch.overdueAsnCount} href="/plans/asn-status?tab=wait" />
                </>
              ),
            },
            {
              key: "unclosed",
              title: "오래된 미종결 입고예정",
              count: watch.unclosedOverdue,
              grow: 1,
              description: `승인·부분입고 상태로 입고예정일에서 ${watch.alertDays}일 이상 지난 건입니다. 입고는 막지 않습니다.`,
              body: (
                <p className={styles.plain}>
                  잔량이 남은 채로 오래된 건이 <b className="mono">{watch.unclosedOverdue}</b>건 있습니다. 더 들어올 물량이 없으면 잔량 종결 대상입니다.{" "}
                  <Link href="/closing">잔량 종결에서 보기 →</Link>
                </p>
              ),
            },
          ]}
        />

        {/* ④ 추이 */}
        <section aria-labelledby="dash-trend">
          <h2 id="dash-trend" className={styles.secTitle}>
            추이<span className={styles.secSub}>최근 {trend.length}업무일 · 오늘은 진행 중(흐린 막대·점선)</span>
          </h2>
          <div className={styles.trends}>
            <TrendChart
              title="입고 차량 · 검수 차이 비율"
              days={trend}
              bars={[{ label: "검수 확정 차량", values: trend.map((d) => d.vehicles), cls: styles.sVeh }]}
              barUnit="대"
              line={{ label: "차이 발생 비율", values: trend.map((d) => (d.vehicles ? Math.round((d.issueVehicles / d.vehicles) * 100) : null)), cls: styles.sIssue }}
              lineUnit="%"
            />
            <TrendChart
              title="입고 수량 (기준 단위)"
              days={trend}
              bars={[
                { label: "정상 입고", values: trend.map((d) => d.goodQty), cls: styles.sGood },
                { label: "반송(훼손·품목 불일치)", values: trend.map((d) => d.returnQty), cls: styles.sRet },
              ]}
            />
            <TrendChart
              title="검수 소요 시간 (입차 → 검수 확정, 평균)"
              note="길어지면 현장이 밀리고 있다는 신호입니다. 입차 기록이 있는 차량만 셉니다."
              days={trend}
              line={{ label: "평균 소요", values: trend.map((d) => d.leadMinutes), cls: styles.sLead }}
              lineUnit="분"
            />
          </div>
        </section>
      </div>
    </>
  );
}

const expireColumns = (multi: boolean): Column<DashPlanRow>[] => [
  { key: "no", header: "입고예정번호", align: "center", render: (r) => <span className="mono">{r.planNo}</span> },
  clientCol<DashPlanRow>(),
  ...centerCol<DashPlanRow>(multi),
  { key: "date", header: "입고예정일", align: "center", render: (r) => <span className="mono">{r.planDate}</span> },
  { key: "status", header: "상태", align: "center", render: (r) => <StatusBadge status={r.status} /> },
];

const asnColumns = (multi: boolean): Column<DashAsnRow>[] => [
  { key: "no", header: "ASN번호", align: "center", render: (r) => <span className="mono">{r.asnNo}</span> },
  clientCol<DashAsnRow>(),
  ...centerCol<DashAsnRow>(multi),
  { key: "vehicle", header: "차량번호", align: "center", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "date", header: "출고일", align: "center", render: (r) => <span className="mono">{r.shipDate}</span> },
];

const rcvColumns = (multi: boolean): Column<DashRcvRow>[] => [
  { key: "vehicle", header: "차량번호", align: "center", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  clientCol<DashRcvRow>(),
  ...centerCol<DashRcvRow>(multi),
  { key: "at", header: "확정", align: "center", render: (r) => <span className="mono">{fmtShortDateTime(r.confirmedAt)}</span> },
  { key: "issue", header: "차이", align: "right", width: 56, render: (r) => <span className={`mono ${styles.warnText}`}>{r.issueCount.toLocaleString()}</span> },
];
