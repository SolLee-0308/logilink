"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { weeklyOffLabel } from "@/domain/business-day";
import { fmtDateTime } from "@/lib/format";
import type { DashCenter, DashFlow } from "./types";
import styles from "./Dashboard.module.css";

/** 3PL·화주사 대시보드 공통 조각 — 머리 오른쪽(센터 고르기·기준 시각·새로 고침) · 숫자 칸 · 오늘 흐름 · 더 보기 */

const md = (ymd: string) => ymd.slice(5);

export function HeadActions({
  centers,
  centerOptions,
  selectedCenter,
  now,
}: {
  centers: DashCenter[];
  centerOptions: { id: number; name: string }[];
  selectedCenter: string;
  now: string;
}) {
  const router = useRouter();
  const single = centers.length === 1 ? centers[0] : null;
  const dateLabel = single
    ? `업무일 ${single.businessDate} (${single.businessDayStart} 시작)`
    : centers.length > 1
      ? `센터별 업무일 기준 (${[...new Set(centers.map((c) => md(c.businessDate)))].join(" · ")})`
      : "센터 없음";
  return (
    <div className={styles.headActions}>
      {centerOptions.length > 1 && (
        <Select
          aria-label="센터"
          value={selectedCenter}
          onChange={(e) => router.push(e.target.value ? `/dashboard?center=${e.target.value}` : "/dashboard")}
        >
          <option value="">전체 센터</option>
          {centerOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      <span className={styles.asOf}>
        {dateLabel} · <span className="mono">{fmtDateTime(now).slice(11)}</span> 기준
      </span>
      <Button size="sm" onClick={() => router.refresh()}>
        새로 고침
      </Button>
    </div>
  );
}

export function Tile({ href, label, value, unit, note, danger }: { href: string; label: string; value: number; unit: string; note: string; danger?: boolean }) {
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

/**
 * 오늘 ASN 차량 진행 막대 (2026-11-12 Sol) — 상차 대기 → 상차중 → 검수 대기 → 입고완료를 한 줄 누적 막대로.
 * 칸 너비 = 차량 수 비율. 0대 단계는 막대에서 빠지고 범례에만 0으로 남는다.
 */
function AsnProgress({ flow }: { flow: DashFlow }) {
  const segs = [
    { key: "reg", label: "상차 대기", value: flow.asnRegistered, cls: styles.segReg },
    { key: "loading", label: "상차중", value: flow.asnLoading, cls: styles.segLoading },
    { key: "loaded", label: "검수 대기", value: flow.asnLoaded, cls: styles.segLoaded },
    { key: "received", label: "입고완료", value: flow.asnReceived, cls: styles.segReceived },
  ];
  const total = segs.reduce((s, x) => s + x.value, 0);
  const pct = total ? Math.round((flow.asnReceived / total) * 100) : 0;
  const summary = segs.map((s) => `${s.label} ${s.value}대`).join(", ");

  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <h3>ASN 차량 (오늘 출고)</h3>
        {total > 0 && (
          <span className={styles.progressSum}>
            <b className="mono">{total.toLocaleString()}</b>대 중 <b className="mono">{flow.asnReceived.toLocaleString()}</b>대 입고완료
            <span className={`${styles.progressPct} mono`}>{pct}%</span>
          </span>
        )}
      </div>
      {total === 0 ? (
        <p className={styles.progressEmpty}>오늘 출고일인 ASN 차량이 없습니다.</p>
      ) : (
        <>
          <div className={styles.bar} role="img" aria-label={`오늘 출고 ASN 차량 ${total}대 — ${summary}`}>
            {segs
              .filter((s) => s.value > 0)
              .map((s) => (
                <span key={s.key} className={`${styles.seg} ${s.cls}`} style={{ flexGrow: s.value }} title={`${s.label} ${s.value}대`}>
                  <b className="mono">{s.value}</b>
                </span>
              ))}
          </div>
          <ul className={styles.legend}>
            {segs.map((s, i) => (
              <li key={s.key} className={s.value === 0 ? styles.legendZero : ""}>
                {i > 0 && <span className={styles.legendArrow} aria-hidden>›</span>}
                <i className={`${styles.swatch} ${s.cls}`} aria-hidden />
                {s.label} <b className="mono">{s.value}</b>대
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** ② 오늘 흐름 — ASN 차량 진행 막대(위) · 입고예정(오늘 예정일) · 검수 확정(오늘) */
export function FlowCard({ flow, description }: { flow: DashFlow; description: string }) {
  return (
    <Card title="오늘 흐름" description={description}>
      <AsnProgress flow={flow} />
      <div className={styles.flow}>
        <FlowGroup title="입고예정 (오늘 예정일)">
          <FlowStep label="승인 전" value={flow.planPre} unit="건" />
          <FlowStep label="승인 이후" value={flow.planApproved} unit="건" />
        </FlowGroup>
        <FlowGroup title="검수 확정 (오늘)">
          <FlowStep label="차량" value={flow.rcvVehicles} unit="대" done />
          <FlowStep label="품목" value={flow.rcvLines} unit="줄" />
          <FlowStep label="차이 있음" value={flow.rcvIssueVehicles} unit="대" warn />
        </FlowGroup>
      </div>
    </Card>
  );
}

export function More({ shown, total, href }: { shown: number; total: number; href: string }) {
  if (total <= shown) return null;
  return (
    <p className={styles.more}>
      외 {total - shown}건 · <Link href={href}>전체 보기 →</Link>
    </p>
  );
}

export interface WatchItem {
  key: string;
  /** 숫자 칸의 #앵커가 가리키는 id — 0건이어도 "이상 없음" 줄에 남겨 둔다 */
  anchorId?: string;
  title: string;
  count: number;
  description: React.ReactNode;
  body: React.ReactNode;
}

/**
 * ③ 주의할 건 (2026-11-12 Sol) — 건이 있는 카드만 펼치고, 0건 카드는 "이상 없음" 한 줄로 모은다.
 */
export function WatchGrid({ items }: { items: WatchItem[] }) {
  const open = items.filter((i) => i.count > 0);
  const clear = items.filter((i) => i.count === 0);
  return (
    <section aria-labelledby="dash-watch" className={styles.watchSec}>
      <h2 id="dash-watch" className={styles.secTitle}>
        주의할 건
      </h2>
      {open.length > 0 && (
        <div className={styles.watch}>
          {open.map((i) => (
            <Card key={i.key} title={i.anchorId ? <span id={i.anchorId}>{i.title}</span> : i.title} label={i.title} count={i.count} description={i.description}>
              {i.body}
            </Card>
          ))}
        </div>
      )}
      {clear.length > 0 && (
        <p className={styles.clear}>
          <span className={styles.clearMark} aria-hidden>
            ✓
          </span>
          <b>이상 없음</b>
          {clear.map((i) => (
            <span key={i.key} id={i.anchorId} className={styles.clearItem}>
              {i.title} <span className="mono">0</span>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/** 센터 설정값(업무일 시작·일마감·유예·정기 휴무) — 매일 볼 값이 아니라 접어 둔다 (2026-11-12 Sol) */
export function CenterRules({ centers }: { centers: DashCenter[] }) {
  if (centers.length === 0) return null;
  return (
    <details className={styles.rules}>
      <summary>센터 기준 보기 (업무일 시작·일마감·기한경과 유예·정기 휴무)</summary>
      <DataTable compact caption="센터 기준" columns={ruleColumns} rows={centers} rowKey={(r) => String(r.id)} empty="센터가 없습니다." />
    </details>
  );
}

const ruleColumns: Column<DashCenter>[] = [
  { key: "name", header: "센터", render: (r) => r.name },
  { key: "start", header: "업무일 시작", render: (r) => <span className="mono">{r.businessDayStart}</span> },
  { key: "close", header: "일마감", render: (r) => <span className="mono">{r.dailyCloseTime}</span> },
  { key: "rule", header: "기한경과 유예", render: (r) => `입고예정일 + ${r.expireGraceDays}영업일` },
  { key: "off", header: "정기 휴무", render: (r) => weeklyOffLabel(r.weeklyOffDays) },
];

export const centerCol =<T extends { centerName: string }>(multi: boolean): Column<T>[] =>
  multi ? [{ key: "center", header: "센터", render: (r) => r.centerName }] : [];
