import styles from "./ComingSoon.module.css";

/** 아직 준비 중인 화면 — 아이콘 + "준비 중입니다." (2026-11-13 Sol: 시연 링크의 대시보드) */
export function ComingSoon({ title, message }: { title: string; message?: string }) {
  return (
    <section className={styles.wrap} aria-label={`${title} 준비 중`}>
      <span className={styles.icon} aria-hidden="true">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </span>
      <h1 className={styles.title}>준비 중입니다.</h1>
      <p className={styles.text}>{message ?? `${title}은(는) 아직 준비 중인 화면입니다.`}</p>
    </section>
  );
}
