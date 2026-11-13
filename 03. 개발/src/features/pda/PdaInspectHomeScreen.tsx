"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { fmtDateTime } from "@/lib/format";
import { startRcv } from "@/server/rcv/actions";
import type { PdaRcvFilter, PdaRcvHome, PdaRcvRow, RcvCandidate } from "@/features/rcv/types";
import { passNotice } from "./device";
import { Icon, Pill, Steps } from "./PdaParts";
import { PdaViewBar } from "./PdaViewBar";
import styles from "./Pda.module.css";

const hm = (iso: string | null) => fmtDateTime(iso).slice(11);

/**
 * PDA 입고검수 첫 화면 (정의서 ⑥, R1)
 * - 상차확인서(LD)·상차지시서(LO) 바코드를 스캔하거나 차량번호를 넣어 시작한다. 상차완료 차량·소속 센터만.
 * - 검수 중인 차량은 다른 검수자가 시작했어도 눌러서 함께 검수한다 (잠금 없음, 2026-11-05 Sol).
 * 2026-11-12 Sol: 상차등록 PDA와 같은 모양 — 검수 내역 메뉴를 합쳐 검정 영역에 날짜·보기(전체/대기/검수 중/완료),
 *   위 요약 줄 삭제, 카드 색(검수 중 연한 주황 · 확정 연한 연두). 대기·검수 중은 날짜와 상관없이 항상, 완료는 확정한 날짜.
 */
export function PdaInspectHomeScreen({ home, filter = "all" }: { home: PdaRcvHome; filter?: PdaRcvFilter }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RcvCandidate[] | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const { today, date } = home;
  const isToday = date === today;
  const show = (k: Exclude<PdaRcvFilter, "all">) => filter === "all" || filter === k;
  const counts: Record<PdaRcvFilter, number> = {
    all: home.waiting.length + home.working.length + home.done.length,
    todo: home.waiting.length,
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
      const r = await startRcv(input);
      if (!r.ok) {
        setError(r.error);
        setCode("");
        scanRef.current?.focus();
        return;
      }
      if (r.data?.candidates) {
        setCandidates(r.data.candidates);
        return;
      }
      passNotice(r.data?.notice);
      // 스캔으로 열어도 지금 날짜·보기를 가지고 간다 — [처음으로]·← 가 같은 목록으로 (2026-11-13 Sol)
      router.push(rcvHref(r.data!.rcvId!));
    });

  /** 검수 대기 카드 — 회색, 상차 구분 알약. 오늘 전에 상차완료한 차량은 날짜 안내 */
  const waitingCard = (w: PdaRcvRow) => {
    const doneDay = w.loadCompletedAt ? fmtDateTime(w.loadCompletedAt).slice(0, 10) : null;
    return (
      <li key={w.loadId}>
        <button type="button" className={styles.card} onClick={() => go({ loadId: w.loadId })} disabled={pending}>
          <span className={styles.cardTop}>
            <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
            <Pill tone={w.loadType === "UNORDERED" ? "amber" : "gray"}>{LOAD_TYPE_LABEL[w.loadType]}</Pill>
          </span>
          <span className={styles.meta}>
            <span className="mono">{w.loadNo}</span>
            <span>{w.clientName}</span>
          </span>
          <span className={styles.meta}>
            <span>
              품목 {w.lineCount}개 · 상차완료 {hm(w.loadCompletedAt)}
            </span>
            <span className={styles.cardGo}>
              검수 <Icon name="arrow" size={13} stroke={2.4} />
            </span>
          </span>
          {doneDay && doneDay < today && <span className={styles.metaWarn}>{doneDay.slice(5)} 상차완료 · 아직 검수 전</span>}
        </button>
      </li>
    );
  };

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
            { label: "상차완료", done: true },
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
            상차확인서·상차지시서 바코드 또는 차량번호
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
              placeholder="상차확인서 스캔 · 차량번호"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={pending}
            />
            <button type="submit" className={styles.goBtn} disabled={pending || !code.trim()} aria-label="시작" title="시작">
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

      {candidates && (
        <section className={styles.sheet} role="dialog" aria-label="검수할 상차 실적 고르기">
          <h2 className={styles.h2}>검수할 상차 실적을 고르세요</h2>
          <p className={styles.help}>같은 차량번호로 검수할 실적이 여럿입니다. 상차확인서 번호를 확인하세요.</p>
          <ul className={styles.list}>
            {candidates.map((c) => (
              <li key={c.loadId}>
                <button type="button" className={styles.card} onClick={() => (setCandidates(null), go({ loadId: c.loadId }))} disabled={pending}>
                  <span className={styles.meta}>
                    <b className="mono">{c.loadNo}</b>
                    <span>{hm(c.completedAt)}</span>
                  </span>
                  <span className={styles.meta}>
                    <span>{c.clientName}</span>
                    <span>{c.centerName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.secondary} onClick={() => setCandidates(null)}>
            닫기
          </button>
        </section>
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
            검수 대기 <span className={styles.count}>{home.waiting.length}</span>
          </h2>
          {home.waiting.length === 0 ? <p className={styles.empty}>검수할 상차완료 차량이 없습니다.</p> : <ul className={styles.list}>{home.waiting.map(waitingCard)}</ul>}
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

/** 보기 버튼 — PDA 너비(360px)에 4개가 한 줄로 들어가게 짧은 이름 */
const FILTER_OPTIONS: [PdaRcvFilter, string][] = [
  ["all", "전체"],
  ["todo", "대기"],
  ["working", "검수 중"],
  ["done", "완료"],
];
