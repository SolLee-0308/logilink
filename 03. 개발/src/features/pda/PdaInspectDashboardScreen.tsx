import Link from "next/link";
import type { PdaRcvDashboard } from "@/features/rcv/types";
import { fmtDateTime } from "@/lib/format";
import { Icon, type IconName } from "./PdaParts";
import styles from "./Pda.module.css";

/**
 * PDA 대시보드 — 입고검수자 (임시안 U45-⑦)
 * 오늘 진행률(확정 / 도착·검수 대기+검수 중+확정, 2026-11-17 Sol — 센터 업무일 기준) → 도착·검수 대기·검수 중·검수확정·이상 있음 4칸 → 내 입력 건수·입차 전 대수 → 최근 확정 3대
 * v1.9: "검수 대기"를 입차 기준으로 나눔 — 칸은 센터에 도착한 차량(도착·검수 대기), 아직 오는 차량(입차 전)은 위 줄에 대수만
 */
export function PdaInspectDashboardScreen({ data }: { data: PdaRcvDashboard }) {
  // 2026-11-17 Sol: 분모 = 오늘 도착한 차량 — 입차 전(날짜와 상관없이 상차완료한 모든 차량)을 빼서 %가 실제 진행을 보이게
  const total = data.arrived + data.working + data.done;
  const pct = total ? Math.round((data.done / total) * 100) : 0;
  // 상차담당 대시보드와 같은 칸 (2026-11-12 Sol) — 상태 색(대기 기본 · 검수 중 주황 · 확정 초록 · 이상 붉은) + 왼쪽 위 아이콘·이름, 숫자 오른쪽 아래
  const tiles: [string, number, string, string, IconName][] = [
    ["도착·검수 대기", data.arrived, "/pda/inspect?st=todo", "", "truck"],
    ["검수 중", data.working, "/pda/inspect?st=working", styles.tilePart, "scan"],
    ["검수확정", data.done, "/pda/inspect?st=done", styles.tileDone, "check"],
    ["이상 있음", data.issueDone, "/pda/inspect?st=done", styles.tileRej, "alert"],
  ];
  return (
    <>
      <section className={styles.hero}>
        <span className={styles.heroK}>오늘 입고검수 · 업무일 {data.today}</span>
        <span className={styles.heroRow}>
          <b className={styles.heroNum}>
            {data.done.toLocaleString()}
            <small> / {total.toLocaleString()}대 도착</small>
          </b>
          <b className={styles.heroPct}>{pct}%</b>
        </span>
        <span className={styles.heroBar} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.heroK}>
          오는 중(입차 전) {data.waiting.toLocaleString()}대 · 내 입력 {data.myInputs.toLocaleString()}건
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
          최근 검수확정
          <Link href="/pda/inspect?st=done" className={styles.h2Link}>
            전체 보기 <Icon name="chevR" size={14} />
          </Link>
        </h2>
        {data.recent.length === 0 ? (
          <p className={styles.empty}>오늘 검수 확정한 차량이 없습니다.</p>
        ) : (
          <ul className={styles.rows}>
            {data.recent.map((r) => (
              <li key={r.rcvId}>
                <Link href={`/pda/inspect/${r.rcvId}?ret=dashboard`}>
                  <b className="mono">{r.vehicleNo}</b>
                  <span className="mono">{r.rcvNo}</span>
                  <span>{fmtDateTime(r.confirmedAt).slice(11)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
