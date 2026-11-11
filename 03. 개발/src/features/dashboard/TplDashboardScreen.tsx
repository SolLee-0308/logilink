"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { weeklyOffLabel } from "@/domain/business-day";
import { fmtShortDateTime } from "@/lib/format";
import { FlowCard, HeadActions, More, Tile, centerCol } from "./DashboardParts";
import type { DashAsnRow, DashCenter, DashPlanRow, DashRcvRow, TplDashboard } from "./types";
import styles from "./Dashboard.module.css";

/**
 * 3PL 대시보드 (2026-11-11 Sol) — ① 오늘 할 일 ② 오늘 흐름 ③ 주의할 건 ④ 일마감 상태.
 * 숫자 칸·목록 줄을 누르면 해당 화면으로 간다. "오늘" = 센터별 업무일.
 */
export function TplDashboardScreen({ data }: { data: TplDashboard }) {
  const router = useRouter();
  const { todo, flow, watch, centers } = data;
  const multi = centers.length > 1;

  return (
    <>
      <PageHeader crumbs={["현황", "대시보드"]} title="대시보드" actions={<HeadActions {...data} />} />

      <div className={styles.page}>
        {/* ① 오늘 할 일 */}
        <section aria-labelledby="dash-todo">
          <h2 id="dash-todo" className={styles.secTitle}>
            오늘 할 일
          </h2>
          <div className={styles.tiles}>
            <Tile href="/plans/approval" label="승인 대기" value={todo.approvalWaiting} unit="건" note="승인·반려할 입고예정" />
            <Tile href="/plans/asn-status?tab=loaded" label="검수 대기 차량" value={todo.inspectWaiting} unit="대" note="상차완료, 검수 시작 전" />
            <Tile href="/plans/asn-status?tab=loaded" label="검수 중 차량" value={todo.inspecting} unit="대" note="PDA에서 검수 진행 중" />
            <Tile href="/plans/inquiry?st=PARTIAL&from=-&to=-" label="부분입고 (잔량 남음)" value={todo.partial} unit="건" note="추가 입고 또는 잔량 종결" />
            <Tile href="#dash-expire" label="기한경과 취소 대상" value={todo.expireTargets} unit="건" note="오늘 일마감 때 취소될 승인 전 건" danger />
          </div>
        </section>

        {/* ② 오늘 흐름 */}
        <FlowCard flow={flow} description="오늘 업무일 기준 — 입고예정은 입고예정일, ASN은 출고일, 검수는 확정 시각으로 셉니다. 취소 건은 빼고 셉니다." />

        {/* ③ 주의할 건 */}
        <div className={styles.watch}>
          <Card
            title={<span id="dash-expire">기한경과 취소 대상</span>}
            count={watch.expireCount}
            description="승인 전(승인대기·반려)이고 유예 영업일이 지난 건입니다. 오늘 일마감 때 취소됩니다. 살릴 건은 마감 전에 승인하세요."
          >
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
          </Card>

          <Card title="출고일 지난 상차 대기" count={watch.overdueAsnCount} description="출고일이 지났는데 상차를 시작하지 않은 ASN 차량입니다. 화주사에 상황을 확인하세요.">
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
          </Card>

          <Card title="오늘 검수 차이" count={flow.rcvIssueVehicles} description="부족·초과·훼손·품목 불일치가 있었던 검수 확정 차량입니다.">
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
                  잔량이 남은 채로 오래된 건이 <b className="mono">{watch.unclosedOverdue}</b>건 있습니다. 더 들어올 물량이 없으면 잔량 종결 대상입니다.{" "}
                  <Link href="/plans/inquiry?from=-&to=-">입고예정 조회에서 보기 →</Link>
                </>
              ) : (
                "기준을 넘긴 미종결 건이 없습니다."
              )}
            </p>
          </Card>
        </div>

        {/* ④ 일마감 */}
        <Card
          title="일마감"
          description="일마감은 오늘 업무일의 검수 확정 실적을 확정하고, 기한경과 건을 취소합니다. 전표를 닫지 않으므로 마감 뒤에도 승인된 건은 계속 입고할 수 있습니다."
          aside={
            <Button size="sm" disabled title="잔량 종결·일마감 화면은 다음 단계에서 연결합니다">
              일마감 화면 (준비 중)
            </Button>
          }
        >
          <DataTable compact caption="센터별 일마감 상태" columns={closeColumns} rows={centers} rowKey={(r) => String(r.id)} empty="센터가 없습니다." />
        </Card>
      </div>
    </>
  );
}

const expireColumns = (multi: boolean): Column<DashPlanRow>[] => [
  { key: "no", header: "입고예정번호", render: (r) => <span className="mono">{r.planNo}</span> },
  { key: "client", header: "화주사", render: (r) => r.clientName },
  ...centerCol<DashPlanRow>(multi),
  { key: "date", header: "입고예정일", render: (r) => <span className="mono">{r.planDate}</span> },
  { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
];

const asnColumns = (multi: boolean): Column<DashAsnRow>[] => [
  { key: "no", header: "ASN번호", render: (r) => <span className="mono">{r.asnNo}</span> },
  { key: "client", header: "화주사", render: (r) => r.clientName },
  ...centerCol<DashAsnRow>(multi),
  { key: "vehicle", header: "차량번호", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "date", header: "출고일", render: (r) => <span className="mono">{r.shipDate}</span> },
];

const rcvColumns = (multi: boolean): Column<DashRcvRow>[] => [
  { key: "vehicle", header: "차량번호", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "client", header: "화주사", render: (r) => r.clientName },
  ...centerCol<DashRcvRow>(multi),
  { key: "at", header: "확정", render: (r) => <span className="mono">{fmtShortDateTime(r.confirmedAt)}</span> },
  { key: "issue", header: "차이 품목", align: "right", render: (r) => <span className={`mono ${styles.warnText}`}>{r.issueCount}</span> },
];

const closeColumns: Column<DashCenter>[] = [
  { key: "name", header: "센터", render: (r) => r.name },
  { key: "date", header: "오늘 업무일", render: (r) => <span className="mono">{r.businessDate}</span> },
  { key: "start", header: "업무일 시작", render: (r) => <span className="mono">{r.businessDayStart}</span> },
  { key: "close", header: "일마감 예정", render: (r) => <span className="mono">{r.dailyCloseTime}</span> },
  { key: "rcv", header: "오늘 확정 차량", align: "right", render: (r) => <span className="mono">{r.confirmedVehicles}대</span> },
  {
    key: "expire",
    header: "기한경과 취소 대상",
    align: "right",
    render: (r) => <span className={`mono ${r.expireTargets > 0 ? styles.dangerText : ""}`}>{r.expireTargets}건</span>,
  },
  { key: "grace", header: "유예 중", align: "right", render: (r) => <span className="mono">{r.expireGrace}건</span> },
  { key: "rule", header: "유예 기준", render: (r) => `입고예정일 + ${r.expireGraceDays}영업일` },
  { key: "off", header: "정기 휴무", render: (r) => weeklyOffLabel(r.weeklyOffDays) },
];
