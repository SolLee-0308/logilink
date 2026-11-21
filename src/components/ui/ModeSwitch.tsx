"use client";

import { useId, useRef } from "react";
import styles from "./ModeSwitch.module.css";

const ICONS = {
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  truck: (
    <>
      <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  sheet: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 9h16M4 15h16M10 3v18" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 17l-5-5-9 8" />
    </>
  ),
};

/**
 * 입력 방법 전환 스위치 (2026-11-06 시안) — 별도 영역 없이 화면 제목 줄 오른쪽에 둔다.
 * 앞에 라벨, 연회색 묶음 안에서 고른 칸은 흰 바탕 + 보라 테두리·글자. 라디오 그룹: 좌우 화살표로 이동.
 * count·alert(2026-11-21 Sol): 있을 때만 칸 오른쪽에 처리할 건수와 ⚠N — 고르지 않은 쪽도 건수가 보이게 (탭과 같은 모양).
 */
export function ModeSwitch<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: {
    key: K;
    label: string;
    icon?: keyof typeof ICONS;
    count?: number;
    countLabel?: string;
    alert?: number;
    alertLabel?: string;
    /** 마우스를 올리면 뜨는 내역 카드 — 있을 때만 */
    detail?: { title: string; rows: { label: string; value: string }[] };
  }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft")
      next = (index - 1 + items.length) % items.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].key);
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <div className={styles.group} role="radiogroup" aria-label={label}>
        {items.map((m, i) => {
          const on = m.key === value;
          return (
            <button
              key={m.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={styles.item}
              aria-describedby={m.detail ? `${popId}-${i}` : undefined}
              onClick={() => onChange(m.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {m.icon && (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ICONS[m.icon]}
                </svg>
              )}
              {m.label}
              {m.count !== undefined && (
                <span className={`${styles.n} mono`} title={m.detail ? undefined : m.countLabel}>
                  {m.count.toLocaleString()}
                  {m.countLabel && <span className="sr-only"> {m.countLabel}</span>}
                </span>
              )}
              {!!m.alert && (
                <span className={`${styles.alert} mono`} title={m.alertLabel}>
                  <span aria-hidden="true">⚠</span>
                  {m.alert.toLocaleString()}
                  {m.alertLabel && <span className="sr-only"> {m.alertLabel}</span>}
                </span>
              )}
              {m.detail && (
                <span id={`${popId}-${i}`} role="tooltip" className={styles.pop}>
                  <span className={styles.popTitle}>{m.detail.title}</span>
                  {m.detail.rows.map((r) => (
                    <span key={r.label} className={styles.popRow}>
                      <span>{r.label}</span>
                      <b className="mono">{r.value}</b>
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
