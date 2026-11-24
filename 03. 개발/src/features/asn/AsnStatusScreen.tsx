"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertStrip } from "@/components/ui/AlertStrip";
import { AsnStatusBadge } from "@/components/ui/Badges";
import { CellSub, DateStamp, DataTable, type Column } from "@/components/ui/DataTable";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Form";
import { Tabs, TabTotal } from "@/components/ui/Tabs";
import { DEPART_TYPE_LABEL } from "@/domain/load-rules";
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
 * 출고일 지난 상차 대기는 있을 때만 붉은 띠 + 상차 대기 탭 ⚠N, 오늘·내일 출고는 출고일 옆 빠른 선택 (요약 카드 대체, 2026-11-07 Sol 확정).
 */
export function AsnStatusScreen({
  rows,
  open: openRows,
  today,
  initial,
  initialClient,
  multiCenter,
}: {
  /** 서버가 읽은 출고일 기간 안의 행 */
  rows: AsnRow[];
  /** 진행 중 전부 — 오늘·내일·출고일 지난 요약용 (기간과 무관) */
  open: AsnRow[];
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

  // 기간을 바꾸면 서버에서 그 기간만 다시 읽는다 (2026-11-14 Sol). 나머지 조건은 화면에서 거른다
  const [loading, startLoading] = useTransition();
  const loaded = `${initial.from}~${initial.to}`;
  useEffect(() => {
    const url = `/plans/asn-status${asnStatusSearch({ tab, client: clientId, q, item, from, to }, today)}`;
    if (`${from}~${to}` !== loaded) startLoading(() => router.replace(url, { scroll: false }));
    else window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(ASN_STATUS_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId, q, item, from, to]);

  /** 화주사·검색 조건까지 거른 행 (탭·기간 전) — 탭 건수와 요약이 같은 기준을 본다 */
  const match = (r: AsnRow) => (!clientId || r.clientId === Number(clientId)) && matchAsnText(r, q) && includesText(r.itemTexts, item);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => rows.filter(match), [rows, clientId, q, item]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openBase = useMemo(() => openRows.filter(match), [openRows, clientId, q, item]);
  const dated = useMemo(() => base.filter((r) => inRange(r.shipDate, from, to)), [base, from, to]);

  const counts = useMemo(() => {
    const c: Record<AsnStatusTab, number> = { wait: 0, loading: 0, loaded: 0, done: 0, canceled: 0 };
    dated.forEach((r) => c[tabOf(r)]++);
    return c;
  }, [dated]);

  /** 요약 — 진행 중(상차 대기·상차중·검수 대기) ASN 기준 */
  const summary = useMemo(() => {
    const open = openBase;
    const on = (d: string) => open.filter((r) => r.shipDate === d);
    return {
      today: on(today),
      tomorrow: on(tomorrow),
      overdue: open.filter((r) => r.status === "REGISTERED" && r.shipDate < today),
    };
  }, [openBase, today, tomorrow]);
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
      align: "center",
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
      align: "center",
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
      align: "center",
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
          {r.lineCount.toLocaleString()}품목
          <CellSub mono>{r.kind === "load" ? `상차 ${qtyText(r.qtyByUnit) || "0"}` : qtyText(r.qtyByUnit)}</CellSub>
        </>
      ),
    },
    {
      key: "at",
      header: tab === "done" ? "입고완료" : tab === "canceled" ? "취소" : "등록",
      align: "center",
      // 1줄 날짜, 2줄 등록자(왼쪽)·시각(오른쪽) (2026-11-14 Sol). 입고완료·취소 탭은 시각만
      render: (r) =>
        tab === "done" || tab === "canceled" ? (
          <DateStamp at={r.closedAt} />
        ) : (
          <DateStamp at={r.createdAt} by={r.kind === "load" ? `${r.createdBy} · 상차 시작` : r.createdBy} />
        ),
    },
    {
      key: "status",
      header: "상태",
      align: "center",
      render: (r) => (
        <>
          <AsnStatusBadge status={r.status} allMissing={r.allMissing} />
          {/* 상차완료 차량의 출차·입차 (v1.9) — 센터가 도착 예상을 볼 수 있게. 시스템 처리 출차는 구분 표시 */}
          {r.status === "LOADED" && (
            <CellSub>
              {r.arrivedAt
                ? `입차 ${fmtShortDateTime(r.arrivedAt)}`
                : r.departure
                  ? `출차 ${fmtShortDateTime(r.departure.at)}${r.departure.system ? ` · ${DEPART_TYPE_LABEL[r.departure.type]}` : ""}`
                  : "출차 전"}
            </CellSub>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <MasterHeader title="ASN·상차 현황" count={counts.wait + counts.loading + counts.loaded} rules={ASN_STATUS_RULES} crumbs={["입고 계획", "ASN·상차 현황"]} />

      <FilterBar>
        <FilterField label="화주사" htmlFor="f-client">
          <ClientFilter id="f-client" value={client} onChange={setClient} />
        </FilterField>
        <DateRangeField label="출고일" from={from} to={to} onFrom={setFrom} onTo={setTo} />
        {/* 오늘·내일 출고 — 요약 카드 대신 출고일 옆 빠른 선택 (진행 중 ASN 대수) */}
        <div className={styles.quick} role="group" aria-label="출고일 빠른 선택">
          <button
            type="button"
            aria-pressed={isRange(today, today)}
            onClick={() => (isRange(today, today) ? pick("", "") : pick(today, today))}
            title={`화주사 ${clients(summary.today)}곳 · 상차완료 ${summary.today.filter((r) => r.status === "LOADED").length}대`}
          >
            오늘 <b className="mono">{summary.today.length.toLocaleString()}</b>대
          </button>
          <button
            type="button"
            aria-pressed={isRange(tomorrow, tomorrow)}
            onClick={() => (isRange(tomorrow, tomorrow) ? pick("", "") : pick(tomorrow, tomorrow))}
            title={`화주사 ${clients(summary.tomorrow)}곳`}
          >
            내일 <b className="mono">{summary.tomorrow.length.toLocaleString()}</b>대
          </button>
        </div>
        <FilterField label="번호·차량" htmlFor="f-q">
          <Input id="f-q" type="search" className={`${styles.q} mono`} placeholder="ASN·입고예정번호, 차량번호" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="품목" htmlFor="f-item">
          <Input id="f-item" type="search" className={styles.item} placeholder="품목코드 또는 품목명" value={item} onChange={(e) => setItem(e.target.value)} />
        </FilterField>
      </FilterBar>

      <Tabs
        label="ASN 상태"
        value={tab}
        onChange={setTab}
        panelId="asn-status-list"
        items={ASN_STATUS_TABS.map((k) => ({
          key: k,
          label: TAB_LABEL[k],
          count: counts[k],
          ...(k === "wait" ? { alert: summary.overdue.length, alertLabel: `출고일 지난 상차 대기 ${summary.overdue.length.toLocaleString()}대` } : {}),
        }))}
        aside={<TabTotal total={list.length} />}
      />
      <div id="asn-status-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {/* 출고일 지난 상차 대기 — 있을 때만 붉은 띠 (입고예정 조회와 같은 규칙, 2026-11-07 Sol 확정) */}
        <AlertStrip
          count={summary.overdue.length}
          unit="대"
          active={isRange("", yesterday) && tab === "wait"}
          onShow={() => pick("", yesterday, "wait")}
          onClear={() => pick("", "")}
          activeLabel="출고일 지난 차량만 보는 중 · 전체 보기"
        >
          출고일이 지났는데 상차를 시작하지 않은 차량 (화주사에 차량 도착 여부 확인)
        </AlertStrip>
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
