"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { CreateButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { inRange } from "../approval-list";
import { DateRangeField, PlanSearchFields, matchPlanNo } from "../PlanSearchFields";
import { Select } from "@/components/ui/Form";
import { Tabs, TabTotal } from "@/components/ui/Tabs";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { PLAN_INPUT_METHOD_LABEL } from "@/domain/plan-status";
import { fmtDateTime, includesText } from "@/lib/format";
import { MasterHeader } from "@/features/master/shared";
import { ENTRY_RULES } from "../rules";
import type { CenterOption, EntryRow, EntryTab } from "../types";
import { ENTRY_LIST_KEY, ENTRY_TABS, entryListSearch, type EntryListQuery } from "./entry-list";
import styles from "./EntryListScreen.module.css";

const TAB_LABEL: Record<EntryTab, string> = { wait: "승인대기", rej: "반려 · 수정 필요", approved: "최근 승인", canceled: "최근 취소" };
const qtyText = (q: [string, number][]) => q.map(([u, n]) => `${u} ${n.toLocaleString()}`).join(" · ");

/**
 * 입고예정 등록 (화주사) — 승인 전 건(승인대기·반려)과 최근 30일 승인·취소 건.
 * 행을 누르면 상세(수정·취소·재요청), [+ 입고예정 등록]은 등록 화면(직접 입력·엑셀·AI 판독).
 */
export function EntryListScreen({
  rows,
  centers,
  defaultCenterId,
  today,
  initial,
}: {
  rows: EntryRow[];
  centers: CenterOption[];
  /** 로그인 사용자의 기본 센터 (사용자·역할에서 지정) */
  defaultCenterId: string;
  today: string;
  initial: EntryListQuery;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<EntryTab>(initial.tab ?? (rows.some((r) => r.tab === "rej") ? "rej" : "wait"));
  // 센터: 주소에 없으면 사용자 기본 센터, "all"이면 전체
  const [center, setCenter] = useState(initial.center === "all" ? "" : initial.center || defaultCenterId);
  const [no, setNo] = useState(initial.no);
  const [item, setItem] = useState(initial.item);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    // 기본 센터가 있는데 전체를 고르면 "all"로 남겨 다음에도 전체로
    const url = `/plans/entry${entryListSearch({ tab, center: center || (defaultCenterId ? "all" : ""), no, item, from, to })}`;
    window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(ENTRY_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [tab, center, no, item, from, to, defaultCenterId]);

  const counts = useMemo(() => {
    const c: Record<EntryTab, number> = { wait: 0, rej: 0, approved: 0, canceled: 0 };
    rows.forEach((r) => c[r.tab]++);
    return c;
  }, [rows]);

  const list = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.tab === tab &&
            (!center || r.centerId === Number(center)) &&
            matchPlanNo(r.planNo, no) &&
            includesText(r.itemTexts, item) &&
            inRange(r.planDate, from, to),
        )
        .sort((a, b) =>
          tab === "approved" || tab === "canceled"
            ? (b.closedAt ?? "").localeCompare(a.closedAt ?? "")
            : a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo),
        ),
    [rows, tab, center, no, item, from, to],
  );

  const columns: Column<EntryRow>[] = [
    {
      key: "no",
      header: "입고예정번호",
      align: "center",
      render: (r) => (
        <span className="cell-tags">
          <span className="mono">{r.planNo}</span>
          {r.revisionNo > 1 && <Tag tone="accent">{r.revisionNo}차</Tag>}
        </span>
      ),
    },
    {
      key: "date",
      header: "입고예정일",
      align: "center",
      render: (r) => {
        const n = dday(r.planDate, today);
        const open = r.tab === "wait" || r.tab === "rej";
        return (
          <>
            <span className="mono">{r.planDate}</span>
            <CellSub>{open && n < 0 ? <span className={styles.over}>기한 지남 · 일마감 때 취소</span> : ddayLabel(n)}</CellSub>
          </>
        );
      },
    },
    ...(centers.length > 1 ? [{ key: "center", header: "센터", render: (r: EntryRow) => r.centerName }] : []),
    { key: "method", header: "등록 방식", align: "center", render: (r) => PLAN_INPUT_METHOD_LABEL[r.inputMethod] },
    {
      key: "lines",
      header: "품목·수량",
      wrap: true,
      render: (r) => (
        <>
          {r.lineCount.toLocaleString()}품목
          <CellSub mono>{qtyText(r.qtyByUnit)}</CellSub>
        </>
      ),
    },
    ...(tab === "rej" ? [{ key: "reason", header: "반려 사유", wrap: true, render: (r: EntryRow) => r.rejectReason ?? "–" }] : []),
    {
      key: "saved",
      header: tab === "approved" ? "승인" : tab === "canceled" ? "취소" : "최종 저장",
      align: "center",
      // 1줄 YYYY-MM-DD, 2줄 이름(왼쪽)·시각(오른쪽) (2026-11-14 Sol). 승인·취소 탭은 이름 없이 시각만
      render: (r) => {
        const closed = tab === "approved" || tab === "canceled";
        const at = fmtDateTime(closed ? r.closedAt : r.savedAt);
        if (!at) return <span className="muted">–</span>;
        return (
          <span className={styles.stamp}>
            <span className="mono">{at.slice(0, 10)}</span>
            <CellSub>
              <span className={styles.stampSub}>
                <span>{closed ? "" : r.savedBy}</span>
                <span className="mono">{at.slice(11, 16)}</span>
              </span>
            </CellSub>
          </span>
        );
      },
    },
    { key: "status", header: "상태", align: "center", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <MasterHeader
        title="입고예정 등록"
        count={counts.wait}
        rules={ENTRY_RULES}
        crumbs={["입고 계획", "입고예정 등록"]}
        actions={<CreateButton href="/plans/entry/new">입고예정 등록</CreateButton>}
      />
      {(centers.length > 1 || rows.length > 0) && (
        <FilterBar>
          {centers.length > 1 && (
            <FilterField label="센터" htmlFor="f-center">
              <Select id="f-center" value={center} onChange={(e) => setCenter(e.target.value)}>
                <option value="">전체</option>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {String(c.id) === defaultCenterId ? " (기본)" : ""}
                  </option>
                ))}
              </Select>
            </FilterField>
          )}
          <DateRangeField from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <PlanSearchFields no={no} item={item} onNo={setNo} onItem={setItem} />
        </FilterBar>
      )}
      <Tabs label="입고예정 상태" value={tab} onChange={setTab} panelId="entry-list" items={ENTRY_TABS.map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] }))}
        aside={<TabTotal total={list.length} />}
      />
      <div id="entry-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <DataTable
          caption="입고예정 목록"
          columns={columns}
          rows={list}
          rowKey={(r) => String(r.id)}
          onActivate={(k) => router.push(`/plans/entry/${k}`)}
          empty={
            tab === "wait"
              ? "승인을 기다리는 입고예정이 없습니다. [+ 입고예정 등록]으로 새로 등록하세요."
              : tab === "rej"
                ? "반려된 입고예정이 없습니다."
                : tab === "approved"
                  ? "최근 30일 동안 승인된 입고예정이 없습니다."
                  : "최근 30일 동안 취소된 입고예정이 없습니다."
          }
        />
      </div>
    </>
  );
}
