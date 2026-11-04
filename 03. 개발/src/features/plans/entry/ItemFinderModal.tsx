"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/FilterBar";
import { Modal } from "@/components/ui/Overlay";
import { STORAGE_TEMP_LABEL, STORAGE_TEMPS, type StorageTemp } from "@/domain/master";
import type { CatalogItem } from "@/domain/plan-entry";
import { searchPlanItems } from "@/server/plans/actions";
import styles from "./ItemFinderModal.module.css";

type Scope = "all" | "recent";
type TempFilter = "all" | StorageTemp;

/**
 * 품목 찾기 창 — 품목이 많아도 찾기 쉽게 서버 검색(품목코드·품목명·바코드·별칭) + 온도대 + 최근 입고 품목.
 * 여러 개를 체크해 한 번에 줄로 넣는다. 이미 입고예정에 있는 품목은 표시만 하고 다시 넣을 수도 있다.
 */
export function ItemFinderModal({
  initialQuery,
  inPlan,
  onClose,
  onAdd,
}: {
  initialQuery: string;
  /** 이미 줄에 있는 품목 id */
  inPlan: Set<number>;
  onClose: () => void;
  onAdd: (items: CatalogItem[]) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [scope, setScope] = useState<Scope>(initialQuery ? "all" : "recent");
  const [temp, setTemp] = useState<TempFilter>("all");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Map<number, CatalogItem>>(new Map());
  const seq = useRef(0);

  async function load(offset: number) {
    const my = ++seq.current;
    setLoading(true);
    const r = await searchPlanItems({ q, temp: temp === "all" ? null : temp, recent: scope === "recent", offset });
    if (my !== seq.current) return;
    setLoading(false);
    if (!r.ok) return;
    setItems((prev) => (offset === 0 ? r.data!.items : [...prev, ...r.data!.items]));
    setTotal(r.data!.total);
  }

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 조회조건이 바뀔 때만
  }, [q, temp, scope]);

  function toggle(it: CatalogItem) {
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(it.id)) n.delete(it.id);
      else n.set(it.id, it);
      return n;
    });
  }

  const allShownPicked = items.length > 0 && items.every((i) => picked.has(i.id));

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="품목 찾기"
      description="품목코드·품목명·바코드·별칭으로 찾고, 넣을 품목을 체크해 한 번에 줄로 추가합니다."
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.size) onAdd([...picked.values()]);
      }}
      footer={
        <>
          <span className={styles.picked}>
            {picked.size ? (
              <>
                <strong className="mono">{picked.size}</strong>개 선택
                <button type="button" className={styles.clear} onClick={() => setPicked(new Map())}>
                  선택 해제
                </button>
              </>
            ) : (
              "품목을 체크하세요"
            )}
          </span>
          <Button onClick={onClose}>닫기</Button>
          <Button type="submit" variant="primary" disabled={!picked.size}>
            {picked.size ? `${picked.size}개 줄 추가` : "줄 추가"}
          </Button>
        </>
      }
    >
      <div className={styles.controls}>
        <input
          className={styles.search}
          type="search"
          aria-label="품목 검색"
          placeholder="품목코드, 품목명, 바코드, 별칭"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value && scope === "recent") setScope("all");
          }}
          data-autofocus
        />
        <ChipGroup
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "전체 품목" },
            { value: "recent", label: "최근 입고 품목" },
          ]}
        />
        <ChipGroup
          value={temp}
          onChange={setTemp}
          options={[{ value: "all" as TempFilter, label: "전체 온도" }, ...STORAGE_TEMPS.map((t) => ({ value: t as TempFilter, label: STORAGE_TEMP_LABEL[t] }))]}
        />
      </div>

      <div className={styles.listWrap} aria-busy={loading}>
        <table className={styles.table}>
          <caption className="sr-only">품목 검색 결과</caption>
          <thead>
            <tr>
              <th className={styles.cCheck}>
                <input
                  type="checkbox"
                  aria-label="보이는 품목 모두 선택"
                  checked={allShownPicked}
                  onChange={() =>
                    setPicked((m) => {
                      const n = new Map(m);
                      items.forEach((i) => (allShownPicked ? n.delete(i.id) : n.set(i.id, i)));
                      return n;
                    })
                  }
                />
              </th>
              <th>품목코드</th>
              <th>품목명</th>
              <th>단위</th>
              <th>온도대</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className={picked.has(it.id) ? styles.on : undefined} onClick={() => toggle(it)}>
                <td className={styles.cCheck}>
                  <input type="checkbox" aria-label={`${it.code} ${it.name} 선택`} checked={picked.has(it.id)} onChange={() => toggle(it)} onClick={(e) => e.stopPropagation()} />
                </td>
                <td className="mono">{it.code}</td>
                <td>
                  {it.name}
                  {inPlan.has(it.id) && <span className={styles.already}>이미 추가됨</span>}
                </td>
                <td className="mono">{it.uoms.map((u) => u.unit).join("·")}</td>
                <td>{it.storageTemp ? STORAGE_TEMP_LABEL[it.storageTemp] : "–"}</td>
                <td className={styles.flags}>{[it.expiryManaged && "유통기한", it.lotManaged && "로트"].filter(Boolean).join("·") || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <p className={styles.empty}>{scope === "recent" ? "최근 입고예정에 넣은 품목이 없습니다. [전체 품목]에서 찾아보세요." : "찾는 품목이 없습니다. 품목코드·바코드로도 찾아보세요."}</p>
        )}
        {loading && <p className={styles.empty}>찾는 중…</p>}
      </div>
      <div className={styles.pager}>
        <span className="muted">
          {total.toLocaleString()}건 중 {items.length.toLocaleString()}건 표시
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
