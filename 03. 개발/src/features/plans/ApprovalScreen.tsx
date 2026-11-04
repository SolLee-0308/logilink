"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { FilterBar, FilterCheckbox, FilterField } from "@/components/ui/FilterBar";
import { DateRangeField, PlanSearchFields, matchPlanNo } from "./PlanSearchFields";
import { Sheet } from "@/components/ui/Overlay";
import { RuleList } from "@/components/ui/RuleList";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { APPROVAL_LIST_KEY, APPROVAL_TABS, approvalListSearch, inRange, type ApprovalListQuery } from "./approval-list";
import { ClientFilter, type PickedClient } from "./ClientFinder";
import { APPROVAL_RULES } from "./rules";
import type { ApprovalRow, ApprovalTab } from "./types";

export const TAB_LABEL: Record<ApprovalTab, string> = { wait: "승인대기", rej: "반려 · 화주사 수정 중", done: "오늘 처리" };

/** BOX 245 · PLT 4 */
export const qtyText = (q: [string, number][]) => q.map(([u, n]) => `${u} ${n.toLocaleString()}`).join(" · ");

/**
 * 승인 대기 목록 — 표를 넓게 쓰고, 행을 누르면 상세 화면(/plans/approval/[id])에서 품목을 확인한 뒤 승인·반려한다.
 * 조회조건은 주소에 남겨 상세에서 돌아와도 그대로.
 */
export function ApprovalScreen({
  rows,
  today,
  initial,
  initialClient,
}: {
  rows: ApprovalRow[];
  today: string;
  initial: ApprovalListQuery;
  /** 주소의 화주사 조건 (이름 표시용) */
  initialClient: PickedClient | null;
}) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<ApprovalTab>(initial.tab);
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const clientId = client ? String(client.id) : "";
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [revOnly, setRevOnly] = useState(initial.rev);
  const [no, setNo] = useState(initial.no);
  const [item, setItem] = useState(initial.item);

  useEffect(() => {
    const url = `/plans/approval${approvalListSearch({ tab, client: clientId, from, to, rev: revOnly, no, item })}`;
    window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(APPROVAL_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [tab, clientId, from, to, revOnly, no, item]);

  const counts = useMemo(() => {
    const c: Record<ApprovalTab, number> = { wait: 0, rej: 0, done: 0 };
    rows.forEach((r) => c[r.tab]++);
    return c;
  }, [rows]);

  const list = useMemo(
    () =>
      rows
        .filter((r) => {
          if (r.tab !== tab) return false;
          if (clientId && r.clientId !== Number(clientId)) return false;
          if (!inRange(r.planDate, from, to)) return false;
          if (revOnly && r.revisionNo < 2) return false;
          return matchPlanNo(r.planNo, no) && includesText(r.itemTexts, item);
        })
        .sort((a, b) =>
          tab === "done"
            ? (b.processed?.at ?? "").localeCompare(a.processed?.at ?? "")
            : a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo),
        ),
    [rows, tab, clientId, from, to, revOnly, no, item],
  );

  const columns: Column<ApprovalRow>[] = [
    {
      key: "no",
      header: "입고예정번호",
      render: (r) => (
        <span className="cell-tags">
          <span className="mono">{r.planNo}</span>
          {r.revisionNo > 1 && <Tag tone="accent">재요청</Tag>}
          {r.tab !== "done" && dday(r.planDate, today) < 0 && <Tag tone="warn">기한 지남</Tag>}
        </span>
      ),
    },
    { key: "client", header: "화주사", render: (r) => r.clientName },
    { key: "center", header: "센터", render: (r) => r.centerName },
    {
      key: "date",
      header: "입고예정일",
      render: (r) => (
        <>
          <span className="mono">{r.planDate}</span>
          <CellSub>{ddayLabel(dday(r.planDate, today))}</CellSub>
        </>
      ),
    },
    {
      key: "qty",
      header: "품목 · 수량",
      align: "right",
      render: (r) => (
        <>
          <span className="mono">{r.lineCount}종</span>
          <CellSub mono>{qtyText(r.qtyByUnit)}</CellSub>
        </>
      ),
    },
    { key: "rev", header: "차수", align: "right", render: (r) => <span className="mono">{r.revisionNo}차</span> },
    tab === "done"
      ? {
          key: "processed",
          header: "내 처리",
          render: (r) => (
            <>
              <span className="mono">{fmtShortDateTime(r.processed?.at)}</span>
              <CellSub>{r.processed?.action === "APPROVE" ? "승인" : "반려"}</CellSub>
            </>
          ),
        }
      : {
          key: "saved",
          header: "최종 저장",
          render: (r) => (
            <>
              <span className="mono">{fmtShortDateTime(r.savedAt)}</span>
              <CellSub>{r.savedBy}</CellSub>
            </>
          ),
        },
    { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader crumbs={["입고 계획", "승인 대기"]} title="승인 대기" count={counts.wait} onHelp={() => setHelp(true)} />
      <Sheet open={help} onClose={() => setHelp(false)} title="이 화면의 업무 규칙">
        <RuleList rules={APPROVAL_RULES} source="입고 업무프로세스 정의서 v1.4" />
      </Sheet>
      <FilterBar>
        <FilterField label="화주사" htmlFor="f-client">
          <ClientFilter id="f-client" value={client} onChange={setClient} />
        </FilterField>
        <DateRangeField from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <FilterCheckbox id="f-rev" label="재요청 건만" checked={revOnly} onChange={setRevOnly} />
        <PlanSearchFields no={no} item={item} onNo={setNo} onItem={setItem} />
      </FilterBar>
      <Tabs
        label="처리 구분"
        value={tab}
        onChange={setTab}
        panelId="approval-body"
        items={APPROVAL_TABS.map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] }))}
      />
      <div id="approval-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <ListToolbar total={list.length} />
        <DataTable
          caption={`${TAB_LABEL[tab]} 입고예정 목록`}
          columns={columns}
          rows={list}
          rowKey={(r) => String(r.id)}
          onActivate={(k) => router.push(`/plans/approval/${k}`)}
          empty={
            tab === "wait" && counts.wait === 0
              ? "승인할 입고예정이 없습니다."
              : tab === "done" && counts.done === 0
                ? "오늘 처리한 입고예정이 없습니다."
                : "조건에 맞는 입고예정이 없습니다. 조회조건을 바꿔 보세요."
          }
        />
      </div>
    </>
  );
}
