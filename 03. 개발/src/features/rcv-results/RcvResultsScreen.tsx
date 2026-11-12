"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Tag } from "@/components/ui/Badges";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Form";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { addDays } from "@/domain/inquiry-rules";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { reverseRcv } from "@/server/rcv/web-actions";
import { MasterHeader, useAction } from "@/features/master/shared";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { DateRangeField } from "@/features/plans/PlanSearchFields";
import { RCV_RESULT_RULES } from "./rules";
import type { RcvResultQuery, RcvResultRow, RcvResultTab } from "./types";
import styles from "./RcvResultsScreen.module.css";

type CloseFilter = "all" | "open" | "closed";
type IssueFilter = "all" | "issue";

const n = (v: number) => v.toLocaleString();

/**
 * 입고검수 실적 (2026-11-12) — 3PL 조회 전용. 차량(검수 1건) 단위 목록.
 * 탭: 확정 / 검수 중. 기간(업무일)은 서버 조회, 화주사·센터·일마감·차이·검색은 화면에서 거른다.
 * 행의 검수번호를 누르면 ASN·상차 현황 상세(무지시는 상차 상세)의 검수 결과로.
 */
export function RcvResultsScreen({
  query,
  rows,
  centers,
  today,
  canCancel = false,
  cancelReasons = [],
}: {
  query: RcvResultQuery;
  rows: RcvResultRow[];
  centers: { id: number; name: string }[];
  today: string;
  /** 입고취소 권한 — 3PL 관리자 */
  canCancel?: boolean;
  cancelReasons?: ReasonOption[];
}) {
  const router = useRouter();
  const act = useAction();
  /** 입고취소할 실적 */
  const [reversing, setReversing] = useState<RcvResultRow | null>(null);
  const canceledTab = query.tab === "canceled";
  const [client, setClient] = useState("");
  const [center, setCenter] = useState("");
  const [closed, setClosed] = useState<CloseFilter>("all");
  const [issue, setIssue] = useState<IssueFilter>("all");
  const [search, setSearch] = useState("");
  const confirmed = query.tab === "confirmed";
  const multiCenter = centers.length > 1 || new Set(rows.map((r) => r.centerId)).size > 1;
  const clients = useMemo(() => [...new Map(rows.map((r) => [r.clientId, r.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);

  /** 서버 조건(탭·기간)을 주소로 — 빈 기간은 "-" */
  const go = (next: Partial<RcvResultQuery>) => {
    const q = { ...query, ...next };
    const p = new URLSearchParams();
    if (q.tab !== "confirmed") p.set("tab", q.tab);
    p.set("from", q.from || "-");
    p.set("to", q.to || "-");
    router.replace(`/rcv-results?${p}`, { scroll: false });
  };

  const list = useMemo(
    () =>
      rows
        .filter((r) => !client || String(r.clientId) === client)
        .filter((r) => !center || String(r.centerId) === center)
        .filter((r) => !confirmed || closed === "all" || (closed === "closed") === !!r.closedDate)
        .filter((r) => !confirmed || issue === "all" || r.issueCount > 0)
        .filter((r) => !search.trim() || includesText([r.rcvNo, r.vehicleNo, r.loadNo, r.asnNo, r.clientName, ...r.itemTexts], search)),
    [rows, client, center, closed, issue, search, confirmed],
  );
  const sum = {
    good: list.reduce((s, r) => s + r.goodBaseQty, 0),
    ret: list.reduce((s, r) => s + r.returnBaseQty, 0),
    issue: list.filter((r) => r.issueCount > 0).length,
    open: list.filter((r) => !r.closedDate).length,
  };

  const columns: Column<RcvResultRow>[] = [
    {
      key: "no",
      header: "검수번호",
      render: (r) => (
        <Link href={r.href} className={`mono ${styles.link}`}>
          {r.rcvNo}
        </Link>
      ),
    },
    { key: "day", header: "업무일", render: (r) => <span className="mono">{r.businessDate}</span> },
    {
      key: "at",
      header: confirmed ? "확정" : canceledTab ? "입고취소" : "시작",
      render: (r) => <span className="mono">{fmtShortDateTime(confirmed ? r.confirmedAt : canceledTab ? (r.reverse?.at ?? null) : r.startedAt)}</span>,
    },
    { key: "vehicle", header: "차량", render: (r) => <span className="mono">{r.vehicleNo}</span> },
    { key: "client", header: "화주사", render: (r) => r.clientName },
    ...(multiCenter ? [{ key: "center", header: "센터", render: (r: RcvResultRow) => r.centerName }] : []),
    {
      key: "load",
      header: "상차",
      render: (r) => (
        <>
          {r.loadType === "UNORDERED" ? <Tag tone="warn">{LOAD_TYPE_LABEL[r.loadType]}</Tag> : <span>{LOAD_TYPE_LABEL[r.loadType]}</span>}
          <span className={styles.sub}>
            <span className="mono">{r.loadNo}</span>
            {r.asnNo && <span className="mono"> · {r.asnNo}</span>}
          </span>
        </>
      ),
    },
    { key: "lines", header: "품목", align: "right", render: (r) => <span className="mono">{r.lineCount}</span> },
    { key: "good", header: "입고", align: "right", render: (r) => <span className="mono">{n(r.goodBaseQty)}</span> },
    { key: "ret", header: "반송", align: "right", render: (r) => (r.returnBaseQty ? <span className="mono">{n(r.returnBaseQty)}</span> : <span className="muted">–</span>) },
    ...(confirmed
      ? [
          { key: "issue", header: "차이", render: (r: RcvResultRow) => (r.issueCount ? <Tag tone="warn">{r.issueCount}품목</Tag> : <span className="muted">–</span>) },
          {
            key: "close",
            header: "일마감",
            render: (r: RcvResultRow) => (r.closedDate ? <span className="mono">{r.closedDate}</span> : <Tag tone="neutral">미마감</Tag>),
          },
          { key: "by", header: "확정자", render: (r: RcvResultRow) => r.confirmedBy ?? "-" },
          // 입고취소 (3PL 관리자, 일마감 전) — 못 하면 이유를 마우스 올림으로
          ...(canCancel
            ? [
                {
                  key: "cancel",
                  header: "",
                  render: (r: RcvResultRow) =>
                    r.cancelBlock ? (
                      <span className="muted" title={r.cancelBlock}>
                        –
                      </span>
                    ) : (
                      <Button size="sm" variant="dangerSoft" onClick={() => setReversing(r)} disabled={act.pending}>
                        입고취소
                      </Button>
                    ),
                },
              ]
            : []),
        ]
      : canceledTab
        ? [
            {
              key: "reverse",
              header: "역전표",
              wrap: true,
              render: (r: RcvResultRow) =>
                r.reverse ? (
                  <>
                    <span className="mono">{r.reverse.no}</span>
                    <span className={styles.sub}>
                      {r.reverse.by} · {r.reverse.reasonName}
                      {r.reverse.reasonText ? ` — ${r.reverse.reasonText}` : ""}
                    </span>
                  </>
                ) : (
                  "-"
                ),
            },
          ]
        : [{ key: "workers", header: "검수자", align: "right" as const, render: (r: RcvResultRow) => <span className="mono">{r.workerCount}명</span> }]),
  ];

  return (
    <>
      <MasterHeader title="입고검수 실적" count={rows.length} rules={RCV_RESULT_RULES} crumbs={["입고 운영", "입고검수 실적"]} />

      <FilterBar>
        <DateRangeField label="업무일" from={query.from} to={query.to} onFrom={(v) => go({ from: v })} onTo={(v) => go({ to: v })} />
        <FilterField label="빠른 선택">
          <ChipGroup
            value={query.from === today && query.to === today ? "today" : query.from === addDays(today, -6) && query.to === today ? "week" : "custom"}
            onChange={(v) => v !== "custom" && go(v === "today" ? { from: today, to: today } : { from: addDays(today, -6), to: today })}
            options={[
              { value: "today", label: "오늘" },
              { value: "week", label: "최근 7일" },
              { value: "custom", label: "직접" },
            ]}
          />
        </FilterField>
        <FilterField label="화주사" htmlFor="rr-client">
          <Select id="rr-client" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">전체</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FilterField>
        {multiCenter && (
          <FilterField label="센터" htmlFor="rr-center">
            <Select id="rr-center" value={center} onChange={(e) => setCenter(e.target.value)}>
              <option value="">전체</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        {confirmed && (
          <>
            <FilterField label="일마감">
              <ChipGroup
                value={closed}
                onChange={setClosed}
                options={[
                  { value: "all", label: "전체" },
                  { value: "open", label: "미마감" },
                  { value: "closed", label: "마감됨" },
                ]}
              />
            </FilterField>
            <FilterField label="차이">
              <ChipGroup
                value={issue}
                onChange={setIssue}
                options={[
                  { value: "all", label: "전체" },
                  { value: "issue", label: "차이 있음" },
                ]}
              />
            </FilterField>
          </>
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="검수번호·차량·상차확인서·ASN·품목" />
      </FilterBar>

      <Tabs<RcvResultTab>
        label="검수 상태"
        value={query.tab}
        onChange={(t) => go({ tab: t })}
        items={[
          { key: "confirmed", label: "확정", count: query.tab === "confirmed" ? rows.length : undefined },
          { key: "working", label: "검수 중", count: query.tab === "working" ? rows.length : undefined },
          { key: "canceled", label: "입고취소", count: canceledTab ? rows.length : undefined },
        ]}
      />

      <ListToolbar total={list.length}>
        <span className={styles.sum}>
          입고 <b className="mono">{n(sum.good)}</b> · 반송 <b className="mono">{n(sum.ret)}</b>
          {confirmed && (
            <>
              {" "}
              · 차이 있음 <b className="mono">{sum.issue}</b>대 · 미마감 <b className="mono">{sum.open}</b>대
            </>
          )}
          <span className={styles.unit}> (기준 단위 합계)</span>
        </span>
      </ListToolbar>

      <DataTable
        caption={confirmed ? "검수 확정 실적" : canceledTab ? "입고취소한 실적" : "검수 중인 차량"}
        columns={columns}
        rows={list}
        rowKey={(r) => String(r.id)}
        empty={
          rows.length
            ? "조건에 맞는 실적이 없습니다."
            : confirmed
              ? "이 기간에 검수 확정한 실적이 없습니다."
              : canceledTab
                ? "이 기간에 입고취소한 실적이 없습니다."
                : "이 기간에 시작해 검수 중인 차량이 없습니다."
        }
      />

      {/* 입고취소 역전표 (2026-11-12) — 사유 필수, 되돌릴 수 없음 */}
      <RejectModal
        open={!!reversing}
        onClose={() => setReversing(null)}
        title="입고취소"
        description="검수 확정 실적을 역전표로 되돌립니다. 입고예정의 입고·반송 누계와 상태, ASN 상태를 되돌리고, 같은 차량을 다시 검수할 수 있습니다. 역전표는 취소할 수 없습니다."
        reasonLabel="입고취소 사유"
        submitLabel="입고취소"
        closeLabel="닫기"
        placeholder="입고취소하는 이유를 적어 주세요."
        target={
          reversing && (
            <span>
              <span className="mono">{reversing.rcvNo}</span> · {reversing.vehicleNo} · {reversing.clientName} · 입고 {n(reversing.goodBaseQty)} · 반송 {n(reversing.returnBaseQty)} (기준 단위)
            </span>
          )
        }
        reasons={cancelReasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await reverseRcv({ rcvId: reversing!.id, version: reversing!.version, reasonCode, reasonText });
          if (r.ok) act.run(async () => r, () => (setReversing(null), router.refresh()));
          else if (r.code === "CONFLICT" || r.code === "STATE") {
            setReversing(null);
            act.run(async () => r, () => router.refresh());
            return { ok: true, message: "" };
          }
          return r;
        }}
      />
    </>
  );
}
