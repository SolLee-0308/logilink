"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { startOrderedLoad, startUnorderedLoad } from "@/server/loads/actions";
import type { PdaHome, PdaWorkingRow } from "@/features/loads/types";
import { passNotice } from "./device";
import styles from "./Pda.module.css";

/**
 * PDA 첫 화면 (정의서 ④)
 * - 지시 상차: 상차지시서 바코드를 스캔(또는 번호 입력)하거나 오늘 상차할 차량을 눌러 시작한다.
 * - 무지시 상차: 예정에 없던 차량 — 센터·차량번호를 넣어 시작한다 (ASN을 만들지 않는다, D12).
 * - 작업 중인 차량은 다른 작업자가 시작했어도 눌러서 함께 실을 수 있다 (작업자 잠금 없음, D11).
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

  const working = (list: PdaWorkingRow[], done = false) =>
    list.map((w) => (
      <li key={w.loadId}>
        <button type="button" className={styles.rowBtn} onClick={() => router.push(`/pda/load/${w.loadId}`)} disabled={pending}>
          <span className={styles.rowMain}>
            <b className="mono">{w.vehicleNo}</b>
            <span className={w.type === "UNORDERED" ? styles.tagFree : styles.tag}>{LOAD_TYPE_LABEL[w.type]}</span>
          </span>
          <span className={styles.rowSub}>
            {w.centerName} · {w.orderNo ? <span className="mono">{w.orderNo}</span> : "지시서 없음"} · 입력 {w.inputCount}건
            {w.workerCount > 1 ? ` · ${w.workerCount}명` : ""}
            {done ? <> · 확인서 <span className="mono">{w.loadNo}</span></> : null}
          </span>
        </button>
      </li>
    ));

  return (
    <>
      <section className={styles.panel}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) startOrder(code);
          }}
        >
          <label htmlFor="pda-order" className={styles.label}>
            상차지시서 바코드
          </label>
          <div className={styles.scanRow}>
            <input
              ref={scanRef}
              id="pda-order"
              className={`${styles.scan} mono`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="스캔하거나 LO- 번호 입력"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              disabled={pending}
            />
            <button type="submit" className={styles.primary} disabled={pending || !code.trim()}>
              시작
            </button>
          </div>
        </form>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>

      {home.working.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.h2}>작업 중인 차량 · {home.working.length}대</h2>
          <ul className={styles.list}>{working(home.working)}</ul>
        </section>
      )}

      <section className={styles.panel}>
        <h2 className={styles.h2}>상차할 차량 · {home.orders.filter((o) => !o.loadId).length}대</h2>
        {home.orders.filter((o) => !o.loadId).length === 0 ? (
          <p className={styles.empty}>오늘 상차할 지시서가 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {home.orders
              .filter((o) => !o.loadId)
              .map((o) => {
                const n = dday(o.shipDate, home.today);
                return (
                  <li key={o.orderNo}>
                    <button type="button" className={styles.rowBtn} onClick={() => startOrder(o.orderNo)} disabled={pending}>
                      <span className={styles.rowMain}>
                        <b className="mono">{o.vehicleNo}</b>
                        {o.driverName && <span className={styles.dim}>{o.driverName}</span>}
                        {n < 0 && <span className={styles.tagWarn}>출고일 지남</span>}
                      </span>
                      <span className={styles.rowSub}>
                        <span className="mono">{o.orderNo}</span> · {o.centerName} · {o.lineCount}줄 · {n < 0 ? o.shipDate : ddayLabel(n)}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <section className={styles.panel}>
        {!unordered ? (
          <button type="button" className={styles.secondary} onClick={() => setUnordered(true)}>
            무지시 상차 (지시서 없는 차량)
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startFree();
            }}
          >
            <h2 className={styles.h2}>무지시 상차</h2>
            <p className={styles.help}>예정에 없던 차량입니다. ASN을 만들지 않고 실적만 남깁니다. 오늘 ASN에 있는 품목만 실을 수 있고, 상차완료 때 차이 사유(예정 외 차량)를 고릅니다.</p>
            {home.centers.length > 1 && (
              <>
                <label htmlFor="pda-center" className={styles.label}>
                  도착 센터
                </label>
                <select id="pda-center" className={styles.select} value={centerId} onChange={(e) => setCenterId(e.target.value)} disabled={pending}>
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
              className={`${styles.scan} mono`}
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

      {home.done.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.h2}>오늘 상차완료 · {home.done.length}대</h2>
          <ul className={styles.list}>{working(home.done, true)}</ul>
        </section>
      )}
    </>
  );
}
