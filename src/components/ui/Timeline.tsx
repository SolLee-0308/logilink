import styles from "./Timeline.module.css";

/** 점 색: save=바이올렛(저장·등록 요청), reject=빨강, ok=파랑(승인·등록), neutral=회색(기준정보 변경) */
export type TimelineTone = "save" | "reject" | "ok" | "neutral";

export interface TimelineEntry {
  key: string;
  tone: TimelineTone;
  title: React.ReactNode;
  /** 인용 (반려 사유 상세 등) */
  quote?: string;
  /** 보조 줄 (변경 내용 요약) */
  detail?: React.ReactNode;
  at: string;
}

/** 처리 이력 — 최신이 위 (호출하는 쪽에서 정렬해서 넘긴다) */
export function Timeline({ entries, empty = "이력이 없습니다." }: { entries: TimelineEntry[]; empty?: string }) {
  if (entries.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ol className={styles.timeline}>
      {entries.map((e) => (
        <li key={e.key} className={styles.tl}>
          <span className={`${styles.dot} ${styles[e.tone]}`} aria-hidden="true" />
          <div>
            {e.title}
            {e.detail && <small>{e.detail}</small>}
            {e.quote && <small>“{e.quote}”</small>}
            <small className="mono">{e.at}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
