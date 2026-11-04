"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AsnStatusBadge } from "@/components/ui/Badges";
import { CreateButton, LinkButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { Input, Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { MasterHeader } from "@/features/master/shared";
import { inRange } from "@/features/plans/approval-list";
import { DateRangeField } from "@/features/plans/PlanSearchFields";
import type { CenterOption } from "@/features/plans/types";
import { ASN_RULES } from "./rules";
import type { AsnRow, AsnTab } from "./types";
import { ASN_LIST_KEY, ASN_TABS, asnListSearch, matchAsnText, type AsnListQuery } from "./asn-list";
import styles from "./AsnListScreen.module.css";

const TAB_LABEL: Record<AsnTab, string> = { wait: "상차 대기", loading: "상차 진행", done: "최근 입고완료", canceled: "최근 취소" };
const qtyText = (q: [string, number][]) => q.map(([u, n]) => `${u} ${n.toLocaleString()}`).join(" · ");

/**
 * ASN 등록 (화주사, /plans/asn) — 차량별 ASN 목록.
 * 행을 누르면 상세(상차지시서 인쇄·취소), [+ ASN 등록]은 승인 입고예정을 차량에 담는 화면.
 */
export function AsnListScreen({
  rows,
  centers,
  defaultCenterId,
  undistributed,
  today,
  initial,
}: {
  rows: AsnRow[];
  centers: CenterOption[];
  defaultCenterId: string;
  /** 아직 ASN에 다 담지 않은 승인 입고예정 수 */
  undistributed: number;
  today: string;
  initial: AsnListQuery;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<AsnTab>(initial.tab ?? "wait");
  const [center, setCenter] = useState(initial.center === "all" ? "" : initial.center || defaultCenterId);
  const [q, setQ] = useState(initial.q);
  const [item, setItem] = useState(initial.item);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    const url = `/plans/asn${asnListSearch({ tab, center: center || (defaultCenterId ? "all" : ""), q, item, from, to })}`;
    window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(ASN_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [tab, center, q, item, from, to, defaultCenterId]);

  const counts = useMemo(() => {
    const c: Record<AsnTab, number> = { wait: 0, loading: 0, done: 0, canceled: 0 };
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
            matchAsnText(r, q) &&
            includesText(r.itemTexts, item) &&
            inRange(r.shipDate, from, to),
        )
        .sort((a, b) =>
          tab === "done" || tab === "canceled"
            ? (b.closedAt ?? "").localeCompare(a.closedAt ?? "")
            : a.shipDate.localeCompare(b.shipDate) || a.asnNo.localeCompare(b.asnNo),
        ),
    [rows, tab, center, q, item, from, to],
  );

  const columns: Column<AsnRow>[] = [
    {
      key: "no",
      header: "ASN번호",
      render: (r) => (
        <>
          <span className="mono">{r.asnNo}</span>
          {r.loadOrderNo && <CellSub mono>지시서 {r.loadOrderNo}</CellSub>}
        </>
      ),
    },
    {
      key: "date",
      header: "출고일",
      render: (r) => {
        const n = dday(r.shipDate, today);
        return (
          <>
            <span className="mono">{r.shipDate}</span>
            <CellSub>{r.tab === "wait" && n < 0 ? <span className={styles.over}>출고일 지남</span> : ddayLabel(n)}</CellSub>
          </>
        );
      },
    },
    {
      key: "vehicle",
      header: "차량",
      render: (r) => (
        <>
          <span className="mono">{r.vehicleNo}</span>
          {r.driverName && <CellSub>{r.driverName}</CellSub>}
        </>
      ),
    },
    ...(centers.length > 1 ? [{ key: "center", header: "센터", render: (r: AsnRow) => r.centerName }] : []),
    {
      key: "plans",
      header: "입고예정",
      wrap: true,
      render: (r) => (
        <span className="mono">
          {r.planNos[0]}
          {r.planNos.length > 1 && <span className="muted"> 외 {r.planNos.length - 1}건</span>}
        </span>
      ),
    },
    {
      key: "lines",
      header: "품목·지시수량",
      wrap: true,
      render: (r) => (
        <>
          {r.lineCount}줄
          <CellSub mono>{qtyText(r.qtyByUnit)}</CellSub>
        </>
      ),
    },
    {
      key: "at",
      header: tab === "done" ? "입고완료" : tab === "canceled" ? "취소" : "등록",
      render: (r) =>
        tab === "done" || tab === "canceled" ? (
          <span className="mono">{fmtShortDateTime(r.closedAt)}</span>
        ) : (
          <>
            <span className="mono">{fmtShortDateTime(r.createdAt)}</span>
            <CellSub>{r.createdBy}</CellSub>
          </>
        ),
    },
    { key: "status", header: "상태", render: (r) => <AsnStatusBadge status={r.status} /> },
  ];

  return (
    <>
      <MasterHeader
        title="ASN 등록"
        count={counts.wait}
        rules={ASN_RULES}
        crumbs={["입고 계획", "ASN 등록"]}
        actions={<CreateButton href="/plans/asn/new">ASN 등록</CreateButton>}
      />
      {undistributed > 0 && (
        <NoteBox
          tone="info"
          action={
            <LinkButton size="sm" href="/plans/asn/new">
              차량에 담기
            </LinkButton>
          }
        >
          ASN에 아직 다 담지 않은 승인 입고예정이 <strong>{undistributed}건</strong> 있습니다. ASN에 담은 품목·수량만 상차하고 입고할 수 있습니다.
        </NoteBox>
      )}
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
          <DateRangeField label="출고일" from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <FilterField label="번호·차량" htmlFor="f-q">
            <Input id="f-q" type="search" className={`${styles.q} mono`} placeholder="ASN·입고예정번호, 차량번호" value={q} onChange={(e) => setQ(e.target.value)} />
          </FilterField>
          <FilterField label="품목" htmlFor="f-item">
            <Input id="f-item" type="search" className={styles.item} placeholder="품목코드 또는 품목명" value={item} onChange={(e) => setItem(e.target.value)} />
          </FilterField>
        </FilterBar>
      )}
      <Tabs label="ASN 상태" value={tab} onChange={setTab} panelId="asn-list" items={ASN_TABS.map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] }))} />
      <div id="asn-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <ListToolbar total={list.length} />
        <DataTable
          caption="ASN 목록"
          columns={columns}
          rows={list}
          rowKey={(r) => String(r.id)}
          onActivate={(k) => router.push(`/plans/asn/${k}`)}
          empty={
            tab === "wait"
              ? "상차를 기다리는 ASN이 없습니다. [+ ASN 등록]으로 승인된 입고예정을 차량에 담으세요."
              : tab === "loading"
                ? "상차 중이거나 상차를 마친 ASN이 없습니다."
                : tab === "done"
                  ? "최근 30일 동안 입고완료된 ASN이 없습니다."
                  : "최근 30일 동안 취소된 ASN이 없습니다."
          }
        />
      </div>
    </>
  );
}
