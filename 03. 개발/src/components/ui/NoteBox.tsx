import styles from "./NoteBox.module.css";

export type NoteTone = "error" | "warn" | "info";

/**
 * 안내 박스 — error: version 충돌 등 처리 차단 / warn: 기한 경과 등 주의 / info: 반려 안내 등
 * action 자리에 버튼을 넣을 수 있다.
 */
export function NoteBox({
  tone,
  children,
  action,
}: {
  tone: NoteTone;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={`${styles.note} ${styles[tone]}`} role={tone === "error" ? "alert" : undefined}>
      <div>
        {children}
        {action && <div className={styles.act}>{action}</div>}
      </div>
    </div>
  );
}
