"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Overlay";
import { searchApprovalClients } from "@/server/plans/actions";
import type { ClientPick } from "@/server/plans/queries";
import styles from "./ClientFinder.module.css";

export interface PickedClient {
  id: number;
  name: string;
}

/**
 * 조회조건 화주사 — 화주사가 많아져도 고를 수 있게 드롭다운 대신 [화주사 찾기] 창.
 * 고른 화주사는 칸에 이름으로 보이고, × 로 전체로 되돌린다.
 */
export function ClientFilter({ id, value, onChange }: { id: string; value: PickedClient | null; onChange: (c: PickedClient | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.field}>
      <button type="button" id={id} className={styles.picker} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={value ? styles.value : styles.placeholder}>{value ? value.name : "전체"}</span>
        <span className={styles.find}>찾기</span>
      </button>
      {value && (
        <button type="button" className={styles.clear} onClick={() => onChange(null)} aria-label={`화주사 ${value.name} 조건 지우기`} title="전체로">
          ×
        </button>
      )}
      {open && (
        <ClientFinderModal
          onClose={() => setOpen(false)}
          onPick={(c) => {
            onChange(c);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

type ClientSearch = (input: { q: string; offset: number }) => Promise<{ items: ClientPick[]; total: number } | null>;

/** 기본 검색 — 서버에서 3PL 소속 센터 이용 화주사를 찾는다 (승인·조회 화면) */
const serverSearch: ClientSearch = async (input) => {
  const r = await searchApprovalClients(input);
  return r.ok ? r.data! : null;
};

/** 화면이 이미 가진 화주사 목록에서 찾는다 (기준정보 화면 — 지금 드롭다운과 같은 범위) */
function localSearch(list: ClientPick[]): ClientSearch {
  return async ({ q, offset }) => {
    const k = q.trim().toLowerCase();
    const hit = k ? list.filter((c) => c.name.toLowerCase().includes(k) || c.code.toLowerCase().includes(k) || c.bizNo.includes(k)) : list;
    return { items: hit.slice(offset, offset + 50), total: hit.length };
  };
}

/**
 * 기준정보용 화주사 선택 칸 — 드롭다운 대신 [찾기] 창 (2026-11-06 Sol 결정, 화주사가 많아져도 고를 수 있게)
 * value는 화주사 id 문자열("" = 없음). 조회조건은 placeholder "전체" + × 지우기, 입력 화면은 "화주사를 선택하세요".
 */
export function ClientPicker({
  id,
  value,
  onChange,
  clients,
  placeholder = "전체",
  clearable = true,
  disabled,
  autoFocus,
  block = false,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  clients: { id: number; code: string; name: string; isActive: boolean; bizNo?: string }[];
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** 입력 화면: 다른 입력칸처럼 칸 너비를 꽉 채운다 */
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const picked = value ? clients.find((c) => String(c.id) === value) : undefined;
  const search = localSearch(clients.map((c) => ({ id: c.id, code: c.code, name: c.name, isActive: c.isActive, bizNo: c.bizNo ?? "" })));
  return (
    <div className={`${styles.field} ${block ? styles.block : ""}`}>
      <button
        type="button"
        id={id}
        className={styles.picker}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        disabled={disabled}
        autoFocus={autoFocus}
      >
        <span className={picked ? styles.value : styles.placeholder}>
          {picked ? `${picked.name}${picked.isActive ? "" : " (사용 안 함)"}` : placeholder}
        </span>
        <span className={styles.find}>찾기</span>
      </button>
      {picked && clearable && !disabled && (
        <button type="button" className={styles.clear} onClick={() => onChange("")} aria-label={`화주사 ${picked.name} 지우기`} title="지우기">
          ×
        </button>
      )}
      {open && (
        <ClientFinderModal
          search={search}
          onClose={() => setOpen(false)}
          onPick={(c) => {
            onChange(String(c.id));
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** 화주사 찾기 창 — 화주사명·코드·사업자번호 검색, 50개씩, 행을 누르면 선택 */
export function ClientFinderModal({
  onClose,
  onPick,
  search = serverSearch,
}: {
  onClose: () => void;
  onPick: (c: PickedClient) => void;
  search?: ClientSearch;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ClientPick[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  async function load(offset: number) {
    const my = ++seq.current;
    setLoading(true);
    const r = await search({ q, offset });
    if (my !== seq.current) return;
    setLoading(false);
    if (!r) return;
    setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    setTotal(r.total);
  }

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 검색어가 바뀔 때만
  }, [q]);

  return (
    <Modal
      open
      onClose={onClose}
      title="화주사 찾기"
      description="화주사명·화주사 코드·사업자번호로 찾고, 행을 눌러 고릅니다."
      footer={<Button onClick={onClose}>닫기</Button>}
    >
      <input
        className={styles.search}
        type="search"
        aria-label="화주사 검색"
        placeholder="화주사명, 코드(HB01), 사업자번호"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-autofocus
      />
      <div className={styles.listWrap} aria-busy={loading}>
        <table className={styles.table}>
          <caption className="sr-only">화주사 검색 결과</caption>
          <thead>
            <tr>
              <th>코드</th>
              <th>화주사명</th>
              <th>사업자번호</th>
              <th>사용</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr
                key={c.id}
                tabIndex={0}
                onClick={() => onPick({ id: c.id, name: c.name })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick({ id: c.id, name: c.name });
                  }
                }}
              >
                <td className="mono">{c.code}</td>
                <td>{c.name}</td>
                <td className="mono">{c.bizNo || "-"}</td>
                <td className={c.isActive ? undefined : styles.off}>{c.isActive ? "사용" : "사용 안 함"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && <p className={styles.empty}>찾는 화주사가 없습니다.</p>}
        {loading && items.length === 0 && <p className={styles.empty}>찾는 중…</p>}
      </div>
      <div className={styles.pager}>
        <span className="muted">
          {total.toLocaleString()}곳 중 {items.length.toLocaleString()}곳 표시
        </span>
        {items.length < total && (
          <Button size="sm" onClick={() => void load(items.length)} disabled={loading}>
            더 보기
          </Button>
        )}
      </div>
    </Modal>
  );
}
