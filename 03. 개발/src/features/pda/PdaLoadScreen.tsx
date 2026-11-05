"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Barcode } from "@/components/ui/Barcode";
import { LINE_STATE_LABEL, LOAD_TYPE_LABEL, UNORDERED_REASON_CODE, qtyInUnit } from "@/domain/load-rules";
import { fmtDateTime } from "@/lib/format";
import { addLoadInput, cancelLoadInput, completeLoad, correctLoadInput, previewScan, reloadLoad } from "@/server/loads/actions";
import type { ReasonOption } from "@/features/shared/RejectModal";
import type { LoadInputView, LoadLineView, LoadView, ScanPreview } from "@/features/loads/types";
import { deviceId, takeNotice } from "./device";
import styles from "./Pda.module.css";

/** 다른 작업자 입력을 다시 읽는 간격 */
const POLL_MS = 5000;

const fmt = (l: Pick<LoadLineView, "showUnit" | "showFactor" | "baseUnit">, base: number) => qtyInUnit(base, l.showUnit, l.showFactor, l.baseUnit);
const timeOf = (iso: string) => fmtDateTime(iso).slice(11);

/**
 * PDA 상차 작업 (정의서 ④ · C5 · C6 · D11)
 * 1) 품목 바코드 스캔 → 품목·단위·지금 합계 확인 → "추가로 실은 수량" 입력
 * 2) 지시 외 품목·지시수량 초과는 경고 후 확인하면 받는다 (사유는 상차완료 때 한 번, 2026-11-05 Sol)
 * 3) 본인 입력만 취소·정정, 다른 작업자 입력은 몇 초마다 합계에 반영
 * 4) 상차완료: 작업자·품목 합계를 보고 확인, 차이가 있으면 사유 선택 → 상차확인서 발행
 */
