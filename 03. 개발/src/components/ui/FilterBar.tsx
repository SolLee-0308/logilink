"use client";

import { IconSearch } from "@/components/icons";
import styles from "./FilterBar.module.css";

/** 조회조건 바 — surface 바탕, 한 줄, 넘치면 줄바꿈 */
export function FilterBar({ children, label = "조회조건" }: { children: React.ReactNode; label?: string }) {
  return (
    <div className={styles.bar} role="search" aria-label={label}>
      {children}
    </div>
  );
}

/** 라벨 + 컨트롤 한 묶음. htmlFor가 있으면 label, 없으면 group으로 렌더 */
export function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  if (htmlFor) {
    return (
      <label className={styles.field} htmlFor={htmlFor}>
        {label}
        {children}
      </label>
    );
  }
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

export interface ChipOption<V extends string> {
  value: V;
  label: string;
}

/** 빠른 선택 칩 (단일 선택) — 선택된 칩은 검정 */
export function ChipGroup<V extends string>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<V>[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className={styles.chips}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FilterCheckbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.field} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className={styles.chk}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label = "검색",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div className={styles.search}>
      <IconSearch size={15} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
