"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DEPART_TYPE_LABEL, LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { fmtDateTime } from "@/lib/format";
import { startRcv } from "@/server/rcv/actions";
import type { PdaRcvFilter, PdaRcvHome, PdaRcvRow, RcvCandidate } from "@/features/rcv/types";
import { passNotice } from "./device";
import { Icon, Pill, Steps } from "./PdaParts";
import { PdaViewBar } from "./PdaViewBar";
import styles from "./Pda.module.css";

const hm = (iso: string | null) => fmtDateTime(iso).slice(11);
const md = (iso: string | null) => fmtDateTime(iso).slice(5, 10);

/**
 * PDA 입고검수 첫 화면 (정의서 ⑥, R1 · v1.9 입차)
 * - 입력 하나로 입차와 검수 진입을 한다 (v1.9 ⑥ "진입 방법"): 상차확인서·상차지시서 스캔 또는 번호를 끝까지 정확히 입력하면
 *   바로 진입(입차 전이면 입차), 일부만 입력하면 후보 목록에서 고른다. 이미 입차한 차량을 다시 스캔하면 그 차량의 검수 화면으로.
 * - 목록: 검수 중(첫 입력 후) · 도착·검수 대기(입차, 첫 입력 전) · 입차 전(오는 차량) · 검수확정
 * - 검수 중인 차량은 다른 검수자가 시작했어도 눌러서 함께 검수한다 (잠금 없음, 2026-11-05 Sol).
 * 2026-11-12 Sol: 상차등록 PDA와 같은 모양 — 검정 영역에 날짜·보기(전체/대기/검수 중/완료), 카드 색(검수 중 연한 주황 · 확정 연한 연두).
 *   확정 전 차량은 날짜와 상관없이 항상, 완료는 확정한 날짜.
 */