export function PdaLoadScreen({ initial, reasons }: { initial: LoadView; reasons: ReasonOption[] }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [qty, setQty] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; qty: string; warn: string | null } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [reason, setReason] = useState(initial.type === "UNORDERED" ? UNORDERED_REASON_CODE : "");
  const [reasonText, setReasonText] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const working = view.status === "WORKING";
  const ordered = view.type === "ORDERED";

  useEffect(() => setNotice(takeNotice()), []);

  const reload = useCallback(async () => {
    const r = await reloadLoad(view.id);
    if (r.ok && r.data) setView(r.data);
    return r.ok ? r.data : undefined;
  }, [view.id]);

  // 다른 작업자 입력 반영 — 화면이 보일 때만, 상차완료되면 멈춘다
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [working, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const resetScan = () => {
    setScan("");
    setPreview(null);
    setQty("");
    setWarn(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  const onScan = (value: string) =>
    start(async () => {
      setError(null);
      setWarn(null);
      const r = await previewScan({ loadId: view.id, scan: value });
      if (r.ok && r.data) {
        setPreview(r.data);
        setQty("");
        setTimeout(() => qtyRef.current?.focus(), 0);
      } else if (!r.ok) {
        setError(r.error);
        setScan("");
        setPreview(null);
        if (r.code === "STATE" && r.error.includes("상차완료")) await reload();
        scanRef.current?.focus();
      }
    });

  const onAdd = (confirm = false) =>
    start(async () => {
      if (!preview) return;
      setError(null);
      const r = await addLoadInput({ loadId: view.id, scan: preview.scan, qty: Number(qty), deviceId: deviceId(), confirm });
      if (r.ok) {
        setToast(r.message);
        resetScan();
        await reload();
      } else if (r.code === "CONFIRM") setWarn(r.error);
      else {
        setError(r.error);
        if (r.code === "STATE") await reload();
      }
    });

  const onCancelInput = (i: LoadInputView) =>
    start(async () => {
      setError(null);
      if (!window.confirm(`${i.itemName} +${i.addQty} ${i.unit} 입력을 취소할까요?`)) return;
      const r = await cancelLoadInput({ inputId: i.id });
      if (r.ok) setToast(r.message);
      else setError(r.error);
      await reload();
    });

  const onCorrect = (confirm = false) =>
    start(async () => {
      if (!editing) return;
      setError(null);
      const r = await correctLoadInput({ inputId: editing.id, qty: Number(editing.qty), confirm, deviceId: deviceId() });
      if (r.ok) {
        setToast(r.message);
        setEditing(null);
        await reload();
      } else if (r.code === "CONFIRM") setEditing({ ...editing, warn: r.error });
      else {
        setError(r.error);
        await reload();
      }
    });

  const openFinish = () =>
    start(async () => {
      setConflict(null);
      setError(null);
      await reload();
      setFinishing(true);
    });

  const onComplete = () =>
    start(async () => {
      setError(null);
      setConflict(null);
      const r = await completeLoad({ loadId: view.id, lastInputId: view.lastInputId, reasonCode: view.hasDiff ? reason : null, reasonText: view.hasDiff ? reasonText : null });
      if (r.ok) {
        // 최신 상태(상차완료)를 먼저 읽고 화면을 바꾼다
        await reload();
        setFinishing(false);
        setToast(r.message);
      } else if (r.code === "CONFLICT") {
        setConflict(r.error);
        await reload();
      } else setError(r.error);
    });

  const myInputs = view.inputs.filter((i) => i.mine && !i.canceled);
  const chosen = reasons.find((r) => r.code === reason);
  const loadedLines = view.lines.filter((l) => l.loadBase > 0).length;

  /* ═════════ 상차완료 뒤 — 상차확인서 번호·바코드 ═════════ */
  if (!working) {
    return (
      <>
        <section className={`${styles.panel} ${styles.doneBox}`}>
          <p className={styles.doneTitle}>상차완료</p>
          <p className={styles.dim}>
            <span className="mono">{view.vehicleNo}</span> · {LOAD_TYPE_LABEL[view.type]} · {fmtDateTime(view.completedAt)} · {view.completedBy}
          </p>
          <div className={styles.barcode}>
            <Barcode value={view.loadNo} height={64} module={2} />
          </div>
          <p className={styles.help}>
            상차확인서 <b className="mono">{view.loadNo}</b>을(를) 발행했습니다. 종이 확인서는 화주사 담당자가 웹 ASN 화면에서 인쇄해 차량에 실어 보냅니다. 입고검수는 이 바코드로 시작합니다.
          </p>
          {view.diffReasonName && (
            <p className={styles.help}>
              차이 사유: <b>{view.diffReasonName}</b>
              {view.diffReasonText ? ` — ${view.diffReasonText}` : ""}
            </p>
          )}
        </section>
        <Lines view={view} />
        <button type="button" className={styles.primaryWide} onClick={() => router.push("/pda")}>
          처음으로
        </button>
      </>
    );
  }

  /* ═════════ 상차완료 확인 ═════════ */
  if (finishing) {
    return (
      <>
        <section className={styles.panel}>
          <h2 className={styles.h2}>상차완료 확인 · {view.vehicleNo}</h2>
          <p className={styles.help}>상차완료는 차량당 한 번입니다. 완료하면 더는 입력할 수 없고, 이후 차이는 입고검수에서 처리합니다.</p>
          <p className={styles.label}>작업자 {view.workers.length}명</p>
          <ul className={styles.workers}>
            {view.workers.map((w) => (
              <li key={w.workerId}>
                {w.name} <span className={styles.dim}>입력 {w.count}건 · 마지막 {timeOf(w.lastAt)}</span>
              </li>
            ))}
          </ul>
          {view.workers.length > 1 && <p className={styles.warnText}>다른 작업자가 아직 싣고 있지 않은지 확인하세요.</p>}
        </section>
        <Lines view={view} />
        {conflict && (
          <p className={styles.error} role="alert">
            {conflict}
          </p>
        )}
        {loadedLines === 0 && <p className={styles.error}>아직 실은 품목이 없습니다.</p>}
        {view.hasDiff && loadedLines > 0 && (
          <section className={styles.panel}>
            <label htmlFor="pda-reason" className={styles.label}>
              {ordered ? "지시수량과 차이가 있습니다 — 차이 사유" : "무지시 상차 — 차이 사유"}
            </label>
            <select id="pda-reason" className={styles.select} value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending}>
              <option value="">사유를 고르세요</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
            {chosen?.requiresText && (
              <textarea
                className={styles.textarea}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="상세 내용을 적어 주세요 (필수)"
                maxLength={500}
                rows={3}
                disabled={pending}
              />
            )}
          </section>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.btnRow}>
          <button type="button" className={styles.secondary} onClick={() => setFinishing(false)} disabled={pending}>
            더 싣기
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={onComplete}
            disabled={pending || loadedLines === 0 || (view.hasDiff && (!reason || (!!chosen?.requiresText && !reasonText.trim())))}
          >
            상차완료 · 확인서 발행
          </button>
        </div>
      </>
    );
  }

  /* ═════════ 작업 중 ═════════ */
  return (
    <>
      <section className={styles.head}>
        <div className={styles.headMain}>
          <b className={`mono ${styles.vehicle}`}>{view.vehicleNo}</b>
          <span className={ordered ? styles.tag : styles.tagFree}>{LOAD_TYPE_LABEL[view.type]}</span>
        </div>
        <p className={styles.dim}>
          {view.centerName}
          {view.asn ? (
            <>
              {" "}
              · 지시서 <span className="mono">{view.asn.orderNo}</span> · 출고일 <span className="mono">{view.asn.shipDate}</span>
            </>
          ) : (
            " · ASN 없음"
          )}
          {view.workers.length > 0 && ` · 작업자 ${view.workers.map((w) => w.name).join(", ")}`}
        </p>
      </section>
      {notice && <p className={styles.warnText}>{notice}</p>}

      <section className={styles.panel}>
        {!preview ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) onScan(scan);
            }}
          >
            <label htmlFor="pda-scan" className={styles.label}>
              품목 바코드
            </label>
            <div className={styles.scanRow}>
              <input
                ref={scanRef}
                id="pda-scan"
                className={`${styles.scan} mono`}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="스캔하거나 바코드·품목코드 입력"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="next"
                disabled={pending}
              />
              <button type="submit" className={styles.primary} disabled={pending || !scan.trim()}>
                찾기
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(qty) > 0) onAdd(false);
            }}
          >
            <div className={styles.preview}>
              <b>{preview.itemName}</b>
              <span className={styles.dim}>
                <span className="mono">{preview.itemCode}</span> · 스캔 단위 <span className="mono">{preview.unit}</span>
                {preview.unit !== preview.baseUnit ? ` (= ${preview.factor} ${preview.baseUnit})` : ""}
              </span>
              <span className={styles.previewQty}>
                {ordered && <>지시 {preview.orderBase ? qtyInUnit(preview.orderBase, preview.showUnit, preview.showFactor, preview.baseUnit) : "없음(지시 외)"} · </>}
                지금 {qtyInUnit(preview.loadBase, preview.showUnit, preview.showFactor, preview.baseUnit)}
              </span>
            </div>
            <label htmlFor="pda-qty" className={styles.label}>
              추가로 실은 수량 ({preview.unit})
            </label>
            <div className={styles.scanRow}>
              <input
                ref={qtyRef}
                id="pda-qty"
                className={`${styles.qty} mono`}
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value.replace(/\D/g, ""));
                  setWarn(null);
                }}
                inputMode="numeric"
                placeholder="0"
                autoComplete="off"
                enterKeyHint="done"
                disabled={pending}
              />
              <button type="submit" className={styles.primary} disabled={pending || !(Number(qty) > 0) || !!warn}>
                + 싣기
              </button>
            </div>
            {warn && (
              <div className={styles.confirm} role="alert">
                <p>{warn}</p>
                <div className={styles.btnRow}>
                  <button type="button" className={styles.secondary} onClick={() => setWarn(null)} disabled={pending}>
                    수량 고치기
                  </button>
                  <button type="button" className={styles.primary} onClick={() => onAdd(true)} disabled={pending}>
                    그래도 싣기
                  </button>
                </div>
              </div>
            )}
            <button type="button" className={styles.link} onClick={resetScan} disabled={pending}>
              다른 품목 스캔
            </button>
          </form>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {toast && (
          <p className={styles.toast} role="status">
            {toast}
          </p>
        )}
      </section>

      <Lines view={view} />

      <section className={styles.panel}>
        <h2 className={styles.h2}>내 입력 · {myInputs.length}건</h2>
        {myInputs.length === 0 ? (
          <p className={styles.empty}>아직 입력한 수량이 없습니다.</p>
        ) : (
          <ul className={styles.inputs}>
            {myInputs.slice(0, 30).map((i) =>
              editing?.id === i.id ? (
                <li key={i.id} className={styles.editRow}>
                  <span>
                    {i.itemName} <span className={styles.dim}>({i.unit})</span>
                  </span>
                  <div className={styles.scanRow}>
                    <input
                      className={`${styles.qty} mono`}
                      value={editing.qty}
                      onChange={(e) => setEditing({ ...editing, qty: e.target.value.replace(/\D/g, ""), warn: null })}
                      inputMode="numeric"
                      autoFocus
                      aria-label="정정할 수량"
                      disabled={pending}
                    />
                    <button type="button" className={styles.primary} onClick={() => onCorrect(false)} disabled={pending || !(Number(editing.qty) > 0) || !!editing.warn}>
                      정정
                    </button>
                  </div>
                  {editing.warn && (
                    <div className={styles.confirm} role="alert">
                      <p>{editing.warn}</p>
                      <button type="button" className={styles.primary} onClick={() => onCorrect(true)} disabled={pending}>
                        그래도 정정
                      </button>
                    </div>
                  )}
                  <button type="button" className={styles.link} onClick={() => setEditing(null)} disabled={pending}>
                    그만두기
                  </button>
                </li>
              ) : (
                <li key={i.id}>
                  <span className={styles.inputMain}>
                    {i.itemName}
                    <b className="mono"> +{i.addQty.toLocaleString()} {i.unit}</b>
                    <span className={styles.dim}> {timeOf(i.inputAt)}{i.corrected ? " · 정정" : ""}</span>
                  </span>
                  <span className={styles.inputBtns}>
                    <button type="button" className={styles.small} onClick={() => setEditing({ id: i.id, qty: String(i.addQty), warn: null })} disabled={pending}>
                      정정
                    </button>
                    <button type="button" className={styles.smallDanger} onClick={() => onCancelInput(i)} disabled={pending}>
                      취소
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
        <p className={styles.help}>본인이 입력한 건만 정정·취소할 수 있습니다. 다른 작업자 입력은 합계에 함께 들어갑니다.</p>
      </section>

      <button type="button" className={styles.finish} onClick={openFinish} disabled={pending}>
        상차완료
      </button>
    </>
  );
}

/** 품목별 지시·상차 합계 */
function Lines({ view }: { view: LoadView }) {
  const ordered = view.type === "ORDERED";
  return (
    <section className={styles.panel}>
      <h2 className={styles.h2}>
        품목 · {view.lines.length}개 {ordered ? "(지시 / 상차)" : "(상차)"}
      </h2>
      {view.lines.length === 0 ? (
        <p className={styles.empty}>{ordered ? "지시 품목이 없습니다." : "아직 실은 품목이 없습니다. 오늘 ASN에 있는 품목만 실을 수 있습니다."}</p>
      ) : (
        <ul className={styles.lines}>
          {view.lines.map((l) => (
            <li key={l.itemId} className={styles[`ln_${l.state}`]}>
              <span className={styles.lineName}>
                {l.itemName}
                <span className={`${styles.dim} mono`}> {l.itemCode}</span>
              </span>
              <span className={styles.lineQty}>
                {ordered && <span className={styles.dim}>{l.orderBase ? fmt(l, l.orderBase) : "지시 없음"} / </span>}
                <b className="mono">{fmt(l, l.loadBase)}</b>
                {ordered && <span className={styles.lineState}>{LINE_STATE_LABEL[l.state]}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
