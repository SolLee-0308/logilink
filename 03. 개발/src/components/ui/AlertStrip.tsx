import styles from "./AlertStrip.module.css";

/**
 * 경고 띠 — 확인해야 할 건이 있을 때만 화면 위에 1줄로 알린다 (2026-11-07 Sol 확정).
 * 요약 카드 대신 쓴다: 0건이면 그리지 않아 자리를 차지하지 않는다. 입고예정 조회·ASN·상차 현황 공통.
 */
export function AlertStrip({
  count,
  unit,
  children,
  active,
  onShow,
  onClear,
  activeLabel = "이 건만 보는 중 · 처음 조건으로",
}: {
  count: number;
  /** 건·대 */
  unit: string;
  /** 무엇이 문제인지 — 건수 앞에 붙는다 */
  children: React.ReactNode;
  /** 지금 이 건들만 거른 상태인지 */
  active: boolean;
  onShow: () => void;
  onClear: () => void;
  activeLabel?: string;
}) {
  if (count <= 0) return null;
  return (
    <div className={styles.strip} role="status">
      <span className={styles.icon} aria-hidden="true">
        !
      </span>
      <span className={styles.text}>
        {children} <b className="mono">{count.toLocaleString()}</b>
        {unit}
      </span>
      <button type="button" className={styles.btn} onClick={active ? onClear : onShow}>
        {active ? activeLabel : "이 건만 보기 →"}
      </button>
    </div>
  );
}
