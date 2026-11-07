"use client";

import { FilterField } from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Form";
import styles from "./PlanSearchFields.module.css";

/**
 * 입고예정 목록 검색 — [입고예정번호] / [품목(코드·이름)] 두 칸 (2026-11-04 Sol 결정).
 * 품목은 코드인지 이름인지 가리지 않고 아는 대로 친다.
 */
export function PlanSearchFields({
  no,
  item,
  onNo,
  onItem,
}: {
  no: string;
  item: string;
  onNo: (v: string) => void;
  onItem: (v: string) => void;
}) {
  return (
    <>
      <FilterField label="입고예정번호" htmlFor="f-no">
        <Input id="f-no" type="search" className={`${styles.no} mono`} placeholder="IP-20261104-0001" value={no} onChange={(e) => onNo(e.target.value)} />
      </FilterField>
      <FilterField label="품목" htmlFor="f-item">
        <Input id="f-item" type="search" className={styles.item} placeholder="품목코드 또는 품목명" value={item} onChange={(e) => onItem(e.target.value)} />
      </FilterField>
    </>
  );
}

/** 입고예정번호 — 대소문자·하이픈 없이 일부만 쳐도 찾는다 (예: 0001, 20261104) */
export const matchPlanNo = (planNo: string, q: string) => {
  const t = q.trim().toUpperCase().replace(/-/g, "");
  return !t || planNo.toUpperCase().replace(/-/g, "").includes(t);
};

/** 날짜 기간(기본: 입고예정일) — 달력 두 칸 (시작 ~ 끝), 한쪽만 넣어도 된다 */
export function DateRangeField({
  from,
  to,
  onFrom,
  onTo,
  label = "입고예정일",
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  label?: string;
}) {
  return (
    <FilterField label={label} htmlFor="f-from">
      <span className={styles.range}>
        <Input id="f-from" type="date" aria-label={`${label} 시작`} value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} />
        <span aria-hidden>~</span>
        <Input type="date" aria-label={`${label} 끝`} value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} />
        {/* [기간 지우기] 버튼은 뺐다 — 달력 팝업의 [삭제]로 지운다 (2026-11-07 Sol 피드백: 자리를 많이 차지) */}
      </span>
    </FilterField>
  );
}
