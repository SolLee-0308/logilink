"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { IconSearch } from "@/components/icons";
import styles from "./FilterBar.module.css";

/**
 * 조회조건 바 — surface 바탕, 한 줄, 넘치면 줄바꿈.
 * 목록을 내려도 화면 위에 붙어 있다(위치 고정, 2026-11-06 Sol 결정). 높이를 --filterbar-h로 알려
 * 오른쪽 상세 패널이 바 아래에 붙게 한다.
 */
export function FilterBar({ children, label = "조회조건" }: { children: React.ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--filterbar-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--filterbar-h");
    };
  }, []);
  useRowAlign(ref);
  return (
    <div ref={ref} className={styles.bar} role="search" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * 조회조건 열 맞추기 (2026-11-14 Sol) — 줄바꿈되면 1번째 줄·2번째 줄의 같은 순번 조건끼리 입력칸 시작점을 맞춘다(표처럼).
 * - 항목명(라벨)은 왼쪽 정렬. 같은 순번의 라벨 칸을 그 열에서 가장 긴 라벨 너비로 늘린다(라벨 뒤 여백).
 * - 같은 순번 조건의 전체 너비도 그 열에서 가장 넓은 것에 맞춰, 다음 조건의 시작점이 어긋나지 않게 한다.
 * - 라벨 없는 조건(검색칸 등)은 앞 여백으로 입력칸 시작점을 맞춘다. 줄 끝 조건만 남는 폭을 채운다.
 * - 한 줄이면 손대지 않는다. 창 크기·조건 수가 바뀌면 다시 잰다.
 */
function useRowAlign(ref: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    let busy = false;
    const labelOf = (el: HTMLElement) => el.querySelector<HTMLElement>(`:scope > .${CSS.escape(styles.label)}`);
    const clear = (items: HTMLElement[]) => {
      for (const el of items) {
        el.style.marginLeft = "";
        el.style.minWidth = "";
        el.style.flexGrow = "";
        const lab = labelOf(el);
        if (lab) lab.style.minWidth = "";
      }
    };
    /** 지금 배치의 줄 나눔 */
    const rowsOf = (items: HTMLElement[]) => {
      const rows: HTMLElement[][] = [];
      let top = -Infinity;
      for (const el of items) {
        if (el.offsetTop > top + 4) rows.push([]);
        rows[rows.length - 1].push(el);
        top = Math.max(top, el.offsetTop);
      }
      return rows;
    };
    const same = (a: HTMLElement[][], b: HTMLElement[][]) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((el, j) => el === b[i][j]));
    const align = () => {
      if (busy) return;
      busy = true;
      const items = [...bar.children] as HTMLElement[];
      clear(items);
      // 남는 폭을 채우는 칸(검색칸 flex:1)이 늘어난 너비로 재지 않게 늘이기를 끄고 잰다 (2026-11-14 Sol 피드백:
      // 늘어난 검색칸 너비가 열 너비가 되어 품목 관리·사용자 화면의 칸이 크게 밀렸음)
      const noGrow = () => items.forEach((el) => (el.style.flexGrow = "0"));
      noGrow();
      // 본래 너비 — 라벨(+라벨~입력칸 간격)과 입력 부분
      const lab0 = new Map<HTMLElement, number>();
      const ctl0 = new Map<HTMLElement, number>();
      for (const el of items) {
        const lab = labelOf(el);
        const lw = lab ? lab.getBoundingClientRect().width + (parseFloat(getComputedStyle(el).columnGap) || 0) : 0;
        lab0.set(el, lw);
        ctl0.set(el, el.getBoundingClientRect().width - lw);
      }
      let rows = rowsOf(items);
      // 늘리면 줄바꿈이 바뀔 수 있어 몇 번 다시 잰다
      for (let round = 0; round < 4 && rows.length > 1; round++) {
        clear(items);
        noGrow();
        const cols = Math.max(...rows.map((r) => r.length));
        for (let j = 0; j < cols; j++) {
          const col = rows.map((r) => r[j]).filter(Boolean);
          const lw = Math.max(...col.map((el) => lab0.get(el)!));
          const fw = Math.max(...col.map((el) => lw + ctl0.get(el)!));
          for (const el of col) {
            const lab = labelOf(el);
            if (lab) lab.style.minWidth = `${lw - lab0.get(el)! + lab.getBoundingClientRect().width}px`;
            else if (lw > 0) el.style.marginLeft = `${lw}px`;
            el.style.minWidth = `${lab ? fw : fw - lw}px`;
          }
        }
        // 줄 끝 조건만 남는 폭을 채운다(중간이 늘어나면 뒤 열이 밀림)
        for (const r of rows) r[r.length - 1].style.flexGrow = "";
        const next = rowsOf(items);
        if (same(next, rows)) break;
        rows = next;
      }
      if (rows.length <= 1) clear(items);
      busy = false;
    };
    align();
    const ro = new ResizeObserver(() => requestAnimationFrame(align));
    ro.observe(bar);
    const mo = new MutationObserver(() => requestAnimationFrame(align));
    mo.observe(bar, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);
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
      // 라벨은 항목명만 감싼다 — 칸 안에 체크박스 등을 함께 둘 수 있게 (2026-11-14 Sol)
      <div className={styles.field}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
        {children}
      </div>
    );
  }
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
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
