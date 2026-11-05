"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { AsnStatusBadge, StatusBadge } from "@/components/ui/Badges";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { Input, Select } from "@/components/ui/Form";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { qtyInUnit } from "@/domain/load-rules";
import { ASN_STATUS_META } from "@/domain/asn-rules";
import { PLAN_STATUS_META } from "@/domain/plan-status";
import { daysBetween, elapsedDays, isOverdue, overdueCutoff, progressPct } from "@/domain/inquiry-rules";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { MasterHeader } from "@/features/master/shared";
import { ClientFilter, type PickedClient } from "@/features/plans/ClientFinder";
import { DateRangeField, matchPlanNo } from "@/features/plans/PlanSearchFields";
import { INQUIRY_LIST_KEY, defaultInquiry, inquirySearch, type InquiryQuery } from "./inquiry-list";
import { INQUIRY_RULES } from "./rules";
import type { CenterOption, InquiryPlanLine, InquiryPlanRow, InquiryTab, InquiryVehicleLine, InquiryVehicleRow } from "./types";
import styles from "./InquiryScreen.module.css";

const PLAN_STATE_LABEL: Record<string, string> = {
  open: "미종결 (승인·부분입고)",
  all: "전체",
  APPROVED: PLAN_STATUS_META.APPROVED.label,
  PARTIAL: PLAN_STATUS_META.PARTIAL.label,
  COMPLETED: PLAN_STATUS_META.COMPLETED.label,
  CLOSED: PLAN_STATUS_META.CLOSED.label,
  CANCELED: "취소 (승인 건 취소)",
};
const ASN_STATE_LABEL: Record<string, string> = {
  open: "미입고 (등록·상차중·상차완료)",
  all: "전체 (취소 제외)",
  REGISTERED: ASN_STATUS_META.REGISTERED.label,
  LOADING: ASN_STATUS_META.LOADING.label,
  LOADED: ASN_STATUS_META.LOADED.label,
  RECEIVED: ASN_STATUS_META.RECEIVED.label,
};

/** 기준 단위 수량을 입고예정 단위로 (예: 12 BOX 6 EA) */
const q = (base: number, l: { unit: InquiryPlanLine["unit"]; factor: number; baseUnit: InquiryPlanLine["baseUnit"] }) => qtyInUnit(base, l.unit, l.factor, l.baseUnit);
const remainOf = (l: InquiryPlanLine) => Math.max(l.baseQty - l.rcvQty - l.returnQty - l.closeQty, 0);
const matchItem = (l: { itemCode: string; itemName: string }, item: string) => includesText([l.itemCode, l.itemName], item);

function Progress({ pct }: { pct: number }) {
  return (
    <span className={styles.progress} title={`진행률 ${pct}%`}>
      <span className={styles.bar} aria-hidden>
        <span style={{ width: `${pct}%` }} className={pct >= 100 ? styles.barDone : undefined} />
      </span>
      <span className="mono">{pct}%</span>
    </span>
  );
}

function Toggle({ open, controls, label }: { open: boolean; controls: string; label: string }) {
  return (
    <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={controls} aria-label={`${label} ${open ? "접기" : "펼치기"}`}>
      <span aria-hidden>{open ? "▾" : "▸"}</span>
    </button>
  );
}

/**
 * 입고예정 조회 (/plans/inquiry, 정의서 ⑤) — 품목별·차량별 탭.
 * 기간·상태·화주사·센터는 서버에서 다시 조회하고, 번호·품목 검색은 받은 목록 안에서 바로 거른다.
 */
