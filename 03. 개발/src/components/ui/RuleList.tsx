import styles from "./RuleList.module.css";

export interface Rule {
  /** 정의서 번호 (C2, D19 등) 또는 UI */
  id: string;
  title: string;
  text: string;
}

/** 도움말 시트 안 업무 규칙 목록 */
export function RuleList({ rules, source }: { rules: Rule[]; source?: string }) {
  return (
    <>
      {source && <p className={styles.source}>근거: {source}</p>}
      <ul className={styles.list}>
        {rules.map((r) => (
          <li key={r.id + r.title} className={styles.rule}>
            <span className={`${styles.id} mono`}>{r.id}</span>
            <div>
              <strong>{r.title}</strong>
              <p>{r.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
