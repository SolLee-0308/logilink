"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { weeklyOffLabel } from "@/domain/business-day";
import { fmtDateTime, fmtShortDateTime } from "@/lib/format";
import type { DashCenter, TplDashboard } from "./types";
import styles from "./Dashboard.module.css";

const md = (ymd: string) => ymd.slice(5);

/**
 * 3PL 대시보드 (2026-11-11 Sol) — ① 오늘 할 일 ② 오늘 흐름 ③ 주의할 건 ④ 일마감 상태.
 * 숫자 칸·목록 줄을 누르면 해당 화면으로 간다. "오늘" = 센터별 업무일.
 */
export function TplDashboardScreen({ data }: { data: TplDashboard }) {
  const router = useRouter();
  const { todo, flow, watch, centers } = data;
  const single = centers.length === 1 ? centers[0] : null;
  const dateLabel = single
    ? `업무일 ${single.businessDate} (${single.businessDayStart} 시작)`
    : `센터별 업무일 기준 (${[...new Set(centers.map((c) => md(c.businessDate)))].join(" · ")})`;

  return (
    <>
      <PageHeader
        crumbs={["현황", "대시보드"]}
        title="대시보드"
        actions={
          <div className={styles.headActions}>
            {data.centerOptions.length > 1 && (
              <Select
                aria-label="센터"
                value={data.selectedCenter}
                onChange={(e) => router.push(e.target.value ? `/dashboard?center=${e.target.value}` : "/dashboard")}
              >
                <option value="">전체 센터</option>
                {data.centerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            <span className={styles.asOf}>
              {dateLabel} · <span className="mono">{fmtDateTime(data.now).slice(11)}</span> 기준
            </span>
            <Button size="sm" onClick={() => router.refresh()}>
              새로 고침
            </Button>
          </div>
        }
      />

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
        <Card title="오늘 흐름" description="오늘 업무일 기준 — 입고예정은 입고예정일, ASN은 출고일, 검수는 확정 시각으로 셉니다. 취소 건은 빼고 셉니다.">
          <div className={styles.flow}>
            <FlowGroup title="입고예정 (오늘 예정일)">
              <FlowStep label="승인 전" value={flow.planPre} unit="건" />
              <FlowStep label="승인 이후" value={flow.planApproved} unit="건" />
            </FlowGroup>
            <FlowGroup title="ASN 차량 (오늘 출고)" arrows>
              <FlowStep label="상차 대기" value={flow.asnRegistered} unit="대" />
              <FlowStep label="상차중" value={flow.asnLoading} unit="대" />
              <FlowStep label="검수 대기" value={flow.asnLoaded} unit="대" />
              <FlowStep label="입고완료" value={flow.asnReceived} unit="대" done />
            </FlowGroup>
            <FlowGroup title="검수 확정 (오늘)">
              <FlowStep label="차량" value={flow.rcvVehicles} unit="대" done />
              <FlowStep label="품목" value={flow.rcvLines} unit="줄" />
              <FlowStep label="차이 있음" value={flow.rcvIssueVehicles} unit="대" warn />
            </FlowGroup>
          </div>
        </Card>

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
              columns={expireColumns(centers.length > 1)}
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
              columns={asnColumns(centers.length > 1)}
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
              columns={rcvColumns(centers.length > 1)}
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

function Tile({ href, label, value, unit, note, danger }: { href: string; label: string; value: number; unit: string; note: string; danger?: boolean }) {
  const zero = value === 0;
  return (
    <Link href={href} className={`${styles.tile} ${zero ? styles.zero : ""} ${danger && !zero ? styles.danger : ""}`}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>
        <b className="mono">{value.toLocaleString()}</b>
        {unit}
      </span>
      <span className={styles.tileNote}>{note}</span>
    </Link>
  );
}

function FlowGroup({ title, arrows, children }: { title: string; arrows?: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.flowGroup}>
      <h3>{title}</h3>
      <div className={`${styles.flowSteps} ${arrows ? styles.arrows : ""}`}>{children}</div>
    </div>
  );
}

function FlowStep({ label, value, unit, done, warn }: { label: string; value: number; unit: string; done?: boolean; warn?: boolean }) {
  const tone = value === 0 ? styles.stepZero : warn ? styles.stepWarn : done ? styles.stepDone : "";
  return (
    <div className={`${styles.step} ${tone}`}>
      <span className={styles.stepLabel}>{label}</span>
      <span className={styles.stepValue}>
        <b className="mono">{value.toLocaleString()}</b>
        {unit}
      </span>
    </div>
  );
}

function More({ shown, total, href }: { shown: number; total: number; href: string }) {
  if (total <= shown) return null;
  return (
    <p className={styles.more}>
      외 {total - shown}건 · <Link href={href}>전체 보기 →</Link>
    </p>
  );
}

const centerCol = <T extends { centerName: string }>(multi: boolean): Column<T>[] =>
  multi ? [{ key: "center", header: "센터", render: (r) => r.centerName }] : [];

const expireColumns = (multi: boolean): Column<TplDashboard["watch"]["expire"][number]>[] => [
  { key: "no", header: "입고예정번호", render: (r) => <span className="mono">{r.planNo}</span> },
  { key: "client", header: "화주사", render: (r) => r.clientName },
  ...centerCol<TplDashboard["watch"]["expire"][number]>(multi),
  { key: "date", header: "입고예정일", render: (r) => <span className="mono">{r.planDate}</span> },
  { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
];

const asnColumns = (multi: boolean): Column<TplDashboard["watch"]["overdueAsn"][number]>[] => [
  { key: "no", header: "ASN번호", render: (r) => <span className="mono">{r.asnNo}</span> },
  { key: "client", header: "화주사", render: (r) => r.clientName },
  ...centerCol<TplDashboard["watch"]["overdueAsn"][number]>(multi),
  { key: "vehicle", header: "차량번호", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "date", header: "출고일", render: (r) => <span className="mono">{r.shipDate}</span> },
];

const rcvColumns = (multi: boolean): Column<TplDashboard["watch"]["issueRcv"][number]>[] => [
  { key: "vehicle", header: "차량번호", render: (r) => <span className="mono">{r.vehicleNo}</span> },
  { key: "client", header: "화주사", render: (r) => r.clientName },
  ...centerCol<TplDashboard["watch"]["issueRcv"][number]>(multi),
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
