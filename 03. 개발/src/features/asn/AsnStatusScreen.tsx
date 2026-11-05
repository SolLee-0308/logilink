"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AsnStatusBadge } from "@/components/ui/Badges";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Form";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { MasterHeader } from "@/features/master/shared";
import { inRange } from "@/features/plans/approval-list";
import { ClientFilter, type PickedClient } from "@/features/plans/ClientFinder";
import { DateRangeField } from "@/features/plans/PlanSearchFields";
import { ASN_STATUS_RULES } from "./rules";
import type { AsnRow, AsnStatusTab } from "./types";
import { matchAsnText } from "./asn-list";
import { ASN_STATUS_LIST_KEY, ASN_STATUS_TABS, asnStatusSearch, type AsnStatusQuery } from "./asn-status-list";
import styles from "./AsnStatusScreen.module.css";

const TAB_LABEL: Record<AsnStatusTab, string> = { wait: "상차 대기", loading: "상차중", loaded: "검수 대기", done: "최근 입고완료", canceled: "최근 취소" };
const qtyText = (q: [string, number][]) => q.map(([u, n]) => `${u} ${n.toLocaleString()}`).join(" · ");
const tabOf = (r: AsnRow): AsnStatusTab =>
  r.status === "REGISTERED" ? "wait" : r.status === "LOADING" ? "loading" : r.status === "LOADED" ? "loaded" : r.status === "RECEIVED" ? "done" : "canceled";
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * ASN·상차 현황 (3PL, /plans/asn-status) — 소속 센터로 들어올 차량(ASN)과 상차 진행을 조회만 한다.
 * 위 요약(오늘·내일 출고, 출고일 지난 상차 대기)을 누르면 그 조건으로 걸러진다.
 */
