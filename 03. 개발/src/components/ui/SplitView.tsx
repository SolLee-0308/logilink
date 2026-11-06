"use client";

import { createContext, useContext, useState } from "react";
import styles from "./SplitView.module.css";

/** 오른쪽 패널 접기 상태 — SplitView가 collapsible일 때만 SidePanel이 손잡이·접힌 띠를 그린다 */
const PanelFold = createContext<{ collapsible: boolean; collapsed: boolean; toggle: () => void }>({
  collapsible: false,
  collapsed: false,
  toggle: () => {},
});

/**
 * 본문 2분할: 왼쪽 목록 + 오른쪽 370px 패널(sticky). 1240px 미만에서는 패널이 목록 아래로.
 * collapsible: 패널을 접어 목록을 넓게 본다. 처음엔 늘 펼친 상태 (2026-11-06 Sol 결정)
 */
export function SplitView({ list, panel, collapsible = false }: { list: React.ReactNode; panel: React.ReactNode; collapsible?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const fold = collapsible && collapsed;
  return (
    <PanelFold.Provider value={{ collapsible, collapsed: fold, toggle: () => setCollapsed((v) => !v) }}>
      <div className={`${styles.body} ${fold ? styles.folded : ""}`}>
        <div className={styles.listcol}>{list}</div>
        {panel}
        {fold && (
          /* 접힌 상태: 본문 오른쪽 가장자리 손잡이 (메뉴 열기 손잡이와 같은 모양, 칸을 차지하지 않음) */
          <button type="button" className={styles.edgeOpen} onClick={() => setCollapsed(false)} aria-expanded={false} aria-label="상세 펼치기" title="상세 펼치기">
            <Chevron dir="left" />
          </button>
        )}
      </div>
    </PanelFold.Provider>
  );
}

const Chevron = ({ dir, double }: { dir: "left" | "right"; double?: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    {double ? (
      <path d={dir === "right" ? "M2.5 3 5.5 6 2.5 9M6.5 3 9.5 6 6.5 9" : "M5.5 3 2.5 6 5.5 9M9.5 3 6.5 6 9.5 9"} fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : (
      <path d={dir === "right" ? "M4.5 3 7.5 6 4.5 9" : "M7.5 3 4.5 6 7.5 9"} fill="none" stroke="currentColor" strokeWidth="1.6" />
    )}
  </svg>
);

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
  const fold = useContext(PanelFold);
  // 접기: 패널 제목 줄 오른쪽 끝 아이콘 (2026-11-06 Sol 결정)
  const foldBtn = fold.collapsible ? (
    <button type="button" className={styles.foldBtn} onClick={fold.toggle} aria-expanded aria-label={`${label} 접기`} title="상세 접기">
      <Chevron dir="right" double />
    </button>
  ) : null;
  const inner = (
    <>
      {(title || sub || foldBtn) && (
        <div className={`${styles.head} ${title || sub ? "" : styles.headBare}`}>
          <div className={styles.headMain}>
            {title && <div className={styles.titleRow}>{title}</div>}
            {sub && <div className={styles.sub}>{sub}</div>}
          </div>
          {foldBtn}
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
