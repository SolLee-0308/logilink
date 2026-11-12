"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { fmtDateTime } from "@/lib/format";
import { startOrderedLoad, startUnorderedLoad } from "@/server/loads/actions";
import type { PdaHome, PdaLoadFilter, PdaWorkingRow } from "@/features/loads/types";
import { passNotice } from "./device";
import { Icon, Pill, Steps } from "./PdaParts";
import styles from "./Pda.module.css";

/**
 * PDA 첫 화면 (정의서 ④)
 * - 지시 상차: 상차지시서 바코드를 스캔(또는 번호 입력)하거나 오늘 상차할 차량을 눌러 시작한다.
 * - 무지시 상차: 예정에 없던 차량 — 센터·차량번호를 넣어 시작한다 (ASN을 만들지 않는다, D12).
 * - 작업 중인 차량은 다른 작업자가 시작했어도 눌러서 함께 실을 수 있다 (작업자 잠금 없음, D11).
 * 화면 배치(2026-11-05 참고 UI): 검정 요약 카드 안 스캔칸 → 작업 중(진행 단계 카드) → 상차할 차량 → 무지시.
 * 2026-11-12 Sol: 상차내역 메뉴를 합침 — 검정 영역에 날짜·보기(전체/상차할 차량/상차 중/상차완료) 드롭다운, 목록은 카드 유지.
 *   작업 중인 차량은 날짜와 상관없이 항상, 오늘이면 출고일 지난 상차할 차량도 보인다. 작업 중·출고일 지남은 알약으로 표시.
 */
