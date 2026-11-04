import { PLAN_STATUS_META, type PlanStatus, type StatusTone } from "@/domain/plan-status";
import { ASN_STATUS_META, type AsnStatus } from "@/domain/asn-rules";
import styles from "./Badges.module.css";

/** 상태 배지 — 상태는 반드시 이 색으로만 표시한다 (바이올렛 금지) */
export function Badge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

/** 입고예정 상태 배지 */
export function StatusBadge({ status }: { status: PlanStatus }) {
  const meta = PLAN_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** ASN 상태 배지 */
export function AsnStatusBadge({ status }: { status: AsnStatus }) {
  const meta = ASN_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** 기준정보 사용 여부 */
export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "done" : "cancel"}>{active ? "사용" : "사용 안 함"}</Badge>;
}

/** accent: 재요청 등 위치·회차(바이올렛) / warn: 기한 지남·중복 의심 / danger: version 충돌 */
export type TagTone = "accent" | "warn" | "danger" | "neutral";

export function Tag({ tone, children }: { tone: TagTone; children: React.ReactNode }) {
  return <span className={`${styles.tag} ${styles[`t-${tone}`]}`}>{children}</span>;
}

/** 건수 배지 (화면 제목·탭 옆) */
export function CountBadge({ value, label }: { value: number; label?: string }) {
  return (
    <span className={`${styles.count} mono`} aria-label={label ? `${label} ${value}건` : undefined}>
      {value.toLocaleString()}
    </span>
  );
}
