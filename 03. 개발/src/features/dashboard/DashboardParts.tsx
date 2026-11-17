"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { WEEKDAY_LABEL, weekdayOf } from "@/domain/business-day";
import { pctOf } from "@/domain/dashboard-rules";
import { fmtDateTime } from "@/lib/format";
import type { DashCenter, DashClient, DashFlow, DashTrendDay } from "./types";
import styles from "./Dashboard.module.css";

/**
 * 3PL·화주사 대시보드 공통 조각 (2026-11-17 Sol 재구성, 시안 v0.1)
 * 머리 줄(센터·업무일·일마감) · 숫자 칸 · 오늘 차량 흐름 · 주의할 건 · 화주사 이름 칸 · 추이 그래프
 */

const md = (ymd: string) => ymd.slice(5);
const hm = (iso: string) => fmtDateTime(iso).slice(11, 16);

/* ───────── 머리 줄 ───────── */

export function HeadActions({
  centers,
  centerOptions,
  selectedCenter,
  now,
  showClose,
}: {
  centers: DashCenter[];
  centerOptions: { id: number; name: string }[];
  selectedCenter: string;
  now: string;
  /** 3PL만 — 센터별 일마감 상태와 일마감 화면 버튼 */
  showClose?: boolean;
}) {
  const router = useRouter();
  const dates = [...new Set(centers.map((c) => c.businessDate))];
  return (
    <div className={styles.headActions}>
      {centerOptions.length > 1 && (
        <Select
          aria-label="센터"
          value={selectedCenter}
          onChange={(e) => router.push(e.target.value ? `/dashboard?center=${e.target.value}` : "/dashboard")}
        >
          <option value="">전체 센터 ({centerOptions.length}곳)</option>
          {centerOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      <span className={styles.asOf}>
        {dates.length === 1 ? (
          <>
            오늘 업무일 <b className="mono">{dates[0]}</b> ({WEEKDAY_LABEL[weekdayOf(dates[0])]})
          </>
        ) : dates.length > 1 ? (
          <>센터별 업무일 ({dates.map(md).join(" · ")})</>
        ) : (
          "센터 없음"
        )}
        {" · "}
        <span className="mono">{fmtDateTime(now).slice(11)}</span> 기준
      </span>
      {showClose &&
        centers.map((c) => (
          <span key={c.id} className={`${styles.closePill} ${c.closed ? styles.closeDone : ""}`} title={c.closed ? `${c.closed.by} 처리` : undefined}>
            {centers.length > 1 && `${c.name} `}
            {c.closed ? (
              <>
                일마감 완료 · <span className="mono">{hm(c.closed.at)}</span> {c.closed.by}
              </>
            ) : (
              <>
                일마감 전 · 예정 <span className="mono">{c.dailyCloseTime}</span>
              </>
            )}
          </span>
        ))}
      {showClose && (
        <LinkButton size="sm" href="/closing?tab=daily">
          일마감 화면
        </LinkButton>
      )}
      <Button size="sm" onClick={() => router.refresh()}>
        새로 고침
      </Button>
    </div>
  );
}

/* ───────── 숫자 칸 ───────── */

export function Tile({ href, label, value, unit, note, danger }: { href: string; label: string; value: number; unit: string; note: React.ReactNode; danger?: boolean }) {
  const zero = value === 0;
  return (
    <Link href={href} className={`${styles.tile} ${zero ? styles.zero : ""} ${danger && !zero ? styles.danger : ""}`}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>
        <b className="mono">{value.toLocaleString()}</b>
        {unit}
      </span>
      <span className={styles.tileNote}>{note}</span>
    </Link>
  );
}

/* ───────── 오늘 차량 흐름 ───────── */

export interface FlowLinks {
  waiting: string;
  loading: string;
  onTheWay: string;
  arrived: string;
  received: string;
}

/**
 * 오늘 차량 흐름 (2026-11-17 Sol) — 5단계 누적 막대. 칸 너비 = 차량 수 비율.
 * 0대인 날에도 빈 막대 틀과 범례를 그대로 보여 준다(A안). 범례를 누르면 그 상태의 목록으로.
 */
export function VehicleFlow({ flow, title, note, links }: { flow: DashFlow; title: string; note: string; links: FlowLinks }) {
  const segs = [
    { key: "waiting", label: "상차 대기", value: flow.waiting, cls: styles.segReg },
    { key: "loading", label: "상차중", value: flow.loading, cls: styles.segLoading },
    { key: "onTheWay", label: "오는 중", value: flow.onTheWay, cls: styles.segWay },
    { key: "arrived", label: "도착·검수", value: flow.arrived, cls: styles.segArrived },
    { key: "received", label: "입고완료", value: flow.received, cls: styles.segReceived },
  ] as const;
  const total = segs.reduce((s, x) => s + x.value, 0);
  const summary = segs.map((s) => `${s.label} ${s.value}대`).join(", ");

  return (
    <Card
      title={title}
      description={note}
      aside={
        <span className={styles.progressSum}>
          <b className="mono">{total.toLocaleString()}</b>대 중 <b className="mono">{flow.received.toLocaleString()}</b>대 입고완료
          <span className={`${styles.progressPct} mono`}>{pctOf(flow.received, total)}%</span>
        </span>
      }
    >
      <div className={`${styles.bar} ${total === 0 ? styles.barEmpty : ""}`} role="img" aria-label={`오늘 차량 ${total}대 — ${summary}`}>
        {total === 0 ? (
          <span className={styles.barEmptyText}>오늘 차량이 없습니다</span>
        ) : (
          segs
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.key} className={`${styles.seg} ${s.cls}`} style={{ flexGrow: s.value }} title={`${s.label} ${s.value}대`}>
                <b className="mono">{s.value}</b>
              </span>
            ))
        )}
      </div>
      <ul className={styles.legend}>
        {segs.map((s, i) => (
          <li key={s.key} className={s.value === 0 ? styles.legendZero : ""}>
            {i > 0 && (
              <span className={styles.legendArrow} aria-hidden>
                ›
              </span>
            )}
            <Link href={links[s.key]} className={styles.legendLink}>
              <i className={`${styles.swatch} ${s.cls}`} aria-hidden />
              {s.label} <b className="mono">{s.value}</b>대
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────── 주의할 건 ───────── */

export function More({ shown, total, href }: { shown: number; total: number; href: string }) {
  if (total <= shown) return null;
  return (
    <p className={styles.more}>
      외 {total - shown}건 · <Link href={href}>전체 보기 →</Link>
    </p>
  );
}

export interface WatchItem {
  key: string;
  /** 숫자 칸의 #앵커가 가리키는 id — 0건이어도 "이상 없음" 줄에 남겨 둔다 */
  anchorId?: string;
  title: string;
  count: number;
  /** 카드 너비 비율 (2026-11-17 Sol: 기한경과 목록은 넓게, 검수 차이는 좁게) */
  grow?: number;
  danger?: boolean;
  description: React.ReactNode;
  body: React.ReactNode;
}

/**
 * 주의할 건 (2026-11-12 Sol) — 건이 있는 카드만 펼치고, 0건 카드는 "이상 없음" 한 줄로 모은다.
 */
export function WatchGrid({ items }: { items: WatchItem[] }) {
  const open = items.filter((i) => i.count > 0);
  const clear = items.filter((i) => i.count === 0);
  return (
    <section aria-labelledby="dash-watch" className={styles.watchSec}>
      <h2 id="dash-watch" className={styles.secTitle}>
        주의할 건
      </h2>
      {open.length > 0 && (
        <div className={styles.watch}>
          {open.map((i) => (
            <div key={i.key} className={styles.watchItem} style={{ flexGrow: i.grow ?? 1, flexBasis: `${(i.grow ?? 1) * 280}px` }}>
              <Card title={i.anchorId ? <span id={i.anchorId}>{i.title}</span> : i.title} label={i.title} count={i.count} description={i.description}>
                {i.body}
              </Card>
            </div>
          ))}
        </div>
      )}
      {clear.length > 0 && (
        <p className={styles.clear}>
          <span className={styles.clearMark} aria-hidden>
            ✓
          </span>
          <b>이상 없음</b>
          {clear.map((i) => (
            <span key={i.key} id={i.anchorId} className={styles.clearItem}>
              {i.title} <span className="mono">0</span>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/**
 * 화주사 이름 칸 (2026-11-17 Sol 시안 댓글) — 긴 이름은 '…'로 줄이고 마우스를 올리면 전체 이름,
 * 누르면 작은 상자에 화주사명 전체와 화주사 코드. 표가 가로 스크롤 상자라 상자는 화면 기준(fixed)으로 띄운다.
 * 줄 클릭(상세 이동)과 겹치지 않게 이벤트를 막는다.
 */
export function ClientName({ name, code }: { name: string; code: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPos(null);
        btn.current?.focus();
      }
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 6 });
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={styles.clientName}
        title={name}
        aria-expanded={!!pos}
        onClick={toggle}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {name}
      </button>
      {pos && (
        <span className={styles.clientPop} role="dialog" aria-label="화주사 정보" style={pos} onClick={(e) => e.stopPropagation()}>
          <span className={styles.popK}>화주사명</span>
          <span className={styles.popV}>{name}</span>
          <span className={styles.popK}>화주사 코드</span>
          <span className={`${styles.popV} mono`}>{code}</span>
        </span>
      )}
    </>
  );
}

export const clientCol = <T extends DashClient>(): Column<T> => ({
  key: "client",
  header: "화주사",
  render: (r) => <ClientName name={r.clientName} code={r.clientCode} />,
});

export const centerCol = <T extends { centerName: string }>(multi: boolean): Column<T>[] =>
  multi ? [{ key: "center", header: "센터", render: (r) => r.centerName }] : [];

/* ───────── 추이 그래프 (2026-11-17 Sol: 최근 14업무일) ───────── */

/** 축 눈금 최댓값 — 1·2·5 × 10^n 중 값보다 큰 가장 작은 수 */
export function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const fmtAxis = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}천` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}천` : String(v));

interface Series {
  label: string;
  values: (number | null)[];
  /** 막대·선 색 class */
  cls: string;
}

/**
 * 막대(쌓기 가능) + 선 그래프 — 막대는 왼쪽 축, 선은 오른쪽 축(rightUnit) 또는 막대가 없으면 왼쪽 축.
 * 오늘(마지막 날)은 진행 중이라 빗금 막대·점선 꼭짓점으로 구분한다.
 */
export function TrendChart({
  title,
  days,
  bars = [],
  line,
  barUnit,
  lineUnit,
  lineMin = 0,
  lineMax,
  guide,
  note,
}: {
  title: string;
  days: DashTrendDay[];
  bars?: Series[];
  line?: Series;
  barUnit?: string;
  lineUnit?: string;
  lineMin?: number;
  lineMax?: number;
  /** 선 그래프 기준선 값 (예: 100%) */
  guide?: number;
  note?: string;
}) {
  const n = days.length;
  const last = n - 1;
  const barTop = niceMax(Math.max(0, ...days.map((_, i) => bars.reduce((s, b) => s + (b.values[i] ?? 0), 0))));
  const lineVals = line?.values.filter((v): v is number => v !== null) ?? [];
  const lTop = lineMax ?? niceMax(Math.max(0, ...lineVals));
  const lPct = (v: number) => Math.max(0, Math.min(100, ((v - lineMin) / (lTop - lineMin)) * 100));
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const pts = line ? line.values.map((v, i) => (v === null ? null : { i, x: x(i), y: lPct(v), v })) : [];
  const solid = pts.filter((p, i) => p && i < last) as { i: number; x: number; y: number; v: number }[];
  const lastPrev = [...solid].reverse()[0];
  const today = pts[last];
  const rightAxis = bars.length > 0 && !!line;
  const empty = days.every((_, i) => bars.every((b) => !b.values[i]) && (line?.values[i] ?? null) === null);
  const desc = days
    .map((d, i) => `${md(d.date)} ${[...bars.map((b) => `${b.label} ${b.values[i] ?? 0}`), ...(line ? [`${line.label} ${line.values[i] ?? "-"}`] : [])].join(" ")}`)
    .join(", ");

  return (
    <Card title={title} description={note} className={styles.chartCard}>
      <div className={styles.chartLegend}>
        {bars.map((b) => (
          <span key={b.label}>
            <i className={`${styles.swatch} ${b.cls}`} aria-hidden />
            {b.label}
            {barUnit && `(${barUnit})`}
          </span>
        ))}
        {line && (
          <span>
            <i className={`${styles.lineSwatch} ${line.cls}`} aria-hidden />
            {line.label}
            {lineUnit && `(${lineUnit})`}
          </span>
        )}
      </div>
      <div className={`${styles.plot} ${rightAxis ? styles.plotRight : ""}`} role="img" aria-label={`${title} — ${desc}`}>
        {[0, 50, 100].map((t) => (
          <span key={t} className={`${styles.gridLine} ${t === 0 ? styles.gridBase : ""}`} style={{ bottom: `${t}%` }} />
        ))}
        {bars.length > 0 ? (
          [0, 50, 100].map((t) => (
            <span key={t} className={styles.yLeft} style={{ bottom: `${t}%` }}>
              {fmtAxis((barTop * t) / 100)}
            </span>
          ))
        ) : line ? (
          [0, 50, 100].map((t) => (
            <span key={t} className={styles.yLeft} style={{ bottom: `${t}%` }}>
              {Math.round(lineMin + ((lTop - lineMin) * t) / 100)}
              {lineUnit}
            </span>
          ))
        ) : null}
        {rightAxis &&
          [50, 100].map((t) => (
            <span key={t} className={`${styles.yRight} ${line!.cls}`} style={{ bottom: `${t}%` }}>
              {Math.round(lineMin + ((lTop - lineMin) * t) / 100)}
              {lineUnit}
            </span>
          ))}
        {guide !== undefined && <span className={styles.guideLine} style={{ bottom: `${lPct(guide)}%` }} />}

        {bars.length > 0 && (
          <div className={styles.bars}>
            {days.map((d, i) => (
              <div key={d.date} className={styles.col} title={`${d.date} ${bars.map((b) => `${b.label} ${(b.values[i] ?? 0).toLocaleString()}`).join(" · ")}`}>
                {bars.length === 1 && (bars[0].values[i] ?? 0) > 0 && <span className={`${styles.barVal} mono`}>{bars[0].values[i]}</span>}
                {[...bars].reverse().map((b, bi) => (
                  <span
                    key={b.label}
                    className={`${styles.barPart} ${b.cls} ${i === last ? styles.barToday : ""} ${bi === 0 ? styles.barTop : ""}`}
                    style={{ height: `${((b.values[i] ?? 0) / barTop) * 100}%` }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {line && (
          <svg className={styles.lineSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline className={line.cls} points={solid.map((p) => `${p.x},${100 - p.y}`).join(" ")} />
            {today && lastPrev && <polyline className={`${line.cls} ${styles.dashed}`} points={`${lastPrev.x},${100 - lastPrev.y} ${today.x},${100 - today.y}`} />}
          </svg>
        )}
        {line &&
          pts.map(
            (p) =>
              p && (
                <span
                  key={p.i}
                  className={`${styles.dot} ${line.cls} ${p.i === last ? styles.dotToday : ""}`}
                  style={{ left: `${p.x}%`, bottom: `${p.y}%` }}
                  title={`${days[p.i].date} ${line.label} ${p.v}${lineUnit ?? ""}`}
                />
              ),
          )}
        {empty && <span className={styles.chartEmpty}>최근 {n}업무일 기록이 없습니다</span>}
      </div>
      <div className={`${styles.xAxis} ${rightAxis ? styles.plotRight : ""}`}>
        {days.map((d, i) => (
          <span key={d.date} className={i === last ? styles.xToday : ""}>
            {i === last ? "오늘" : md(d.date)}
          </span>
        ))}
      </div>
    </Card>
  );
}
