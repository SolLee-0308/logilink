"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import type { PdaRcvHistory } from "@/features/rcv/types";
import { fmtDateTime } from "@/lib/format";
import { Icon, Pill } from "./PdaParts";
import styles from "./Pda.module.css";

const shift = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** PDA 검수 내역 — 날짜별(확정 시각) 검수 확정 차량. 누르면 검수 결과·배분 화면 */
export function PdaInspectHistoryScreen({ history }: { history: PdaRcvHistory }) {
  const router = useRouter();
  const { date, today, rows } = history;
  const go = (d: string) => router.push(d === today ? "/pda/inspect/history" : `/pda/inspect/history?date=${d}`);
  return (
    <>
      <section className={styles.dateBar}>
        <button type="button" className={styles.roundBtn} onClick={() => go(shift(date, -1))} aria-label="전날">
          <Icon name="chevL" size={18} />
        </button>
        <label className={styles.dateField}>
          <span className="sr-only">검수일</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
          {date === today && <small>오늘</small>}
        </label>
        <button type="button" className={styles.roundBtn} onClick={() => go(shift(date, 1))} disabled={date >= today} aria-label="다음 날">
          <Icon name="chevR" size={18} />
        </button>
      </section>
      <section className={styles.section}>
        <h2 className={styles.h2}>
          검수확정 <span className={styles.count}>{rows.length}</span>
        </h2>
        {rows.length === 0 ? (
          <p className={styles.empty}>이 날 검수 확정한 차량이 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((w) => (
              <li key={w.rcvId}>
                <Link href={`/pda/inspect/${w.rcvId}?from=${date}`} className={styles.card}>
                  <span className={styles.cardTop}>
                    <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
                    {w.issueCount ? <Pill tone="amber">이상 {w.issueCount}건</Pill> : <Pill tone="green">이상 없음</Pill>}
                  </span>
                  <span className={styles.meta}>
                    <span className="mono">{w.rcvNo}</span>
                    <span>{fmtDateTime(w.confirmedAt).slice(11)}</span>
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
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
