"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { fmtShortDateTime } from "@/lib/format";
import { HeadActions, More, Tile, TrendChart, VehicleFlow, WatchGrid, centerCol } from "./DashboardParts";
import type { DashAsnRow, DashRcvRow, ShipperDashboard } from "./types";
import styles from "./Dashboard.module.css";

type ExpireRow = ShipperDashboard["watch"]["expire"][number];

/**
 * 화주사 대시보드 (2026-11-17 Sol 재구성, 시안 v0.1) — 할 일 · 오늘 내 차량 흐름 · 주의할 건 · 추이(14업무일).
 * 자기 화주사 건만, 이용 센터 기준. 3PL 대시보드와 같은 집계를 쓰고 이동 화면만 화주사 화면으로.
 * 빠진 것: 승인 대기 칸(3PL이 처리할 일), 검수 중 칸(흐름 막대로), 이용 센터 표·센터 기준.
 */
export function ShipperDashboardScreen({ data }: { data: ShipperDashboard }) {
  const router = useRouter();
  const { todo, flow, watch, centers, trend } = data;
  const multi = centers.length > 1;

  return (
    <>
      <PageHeader crumbs={["현황", "대시보드"]} title={`대시보드${data.clientName ? ` · ${data.clientName}` : ""}`} actions={<HeadActions {...data} />} />

      <div className={styles.page}>
        {/* ① 할 일 */}
        <section aria-labelledby="dash-todo">
          <h2 id="dash-todo" className={styles.secTitle}>
            할 일
          </h2>
          <div className={styles.tiles}>
            <Tile href="/plans/entry?tab=rej" label="반려된 입고예정" value={todo.rejected} unit="건" note="고쳐서 다시 승인 요청" danger />
            <Tile href="#dash-expire" label="오늘 기한경과 취소" value={todo.expireTargets} unit="건" note="오늘 일마감 때 취소될 승인 전 건" danger />
            <Tile href="/plans/asn/new" label="ASN 등록할 입고예정" value={todo.toAsn} unit="건" note="차량에 담을 잔량이 남은 승인 건" />
            <Tile href="/master/item-requests?tab=rej" label="반려된 품목 등록 요청" value={todo.itemRejected} unit="건" note="고쳐서 다시 요청" danger />
          </div>
        </section>

        {/* ② 오늘 내 차량 흐름 */}
        <VehicleFlow
          flow={flow}
          title="오늘 내 차량 흐름"
          note="오늘 출고일인 내 ASN 차량과 오늘 상차한 무지시 차량입니다. 범례를 누르면 그 상태의 차량 목록으로 갑니다."
          links={{
            waiting: "/plans/asn?tab=wait",
            loading: "/plans/asn?tab=loading",
            // 화주사 ASN 조회는 상차중·상차완료를 '상차 진행' 탭 하나로 본다
            onTheWay: "/plans/asn?tab=loading",
            arrived: "/plans/asn?tab=loading",
            received: "/plans/asn?tab=done",
          }}
        />

        {/* ③ 주의할 건 */}
        <WatchGrid
          items={[
            {
              key: "expire",
              anchorId: "dash-expire",
              title: "기한경과 승인 전 건",
              count: watch.expireCount,
              grow: 2,
              description:
                "입고예정일이 지났는데 승인 전(승인대기·반려)인 건입니다. 취소 예정일의 일마감 때 자동 취소됩니다. 필요한 건은 3PL에 승인을 요청하고, 반려 건은 고쳐서 다시 요청하세요.",
              body: (
                <>
                  <DataTable
                    compact
                    caption="기한경과 승인 전 건"
                    columns={expireColumns(multi)}
                    rows={watch.expire}
                    rowKey={(r) => String(r.id)}
                    onActivate={(k) => router.push(`/plans/entry/${k}`)}
                    empty="입고예정일이 지난 승인 전 건이 없습니다."
                  />
                  <More shown={watch.expire.length} total={watch.expireCount} href="/plans/entry" />
                </>
              ),
            },
            {
              key: "issueRcv",
              title: "오늘 검수 차이",
              count: watch.issueCount,
              grow: 1.2,
              description: "센터 검수에서 부족·초과·훼손·품목 불일치가 나온 내 차량입니다.",
              body: (
                <DataTable
                  compact
                  caption="오늘 검수 차이"
                  columns={rcvColumns(multi)}
                  rows={watch.issueRcv}
                  rowKey={(r) => r.href}
                  onActivate={(k) => router.push(k)}
                  empty="차이 난 차량이 없습니다."
                />
              ),
            },
            {
              key: "overdueAsn",
              title: "출고일 지난 상차 대기",
              count: watch.overdueAsnCount,
              grow: 1.5,
              description: "출고일이 지났는데 상차를 시작하지 않은 차량입니다. 출고하지 않을 차량이면 ASN을 취소하세요.",
              body: (
                <>
                  <DataTable
                    compact
                    caption="출고일 지난 상차 대기"
                    columns={asnColumns(multi)}
                    rows={watch.overdueAsn}
                    rowKey={(r) => String(r.id)}
                    onActivate={(k) => router.push(`/plans/asn/${k}`)}
                    empty="없습니다."
                  />
                  <More shown={watch.overdueAsn.length} total={watch.overdueAsnCount} href="/plans/asn?tab=wait" />
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
                  잔량이 남은 채로 오래된 건이 <b className="mono">{watch.unclosedOverdue}</b>건 있습니다. 더 보낼 물량이 없으면 센터에 잔량 종결을 요청하세요.{" "}
                  <Link href="/plans/inquiry?from=-&to=-">입고예정 조회에서 보기 →</Link>
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
              title="입고 수량 (기준 단위)"
              days={trend}
              bars={[
                { label: "정상 입고", values: trend.map((d) => d.goodQty), cls: styles.sGood },
                { label: "반송(훼손·품목 불일치)", values: trend.map((d) => d.returnQty), cls: styles.sRet },
              ]}
            />
            <TrendChart
              title="입고예정 대비 입고율"
              note="그날이 입고예정일인 승인 건의 수량 중 입고된 수량의 비율입니다. 늦게 들어온 수량도 입고예정일 쪽에 셉니다. 오늘은 아직 들어오는 중이라 표시하지 않습니다."
              days={trend}
              line={{
                label: "입고율",
                // 오늘은 하루 중간이라 낮게 보여 추이를 왜곡한다 — 빼고 그린다
                values: trend.map((d, i) => (i < trend.length - 1 && d.planQty ? Math.round((d.planRcvQty / d.planQty) * 100) : null)),
                cls: styles.sRate,
              }}
              lineUnit="%"
              lineMin={0}
              lineMax={100}
              guide={100}
            />
          </div>
        </section>
      </div>
    </>
  );
}

const expireColumns = (multi: boolean): Column<ExpireRow>[] => [
  { key: "no", header: "입고예정번호", align: "center", render: (r) => <span className="mono">{r.planNo}</span> },
  ...centerCol<ExpireRow>(multi),
  { key: "date", header: "입고예정일", align: "center", render: (r) => <span className="mono">{r.planDate}</span> },
  { key: "status", header: "상태", align: "center", render: (r) => <StatusBadge status={r.status} /> },
  {
    key: "due",
    header: "취소 예정",
    align: "center",
    render: (r) => (r.target ? <b className={styles.dangerText}>오늘 일마감</b> : <span className="mono">{r.dueDate}</span>),
  },
];

const asnColumns = (multi: boolean): Column<DashAsnRow>[] => [
  { key: "no", header: "ASN번호", align: "center", render: (r) => <span className="mono">{r.asnNo}</span> },
  ...centerCol<DashAsnRow>(multi),
  { key: "vehicle", header: "차량번호", align: "center", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "date", header: "출고일", align: "center", render: (r) => <span className="mono">{r.shipDate}</span> },
];

const rcvColumns = (multi: boolean): Column<DashRcvRow>[] => [
  { key: "vehicle", header: "차량번호", align: "center", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  ...centerCol<DashRcvRow>(multi),
  { key: "at", header: "확정", align: "center", render: (r) => <span className="mono">{fmtShortDateTime(r.confirmedAt)}</span> },
  { key: "issue", header: "차이", align: "right", width: 56, render: (r) => <span className={`mono ${styles.warnText}`}>{r.issueCount.toLocaleString()}</span> },
];
