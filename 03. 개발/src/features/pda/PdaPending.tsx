import { Icon } from "./PdaParts";
import styles from "./Pda.module.css";

/** 아직 만들지 않은 PDA 메뉴 자리 — 입고검수 쪽은 3단계에서 만든다 */
export function PdaPending({ title }: { title: string }) {
  return (
    <section className={styles.pending}>
      <span className={styles.iconCircle}>
        <Icon name="box" size={20} />
      </span>
      <b>{title}</b>
      <p className={styles.help}>이 화면은 입고검수(3단계: 입차·실제 입고 건·PDA 검수) 개발 때 만듭니다.</p>
    </section>
  );
}