export function PdaInspectHomeScreen({ home, filter = "all" }: { home: PdaRcvHome; filter?: PdaRcvFilter }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ message: string; rows: RcvCandidate[] } | null>(null);
  /** 목록(첫 화면 "입차 전"·후보)에서 입차 전 차량을 골랐을 때 — 실수로 입차하지 않게 한 번 묻는다 (정의서 v1.9 ⑥ 진입 방법). departed: 모르면 null */
  const [arriving, setArriving] = useState<{ loadId: number; vehicleNo: string; loadNo: string; clientName: string; departed: boolean | null } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const { today, date } = home;
  const isToday = date === today;
  const show = (k: Exclude<PdaRcvFilter, "all">) => filter === "all" || filter === k;
  const counts: Record<PdaRcvFilter, number> = {
    all: home.waiting.length + home.arrived.length + home.working.length + home.done.length,
    todo: home.waiting.length + home.arrived.length,
    working: home.working.length,
    done: home.done.length,
  };

  /** 날짜·보기를 바꾼다 — 주소에 남겨 검수 화면에서 ← 로 돌아와도 같은 목록. 바꾼 뒤 커서는 스캔칸으로 */
  const view = (next: { date?: string; st?: PdaRcvFilter }) => {
    const d = next.date ?? date;
    const st = next.st ?? filter;
    const q = new URLSearchParams();
    if (d !== today) q.set("date", d);
    if (st !== "all") q.set("st", st);
    router.replace(q.size ? `/pda/inspect?${q}` : "/pda/inspect", { scroll: false });
    scanRef.current?.focus();
  };
  useEffect(() => {
    scanRef.current?.focus();
  }, [date, filter]);

  /** 검수 화면으로 — ← 가 지금 날짜·보기로 돌아오게 */
  const rcvHref = (rcvId: number) => {
    const q = new URLSearchParams();
    if (!isToday) q.set("from", date);
    if (filter !== "all") q.set("st", filter);
    return q.size ? `/pda/inspect/${rcvId}?${q}` : `/pda/inspect/${rcvId}`;
  };

  const go = (input: { code?: string; loadId?: number }) =>
    start(async () => {
      setError(null);
      setArriving(null);
      const r = await startRcv(input);
      if (!r.ok) {
        setError(r.error);
        setCode("");
        scanRef.current?.focus();
        return;
      }
      if (r.data?.candidates) {
        setCandidates({ message: r.message, rows: r.data.candidates });
        return;
      }
      setCode("");
      passNotice(r.data?.notice);
      // 스캔으로 열어도 지금 날짜·보기를 가지고 간다 — [처음으로]·← 가 같은 목록으로 (2026-11-13 Sol)
      router.push(rcvHref(r.data!.rcvId!));
    });

  /** 입차 전 차량 카드 — 회색. 출차 대기 / 운송 중(출차 구분). 누르면 입차 확인 */
  const waitingCard = (w: PdaRcvRow) => {
    const doneDay = w.loadCompletedAt ? fmtDateTime(w.loadCompletedAt).slice(0, 10) : null;
    return (
      <li key={w.loadId}>
        <button
          type="button"
          className={styles.card}
          onClick={() => setArriving({ loadId: w.loadId, vehicleNo: w.vehicleNo, loadNo: w.loadNo, clientName: w.clientName, departed: !!w.departure })}
          disabled={pending}
        >
          <span className={styles.cardTop}>
            <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
            {w.departure ? <Pill tone="blue">운송 중</Pill> : <Pill tone="gray">출차 대기</Pill>}
          </span>
          <span className={styles.meta}>
            <span className="mono">{w.loadNo}</span>
            <span>{w.clientName}</span>
          </span>
          <span className={styles.meta}>
            <span>
              {LOAD_TYPE_LABEL[w.loadType]} · 품목 {w.lineCount}개 · 상차완료 {hm(w.loadCompletedAt)}
            </span>
            <span className={styles.cardGo}>
              입차 <Icon name="arrow" size={13} stroke={2.4} />
            </span>
          </span>
          {w.departure && (
            <span className={styles.meta}>
              <span>
                출차 {md(w.departure.at)} {hm(w.departure.at)}
                {w.departure.system ? ` · ${DEPART_TYPE_LABEL[w.departure.type]}` : ""}
              </span>
            </span>
          )}
          {doneDay && doneDay < today && <span className={styles.metaWarn}>{doneDay.slice(5)} 상차완료 · 아직 입차 전</span>}
        </button>
      </li>
    );
  };

  /** 도착·검수 대기 카드 — 흰 바탕 + 파란 줄. 입차했고 아직 첫 입력 전. 누르면 검수 화면(입고취소 뒤 재검수 차량은 새 전표) */
  const arrivedCard = (w: PdaRcvRow) => (
    <li key={`a-${w.loadId}`}>
      <button
        type="button"
        className={`${styles.card} ${styles.cardArrived}`}
        onClick={() => (w.rcvId ? router.push(rcvHref(w.rcvId)) : go({ loadId: w.loadId }))}
        disabled={pending}
      >
        <span className={styles.cardTop}>
          <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
          <Pill tone="blue">{w.rcvId ? "도착·검수 대기" : "다시 검수"}</Pill>
        </span>
        <span className={styles.meta}>
          <span className="mono">{w.loadNo}</span>
          <span>{w.clientName}</span>
        </span>
        <span className={styles.meta}>
          <span>
            {LOAD_TYPE_LABEL[w.loadType]} · 품목 {w.lineCount}개 · 입차 {w.arrivedAt && md(w.arrivedAt) !== today.slice(5) ? `${md(w.arrivedAt)} ` : ""}
            {hm(w.arrivedAt)}
          </span>
          <span className={styles.cardGo}>
            검수 <Icon name="arrow" size={13} stroke={2.4} />
          </span>
        </span>
      </button>
    </li>
  );

  /** 검수 중 카드 — 연한 주황(상차 중 카드와 같은 색), 작은 진행 단계. 날짜와 상관없이 항상 보인다 */
  const workingCard = (w: PdaRcvRow) => (
    <li key={w.loadId}>
      <button type="button" className={`${styles.card} ${styles.cardWorking}`} onClick={() => router.push(rcvHref(w.rcvId!))} disabled={pending}>
        <span className={styles.cardTop}>
          <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
        </span>
        <span className={styles.meta}>
          <span>
            {LOAD_TYPE_LABEL[w.loadType]} · <span className="mono">{w.loadNo}</span>
          </span>
          <span>{w.clientName}</span>
        </span>
        <Steps
          compact
          steps={[
            { label: "입차", done: true, time: hm(w.arrivedAt) },
            { label: "검수 중", done: true, time: `입력 ${w.inputCount}건${w.workerCount > 1 ? ` · ${w.workerCount}명` : ""}` },
            { label: "검수확정", done: false },
          ]}
        />
      </button>
    </li>
  );

  /** 확정 카드 — 연한 연두(상차완료 카드와 같은 색). 알약은 이상 있을 때만 */
  const doneCard = (w: PdaRcvRow) => (
    <li key={w.rcvId}>
      <Link href={rcvHref(w.rcvId!)} className={`${styles.card} ${styles.cardDone}`}>
        <span className={styles.cardTop}>
          <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
          {w.issueCount > 0 && <Pill tone="amber">이상 {w.issueCount}건</Pill>}
        </span>
        <span className={styles.meta}>
          <span className="mono">{w.rcvNo}</span>
          <span>확정 {hm(w.confirmedAt)}</span>
        </span>
        <span className={styles.meta}>
          <span>
            {w.clientName} · {LOAD_TYPE_LABEL[w.loadType]}
          </span>
          <span>
            {w.confirmedBy} · 입력 {w.inputCount}건{w.workerCount > 1 ? ` · ${w.workerCount}명` : ""}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <>
      {/* 검정 영역 — 바코드 스캔 + 날짜·보기 (2026-11-12 Sol: 상차등록과 같은 구성, 위 요약 줄 삭제) */}
      <section className={styles.hero}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) go({ code });
          }}
        >
          <label htmlFor="pda-rcv" className="sr-only">
            상차확인서·상차지시서 바코드, 번호 또는 차량번호
          </label>
          <div className={styles.searchPill}>
            <span className={styles.searchIcon}>
              <Icon name="scan" size={18} />
            </span>
            <input
              ref={scanRef}
              id="pda-rcv"
              className="mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="상차확인서 스캔 · 번호 · 차량번호"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={pending}
            />
            <button type="submit" className={styles.goBtn} disabled={pending || !code.trim()} aria-label="입차·검수" title="입차·검수">
              <Icon name="arrow" size={18} stroke={2.2} />
            </button>
          </div>
        </form>
        {error && (
          <p className={styles.heroError} role="alert">
            {error}
          </p>
        )}
        <PdaViewBar date={date} today={today} filter={filter} options={FILTER_OPTIONS} counts={counts} pending={pending} onDate={(d) => view({ date: d })} onView={(st) => view({ st })} />
      </section>

      {/* 후보 목록 — 일부만 입력했거나 정확히 일치하는 차량이 여럿 (v1.9) */}
      {candidates && (
        <section className={styles.sheet} role="dialog" aria-label="차량 고르기">
          <h2 className={styles.h2}>차량을 고르세요</h2>
          <p className={styles.help}>{candidates.message} 입차 전 차량을 고르면 확인 후 입차합니다.</p>
          <ul className={styles.list}>
            {candidates.rows.map((c) => (
              <li key={c.loadId}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => {
                    setCandidates(null);
                    // 이미 입차한 차량은 그 검수 화면으로 바로, 입차 전 차량은 확인 창을 거쳐 입차
                    if (c.arrived) go({ loadId: c.loadId });
                    else setArriving({ loadId: c.loadId, vehicleNo: c.vehicleNo, loadNo: c.loadNo, clientName: c.clientName, departed: null });
                  }}
                  disabled={pending}
                >
                  <span className={styles.cardTop}>
                    <b className={`mono ${styles.cardId}`}>{c.vehicleNo}</b>
                    {c.arrived ? <Pill tone="blue">입차함</Pill> : <Pill tone="gray">입차 전</Pill>}
                  </span>
                  <span className={styles.meta}>
                    <span className="mono">{c.loadNo}</span>
                    <span>{c.clientName}</span>
                  </span>
                  <span className={styles.meta}>
                    <span className="mono">{c.orderNo ?? "무지시 상차"}</span>
                    <span>
                      상차완료 {md(c.completedAt)} {hm(c.completedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.secondary} onClick={() => (setCandidates(null), scanRef.current?.focus())}>
            닫기
          </button>
        </section>
      )}

      {/* 입차 확인 — 목록에서 입차 전 차량을 눌렀을 때 (스캔·정확한 번호 입력은 묻지 않고 바로) */}
      {arriving && (
        <div className={styles.modalScrim} onClick={(e) => e.target === e.currentTarget && !pending && setArriving(null)}>
          <section className={styles.modalSheet} role="dialog" aria-modal="true" aria-labelledby="arrive-title">
            <h2 id="arrive-title" className={styles.h2}>
              입차
            </h2>
            <p className={styles.askBody}>
              <b className="mono">{arriving.vehicleNo}</b> · {arriving.clientName}
              <br />
              <span className="mono">{arriving.loadNo}</span>
            </p>
            <p className={styles.help}>
              차량이 센터에 도착했으면 입차합니다. 상차확인서 번호와 차량번호를 확인하세요.
              {arriving.departed === false && " 출차 기록이 없어 출차도 '입차 처리(시스템)'으로 함께 기록됩니다."}
            </p>
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondary} onClick={() => setArriving(null)} disabled={pending} autoFocus>
                그만두기
              </button>
              <button type="button" className={styles.primary} onClick={() => go({ loadId: arriving.loadId })} disabled={pending}>
                입차
              </button>
            </div>
          </section>
        </div>
      )}

      {show("working") && (filter === "working" || home.working.length > 0) && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            검수 중인 차량 <span className={styles.count}>{home.working.length}</span>
          </h2>
          {home.working.length === 0 ? <p className={styles.empty}>검수 중인 차량이 없습니다.</p> : <ul className={styles.list}>{home.working.map(workingCard)}</ul>}
        </section>
      )}

      {show("todo") && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            도착·검수 대기 <span className={styles.count}>{home.arrived.length}</span>
          </h2>
          {home.arrived.length === 0 ? <p className={styles.empty}>입차하고 검수를 기다리는 차량이 없습니다.</p> : <ul className={styles.list}>{home.arrived.map(arrivedCard)}</ul>}
        </section>
      )}

      {show("todo") && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            입차 전 <span className={styles.count}>{home.waiting.length}</span>
          </h2>
          {home.waiting.length === 0 ? <p className={styles.empty}>이 센터로 오는 상차완료 차량이 없습니다.</p> : <ul className={styles.list}>{home.waiting.map(waitingCard)}</ul>}
        </section>
      )}

      {show("done") && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            검수확정 <span className={styles.count}>{home.done.length}</span>
          </h2>
          {home.done.length === 0 ? (
            <p className={styles.empty}>{isToday ? "오늘" : date} 검수 확정한 차량이 없습니다.</p>
          ) : (
            <ul className={styles.list}>{home.done.map(doneCard)}</ul>
          )}
        </section>
      )}
    </>
  );
}

/** 보기 버튼 — PDA 너비(360px)에 4개가 한 줄로 들어가게 짧은 이름. 대기 = 도착·검수 대기 + 입차 전 */
const FILTER_OPTIONS: [PdaRcvFilter, string][] = [
  ["all", "전체"],
  ["todo", "대기"],
  ["working", "검수 중"],
  ["done", "완료"],
];
