"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ItemUnit } from "@/domain/master";
import type { CatalogItem } from "@/domain/plan-entry";
import { findPlanItem, searchPlanItems } from "@/server/plans/actions";
import styles from "./ItemPicker.module.css";

const QUICK_LIMIT = 8;

/**
 * 줄 안 빠른 입력 — 품목이 수천 개여도 쓸 수 있게 서버에서 찾는다.
 * - 품목코드·바코드를 치고 Enter → 정확히 같은 품목을 바로 넣는다 (바코드 스캐너 입력 그대로)
 * - 2글자 이상 치면 후보 8개까지. 더 많으면 [품목 찾기] 창으로 이어서 찾는다
 */
export function ItemPicker({
  id,
  item,
  onPick,
  onMore,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  /** 지금 줄에 고른 품목 */
  item: CatalogItem | undefined;
  onPick: (item: CatalogItem, unit?: ItemUnit | null) => void;
  /** 품목 찾기 창 열기 (입력한 글자를 넘긴다) */
  onMore: (q: string) => void;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const label = item ? `${item.code} ${item.name}` : "";
  const [text, setText] = useState(label);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) setText(label);
  }, [label, open]);

  // 입력이 멈추면 서버에서 찾는다 (2글자 이상)
  useEffect(() => {
    if (!open) return;
    const q = text.trim();
    if (q === label || q.length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchPlanItems({ q });
      if (my !== seq.current) return;
      setLoading(false);
      if (r.ok) {
        setResults(r.data!.items.slice(0, QUICK_LIMIT));
        setTotal(r.data!.total);
        setActive(0);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text, open, label]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setMiss(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pick(it: CatalogItem, unit?: ItemUnit | null) {
    onPick(it, unit);
    setText(`${it.code} ${it.name}`);
    setOpen(false);
    setMiss(null);
  }

  /** Enter — 목록에서 고른 품목, 아니면 품목코드·바코드 정확히 일치 */
  async function enter() {
    const q = text.trim();
    if (!q || q === label) return;
    const exact = results.find((r) => r.code.toUpperCase() === q.toUpperCase() || r.barcodes.some((b) => b.barcode === q));
    if (exact) return pick(exact, exact.barcodes.find((b) => b.barcode === q)?.unit);
    if (open && results[active] && !/^\d{8,14}$/.test(q)) return pick(results[active]);
    seq.current++;
    setLoading(true);
    const r = await findPlanItem(q);
    setLoading(false);
    if (r.ok && r.data) return pick(r.data.item, r.data.unit);
    setMiss(q);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void enter();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setText(label);
    }
  }

  const q = text.trim();
  const showList = open && q !== label && (q.length >= 2 || !!miss);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        id={id}
        className={`${styles.input} ${invalid ? styles.invalid : ""}`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${results[active].id}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="품목코드·바코드 입력 후 Enter, 또는 이름 2글자 이상"
        value={text}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setMiss(null);
        }}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className={styles.list} id={listId} role="listbox" aria-label="품목 후보">
          {loading && results.length === 0 && <li className={styles.none}>찾는 중…</li>}
          {!loading && miss && <li className={styles.none}>&apos;{miss}&apos;와(과) 품목코드·바코드가 같은 품목이 없습니다.</li>}
          {!loading && !miss && results.length === 0 && <li className={styles.none}>찾는 품목이 없습니다.</li>}
          {results.map((it, i) => (
            <li
              key={it.id}
              id={`${listId}-${it.id}`}
              role="option"
              aria-selected={i === active}
              className={`${styles.opt} ${i === active ? styles.active : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="mono">{it.code}</span>
              <span className={styles.name}>{it.name}</span>
              <span className={`${styles.units} mono`}>{it.uoms.map((u) => u.unit).join("·")}</span>
            </li>
          ))}
          <li className={styles.more}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onMore(q === label ? "" : q);
              }}
            >
              {total > results.length ? `${total.toLocaleString()}건 중 ${results.length}건 · ` : ""}품목 찾기 창에서 찾기
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
