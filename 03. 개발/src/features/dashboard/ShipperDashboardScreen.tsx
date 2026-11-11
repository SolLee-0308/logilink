"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { weeklyOffLabel } from "@/domain/business-day";
import { fmtShortDateTime } from "@/lib/format";
import { FlowCard, HeadActions, More, Tile, centerCol } from "./DashboardParts";
import type { DashAsnRow, DashCenter, DashRcvRow, ShipperDashboard } from "./types";
import styles from "./Dashboard.module.css";

type ExpireRow = ShipperDashboard["watch"]["expire"][number];

/**
 * 화주사 대시보드 (2026-11-11) — ① 할 일 ② 오늘 흐름 ③ 주의할 건 ④ 이용 센터 기준.
 * 자기 화주사 건만, 이용 센터 기준. 3PL 대시보드와 같은 집계를 쓰고 이동 화면만 화주사 화면으로.
 */
export function ShipperDashboardScreen({ data }: { data: ShipperDashboard }) {
  const router = useRouter();
  const { todo, flow, watch, centers } = data;
  const multi = centers.length > 1;

  return (
    <>
      <PageHeader crumbs={["현황", "대시보드"]} title="대시보드" actions={<HeadActions {...data} />} />

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
            <Tile href="/plans/entry?tab=wait" label="승인 대기" value={todo.waiting} unit="건" note="3PL 검토 중" />
            <Tile href="/plans/asn?tab=loading" label="검수 중 차량" value={todo.inspecting} unit="대" note="센터에서 검수 진행 중" />
            <Tile href="/master/item-requests?tab=rej" label="반려된 품목 등록 요청" value={todo.itemRejected} unit="건" note="고쳐서 다시 요청" danger />
          </div>
        </section>

        {/* ② 오늘 흐름 */}
        <FlowCard flow={flow} description="내 입고예정·차량만, 센터 업무일 기준으로 셉니다. 입고예정은 입고예정일, ASN은 출고일, 검수는 확정 시각 기준이며 취소 건은 뺍니다." />

        {/* ③ 주의할 건 */}
        <div className={styles.watch}>
          <Card
            title={<span id="dash-expire">기한경과 승인 전 건</span>}
            count={watch.expireCount}
            description="입고예정일이 지났는데 승인 전(승인대기·반려)인 건입니다. 취소 예정일의 일마감 때 자동 취소됩니다. 필요한 건은 3PL에 승인을 요청하고, 반려 건은 고쳐서 다시 요청하세요."
          >
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
          </Card>

          <Card title="출고일 지난 상차 대기" count={watch.overdueAsnCount} description="출고일이 지났는데 상차를 시작하지 않은 차량입니다. 출고하지 않을 차량이면 ASN을 취소하세요.">
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
          </Card>

          <Card title="오늘 검수 차이" count={flow.rcvIssueVehicles} description="센터 검수에서 부족·초과·훼손·품목 불일치가 나온 내 차량입니다.">
            <DataTable
              compact
              caption="오늘 검수 차이"
              columns={rcvColumns(multi)}
              rows={watch.issueRcv}
              rowKey={(r) => r.href}
              onActivate={(k) => router.push(k)}
              empty="차이 난 차량이 없습니다."
            />
          </Card>

          <Card title="오래된 미종결 입고예정" count={watch.unclosedOverdue} description={`승인·부분입고 상태로 입고예정일에서 ${watch.alertDays}일 이상 지난 건입니다. 입고는 막지 않습니다.`}>
            <p className={styles.plain}>
              {watch.unclosedOverdue > 0 ? (
                <>
                  잔량이 남은 채로 오래된 건이 <b className="mono">{watch.unclosedOverdue}</b>건 있습니다. 더 보낼 물량이 없으면 센터에 잔량 종결을 요청하세요.{" "}
                  <Link href="/plans/inquiry?from=-&to=-">입고예정 조회에서 보기 →</Link>
                </>
              ) : (
                "기준을 넘긴 미종결 건이 없습니다."
              )}
            </p>
          </Card>
        </div>

        {/* ④ 이용 센터 기준 */}
        <Card title="이용 센터 기준" description="센터마다 업무일 시작 시각·일마감·기한경과 유예·정기 휴무가 다릅니다. 새벽 입고는 시작 시각 전이면 전날 업무일로 잡힙니다.">
          <DataTable compact caption="이용 센터 기준" columns={centerColumns} rows={centers} rowKey={(r) => String(r.id)} empty="이용 센터가 없습니다. 3PL에 문의하세요." />
        </Card>
      </div>
    </>
  );
}

const expireColumns = (multi: boolean): Column<ExpireRow>[] => [
  { key: "no", header: "입고예정번호", render: (r) => <span className="mono">{r.planNo}</span> },
  ...centerCol<ExpireRow>(multi),
  { key: "date", header: "입고예정일", render: (r) => <span className="mono">{r.planDate}</span> },
  { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
  {
    key: "due",
    header: "취소 예정",
    render: (r) => (r.target ? <b className={styles.dangerText}>오늘 일마감</b> : <span className="mono">{r.dueDate}</span>),
  },
];

const asnColumns = (multi: boolean): Column<DashAsnRow>[] => [
  { key: "no", header: "ASN번호", render: (r) => <span className="mono">{r.asnNo}</span> },
  ...centerCol<DashAsnRow>(multi),
  { key: "vehicle", header: "차량번호", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "date", header: "출고일", render: (r) => <span className="mono">{r.shipDate}</span> },
];

const rcvColumns = (multi: boolean): Column<DashRcvRow>[] => [
  { key: "vehicle", header: "차량번호", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  ...centerCol<DashRcvRow>(multi),
  { key: "at", header: "확정", render: (r) => <span className="mono">{fmtShortDateTime(r.confirmedAt)}</span> },
  { key: "issue", header: "차이 품목", align: "right", render: (r) => <span className={`mono ${styles.warnText}`}>{r.issueCount}</span> },
];

const centerColumns: Column<DashCenter>[] = [
  { key: "name", header: "센터", render: (r) => r.name },
  { key: "date", header: "오늘 업무일", render: (r) => <span className="mono">{r.businessDate}</span> },
  { key: "start", header: "업무일 시작", render: (r) => <span className="mono">{r.businessDayStart}</span> },
  { key: "close", header: "일마감 예정", render: (r) => <span className="mono">{r.dailyCloseTime}</span> },
  { key: "rule", header: "기한경과 유예", render: (r) => `입고예정일 + ${r.expireGraceDays}영업일` },
  { key: "off", header: "정기 휴무", render: (r) => weeklyOffLabel(r.weeklyOffDays) },
];