export function PdaHomeScreen({
  home,
  filter = "all",
  openFree = false,
}: {
  home: PdaHome;
  filter?: PdaLoadFilter;
  /** 머리의 [무지시 상차]로 들어옴 (?free=1) */
  openFree?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unordered, setUnordered] = useState(openFree);
  // 머리의 [무지시 상차]를 누를 때마다 폼을 연다
  useEffect(() => {
    if (openFree) setUnordered(true);
  }, [openFree]);
  const closeFree = () => {
    setUnordered(false);
    setSuggest(null);
    if (openFree) router.replace("/pda");
  };
  const [centerId, setCenterId] = useState(home.defaultCenterId || (home.centers[0] ? String(home.centers[0].id) : ""));
  const [vehicle, setVehicle] = useState("");
  const [suggest, setSuggest] = useState<{ message: string; orderNo: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const go = (r: { ok: true; data?: { loadId: number; notice?: string } }) => {
    passNotice(r.data?.notice);
    router.push(`/pda/load/${r.data!.loadId}`);
  };

  const startOrder = (orderNo: string) =>
    start(async () => {
      setError(null);
      const r = await startOrderedLoad({ orderNo });
      if (r.ok) go(r);
      else {
        setError(r.error);
        setCode("");
        scanRef.current?.focus();
      }
    });

  const startFree = (force = false) =>
    start(async () => {
      setError(null);
      setSuggest(null);
      const r = await startUnorderedLoad({ centerId: Number(centerId), vehicleNo: vehicle, force });
      if (r.ok) go(r);
      else if (r.code === "CONFIRM" && r.fieldErrors?.orderNo) setSuggest({ message: r.error, orderNo: r.fieldErrors.orderNo });
      else setError(r.error);
    });

  const todo = home.orders.filter((o) => !o.loadId);
  const { today, date } = home;
  const isToday = date === today;
  const show = (k: Exclude<PdaLoadFilter, "all">) => filter === "all" || filter === k;
  const counts: Record<PdaLoadFilter, number> = {
    all: todo.length + home.working.length + home.done.length,
    todo: todo.length,
    working: home.working.length,
    done: home.done.length,
  };

  /** 날짜·거르기를 바꾼다 — 주소에 남겨 상차 작업에서 ← 로 돌아와도 같은 목록. 바꾼 뒤 커서는 스캔칸으로 */
  const view = (next: { date?: string; st?: PdaLoadFilter }) => {
    const d = next.date ?? date;
    const st = next.st ?? filter;
    const q = new URLSearchParams();
    if (d !== today) q.set("date", d);
    if (st !== "all") q.set("st", st);
    router.replace(q.size ? `/pda?${q}` : "/pda", { scroll: false });
    scanRef.current?.focus();
  };
  // 날짜를 바꾸면 화면 데이터가 새로 오므로, 그 뒤에도 스캔칸에 커서를 둔다 (바코드가 날짜칸·드롭다운에 들어가지 않게)
  useEffect(() => {
    if (!unordered) scanRef.current?.focus();
  }, [date, filter]); // unordered는 일부러 뺌 — 무지시 폼을 닫을 때 커서를 옮기지 않는다

  /** 상차 작업·상차확인서로 — ← 가 지금 날짜·거르기로 돌아오게 */
  const loadHref = (loadId: number) => {
    const q = new URLSearchParams();
    if (!isToday) q.set("from", date);
    if (filter !== "all") q.set("st", filter);
    return q.size ? `/pda/load/${loadId}?${q}` : `/pda/load/${loadId}`;
  };

  /** 상차 중인 차량 카드 — 연한 주황 카드([출고일 지남]만 알약) / 지시서·센터 / 작은 진행 단계. 날짜와 상관없이 항상 보인다 */
  const workingCard = (w: PdaWorkingRow) => (
    <li key={w.loadId}>
      <button type="button" className={`${styles.card} ${styles.cardWorking}`} onClick={() => router.push(loadHref(w.loadId))} disabled={pending}>
        <span className={styles.cardTop}>
          <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
          {w.shipDate && w.shipDate < today && <Pill tone="red">출고일 지남</Pill>}
        </span>
        <span className={styles.meta}>
          <span>
            {LOAD_TYPE_LABEL[w.type]} · {w.orderNo ? <span className="mono">{w.orderNo}</span> : "지시서 없음"}
          </span>
          <span>{w.centerName}</span>
        </span>
        {/* 재개한 차량은 "재개 N차" (2026-11-12 Sol, D20) · 날을 넘겼거나 출고일 지난 차량은 안내 */}
        {(w.revisionNo > 1 || w.loadDate < today || (w.shipDate && w.shipDate < today)) && (
          <span className={styles.metaWarn}>
            {[
              w.revisionNo > 1 ? `재개 ${w.revisionNo}차` : "",
              w.loadDate < today ? `${w.loadDate.slice(5)} 시작` : "",
              w.shipDate && w.shipDate < today ? `출고일 ${w.shipDate}` : w.loadDate < today ? "아직 상차완료 전" : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        <Steps
          compact
          steps={[
            { label: "상차 시작", done: true },
            { label: "상차 중", done: w.inputCount > 0, time: `입력 ${w.inputCount}건${w.workerCount > 1 ? ` · ${w.workerCount}명` : ""}` },
            { label: "상차완료", done: false },
          ]}
        />
      </button>
    </li>
  );

  return (
    <>
      {/* 검정 영역 — 상차지시서 스캔 + 날짜·거르기 (2026-11-12 Sol: 상차내역 합침, 위 요약 줄(상차할·상차 중·완료) 삭제) */}
      <section className={styles.hero}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) startOrder(code);
          }}
        >
          <label htmlFor="pda-order" className="sr-only">
            상차지시서 바코드
          </label>
          <div className={styles.searchPill}>
            <span className={styles.searchIcon}>
              <Icon name="scan" size={18} />
            </span>
            <input
              ref={scanRef}
              id="pda-order"
              className="mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="상차지시서 스캔 · LO- 번호"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
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
        {/*
          날짜 + 보기를 한 줄로 (2026-11-12 Sol A안: 공간 절약)
          날짜는 작은 칸(MM-DD▾) — 누르면 달력. 지난 날짜를 보는 중이면 노란 칸. 보기는 건수 붙은 버튼 4개.
        */}
        <div className={styles.heroChips} role="group" aria-label="날짜와 보기">
          <span className={`${styles.heroDateChip} ${isToday ? "" : styles.heroDatePast}`}>
            <button
              type="button"
              onClick={() => {
                const el = dateRef.current;
                if (!el) return;
                try {
                  el.showPicker();
                } catch {
                  el.focus();
                }
              }}
              disabled={pending}
              aria-label={`조회 날짜 ${date}${isToday ? " (오늘)" : ""} — 눌러서 바꾸기`}
            >
              {isToday ? "오늘" : date.slice(5)}
              <Icon name="chevD" size={12} stroke={2.4} />
            </button>
            <input
              ref={dateRef}
              type="date"
              tabIndex={-1}
              aria-hidden="true"
              value={date}
              max={today}
              onChange={(e) => e.target.value && view({ date: e.target.value })}
            />
          </span>
          {FILTER_OPTIONS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`${styles.heroChip} ${filter === v ? styles.heroChipOn : ""}`}
              aria-pressed={filter === v}
              onClick={() => view({ st: v })}
              disabled={pending}
            >
              {l} <b className="mono">{counts[v]}</b>
            </button>
          ))}
        </div>
      </section>

      {unordered && (
          <form
            className={styles.sheet}
            onSubmit={(e) => {
              e.preventDefault();
              startFree();
            }}
          >
            <h2 className={styles.h2}>
              <Icon name="truck" size={18} /> 무지시 상차
            </h2>
            <p className={styles.help}>예정에 없던 차량입니다. ASN을 만들지 않고 실적만 남깁니다. 오늘 ASN에 있는 품목만 실을 수 있고, 상차완료 때 차이 사유(예정 외 차량)를 고릅니다.</p>
            {home.centers.length > 1 && (
              <>
                <label htmlFor="pda-center" className={styles.label}>
                  도착 센터
                </label>
                <select id="pda-center" className={styles.field} value={centerId} onChange={(e) => setCenterId(e.target.value)} disabled={pending}>
                  {home.centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="pda-vehicle" className={styles.label}>
              차량번호
            </label>
            <input
              id="pda-vehicle"
              className={`${styles.field} mono`}
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="예: 82가1234"
              autoComplete="off"
              autoFocus
              disabled={pending}
            />
            {suggest && (
              <div className={styles.confirm} role="alert">
                <p>{suggest.message}</p>
                <div className={styles.btnRow}>
                  <button type="button" className={styles.primary} onClick={() => startOrder(suggest.orderNo)} disabled={pending}>
                    지시 상차로 시작
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => startFree(true)} disabled={pending}>
                    그래도 무지시
                  </button>
                </div>
              </div>
            )}
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondary} onClick={closeFree} disabled={pending}>
                닫기
              </button>
              <button type="submit" className={styles.primary} disabled={pending || !vehicle.trim() || !centerId}>
                무지시 상차 시작
              </button>
            </div>
          </form>
      )}

      {show("working") && (filter === "working" || home.working.length > 0) && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            상차 중인 차량 <span className={styles.count}>{home.working.length}</span>
          </h2>
          {home.working.length === 0 ? (
            <p className={styles.empty}>상차 중인 차량이 없습니다.</p>
          ) : (
            <ul className={styles.list}>{home.working.map(workingCard)}</ul>
          )}
        </section>
      )}

      {show("todo") && (
      <section className={styles.section}>
        <h2 className={styles.h2}>
          상차할 차량 <span className={styles.count}>{todo.length}</span>
        </h2>
        {todo.length === 0 ? (
          <p className={styles.empty}>{isToday ? "오늘 상차할 지시서가 없습니다." : `출고일이 ${date}인 상차 전 지시서가 없습니다.`}</p>
        ) : (
          <ul className={styles.list}>
            {todo.map((o) => {
              const n = dday(o.shipDate, home.today);
              return (
                <li key={o.orderNo}>
                  <button type="button" className={styles.card} onClick={() => startOrder(o.orderNo)} disabled={pending}>
                    <span className={styles.cardTop}>
                      <b className={`mono ${styles.cardId}`}>{o.vehicleNo}</b>
                      {n < 0 ? <Pill tone="red">출고일 지남</Pill> : <Pill tone="gray">{ddayLabel(n)}</Pill>}
                    </span>
                    <span className={styles.meta}>
                      <span className="mono">{o.orderNo}</span>
                      <span>{o.centerName}</span>
                    </span>
                    <span className={styles.meta}>
                      <span>
                        {o.driverName ?? "기사 미정"} · {o.lineCount}줄{n < 0 ? ` · 출고일 ${o.shipDate}` : ""}
                      </span>
                      <span className={styles.cardGo}>
                        시작 <Icon name="arrow" size={13} stroke={2.4} />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {show("done") && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            상차완료 <span className={styles.count}>{home.done.length}</span>
          </h2>
          {home.done.length === 0 ? (
            <p className={styles.empty}>{isToday ? "오늘" : date} 상차완료한 차량이 없습니다.</p>
          ) : (
            <ul className={styles.list}>
              {home.done.map((w) => (
                <li key={w.loadId}>
                  <Link href={loadHref(w.loadId)} className={`${styles.card} ${styles.cardDone}`}>
                    <span className={styles.cardTop}>
                      <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
                      {/* 카드 색이 이미 상차완료(연두) — 알약은 출차 전·차이 있음만 (2026-11-12 Sol: 출차) */}
                      <span className={styles.pills}>
                        {w.diffReasonName && <Pill tone="amber">차이 있음</Pill>}
                        {!w.departure && <Pill tone="blue">출차 전</Pill>}
                      </span>
                    </span>
                    <span className={styles.meta}>
                      <span className="mono">
                        {w.loadNo}
                        {w.revisionNo > 1 ? ` · ${w.revisionNo}차` : ""}
                      </span>
                      <span>
                        완료 {fmtDateTime(w.completedAt).slice(11)}
                        {w.departure && (w.departure.auto ? " · 자동 출차" : ` · 출차 ${fmtDateTime(w.departure.at).slice(11)}`)}
                      </span>
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
      )}
    </>
  );
}

/** 보기 버튼 — PDA 너비(360px)에 4개가 한 줄로 들어가게 짧은 이름 */
const FILTER_OPTIONS: [PdaLoadFilter, string][] = [
  ["all", "전체"],
  ["todo", "상차할"],
  ["working", "상차 중"],
  ["done", "완료"],
];
