"use client";

import { useRef } from "react";
import styles from "./ModeSwitch.module.css";

const ICONS = {
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
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
 */
export function ModeSwitch<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { key: K; label: string; icon?: "pencil" | "sheet" | "image" }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

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
            </button>
          );
        })}
      </div>
    </div>
  );
}
