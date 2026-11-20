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
  /** 버튼 — 글 아래 줄이 아니라 같은 줄 오른쪽 끝에 둔다 (2026-11-14 Sol, 모든 안내 박스) */
  action?: React.ReactNode;
}) {
  if (action) {
    return (
      <div className={`${styles.note} ${styles[tone]} ${styles.inline}`} role={tone === "error" ? "alert" : undefined}>
        <div className={styles.text}>{children}</div>
        <div className={styles.actRight}>{action}</div>
      </div>
    );
  }
  return (
    <div className={`${styles.note} ${styles[tone]}`} role={tone === "error" ? "alert" : undefined}>
      <div>{children}</div>
    </div>
  );
}
