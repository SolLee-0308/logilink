"use client";

import styles from "./DataTable.module.css";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
  /** 줄바꿈 허용 (기본은 한 줄) */
  wrap?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  /** 선택(상세 표시 중)인 행 */
  activeKey?: string | null;
  /** 행 클릭 또는 Enter/Space로 선택 */
  onActivate?: (key: string) => void;
  /** 행 강조 (예: version 충돌) */
  rowTone?: (row: T) => "conflict" | undefined;
  empty?: React.ReactNode;
  compact?: boolean;
}

/**
 * 목록 표 — 세로선 없이 가로 구분선만, 열 제목은 surface 바탕의 둥근 행.
 * 선택 행: violet-50 바탕 + 왼쪽 3px violet-600 선. 위·아래 화살표로 행 이동.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  activeKey,
  onActivate,
  rowTone,
  empty,
  compact,
}: DataTableProps<T>) {
  const interactive = !!onActivate;

  function onKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, key: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate?.(key);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      (sib as HTMLElement | null)?.focus();
    }
  }

  return (
    <div className={styles.wrap}>
      {rows.length > 0 ? (
        <div className={styles.scroll}>
          <table className={`${styles.table} ${compact ? styles.compact : ""}`}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={c.align === "right" ? styles.num : undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row);
                const active = key === activeKey;
                const tone = rowTone?.(row);
                const cls = [
                  interactive ? styles.clickable : "",
                  active ? styles.active : "",
                  tone === "conflict" ? styles.conflict : "",
                ].join(" ");
                return (
                  <tr
                    key={key}
                    className={cls}
                    tabIndex={interactive ? 0 : undefined}
                    aria-current={active ? "true" : undefined}
                    onClick={interactive ? () => onActivate?.(key) : undefined}
                    onKeyDown={interactive ? (e) => onKeyDown(e, key) : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={[c.align === "right" ? styles.num : "", c.wrap ? styles.wrapCell : ""].join(" ")}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>{empty ?? "조회된 내용이 없습니다."}</div>
      )}
    </div>
  );
}

/** 셀 안 보조 줄 (D-day, 저장자 등) */
export function CellSub({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <span className={`${styles.sub} ${mono ? "mono" : ""}`}>{children}</span>;
}
