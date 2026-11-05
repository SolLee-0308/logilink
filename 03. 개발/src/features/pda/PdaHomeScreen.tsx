"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { startOrderedLoad, startUnorderedLoad } from "@/server/loads/actions";
import type { PdaHome, PdaWorkingRow } from "@/features/loads/types";
import { passNotice } from "./device";
import { Icon, Pill, Steps } from "./PdaParts";
import styles from "./Pda.module.css";

/**
 * PDA 첫 화면 (정의서 ④)
 * - 지시 상차: 상차지시서 바코드를 스캔(또는 번호 입력)하거나 오늘 상차할 차량을 눌러 시작한다.
 * - 무지시 상차: 예정에 없던 차량 — 센터·차량번호를 넣어 시작한다 (ASN을 만들지 않는다, D12).
 * - 작업 중인 차량은 다른 작업자가 시작했어도 눌러서 함께 실을 수 있다 (작업자 잠금 없음, D11).
 * 화면 배치(2026-11-05 참고 UI): 검정 요약 카드 안 스캔칸 → 작업 중(진행 단계 카드) → 상차할 차량 → 무지시. 오늘 상차완료는 상차내역 메뉴로 옮김
 */
export function PdaHomeScreen({ home }: { home: PdaHome }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unordered, setUnordered] = useState(false);
  const [centerId, setCenterId] = useState(home.defaultCenterId || (home.centers[0] ? String(home.centers[0].id) : ""));
  const [vehicle, setVehicle] = useState("");
  const [suggest, setSuggest] = useState<{ message: string; orderNo: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

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

  /** 작업 중인 차량 카드 — 차량번호·구분 알약 / 지시서·센터 한 줄 / 작은 진행 단계 */
  const workingCard = (w: PdaWorkingRow) => (
    <li key={w.loadId}>
      <button type="button" className={styles.card} onClick={() => router.push(`/pda/load/${w.loadId}`)} disabled={pending}>
        <span className={styles.cardTop}>
          <b className={`mono ${styles.cardId}`}>{w.vehicleNo}</b>
          <Pill tone={w.type === "UNORDERED" ? "amber" : "blue"}>{LOAD_TYPE_LABEL[w.type]}</Pill>
        </span>
        <span className={styles.meta}>
          <span>{w.orderNo ? <span className="mono">{w.orderNo}</span> : "지시서 없음"}</span>
          <span>{w.centerName}</span>
        </span>
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
      {/* 검정 요약 카드 — 오늘 남은 차량 수 한 줄 + 상차지시서 스캔 */}
      <section className={styles.hero}>
        <span className={styles.heroRow}>
          <span className={styles.heroK}>
            오늘 상차할 <b className={styles.heroInline}>{todo.length}대</b>
          </span>
          <span className={styles.heroStats}>
            <span>
              작업 중 <b>{home.working.length}</b>
            </span>
            <span>
              완료 <b>{home.done.length}</b>
            </span>
          </span>
        </span>
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
      </section>

      {home.working.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>
            작업 중인 차량 <span className={styles.count}>{home.working.length}</span>
          </h2>
          <ul className={styles.list}>{home.working.map(workingCard)}</ul>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.h2}>
          상차할 차량 <span className={styles.count}>{todo.length}</span>
        </h2>
        {todo.length === 0 ? (
          <p className={styles.empty}>오늘 상차할 지시서가 없습니다.</p>
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

      <section className={styles.section}>
        {!unordered ? (
          <button type="button" className={styles.outlinePill} onClick={() => setUnordered(true)}>
            <Icon name="truck" size={18} />
            무지시 상차 (지시서 없는 차량)
          </button>
        ) : (
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
              <button type="button" className={styles.secondary} onClick={() => (setUnordered(false), setSuggest(null))} disabled={pending}>
                닫기
              </button>
              <button type="submit" className={styles.primary} disabled={pending || !vehicle.trim() || !centerId}>
                무지시 상차 시작
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
