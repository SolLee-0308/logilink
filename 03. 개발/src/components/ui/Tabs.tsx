"use client";

import { useRef } from "react";
import styles from "./Tabs.module.css";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  /** 탭 패널 id (aria-controls) */
  panelId?: string;
}

/** 활성 탭은 violet-600 + 흰 글자. 좌우 화살표·Home·End로 이동 */
export function Tabs<K extends string>({ items, value, onChange, label, panelId }: TabsProps<K>) {
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
          </button>
        );
      })}
    </div>
  );
}
