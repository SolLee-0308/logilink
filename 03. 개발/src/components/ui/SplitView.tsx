import styles from "./SplitView.module.css";

/** 본문 2분할: 왼쪽 목록 + 오른쪽 370px 패널(sticky). 1240px 미만에서는 패널이 목록 아래로 */
export function SplitView({ list, panel }: { list: React.ReactNode; panel: React.ReactNode }) {
  return (
    <div className={styles.body}>
      <div className={styles.listcol}>{list}</div>
      {panel}
    </div>
  );
}

interface SidePanelProps {
  label: string;
  /** 제목 줄 (번호·이름 + 배지·태그) */
  title?: React.ReactNode;
  /** 제목 아래 보조 줄 */
  sub?: React.ReactNode;
  children: React.ReactNode;
  /** 하단 고정 영역 */
  footer?: React.ReactNode;
  /** 폼으로 감쌀 때 */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function SidePanel({ label, title, sub, children, footer, onSubmit }: SidePanelProps) {
  const inner = (
    <>
      {(title || sub) && (
        <div className={styles.head}>
          {title && <div className={styles.titleRow}>{title}</div>}
          {sub && <div className={styles.sub}>{sub}</div>}
        </div>
      )}
      <div className={styles.pbody}>{children}</div>
      {footer && <div className={styles.foot}>{footer}</div>}
    </>
  );
  if (onSubmit) {
    return (
      <form className={styles.panel} aria-label={label} onSubmit={onSubmit} noValidate>
        {inner}
      </form>
    );
  }
  return (
    <aside className={styles.panel} aria-label={label}>
      {inner}
    </aside>
  );
}

/** 패널 제목 (번호는 mono) */
export function PanelTitle({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <h2 className={`${styles.title} ${mono ? "mono" : ""}`}>{children}</h2>;
}

/** 패널 안 구획 */
export function PanelSection({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.sect}>
      <h3>
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

/** 패널 하단 왼쪽 보조 문구 (조회 v{n} 등) */
export function PanelFootNote({ children }: { children: React.ReactNode }) {
  return <span className={styles.ver}>{children}</span>;
}

/** 목록 위 도구 줄: 총 N건 + 오른쪽 행위 */
export function ListToolbar({ total, children }: { total: number; children?: React.ReactNode }) {
  return (
    <div className={styles.toolbar}>
      <span>
        총 <strong className="mono">{total.toLocaleString()}</strong>건
      </span>
      {children && <div className={styles.toolbarRight}>{children}</div>}
    </div>
  );
}

/** 라벨-값 2열 */
export function KeyValue({ items }: { items: [label: string, value: React.ReactNode][] }) {
  return (
    <dl className={styles.kv}>
      {items.map(([k, v]) => (
        <div key={k} className={styles.kvRow}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
