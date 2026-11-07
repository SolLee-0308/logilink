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
import { Icon, InfoRows, Pill } from "./PdaParts";
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
 * 화면 배치(2026-11-05 참고 UI): 차량 머리·진행 단계 → 스캔 카드 → 품목 → 상차 정보 → 내 입력 타임라인 → 아래 고정 [상차완료]
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

  const tone = ordered ? "blue" : "amber";
  const firstInput = [...view.inputs].reverse().find((i) => !i.canceled);
  const orderLineCount = view.lines.filter((l) => l.orderBase > 0).length;
  const matchedCount = view.lines.filter((l) => l.orderBase > 0 && l.state === "match").length;

  /**
   * 차량 머리 — 차량번호·구분 + 상태 한 줄 (2026-11-06 Sol 결정: 타임라인 3단계 → 상태 한 줄).
   * 박스 없이 두어 아래 스캔 칸이 화면의 중심이 되게 한다.
   */
  const head = () => (
    <section className={styles.vHead}>
      <span className={styles.idHead}>
        <Icon name="truck" size={18} />
        <b className={`mono ${styles.idNo}`}>{view.vehicleNo}</b>
        <Pill tone={working ? tone : "green"}>{working ? LOAD_TYPE_LABEL[view.type] : "상차완료"}</Pill>
      </span>
      <span className={styles.vStatus}>
        {working ? (
          <>
            <b>상차 중</b> · {timeOf(view.createdAt)} 시작{firstInput ? ` · 마지막 입력 ${timeOf(view.inputs.find((i) => !i.canceled)?.inputAt ?? firstInput.inputAt)}` : ""}
            {/* 지시 품목 일치 — 태그 대신 상태 줄 일반 글자 (2026-11-07 Sol 확정), 다 맞으면 초록 */}
            {view.type === "ORDERED" && orderLineCount > 0 && (
              <>
                {" · "}
                <span className={matchedCount === orderLineCount ? styles.matchAll : undefined}>
                  일치 <span className="mono">{matchedCount}/{orderLineCount}</span>품목
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <b>상차완료</b> · {view.completedAt ? timeOf(view.completedAt) : "-"}
          </>
        )}
        {" · "}
        {view.centerName}
      </span>
    </section>
  );

  /* ═════════ 상차완료 뒤 — 상차확인서 번호·바코드 (참고 UI 완료 화면) ═════════ */
  if (!working) {
    return (
      <>
        <section className={styles.success}>
          <span className={styles.checkHalo} aria-hidden="true">
            <span>
              <Icon name="check" size={24} stroke={2.8} />
            </span>
          </span>
          <h2 className={styles.successTitle}>
            상차확인서를 발행했습니다.
          </h2>
          <p className={styles.successSub}>종이 확인서는 화주사 담당자가 웹 ASN 화면에서 인쇄해 차량에 실어 보냅니다. 입고검수는 이 바코드로 시작합니다.</p>
          <InfoRows
            rows={[
              ["상차확인서", <b key="no" className="mono">{view.loadNo}</b>],
              ["차량번호", <span key="v" className="mono">{view.vehicleNo}</span>],
              ["구분", LOAD_TYPE_LABEL[view.type]],
              ["도착 센터", view.centerName],
              ["완료 시각", fmtDateTime(view.completedAt)],
              ["완료자", view.completedBy ?? "-"],
              ...(view.diffReasonName ? ([["차이 사유", `${view.diffReasonName}${view.diffReasonText ? ` — ${view.diffReasonText}` : ""}`]] as [string, React.ReactNode][]) : []),
            ]}
          />
          <div className={styles.barcode}>
            <Barcode value={view.loadNo} height={52} module={2} />
          </div>
          <button type="button" className={styles.blackPill} onClick={() => router.push("/pda")}>
            처음으로
          </button>
        </section>
        <Lines view={view} />
      </>
    );
  }

  /* ═════════ 상차완료 확인 ═════════ */
  if (finishing) {
    return (
      <>
        {head()}
        <section className={styles.sheet}>
          <h2 className={styles.h2}>상차완료 확인</h2>
          <p className={styles.help}>상차완료는 차량당 한 번입니다. 완료하면 더는 입력할 수 없고, 이후 차이는 입고검수에서 처리합니다.</p>
          <p className={styles.label}>작업자 {view.workers.length}명</p>
          <ul className={styles.workers}>
            {view.workers.map((w) => (
              <li key={w.workerId}>
                <span className={styles.avatarSm} aria-hidden="true">
                  {w.name.slice(0, 1)}
                </span>
                <span className={styles.workerText}>
                  <b>{w.name}</b>
                  <span className={styles.dim}>
                    입력 {w.count}건 · 마지막 {timeOf(w.lastAt)}
                  </span>
                </span>
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
          <section className={styles.sheet}>
            <label htmlFor="pda-reason" className={styles.label}>
              {ordered ? "지시수량과 차이가 있습니다 — 차이 사유" : "무지시 상차 — 차이 사유"}
            </label>
            <select id="pda-reason" className={styles.field} value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending}>
              <option value="">사유를 고르세요</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
            {chosen?.requiresText && (
              <textarea
                className={`${styles.field} ${styles.textarea}`}
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
        <div className={`${styles.btnRow} ${styles.bottomBar}`}>
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
      {head()}
      {notice && <p className={styles.warnText}>{notice}</p>}

      {/* 스캔 칸 — 화면의 중심, 목록을 내려도 위에 붙어 있다 (2026-11-06 Sol 결정) */}
      <section className={styles.scanCard}>
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
            <div className={`${styles.searchPill} ${styles.searchPillLight}`}>
              <span className={styles.searchIcon}>
                <Icon name="scan" size={18} />
              </span>
              <input
                ref={scanRef}
                id="pda-scan"
                className="mono"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="스캔하거나 바코드·품목코드 입력"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="next"
                disabled={pending}
              />
              <button type="submit" className={styles.goBtn} disabled={pending || !scan.trim()} aria-label="찾기" title="찾기">
                <Icon name="arrow" size={18} stroke={2.2} />
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
            <div className={styles.sheetHead}>
              <span className={styles.iconCircle}>
                <Icon name="box" size={17} />
              </span>
              <b className={styles.previewName}>{preview.itemName}</b>
            </div>
            <InfoRows
              tone="white"
              rows={[
                ["품목코드", <span key="c" className="mono">{preview.itemClientCode ?? preview.itemCode}</span>],
                ["스캔 단위", <span key="u" className="mono">{preview.unit}{preview.unit !== preview.baseUnit ? ` (= ${preview.factor} ${preview.baseUnit})` : ""}</span>],
                ...(ordered
                  ? ([["지시", preview.orderBase ? qtyInUnit(preview.orderBase, preview.showUnit, preview.showFactor, preview.baseUnit) : <span key="x" className={styles.warnInline}><Icon name="alert" size={15} /> 지시 외</span>]] as [string, React.ReactNode][])
                  : []),
                ["지금 합계", <b key="n">{qtyInUnit(preview.loadBase, preview.showUnit, preview.showFactor, preview.baseUnit)}</b>],
              ]}
            />
            <label htmlFor="pda-qty" className={styles.label}>
              추가로 실은 수량 ({preview.unit})
            </label>
            <div className={styles.qtyRow}>
              <input
                ref={qtyRef}
                id="pda-qty"
                className={`${styles.field} ${styles.qty} mono`}
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

      {/* 내 입력 — 접힌 줄, 눌러서 정정·취소 (2026-11-06 Sol 결정: 정보 줄이기) */}
      <details className={styles.fold}>
        <summary className={styles.foldHead}>
          내 입력 <span className={styles.count}>{myInputs.length}</span>
          <span className={styles.detailSum}>{myInputs[0] ? `마지막 ${timeOf(myInputs[0].inputAt)}` : "없음"}</span>
          <span className={styles.detailChev}>
            <Icon name="chevD" size={16} />
          </span>
        </summary>
        <div className={styles.foldBody}>
      {myInputs.length === 0 ? (
        <p className={styles.empty}>아직 입력한 수량이 없습니다.</p>
      ) : (
        <ol className={styles.timeline}>
          {myInputs.slice(0, 30).map((i) =>
            editing?.id === i.id ? (
              <li key={i.id} className={styles.editRow}>
                <span>
                  {i.itemName} <span className={styles.dim}>({i.unit})</span>
                </span>
                <div className={styles.qtyRow}>
                  <input
                    className={`${styles.field} ${styles.qty} mono`}
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
                <span className={styles.tlTime}>
                  <b className="mono">{timeOf(i.inputAt)}</b>
                  {i.corrected && <small>정정</small>}
                </span>
                <span className={styles.tlDot} aria-hidden="true">
                  <Icon name="check" size={11} stroke={2.8} />
                </span>
                <span className={styles.tlBody}>
                  <span>
                    {i.itemName}
                    <b className="mono">
                      {" "}
                      +{i.addQty.toLocaleString()} {i.unit}
                    </b>
                  </span>
                  <span className={styles.inputBtns}>
                    <button type="button" className={styles.small} onClick={() => setEditing({ id: i.id, qty: String(i.addQty), warn: null })} disabled={pending}>
                      정정
                    </button>
                    <button type="button" className={styles.smallDanger} onClick={() => onCancelInput(i)} disabled={pending}>
                      취소
                    </button>
                  </span>
                </span>
              </li>
            ),
          )}
        </ol>
      )}
          <p className={styles.help}>본인이 입력한 건만 정정·취소할 수 있습니다.</p>
        </div>
      </details>

      {/* 상차 정보 — 기본은 접어 두고 눌러서 펼친다 (2026-11-05 Sol 승인) */}
      <details className={styles.fold}>
        <summary className={styles.foldHead}>
          상차 정보
          <span className={styles.detailSum}>{view.centerName}</span>
          <span className={styles.detailChev}>
            <Icon name="chevD" size={16} />
          </span>
        </summary>
        <InfoRows
          tone="white"
          rows={[
            ["도착 센터", view.centerName],
            ["지시서", view.asn?.orderNo ? <span key="o" className="mono">{view.asn.orderNo}</span> : view.asn ? "-" : "ASN 없음"],
            ...(view.asn ? ([["출고일", <span key="d" className="mono">{view.asn.shipDate}</span>]] as [string, React.ReactNode][]) : []),
            ...(view.asn?.driverName ? ([["기사", `${view.asn.driverName}${view.asn.driverTel ? ` · ${view.asn.driverTel}` : ""}`]] as [string, React.ReactNode][]) : []),
            ["작업자", view.workers.length ? view.workers.map((w) => w.name).join(", ") : "-"],
          ]}
        />
      </details>


      <div className={styles.bottomBar}>
        {/* 품목을 1개 이상 실었을 때만 (2026-11-06 Sol) */}
        <button type="button" className={styles.blackPill} onClick={openFinish} disabled={pending || loadedLines === 0}>
          상차완료
        </button>
      </div>
    </>
  );
}

/**
 * 품목코드 + 품목명 한 줄 (2026-11-07 Sol 피드백) — 코드는 지금 크기·색 그대로 이름 앞에.
 * 칸보다 길면 이름이 옆으로 천천히 흘러 끝까지 보이게 한다(움직임 줄이기 설정이면 멈춤).
 */
function ScrollName({ code, name }: { code: string; name: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setShift(Math.max(0, i.scrollWidth - o.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, [code, name]);
  return (
    <span ref={outer} className={styles.flatName} title={`${code} ${name}`}>
      <span
        ref={inner}
        className={shift > 0 ? styles.marquee : undefined}
        style={shift > 0 ? ({ "--shift": `-${shift}px`, "--dur": `${Math.max(5, shift / 25)}s` } as React.CSSProperties) : undefined}
      >
        <span className={`${styles.dim} mono`}>{code}</span> {name}
      </span>
    </span>
  );
}

/**
 * 품목별 지시·상차 합계 — 박스 없이 줄 목록 (2026-11-06 Sol 결정: 스캔 중심 + 목록 평면화).
 * 지시 상차는 줄마다 진행 막대, 상태는 색으로만: 일치 초록 · 부족 주황 · 초과·지시 외 빨강 · 아직 안 실음 회색.
 * 코드는 상차담당(화주사)에게 익숙한 화주사 품목코드를 먼저 보여 준다.
 */
function Lines({ view }: { view: LoadView }) {
  const ordered = view.type === "ORDERED";
  return (
    <section className={styles.flat}>
      <h2 className={styles.h2}>
        품목 <span className={styles.count}>{view.lines.length}</span>
        {/* 지시 상차의 '일치 N/M' 태그는 머리 상태 줄로 옮겼다 (2026-11-07 Sol 확정) */}
        {!ordered && <span className={styles.h2Sub}>상차 수량</span>}
      </h2>
      {view.lines.length === 0 ? (
        <p className={styles.empty}>{ordered ? "지시 품목이 없습니다." : "아직 실은 품목이 없습니다. 오늘 ASN에 있는 품목만 실을 수 있습니다."}</p>
      ) : (
        <ul className={styles.flatLines}>
          {view.lines.map((l) => {
            const st = l.loadBase === 0 && l.orderBase > 0 ? "none" : l.state;
            const pct = l.orderBase > 0 ? Math.min(100, (l.loadBase / l.orderBase) * 100) : 100;
            return (
              <li key={l.itemId} className={styles[`st_${st}`]}>
                <span className={styles.flatTop}>
                  <ScrollName code={l.itemClientCode ?? l.itemCode} name={l.itemName} />
                  <span className={styles.flatQty}>
                    <b className="mono">{fmt(l, l.loadBase)}</b>
                    {ordered && <span className={styles.dim}> / {l.orderBase ? fmt(l, l.orderBase) : "지시 없음"}</span>}
                  </span>
                </span>
                {ordered && (
                  <span className={styles.flatBottom}>
                    <span className={styles.lnBar} aria-hidden="true">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    {/* 안 실은 줄은 회색 막대만 — '아직 안 실음' 문구는 뺐다 (2026-11-07 Sol 피드백) */}
                    <span className={styles.stText}>{st === "none" ? "" : LINE_STATE_LABEL[l.state]}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
