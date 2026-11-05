import styles from "./Pda.module.css";

/*
 * PDA 공통 조각 — 아이콘·진행 단계·라벨/값 상자·상태 알약
 * 참고 UI(2026-11-05 Sol 지정): 모노크롬 물류 앱(진행 단계·상세 카드·타임라인), 완료 화면(체크 원·정보 상자·알약 버튼)
 */

export type IconName = "truck" | "scan" | "arrow" | "back" | "logout" | "check" | "box" | "user" | "alert" | "plus" | "list" | "chart" | "chevL" | "chevR" | "chevD";

const PATHS: Record<IconName, React.ReactNode> = {
  truck: (
    <>
      <path d="M3 6h11v10H3z" />
      <path d="M14 10h4l3 3v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M8 9v6M11 9v6M14 9v6M17 9v6" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  logout: (
    <>
      <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  box: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </>
  ),
  chevL: <path d="M15 5l-7 7 7 7" />,
  chevR: <path d="M9 5l7 7-7 7" />,
  chevD: <path d="M5 9l7 7 7-7" />,
};

export function Icon({ name, size = 20, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export interface Step {
  label: string;
  /** 그 단계를 지났는지 */
  done: boolean;
  time?: string | null;
}

/** 진행 단계 — 지난 단계는 검정 점+체크, 남은 단계는 회색 점. 선은 마지막으로 지난 단계까지 검정 */
export function Steps({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  const last = steps.reduce((n, s, i) => (s.done ? i : n), -1);
  const pct = steps.length > 1 ? (Math.max(last, 0) / (steps.length - 1)) * 100 : 0;
  return (
    <div className={`${styles.steps} ${compact ? styles.stepsCompact : ""}`}>
      <div className={styles.stepTrack} aria-hidden="true">
        <span className={styles.stepFill} style={{ width: `${pct}%` }} />
      </div>
      <ol className={styles.stepList}>
        {steps.map((s) => (
          <li key={s.label} className={s.done ? styles.stepDone : undefined}>
            <span className={styles.stepDot}>{s.done && <Icon name="check" size={compact ? 11 : 13} stroke={2.6} />}</span>
            <span className={styles.stepLabel}>{s.label}</span>
            {s.time ? <span className={styles.stepTime}>{s.time}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 라벨(왼쪽 회색) / 값(오른쪽 진하게) 줄 묶음 */
export function InfoRows({ rows, tone = "gray" }: { rows: [string, React.ReactNode][]; tone?: "gray" | "white" }) {
  return (
    <dl className={`${styles.info} ${tone === "white" ? styles.infoWhite : ""}`}>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.infoRow}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export type PillTone = "blue" | "amber" | "green" | "red" | "gray";

export function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</span>;
}
