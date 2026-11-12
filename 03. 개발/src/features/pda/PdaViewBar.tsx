"use client";

import { useRef } from "react";
import { Icon } from "./PdaParts";
import styles from "./Pda.module.css";

/**
 * 검정 영역 안 날짜 + 보기 한 줄 (2026-11-12 Sol A안) — 상차등록·입고검수 공통.
 * 날짜는 작은 칸(오늘 / MM-DD▾, 누르면 달력, 지난 날짜면 노란 칸), 보기는 건수 붙은 버튼(선택된 것만 흰 버튼).
 * 주소 바꾸기·스캔칸 커서 되돌리기는 부르는 화면이 onDate·onView에서 한다.
 */
export function PdaViewBar<T extends string>({
  date,
  today,
  filter,
  options,
  counts,
  pending,
  onDate,
  onView,
}: {
  date: string;
  today: string;
  filter: T;
  options: readonly (readonly [T, string])[];
  counts: Record<T, number>;
  pending: boolean;
  onDate: (ymd: string) => void;
  onView: (v: T) => void;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const isToday = date === today;
  return (
    <div className={styles.heroChips} role="group" aria-label="날짜와 보기">
      <span className={`${styles.heroDateChip} ${isToday ? "" : styles.heroDatePast}`}>
        <button
          type="button"
          onClick={() => {
            const el = dateRef.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              el.focus();
            }
          }}
          disabled={pending}
          aria-label={`조회 날짜 ${date}${isToday ? " (오늘)" : ""} — 눌러서 바꾸기`}
        >
          {isToday ? "오늘" : date.slice(5)}
          <Icon name="chevD" size={12} stroke={2.4} />
        </button>
        <input ref={dateRef} type="date" tabIndex={-1} aria-hidden="true" value={date} max={today} onChange={(e) => e.target.value && onDate(e.target.value)} />
      </span>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          className={`${styles.heroChip} ${filter === v ? styles.heroChipOn : ""}`}
          aria-pressed={filter === v}
          onClick={() => onView(v)}
          disabled={pending}
        >
          {l} <b className="mono">{counts[v]}</b>
        </button>
      ))}
    </div>
  );
}
