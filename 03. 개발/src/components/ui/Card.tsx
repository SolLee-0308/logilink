import styles from "./Card.module.css";

/**
 * 화면 안 영역 카드 — 진한 테두리 + 옅은 회색 머리 띠로 영역을 나눈다 (2026-11-04 Sol: 흰 바탕 유지 + 테두리 강화).
 * step: 단계 번호(① ②), aside: 머리 오른쪽(건수·버튼), footer: 카드 아래 버튼 줄.
 */
export function Card({
  title,
  step,
  stepState = "current",
  count,
  description,
  aside,
  footer,
  children,
  label,
  className,
}: {
  title: React.ReactNode;
  step?: number;
  stepState?: "current" | "done" | "todo";
  count?: number;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <section className={`${styles.card} ${className ?? ""}`} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <div className={`${styles.head} ${children || footer ? "" : styles.only}`}>
        {step !== undefined && (
          <span className={`${styles.step} ${styles[stepState]}`} aria-hidden>
            {step}
          </span>
        )}
        <div className={styles.titles}>
          <h2>
            {title}
            {count !== undefined && <span className={`${styles.count} mono`}>{count.toLocaleString()}</span>}
          </h2>
          {description && <p>{description}</p>}
        </div>
        {aside && <div className={styles.aside}>{aside}</div>}
      </div>
      {children && <div className={styles.body}>{children}</div>}
      {footer && <div className={styles.foot}>{footer}</div>}
    </section>
  );
}