export function InquiryScreen({
  initial,
  initialClient,
  plans,
  vehicles,
  overdueCount,
  alertDays,
  centers,
  shipper,
  multiCenter,
  today,
}: {
  initial: InquiryQuery;
  initialClient: PickedClient | null;
  plans: InquiryPlanRow[];
  vehicles: InquiryVehicleRow[];
  overdueCount: number;
  alertDays: number;
  centers: CenterOption[];
  /** 화주사 계정 — 화주사 조건·열을 숨긴다 */
  shipper: boolean;
  multiCenter: boolean;
  today: string;
}) {
  const router = useRouter();
  const [loading, start] = useTransition();
  const [f, setF] = useState<InquiryQuery>(initial);
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const [open, setOpen] = useState<string | null>(null);
  const cutoff = overdueCutoff(today, alertDays);

  /** 서버 조건(탭·상태·기간·화주사·센터)이 바뀌면 다시 조회, 검색어는 주소만 바꾼다 */
  function apply(next: Partial<InquiryQuery>) {
    const merged = { ...f, ...next };
    setF(merged);
    setOpen(null);
    start(() => router.replace(`/plans/inquiry${inquirySearch(merged, today)}`, { scroll: false }));
  }
  function search(next: Partial<Pick<InquiryQuery, "q" | "item">>) {
    setF((cur) => ({ ...cur, ...next }));
  }
  useEffect(() => {
    const url = `/plans/inquiry${inquirySearch(f, today)}`;
    window.history.replaceState(window.history.state, "", url);
    try {
      sessionStorage.setItem(INQUIRY_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [f, today]);

  const tab = f.tab;
  const item = f.item.trim();

  /* ── 품목별 ── */
  const planList = useMemo(
    () => plans.filter((p) => matchPlanNo(p.planNo, f.q) && (!item || p.lines.some((l) => matchItem(l, item)))),
    [plans, f.q, item],
  );
  /* ── 차량별 ── */
  const vehicleList = useMemo(() => {
    const t = f.q.trim().toUpperCase().replace(/[\s-]/g, "");
    return vehicles.filter(
      (v) =>
        (!t || [v.asnNo, v.vehicleNo, ...v.planNos].some((s) => s.toUpperCase().replace(/[\s-]/g, "").includes(t))) &&
        (!item || v.lines.some((l) => matchItem(l, item))),
    );
  }, [vehicles, f.q, item]);

  const isDefault = (() => {
    const d = defaultInquiry(today);
    return f.st === d.st && f.from === d.from && f.to === d.to && !f.client && !f.center && !f.q && !f.item;
  })();
  const overdueOn = tab === "plan" && f.st === "open" && f.from === "" && f.to === cutoff;
  const states = tab === "plan" ? PLAN_STATE_LABEL : ASN_STATE_LABEL;
  const showClient = !shipper;

  return (
    <>
      <MasterHeader title="입고예정 조회" rules={INQUIRY_RULES} crumbs={["입고 계획", "입고예정 조회"]} />

      <div className={styles.summary} role="group" aria-label="미종결 요약">
        <button
          type="button"
          className={`${styles.tile} ${overdueCount ? styles.tileWarn : ""} ${overdueOn ? styles.tileOn : ""}`}
          aria-pressed={overdueOn}
          onClick={() => apply({ tab: "plan", st: "open", from: "", to: cutoff })}
        >
          <span className={styles.tileLabel}>경과 기준 초과 미종결</span>
          <span className={styles.tileValue}>
            <b className="mono">{overdueCount}</b>건
          </span>
          <span className={styles.tileSub}>입고예정일 후 {alertDays}일 이상 지난 승인·부분입고</span>
        </button>
        {!isDefault && (
          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              setClient(null);
              apply({ ...defaultInquiry(today), tab });
            }}
          >
            처음 조건으로
          </button>
        )}
      </div>

      <Tabs
        label="조회 기준"
        value={tab}
        onChange={(k: InquiryTab) => apply({ tab: k, st: "open" })}
        panelId="inquiry-list"
        items={[
          { key: "plan", label: "품목별" },
          { key: "vehicle", label: "차량별" },
        ]}
      />

      <FilterBar>
        <DateRangeField label={tab === "plan" ? "입고예정일" : "출고일"} from={f.from} to={f.to} onFrom={(v) => apply({ from: v })} onTo={(v) => apply({ to: v })} />
        <FilterField label="상태" htmlFor="f-st">
          <Select id="f-st" value={f.st} onChange={(e) => apply({ st: e.target.value })}>
            {Object.entries(states).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </FilterField>
        {showClient && (
          <FilterField label="화주사" htmlFor="f-client">
            <ClientFilter
              id="f-client"
              value={client}
              onChange={(c) => {
                setClient(c);
                apply({ client: c ? String(c.id) : "" });
              }}
            />
          </FilterField>
        )}
        {centers.length > 1 && (
          <FilterField label="센터" htmlFor="f-center">
            <Select id="f-center" value={f.center} onChange={(e) => apply({ center: e.target.value })}>
              <option value="">전체</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        <FilterField label={tab === "plan" ? "입고예정번호" : "번호·차량"} htmlFor="f-q">
          <Input
            id="f-q"
            type="search"
            className={`${styles.q} mono`}
            placeholder={tab === "plan" ? "IP-20261105-0001" : "ASN·입고예정번호, 차량번호"}
            value={f.q}
            onChange={(e) => search({ q: e.target.value })}
          />
        </FilterField>
        <FilterField label="품목" htmlFor="f-item">
          <Input id="f-item" type="search" className={styles.item} placeholder="품목코드 또는 품목명" value={f.item} onChange={(e) => search({ item: e.target.value })} />
        </FilterField>
      </FilterBar>

      <div id="inquiry-list" role="tabpanel" aria-labelledby={`tab-${tab}`} aria-busy={loading} className={`${styles.panel} ${loading ? styles.loading : ""}`}>
        <ListToolbar total={tab === "plan" ? planList.length : vehicleList.length}>
          {(tab === "plan" ? plans.length : vehicles.length) >= 1000 && <span className={styles.cap}>1,000건까지만 보입니다. 기간을 줄여 조회하세요.</span>}
        </ListToolbar>
        {tab === "plan" ? (
          <PlanTable rows={planList} item={item} open={open} setOpen={setOpen} today={today} alertDays={alertDays} showClient={showClient} showCenter={multiCenter} />
        ) : (
          <VehicleTable rows={vehicleList} item={item} open={open} setOpen={setOpen} today={today} showClient={showClient} showCenter={multiCenter} />
        )}
      </div>
    </>
  );
}

/* ═════════ 품목별 탭 ═════════ */

function PlanTable({
  rows,
  item,
  open,
  setOpen,
  today,
  alertDays,
  showClient,
  showCenter,
}: {
  rows: InquiryPlanRow[];
  item: string;
  open: string | null;
  setOpen: (k: string | null) => void;
  today: string;
  alertDays: number;
  showClient: boolean;
  showCenter: boolean;
}) {
  if (!rows.length) return <div className={styles.empty}>조건에 맞는 입고예정이 없습니다. 기간이나 상태를 바꿔 보세요.</div>;
  const cols = 9 + (showClient ? 1 : 0) + (showCenter ? 1 : 0);
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className="sr-only">입고예정 목록 (품목별)</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.tCol}>
              <span className="sr-only">펼치기</span>
            </th>
            <th scope="col">입고예정일</th>
            <th scope="col">입고예정번호</th>
            {showClient && <th scope="col">화주사</th>}
            {showCenter && <th scope="col">센터</th>}
            <th scope="col">품목</th>
            <th scope="col">진행률</th>
            <th scope="col">오는 중</th>
            <th scope="col">승인</th>
            <th scope="col">상태</th>
            <th scope="col">
              <span className="sr-only">상세</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const key = `p${p.id}`;
            // 품목 검색 중이면 일치하는 건을 모두 펼치고 일치하는 줄만, 아니면 한 번에 한 건만
            const expanded = item ? true : open === key;
            const lines = item ? p.lines.filter((l) => matchItem(l, item)) : p.lines;
            const elapsed = elapsedDays(p.status, p.planDate, today);
            const over = isOverdue(elapsed, alertDays);
            const n = dday(p.planDate, today);
            const pct = progressPct(p.lines);
            const incoming = p.lines.reduce((s, l) => s + l.incomingQty, 0);
            const approvedDays = p.approvedAt ? daysBetween(p.approvedAt.slice(0, 10), today) : null;
            return (
              <Fragment key={key}>
                <tr
                  className={`${styles.row} ${expanded ? styles.rowOpen : ""} ${over ? styles.rowOver : ""}`}
                  onClick={() => !item && setOpen(open === key ? null : key)}
                >
                  <td className={styles.tCol}>{!item && <Toggle open={expanded} controls={`${key}-lines`} label={p.planNo} />}</td>
                  <td>
                    <span className="mono">{p.planDate}</span>
                    <span className={styles.sub}>{elapsed > 0 ? <span className={over ? styles.over : undefined}>{elapsed}일 경과</span> : ddayLabel(n)}</span>
                  </td>
                  <td>
                    <Link href={`/plans/inquiry/${p.id}`} className={`${styles.no} mono`} onClick={(e) => e.stopPropagation()}>
                      {p.planNo}
                    </Link>
                  </td>
                  {showClient && <td>{p.clientName}</td>}
                  {showCenter && <td>{p.centerName}</td>}
                  <td>
                    {p.lines.length}품목
                    {item && <span className={styles.sub}>일치 {lines.length}품목</span>}
                  </td>
                  <td>
                    <Progress pct={pct} />
                  </td>
                  <td>
                    {p.vehicleCount ? (
                      <>
                        {incoming > 0 ? <b className={styles.incoming}>오는 중</b> : <span className="muted">입고 끝</span>}
                        <span className={styles.sub}>차량 {p.vehicleCount}대</span>
                      </>
                    ) : (
                      <span className="muted">ASN 없음</span>
                    )}
                  </td>
                  <td>
                    <span className="mono">{fmtShortDateTime(p.approvedAt)}</span>
                    <span className={styles.sub}>{approvedDays !== null ? `승인 후 ${approvedDays}일 · ${p.approvedBy ?? ""}` : ""}</span>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>
                    <Link href={`/plans/inquiry/${p.id}`} className={styles.detail} onClick={(e) => e.stopPropagation()}>
                      상세
                    </Link>
                  </td>
                </tr>
                {expanded && (
                  <tr className={styles.expand}>
                    <td colSpan={cols} id={`${key}-lines`}>
                      <PlanLines lines={lines} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlanLines({ lines }: { lines: InquiryPlanLine[] }) {
  return (
    <div className={styles.inner}>
      <table className={styles.innerTable}>
        <caption className="sr-only">품목 라인</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.num}>#</th>
            <th scope="col">품목코드</th>
            <th scope="col">품목명</th>
            <th scope="col" className={styles.num}>승인</th>
            <th scope="col" className={styles.num}>오는 중</th>
            <th scope="col" className={styles.num}>입고</th>
            <th scope="col" className={styles.num}>반송</th>
            <th scope="col" className={styles.num}>종결</th>
            <th scope="col" className={styles.num}>잔량</th>
            <th scope="col">진행률</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const remain = remainOf(l);
            return (
              <tr key={l.lineNo}>
                <td className={`${styles.num} mono`}>{l.lineNo}</td>
                <td className="mono">{l.itemCode}</td>
                <td className={styles.name}>{l.itemName}</td>
                <td className={`${styles.num} mono`}>{q(l.baseQty, l)}</td>
                <td className={`${styles.num} mono`}>{l.incomingQty ? <b className={styles.incoming}>{q(l.incomingQty, l)}</b> : <span className="muted">–</span>}</td>
                <td className={`${styles.num} mono`}>{l.rcvQty ? q(l.rcvQty, l) : <span className="muted">–</span>}</td>
                <td className={`${styles.num} mono`}>{l.returnQty ? q(l.returnQty, l) : <span className="muted">–</span>}</td>
                <td className={`${styles.num} mono`}>{l.closeQty ? q(l.closeQty, l) : <span className="muted">–</span>}</td>
                <td className={`${styles.num} mono`}>{remain ? <b>{q(remain, l)}</b> : <span className="muted">0</span>}</td>
                <td>
                  <Progress pct={progressPct([l])} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═════════ 차량별 탭 ═════════ */

function VehicleTable({
  rows,
  item,
  open,
  setOpen,
  today,
  showClient,
  showCenter,
}: {
  rows: InquiryVehicleRow[];
  item: string;
  open: string | null;
  setOpen: (k: string | null) => void;
  today: string;
  showClient: boolean;
  showCenter: boolean;
}) {
  if (!rows.length) return <div className={styles.empty}>조건에 맞는 차량(ASN)이 없습니다. 기간이나 상태를 바꿔 보세요.</div>;
  const cols = 8 + (showClient ? 1 : 0) + (showCenter ? 1 : 0);
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className="sr-only">차량(ASN) 목록</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.tCol}>
              <span className="sr-only">펼치기</span>
            </th>
            <th scope="col">출고일</th>
            <th scope="col">차량</th>
            <th scope="col">ASN번호</th>
            {showClient && <th scope="col">화주사</th>}
            {showCenter && <th scope="col">센터</th>}
            <th scope="col">입고예정</th>
            <th scope="col">품목</th>
            <th scope="col">입고현황</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const key = `v${v.id}`;
            const expanded = item ? true : open === key;
            const lines = item ? v.lines.filter((l) => matchItem(l, item)) : v.lines;
            const n = dday(v.shipDate, today);
            const received = v.status === "RECEIVED";
            const order = v.lines.reduce((s, l) => s + l.orderQty, 0);
            const got = v.lines.reduce((s, l) => s + l.rcvQty + l.returnQty, 0);
            return (
              <Fragment key={key}>
                <tr className={`${styles.row} ${expanded ? styles.rowOpen : ""}`} onClick={() => !item && setOpen(open === key ? null : key)}>
                  <td className={styles.tCol}>{!item && <Toggle open={expanded} controls={`${key}-lines`} label={`차량 ${v.vehicleNo}`} />}</td>
                  <td>
                    <span className="mono">{v.shipDate}</span>
                    <span className={styles.sub}>{ddayLabel(n)}</span>
                  </td>
                  <td>
                    <span className={`mono ${styles.vehicle}`}>{v.vehicleNo}</span>
                    {(v.driverName || v.driverTel) && (
                      <span className={styles.sub}>
                        {v.driverName}
                        {v.driverTel ? <span className="mono"> {v.driverTel}</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="mono">{v.asnNo}</td>
                  {showClient && <td>{v.clientName}</td>}
                  {showCenter && <td>{v.centerName}</td>}
                  <td>
                    <span className="mono">{v.planNos[0]}</span>
                    {v.planNos.length > 1 && <span className="muted"> 외 {v.planNos.length - 1}건</span>}
                  </td>
                  <td>
                    {v.lines.length}줄{item && <span className={styles.sub}>일치 {lines.length}줄</span>}
                  </td>
                  <td>
                    {received ? (
                      <>
                        <span>입고 {order ? Math.floor((got / order) * 100) : 0}%</span>
                        <span className={styles.sub}>{fmtShortDateTime(v.receivedAt)} 확정</span>
                      </>
                    ) : (
                      <b className={styles.incoming}>오는 중</b>
                    )}
                  </td>
                  <td>
                    <AsnStatusBadge status={v.status} />
                  </td>
                </tr>
                {expanded && (
                  <tr className={styles.expand}>
                    <td colSpan={cols} id={`${key}-lines`}>
                      <VehicleLines lines={lines} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VehicleLines({ lines }: { lines: InquiryVehicleLine[] }) {
  return (
    <div className={styles.inner}>
      <table className={styles.innerTable}>
        <caption className="sr-only">실린 입고예정 라인</caption>
        <thead>
          <tr>
            <th scope="col">입고예정번호</th>
            <th scope="col">품목코드</th>
            <th scope="col">품목명</th>
            <th scope="col" className={styles.num}>지시</th>
            <th scope="col" className={styles.num}>오는 중</th>
            <th scope="col" className={styles.num}>입고</th>
            <th scope="col" className={styles.num}>반송</th>
            <th scope="col" className={styles.num}>입고예정 잔량</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td>
                <Link href={`/plans/inquiry/${l.planId}`} className={`${styles.no} mono`}>
                  {l.planNo}
                </Link>
              </td>
              <td className="mono">{l.itemCode}</td>
              <td className={styles.name}>{l.itemName}</td>
              <td className={`${styles.num} mono`}>{q(l.orderQty, l)}</td>
              <td className={`${styles.num} mono`}>{l.incomingQty ? <b className={styles.incoming}>{q(l.incomingQty, l)}</b> : <span className="muted">–</span>}</td>
              <td className={`${styles.num} mono`}>{l.rcvQty ? q(l.rcvQty, l) : <span className="muted">–</span>}</td>
              <td className={`${styles.num} mono`}>{l.returnQty ? q(l.returnQty, l) : <span className="muted">–</span>}</td>
              <td className={`${styles.num} mono`}>{l.planRemainQty ? <b>{q(l.planRemainQty, l)}</b> : <span className="muted">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
