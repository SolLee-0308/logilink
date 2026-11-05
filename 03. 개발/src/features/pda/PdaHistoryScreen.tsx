"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import type { PdaHistory } from "@/features/loads/types";
import { fmtDateTime } from "@/lib/format";
import { Icon, Pill } from "./PdaParts";
import styles from "./Pda.module.css";

const shift = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * PDA 상차내역 (2026-11-05 PDA 메뉴 확정) — 날짜별 상차완료 차량
 * 카드를 누르면 상차확인서 번호·바코드 화면(/pda/load/[id])으로 간다. 기사·검수 쪽에서 번호를 다시 찾을 때 쓴다.
 */
export function PdaHistoryScreen({ history }: { history: PdaHistory }) {
  const router = useRouter();
  const { date, today, rows } = history;
  const go = (d: string) => router.push(d === today ? "/pda/loads" : `/pda/loads?date=${d}`);
  return (
    <>
      <section className={styles.dateBar}>
        <button type="button" className={styles.roundBtn} onClick={() => go(shift(date, -1))} aria-label="전날">
          <Icon name="chevL" size={18} />
        </button>
        <label className={styles.dateField}>
          <span className="sr-only">상차일</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
          {date === today && <small>오늘</small>}
        </label>
        <button type="button" className={styles.roundBtn} onClick={() => go(shift(date, 1))} disabled={date >= today} aria-label="다음 날">
          <Icon name="chevR" size={18} />
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>
          상차완료 <span className={styles.count}>{rows.length}</span>
        </h2>
        {rows.length === 0 ? (
          <p className={styles.empty}>이 날 상차완료한 차량이 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((w) => (
              <li key={w.loadId}>
                <Link href={`/pda/load/${w.loadId}?from=${date}`} className={styles.card}>
                  <span className={styles.cardTop}>
                    <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
                    {w.diffReasonName ? <Pill tone="amber">차이 있음</Pill> : <Pill tone="green">상차완료</Pill>}
                  </span>
                  <span className={styles.meta}>
                    <span className="mono">{w.loadNo}</span>
                    <span>{fmtDateTime(w.completedAt).slice(11)}</span>
                  </span>
                  <span className={styles.meta}>
                    <span>
                      {w.centerName} · {LOAD_TYPE_LABEL[w.type]}
                    </span>
                    <span>
                      {w.completedBy} · 입력 {w.inputCount}건
                    </span>
                  </span>
                  {w.diffReasonName && <span className={styles.metaWarn}>차이 사유: {w.diffReasonName}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
