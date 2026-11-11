"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
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

/** ② 오늘 흐름 — 입고예정(오늘 예정일) · ASN 차량(오늘 출고) · 검수 확정(오늘) */
export function FlowCard({ flow, description }: { flow: DashFlow; description: string }) {
  return (
    <Card title="오늘 흐름" description={description}>
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

export const centerCol = <T extends { centerName: string }>(multi: boolean): Column<T>[] =>
  multi ? [{ key: "center", header: "센터", render: (r) => r.centerName }] : [];
