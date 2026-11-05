"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { fmtDateTime } from "@/lib/format";
import { startRcv } from "@/server/rcv/actions";
import type { PdaRcvHome, PdaRcvRow, RcvCandidate } from "@/features/rcv/types";
import { passNotice } from "./device";
import { Icon, Pill, Steps } from "./PdaParts";
import styles from "./Pda.module.css";

const hm = (iso: string | null) => fmtDateTime(iso).slice(11);

/**
 * PDA 입고검수 첫 화면 (정의서 ⑥, R1)
 * - 상차확인서(LD)·상차지시서(LO) 바코드를 스캔하거나 차량번호를 넣어 시작한다. 상차완료 차량·소속 센터만.
 * - 검수 중인 차량은 다른 검수자가 시작했어도 눌러서 함께 검수한다 (잠금 없음, 2026-11-05 Sol).
 */
export function PdaInspectHomeScreen({ home }: { home: PdaRcvHome }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RcvCandidate[] | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

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
      router.push(`/pda/inspect/${r.data!.rcvId}`);
    });

  const card = (w: PdaRcvRow, working: boolean) => (
    <li key={w.loadId}>
      <button type="button" className={styles.card} onClick={() => (working ? router.push(`/pda/inspect/${w.rcvId}`) : go({ loadId: w.loadId }))} disabled={pending}>
        <span className={styles.cardTop}>
          <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
          {working ? <Pill tone="blue">검수중</Pill> : <Pill tone={w.loadType === "UNORDERED" ? "amber" : "gray"}>{LOAD_TYPE_LABEL[w.loadType]}</Pill>}
        </span>
        <span className={styles.meta}>
          <span className="mono">{w.loadNo}</span>
          <span>{w.clientName}</span>
        </span>
        {working ? (
          <Steps
            compact
            steps={[
              { label: "상차완료", done: true },
              { label: "검수 중", done: true, time: `입력 ${w.inputCount}건${w.workerCount > 1 ? ` · ${w.workerCount}명` : ""}` },
              { label: "검수확정", done: false },
            ]}
          />
        ) : (
          <span className={styles.meta}>
            <span>
              품목 {w.lineCount}개 · 상차완료 {hm(w.loadCompletedAt)}
            </span>
            <span className={styles.cardGo}>
              검수 <Icon name="arrow" size={13} stroke={2.4} />
            </span>
          </span>
        )}
      </button>
    </li>
  );

  return (
    <>
      <section className={styles.hero}>
        <span className={styles.heroRow}>
          <span className={styles.heroK}>
            검수 대기 <b className={styles.heroInline}>{home.waiting.length}대</b>
          </span>
          <span className={styles.heroStats}>
            <span>
              검수 중 <b>{home.working.length}</b>
            </span>
            <span>
              오늘 확정 <b>{home.doneCount}</b>
            </span>
          </span>
        </span>
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

      {home.working.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            검수 중인 차량 <span className={styles.count}>{home.working.length}</span>
          </h2>
          <ul className={styles.list}>{home.working.map((w) => card(w, true))}</ul>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.h2}>
          검수 대기 <span className={styles.count}>{home.waiting.length}</span>
        </h2>
        {home.waiting.length === 0 ? <p className={styles.empty}>검수할 상차완료 차량이 없습니다.</p> : <ul className={styles.list}>{home.waiting.map((w) => card(w, false))}</ul>}
      </section>
    </>
  );
}