export function AsnStatusScreen({
  rows,
  today,
  initial,
  initialClient,
  multiCenter,
}: {
  rows: AsnRow[];
  today: string;
  initial: AsnStatusQuery;
  initialClient: PickedClient | null;
  /** 여러 센터를 보는 계정이면 센터 열을 보인다 */
  multiCenter: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<AsnStatusTab>(initial.tab ?? "wait");
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const clientId = client ? String(client.id) : "";
  const [q, setQ] = useState(initial.q);
  const [item, setItem] = useState(initial.item);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);

  useEffect(() => {
    const url = `/plans/asn-status${asnStatusSearch({ tab, client: clientId, q, item, from, to })}`;
    window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(ASN_STATUS_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [tab, clientId, q, item, from, to]);

  /** 화주사·검색 조건까지 거른 행 (탭·기간 전) — 탭 건수와 요약이 같은 기준을 본다 */
  const base = useMemo(
    () => rows.filter((r) => (!clientId || r.clientId === Number(clientId)) && matchAsnText(r, q) && includesText(r.itemTexts, item)),
    [rows, clientId, q, item],
  );
  const dated = useMemo(() => base.filter((r) => inRange(r.shipDate, from, to)), [base, from, to]);

  const counts = useMemo(() => {
    const c: Record<AsnStatusTab, number> = { wait: 0, loading: 0, loaded: 0, done: 0, canceled: 0 };
    dated.forEach((r) => c[tabOf(r)]++);
    return c;
  }, [dated]);

  /** 요약 — 진행 중(상차 대기·상차중·검수 대기) ASN 기준 */
  const summary = useMemo(() => {
    const open = base.filter((r) => ["REGISTERED", "LOADING", "LOADED"].includes(r.status));
    const on = (d: string) => open.filter((r) => r.shipDate === d);
    return {
      today: on(today),
      tomorrow: on(tomorrow),
      overdue: open.filter((r) => r.status === "REGISTERED" && r.shipDate < today),
    };
  }, [base, today, tomorrow]);
  const clients = (list: AsnRow[]) => new Set(list.map((r) => r.clientId)).size;
  const pick = (f: string, t: string, nextTab?: AsnStatusTab) => {
    setFrom(f);
    setTo(t);
    if (nextTab) setTab(nextTab);
  };
  const isRange = (f: string, t: string) => from === f && to === t;

  const list = useMemo(
    () =>
      dated
        .filter((r) => tabOf(r) === tab)
        .sort((a, b) =>
          tab === "done" || tab === "canceled"
            ? (b.closedAt ?? "").localeCompare(a.closedAt ?? "")
            : a.shipDate.localeCompare(b.shipDate) || a.clientName.localeCompare(b.clientName) || a.kind.localeCompare(b.kind) || (a.asnNo || a.loadNo || "").localeCompare(b.asnNo || b.loadNo || ""),
        ),
    [dated, tab],
  );

  const columns: Column<AsnRow>[] = [
    {
      key: "date",
      header: "출고일",
      render: (r) => {
        const n = dday(r.shipDate, today);
        return (
          <>
            <span className="mono">{r.shipDate}</span>
            <CellSub>{r.status === "REGISTERED" && n < 0 ? <span className={styles.over}>출고일 지남</span> : ddayLabel(n)}</CellSub>
          </>
        );
      },
    },
    { key: "client", header: "화주사", render: (r) => r.clientName },
    {
      key: "vehicle",
      header: "차량",
      render: (r) => (
        <>
          <span className={`mono ${styles.vehicle}`}>{r.vehicleNo}</span>
          {(r.driverName || r.driverTel) && (
            <CellSub>
              {r.driverName}
              {r.driverTel ? <span className="mono"> {r.driverTel}</span> : null}
            </CellSub>
          )}
        </>
      ),
    },
    {
      key: "no",
      header: "ASN번호",
      render: (r) =>
        r.kind === "load" ? (
          <>
            <span className={styles.unordered}>무지시 상차</span>
            <CellSub mono>확인서 {r.loadNo}</CellSub>
          </>
        ) : (
          <>
            <span className="mono">{r.asnNo}</span>
            {r.loadNo && (r.status === "LOADED" || r.status === "RECEIVED") ? (
              <CellSub mono>확인서 {r.loadNo}</CellSub>
            ) : (
              r.loadOrderNo && <CellSub mono>지시서 {r.loadOrderNo}</CellSub>
            )}
          </>
        ),
    },
    ...(multiCenter ? [{ key: "center", header: "센터", render: (r: AsnRow) => r.centerName }] : []),
    {
      key: "plans",
      header: "입고예정",
      wrap: true,
      render: (r) =>
        r.kind === "load" ? (
          <span className="muted">ASN 없음</span>
        ) : (
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
          <CellSub mono>{r.kind === "load" ? `상차 ${qtyText(r.qtyByUnit) || "0"}` : qtyText(r.qtyByUnit)}</CellSub>
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
            <CellSub>{r.kind === "load" ? `${r.createdBy} · 상차 시작` : r.createdBy}</CellSub>
          </>
        ),
    },
    { key: "status", header: "상태", render: (r) => <AsnStatusBadge status={r.status} /> },
  ];

  return (
    <>
      <MasterHeader title="ASN·상차 현황" count={counts.wait + counts.loading + counts.loaded} rules={ASN_STATUS_RULES} crumbs={["입고 계획", "ASN·상차 현황"]} />

      {/* 요약 — 누르면 그 출고일로 거른다 */}
      <div className={styles.summary} role="group" aria-label="출고 요약">
        <button type="button" className={`${styles.tile} ${isRange(today, today) ? styles.tileOn : ""}`} onClick={() => pick(today, today)} aria-pressed={isRange(today, today)}>
          <span className={styles.tileLabel}>오늘 출고</span>
          <span className={styles.tileValue}>
            <b className="mono">{summary.today.length}</b>대
          </span>
          <span className={styles.tileSub}>화주사 {clients(summary.today)}곳 · 상차완료 {summary.today.filter((r) => r.status === "LOADED").length}대</span>
        </button>
        <button
          type="button"
          className={`${styles.tile} ${isRange(tomorrow, tomorrow) ? styles.tileOn : ""}`}
          onClick={() => pick(tomorrow, tomorrow)}
          aria-pressed={isRange(tomorrow, tomorrow)}
        >
          <span className={styles.tileLabel}>내일 출고</span>
          <span className={styles.tileValue}>
            <b className="mono">{summary.tomorrow.length}</b>대
          </span>
          <span className={styles.tileSub}>화주사 {clients(summary.tomorrow)}곳</span>
        </button>
        <button
          type="button"
          className={`${styles.tile} ${summary.overdue.length ? styles.tileWarn : ""} ${isRange("", yesterday) && tab === "wait" ? styles.tileOn : ""}`}
          onClick={() => pick("", yesterday, "wait")}
          aria-pressed={isRange("", yesterday) && tab === "wait"}
        >
          <span className={styles.tileLabel}>출고일 지난 상차 대기</span>
          <span className={styles.tileValue}>
            <b className="mono">{summary.overdue.length}</b>건
          </span>
          <span className={styles.tileSub}>화주사에 차량 도착 여부 확인</span>
        </button>
        {(from || to) && (
          <button type="button" className={styles.reset} onClick={() => pick("", "")}>
            출고일 전체 보기
          </button>
        )}
      </div>

      <FilterBar>
        <FilterField label="화주사" htmlFor="f-client">
          <ClientFilter id="f-client" value={client} onChange={setClient} />
        </FilterField>
        <DateRangeField label="출고일" from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <FilterField label="번호·차량" htmlFor="f-q">
          <Input id="f-q" type="search" className={`${styles.q} mono`} placeholder="ASN·입고예정번호, 차량번호" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="품목" htmlFor="f-item">
          <Input id="f-item" type="search" className={styles.item} placeholder="품목코드 또는 품목명" value={item} onChange={(e) => setItem(e.target.value)} />
        </FilterField>
      </FilterBar>

      <Tabs label="ASN 상태" value={tab} onChange={setTab} panelId="asn-status-list" items={ASN_STATUS_TABS.map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] }))} />
      <div id="asn-status-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <ListToolbar total={list.length} />
        <DataTable
          caption="ASN 목록"
          columns={columns}
          rows={list}
          rowKey={(r) => r.key}
          onActivate={(k) => {
            const r = list.find((x) => x.key === k);
            if (r) router.push(r.href);
          }}
          empty={
            tab === "wait"
              ? "상차를 기다리는 ASN이 없습니다."
              : tab === "loading"
                ? "상차 중인 차량이 없습니다."
                : tab === "loaded"
                  ? "상차를 마치고 검수를 기다리는 차량이 없습니다."
                  : tab === "done"
                    ? "최근 30일 동안 입고완료된 ASN이 없습니다."
                    : "최근 30일 동안 취소된 ASN이 없습니다."
          }
        />
      </div>
    </>
  );
}
