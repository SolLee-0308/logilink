import Link from "next/link";
import type { PdaLoadDashboard } from "@/features/loads/types";
import { fmtDateTime } from "@/lib/format";
import { Icon, type IconName } from "./PdaParts";
import styles from "./Pda.module.css";

/**
 * PDA 대시보드 — 상차담당 (임시안 U41)
 * 오늘 차량 진행률(완료 / 전체) → 상차할·작업 중·완료·차이 있음 4칸 → 내 입력 건수 → 최근 상차완료 3대
 */
export function PdaDashboardScreen({ data }: { data: PdaLoadDashboard }) {
  const total = data.todo + data.working + data.done;
  const pct = total ? Math.round((data.done / total) * 100) : 0;
  // 칸 색 = 상태 배지 색 (상차할 차량은 기본, 2026-11-07 Sol 피드백) — 상차 중(주황), 상차완료(초록), 차이 있음(붉은)
  // 2026-11-12 Sol: 칸마다 아이콘, 이름 "상차할"→"상차할 차량", "작업 중"→"상차 중"
  const tiles: [string, number, string, string, IconName][] = [
    ["상차할 차량", data.todo, "/pda?st=todo", "", "truck"],
    ["상차 중", data.working, "/pda?st=working", styles.tilePart, "box"],
    ["상차완료", data.done, "/pda?st=done", styles.tileDone, "check"],
    ["차이 있음", data.diffDone, "/pda?st=done", styles.tileRej, "alert"],
  ];
  return (
    <>
      <section className={styles.hero}>
        <span className={styles.heroK}>오늘 상차 진행 · {data.today}</span>
        <span className={styles.heroRow}>
          <b className={styles.heroNum}>
            {data.done}
            <small> / {total}대</small>
          </b>
          <b className={styles.heroPct}>{pct}%</b>
        </span>
        <span className={styles.heroBar} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.heroK}>
          무지시 {data.unorderedDone}대 포함 · 내 입력 {data.myInputs}건
        </span>
      </section>

      <section className={styles.tiles}>
        {tiles.map(([k, v, href, tone, icon]) => (
          <Link key={k} href={href} className={`${styles.tile} ${styles.tileIcon} ${tone}`}>
            <span className={styles.tileGlyph}>
              <Icon name={icon} size={18} stroke={2} />
            </span>
            <span className={styles.k}>{k}</span>
            <b>{v}</b>
          </Link>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>
          최근 상차완료
          <Link href="/pda?st=done" className={styles.h2Link}>
            전체 보기 <Icon name="chevR" size={14} />
          </Link>
        </h2>
        {data.recent.length === 0 ? (
          <p className={styles.empty}>오늘 상차완료한 차량이 없습니다.</p>
        ) : (
          <ul className={styles.rows}>
            {data.recent.map((r) => (
              <li key={r.loadId}>
                <Link href={`/pda/load/${r.loadId}?st=done`}>
                  <b className="mono">{r.vehicleNo}</b>
                  <span className="mono">{r.loadNo}</span>
                  <span>{fmtDateTime(r.completedAt).slice(11)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
