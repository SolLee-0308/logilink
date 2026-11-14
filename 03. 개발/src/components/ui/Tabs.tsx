"use client";

import { useRef } from "react";
import styles from "./Tabs.module.css";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
  /** 주의 건수 — 붉은 ⚠N (0이면 숨김). 예: 미종결 탭의 경과 기준 초과 건 */
  alert?: number;
  /** alert 숫자의 뜻 (스크린리더·마우스 올림) */
  alertLabel?: string;
}

interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  /** 탭 패널 id (aria-controls) */
  panelId?: string;
  /** 탭 줄 오른쪽 끝 — 예: 총 건수 (2026-11-14 Sol) */
  aside?: React.ReactNode;
}

/** 활성 탭은 violet-600 + 흰 글자. 좌우 화살표·Home·End로 이동 */
export function Tabs<K extends string>({ items, value, onChange, label, panelId, aside }: TabsProps<K>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].key);
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((t, i) => {
        const selected = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
            {t.count !== undefined && <span className={`${styles.n} mono`}>{t.count.toLocaleString()}</span>}
            {!!t.alert && (
              <span className={`${styles.alert} mono`} title={t.alertLabel}>
                <span aria-hidden="true">⚠</span>
                {t.alert.toLocaleString()}
                {t.alertLabel && <span className="sr-only"> {t.alertLabel}</span>}
              </span>
            )}
          </button>
        );
      })}
      {aside && <div className={styles.aside}>{aside}</div>}
    </div>
  );
}

/** 탭 줄 오른쪽 끝 총 건수 — 모든 목록 화면 공통 (2026-11-14 Sol) */
export function TabTotal({ total }: { total: number }) {
  return (
    <span>
      총 <strong className="mono">{total.toLocaleString()}</strong>건
    </span>
  );
}
