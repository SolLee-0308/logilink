"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Barcode } from "@/components/ui/Barcode";
import { DEPART_CONFIRM_MSG, LINE_STATE_LABEL, LOAD_TYPE_LABEL, UNORDERED_REASON_CODE, qtyInUnit } from "@/domain/load-rules";
import { fmtDateTime } from "@/lib/format";
import { addLoadInput, cancelLoadInput, completeLoad, correctLoadInput, departLoad, previewScan, reloadLoad, reopenLoad } from "@/server/loads/actions";
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
 * 확인 창 — 화면 안 경고·브라우저 confirm 대신 아래에서 올라오는 창 (2026-11-11 Sol).
 * over: 지시 초과·지시 외 (입력 add / 정정 edit) · cancel: 내 입력 취소. 버튼을 고르기 전에는 [상차완료]를 막는다.
 */
type Ask =
  | { type: "over"; source: "add" | "edit"; kind: "over" | "extra"; item: string; order: string; after: string }
  | { type: "cancel"; input: LoadInputView };

const overAsk = (source: "add" | "edit", fe?: Record<string, string>): Ask | null =>
  fe?.kind === "over" || fe?.kind === "extra" ? { type: "over", source, kind: fe.kind, item: fe.item ?? "", order: fe.order ?? "", after: fe.after ?? "" } : null;

/**
 * PDA 상차 작업 (정의서 ④ · C5 · C6 · D11)
 * 1) 품목 바코드 스캔 → 품목·단위·지금 합계 확인 → "추가로 실은 수량" 입력
 * 2) 지시 외 품목·지시수량 초과는 경고 후 확인하면 받는다 (사유는 상차완료 때 한 번, 2026-11-05 Sol)
 * 3) 본인 입력만 취소·정정, 다른 작업자 입력은 몇 초마다 합계에 반영
 * 4) 상차완료: 작업자·품목 합계를 보고 확인, 차이가 있으면 사유 선택 → 상차확인서 발행
 * 5) 상차 재개(v1.5 D20): 지시 상차만, 출차·검수 시작 전까지 사유와 함께 재개 → 다시 완료하면 같은 번호 다음 차수 (무지시 재개 안 함, 2026-11-12)
 * 6) 출차(2026-11-12 Sol): 상차완료 화면 [출차] → 확인 창 → 이후 재개 불가. 안 누르면 상차완료한 업무일이 지나면 자동 출차
 * 화면 배치(2026-11-05 참고 UI): 차량 머리·진행 단계 → 스캔 카드 → 품목 → 상차 정보 → 내 입력 타임라인 → 아래 고정 [상차완료]
 */
export function PdaLoadScreen({ initial, reasons, reopenReasons = [] }: { initial: LoadView; reasons: ReasonOption[]; reopenReasons?: ReasonOption[] }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  /** 방금 입력·정정·취소한 품목 — 목록에서 그 줄로 옮겨 잠깐 강조 (토스트 대신, 2026-11-07 Sol 피드백) */
  const [flash, setFlash] = useState<{ itemId: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [qty, setQty] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [editing, setEditing] = useState<{ id: number; qty: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [reason, setReason] = useState(initial.type === "UNORDERED" ? UNORDERED_REASON_CODE : "");
  const [reasonText, setReasonText] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  /** 상차 재개 창 (정의서 v1.5 D20) — 사유 코드·상세 */
  const [reopening, setReopening] = useState<{ code: string; text: string } | null>(null);
  /** 출차 확인 창 (2026-11-12 Sol) */
  const [departing, setDeparting] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const working = view.status === "WORKING";
  const ordered = view.type === "ORDERED";
  /**
   * 완료 화면을 어떻게 열었는지 (2026-11-12 Sol) — me: 내가 방금 완료 / other: 작업 중 다른 작업자가 완료 / null: 목록에서 지난 확인서를 엶.
   * 방금 완료한 경우에만 "발행했습니다"와 체크 원을 보여 준다.
   */
  const [doneBy, setDoneBy] = useState<"me" | "other" | null>(null);
  const meDone = useRef(false);
  const prevStatus = useRef(initial.status);

  useEffect(() => setNotice(takeNotice()), []);

  useEffect(() => {
    if (prevStatus.current === "WORKING" && view.status === "COMPLETED") setDoneBy(meDone.current ? "me" : "other");
    if (view.status === "WORKING") {
      meDone.current = false;
      setDoneBy(null);
    }
    prevStatus.current = view.status;
  }, [view.status]);

  const reload = useCallback(async () => {
    const r = await reloadLoad(view.id);
    if (r.ok && r.data) setView(r.data);
    return r.ok ? r.data : undefined;
  }, [view.id]);

  // 완료 화면 — 다시 볼 때 최신 상태를 읽는다(그사이 검수가 시작됐으면 [상차 재개]를 안내 문구로) (2026-11-12)
  useEffect(() => {
    if (working) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [working, reload]);

  // 다른 작업자 입력 반영 — 화면이 보일 때만, 상차완료되면 멈춘다
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [working, reload]);


  const resetScan = () => {
    setScan("");
    setPreview(null);
    setQty("");
    setAsk(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  const onScan = (value: string) =>
    start(async () => {
      setError(null);
      setAsk(null);
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
        const itemId = preview.itemId;
        resetScan();
        await reload();
        setFlash({ itemId, n: Date.now() });
      } else if (r.code === "CONFIRM" && overAsk("add", r.fieldErrors)) setAsk(overAsk("add", r.fieldErrors));
      else {
        setAsk(null);
        setError(r.error);
        if (r.code === "STATE") await reload();
      }
    });

  const onCancelInput = (i: LoadInputView) =>
    start(async () => {
      setError(null);
      setAsk(null);
      const r = await cancelLoadInput({ inputId: i.id });
      if (!r.ok) setError(r.error);
      await reload();
      if (r.ok) setFlash({ itemId: i.itemId, n: Date.now() });
    });

  const onCorrect = (confirm = false) =>
    start(async () => {
      if (!editing) return;
      setError(null);
      const r = await correctLoadInput({ inputId: editing.id, qty: Number(editing.qty), confirm, deviceId: deviceId() });
      if (r.ok) {
        const itemId = view.inputs.find((x) => x.id === editing.id)?.itemId;
        setEditing(null);
        setAsk(null);
        await reload();
        if (itemId) setFlash({ itemId, n: Date.now() });
      } else if (r.code === "CONFIRM" && overAsk("edit", r.fieldErrors)) setAsk(overAsk("edit", r.fieldErrors));
      else {
        setAsk(null);
        setError(r.error);
        await reload();
      }
    });

  /** 상차 재개 — 출차·검수 시작 전에만. 성공하면 작업 화면으로 돌아간다(기존 입력 유지) */
  const onReopen = () =>
    start(async () => {
      if (!reopening) return;
      setError(null);
      const r = await reopenLoad({ loadId: view.id, reasonCode: reopening.code, reasonText: reopening.text });
      if (r.ok) {
        setReopening(null);
        setReason(view.type === "UNORDERED" ? UNORDERED_REASON_CODE : "");
        setReasonText("");
        setNotice(r.message);
        await reload();
      } else {
        setError(r.error);
        if (r.code === "STATE") await reload();
      }
    });

  /** [상차 재개] — 누를 때 최신 상태를 먼저 읽는다. 그사이 검수가 시작됐으면 창을 열지 않고 안내 문구로 바뀐다 */
  const openReopen = () =>
    start(async () => {
      setError(null);
      const v = await reload();
      if (v?.canReopen) setReopening({ code: "", text: "" });
    });

  /** [출차] — 최신 상태를 읽고 확인 창. 그사이 재개됐거나 이미 출차됐으면 창을 열지 않는다 */
  const openDepart = () =>
    start(async () => {
      setError(null);
      const v = await reload();
      if (v?.canDepart) setDeparting(true);
    });

  const onDepart = () =>
    start(async () => {
      setError(null);
      const r = await departLoad({ loadId: view.id });
      if (r.ok) {
        setDeparting(false);
        setNotice(r.message);
        await reload();
      } else {
        setError(r.error);
        if (r.code === "STATE") await reload();
      }
    });

  /** 확인 창 [수량 고치기]·[그만두기] — 고치던 수량 칸으로 돌아간다 */
  const closeAsk = () => {
    const src = ask?.type === "over" ? ask.source : null;
    setAsk(null);
    if (src === "add") setTimeout(() => qtyRef.current?.select(), 0);
  };

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
        meDone.current = true;
        await reload();
        setFinishing(false);
      } else if (r.code === "CONFLICT") {
        setConflict(r.error);
        await reload();
      } else setError(r.error);
    });

  const myInputs = view.inputs.filter((i) => i.mine && !i.canceled);
  const chosen = reasons.find((r) => r.code === reason);
  const reopenChosen = reopenReasons.find((r) => r.code === reopening?.code);
  const loadedLines = view.lines.filter((l) => l.loadBase > 0).length;

  const tone = ordered ? "blue" : "amber";
  const orderLineCount = view.lines.filter((l) => l.orderBase > 0).length;
  const matchedCount = view.lines.filter((l) => l.orderBase > 0 && l.state === "match").length;

  /**
   * 차량 머리 — 차량번호·구분 + 상태 한 줄: 시작 시각 · 도착 센터 (2026-11-11 Sol: 일치 수는 아래 [상차완료] 띠로, 마지막 입력은 '내 입력'에서).
   * 박스 없이 두어 아래 스캔 칸이 화면의 중심이 되게 한다.
   */
  const head = () => (
    <section className={styles.vHead}>
      <span className={styles.idHead}>
        <Icon name="truck" size={18} />
        <b className={`mono ${styles.idNo}`}>{view.vehicleNo}</b>
        <Pill tone={tone}>{LOAD_TYPE_LABEL[view.type]}</Pill>
        {view.revisionNo > 1 && <Pill tone="amber">재개 · {view.revisionNo}차</Pill>}
      </span>
      {/* 재개한 차량은 처음 시작 시각 대신 재개 시각·사유 (2026-11-12 Sol, D20) */}
      <span className={styles.vStatus}>
        <b>상차 중</b> ·{" "}
        {view.revisionNo > 1 && view.lastReopen
          ? `${timeOf(view.lastReopen.at)} 재개${view.lastReopen.reasonName ? `(${view.lastReopen.reasonName})` : ""}`
          : `${timeOf(view.createdAt)} 시작`}{" "}
        · {view.centerName}
      </span>
    </section>
  );

  /* ═════════ 상차완료 뒤 — 상차확인서 번호·바코드 (참고 UI 완료 화면) ═════════ */
  if (!working) {
    return (
      <>
        <section className={styles.success}>
          {/* 방금 완료했을 때만 체크 원 + "발행했습니다" — 목록에서 지난 확인서를 열면 조회 제목 (2026-11-12 Sol) */}
          {doneBy && (
            <span className={styles.checkHalo} aria-hidden="true">
              <span>
                <Icon name="check" size={24} stroke={2.8} />
              </span>
            </span>
          )}
          <h2 className={styles.successTitle}>
            {doneBy === "other"
              ? "다른 작업자가 상차완료했습니다."
              : doneBy === "me"
                ? view.revisionNo > 1
                  ? `상차확인서 ${view.revisionNo}차를 발행했습니다.`
                  : "상차확인서를 발행했습니다."
                : `상차확인서${view.revisionNo > 1 ? ` · ${view.revisionNo}차` : ""}`}
          </h2>
          {doneBy && view.revisionNo > 1 && (
            <p className={styles.warnText}>이전 차수 확인서는 쓰지 마세요. 인쇄했다면 웹에서 다시 인쇄하세요.</p>
          )}
          <p className={styles.successSub}>입고검수는 이 바코드로 시작합니다.</p>
          <InfoRows
            rows={[
              [
                "상차확인서",
                <b key="no" className="mono">
                  {view.loadNo}
                  {view.revisionNo > 1 && ` · ${view.revisionNo}차`}
                </b>,
              ],
              ["차량번호", <span key="v" className="mono">{view.vehicleNo}</span>],
              ["도착 센터", view.centerName],
              ["완료", `${view.completedAt ? timeOf(view.completedAt) : "-"} · ${view.completedBy ?? "-"}`],
              // 출차 (2026-11-12 Sol) — 출차 전 / 시각·처리자 / 업무일이 지나 자동 출차
              ["출차", <DepartText key="dep" view={view} />],
              // ASN 대비 상차 — 품목 목록 대신 요약만 (2026-11-07 Sol 피드백)
              ["ASN 대비 상차", <LoadSummary key="sum" view={view} />],
              ...(view.diffReasonName ? ([["차이 사유", `${view.diffReasonName}${view.diffReasonText ? ` — ${view.diffReasonText}` : ""}`]] as [string, React.ReactNode][]) : []),
            ]}
          />
          <div className={styles.barcode}>
            <Barcode value={view.loadNo} height={52} module={2} />
          </div>
          {/*
            출차 전: [출차](주 버튼) + [상차 재개](지시 상차만) + 처음으로 / 출차 후: 처음으로만 (2026-11-12 Sol)
            출차는 되돌릴 수 없어 확인 창을 거친다. 재개는 지시 상차 + 출차 전 + 검수 전 (정의서 v1.5 D20)
          */}
          {view.canDepart ? (
            <button type="button" className={styles.blackPill} onClick={openDepart} disabled={pending}>
              <Icon name="truck" size={18} /> 출차
            </button>
          ) : (
            <button type="button" className={styles.blackPill} onClick={() => router.push("/pda")}>
              처음으로
            </button>
          )}
          {view.canReopen ? (
            <>
              <button type="button" className={`${styles.secondary} ${styles.wide}`} onClick={openReopen} disabled={pending}>
                상차 재개
              </button>
              <p className={styles.help}>빠뜨린 품목이 있으면 출차 전까지 재개해서 더 실을 수 있습니다.</p>
            </>
          ) : (
            <p className={styles.help}>
              {view.departure
                ? "출차한 차량은 재개할 수 없습니다. 차이는 입고검수에서 처리합니다."
                : view.type === "UNORDERED"
                  ? "무지시 상차는 재개할 수 없습니다. 더 실을 물량은 새 무지시 상차로 등록하세요."
                  : "입고검수가 시작되어 상차를 재개할 수 없습니다."}
            </p>
          )}
          {view.canDepart && (
            <button type="button" className={styles.link} onClick={() => router.push("/pda")} disabled={pending}>
              처음으로 (출차는 나중에)
            </button>
          )}
          {error && !reopening && !departing && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </section>
        {departing && (
          <div className={styles.modalScrim}>
            <section className={styles.modalSheet} role="alertdialog" aria-modal="true" aria-labelledby="depart-title" aria-describedby="depart-body">
              <h2 id="depart-title" className={styles.h2}>
                <Icon name="truck" size={18} /> 출차
              </h2>
              <p id="depart-body" className={styles.askBody}>
                <b className={`mono ${styles.askItem}`}>{view.vehicleNo}</b>{" "}
                <span className="mono">
                  {view.loadNo}
                  {view.revisionNo > 1 ? ` · ${view.revisionNo}차` : ""}
                </span>
              </p>
              <p className={styles.help}>{DEPART_CONFIRM_MSG}</p>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <div className={styles.btnRow}>
                <button type="button" className={styles.secondary} onClick={() => setDeparting(false)} disabled={pending} autoFocus>
                  그만두기
                </button>
                <button type="button" className={styles.primary} onClick={onDepart} disabled={pending}>
                  출차
                </button>
              </div>
            </section>
          </div>
        )}
        {reopening && (
          <div className={styles.modalScrim}>
            <section className={styles.modalSheet} role="dialog" aria-modal="true" aria-labelledby="reopen-title">
              <h2 id="reopen-title" className={styles.h2}>
                상차 재개
              </h2>
              <p className={styles.help}>
                다시 상차완료하면 확인서가 <b>{view.revisionNo + 1}차</b>로 바뀝니다(인쇄했다면 웹에서 다시 인쇄). 지시 품목과 오늘 ASN에 있는 품목만 실을 수 있고, ASN에 없는 새 품목은 실을 수 없습니다.
              </p>
              <label htmlFor="pda-reopen" className={styles.label}>
                재개 사유
              </label>
              <select
                id="pda-reopen"
                className={styles.field}
                value={reopening.code}
                onChange={(e) => setReopening({ ...reopening, code: e.target.value })}
                disabled={pending}
                autoFocus
              >
                <option value="">사유를 고르세요</option>
                {reopenReasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
              {reopenChosen?.requiresText && (
                <textarea
                  className={`${styles.field} ${styles.textarea}`}
                  value={reopening.text}
                  onChange={(e) => setReopening({ ...reopening, text: e.target.value })}
                  placeholder="상세 내용 (필수)"
                  maxLength={500}
                  rows={3}
                  disabled={pending}
                />
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <div className={styles.btnRow}>
                <button type="button" className={styles.secondary} onClick={() => setReopening(null)} disabled={pending}>
                  그만두기
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={onReopen}
                  disabled={pending || !reopening.code || (!!reopenChosen?.requiresText && !reopening.text.trim())}
                >
                  재개
                </button>
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  /* ═════════ 상차완료 확인 — 작업 화면 위에 아래에서 올라오는 확인 창 (2026-11-07 Sol 피드백: 위쪽 표시 → 모달) ═════════ */
  const diffLines = view.lines.filter((l) => l.state !== "match" && (l.orderBase > 0 || l.loadBase > 0));
  const finishSheet = finishing && (
    <div className={styles.modalScrim} onClick={(e) => e.target === e.currentTarget && !pending && setFinishing(false)}>
      <section className={styles.modalSheet} role="dialog" aria-modal="true" aria-labelledby="finish-title">
        <h2 id="finish-title" className={styles.h2}>
          상차완료
        </h2>
        {/* 재개 규칙 반영 (2026-11-12 Sol, D20) — 완료 후에도 검수 전까지 재개 가능(지시 상차만) */}
        <p className={styles.help}>
          {ordered
            ? "완료하면 상차확인서가 발행됩니다. 출차 전까지는 [상차 재개]로 더 실을 수 있습니다."
            : "완료하면 상차확인서가 발행됩니다. 무지시 상차는 완료 후 재개할 수 없습니다."}
        </p>
        {view.revisionNo > 1 && (
          <p className={styles.warnText}>
            완료하면 확인서가 {view.revisionNo}차로 바뀝니다. 이전에 인쇄한 확인서는 웹에서 다시 인쇄하세요.
          </p>
        )}
        {ordered && orderLineCount > 0 && (
          <p className={styles.finishSum}>
            <MatchText matched={matchedCount} total={orderLineCount} />
          </p>
        )}
        {view.hasDiff && diffLines.length > 0 && (
          <ul className={styles.diffList} aria-label="차이 품목">
            {diffLines.map((l) => (
              <li key={l.itemId}>
                <span className={styles.diffName}>
                  <span className={`${styles.dim} mono`}>{l.itemClientCode ?? l.itemCode}</span> {l.itemName}
                </span>
                <span className={`mono ${styles.diffQty}`}>
                  {fmt(l, l.loadBase)}
                  {l.orderBase > 0 && <span className={styles.dim}> / {fmt(l, l.orderBase)}</span>}
                </span>
                <span className={`${styles.diffState} ${styles[`ds_${l.state}`]}`}>{LINE_STATE_LABEL[l.state]}</span>
              </li>
            ))}
          </ul>
        )}
        {view.hasDiff && loadedLines > 0 && (
          <div className={styles.reasonBox}>
            <label htmlFor="pda-reason" className={styles.label}>
              차이 사유
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
                placeholder="상세 내용 (필수)"
                maxLength={500}
                rows={3}
                disabled={pending}
              />
            )}
          </div>
        )}
        {/* 작업자 — 이름 한 줄 (2026-11-11 Sol: 꼭 필요한 정보만). 여러 명이면 아직 싣는 사람이 없는지 확인 */}
        <p className={styles.finishSum}>
          작업자 {view.workers.length}명 <span className={styles.dim}>· {view.workers.map((w) => w.name).join(", ") || "-"}</span>
        </p>
        {view.workers.length > 1 && <p className={styles.warnText}>다른 작업자가 다 실었는지 확인하세요.</p>}
        {conflict && (
          <p className={styles.error} role="alert">
            {conflict}
          </p>
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
            상차완료
          </button>
        </div>
      </section>
    </div>
  );

  /* ═════════ 확인 창 — 지시 초과·지시 외 / 입력 취소 (2026-11-11 Sol: 화면 안 경고 → 모달). 밖을 눌러도 닫지 않는다 ═════════ */
  const askSheet = ask && (
    <div className={styles.modalScrim}>
      <section className={styles.modalSheet} role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-body">
        {ask.type === "over" ? (
          <>
            <h2 id="ask-title" className={`${styles.h2} ${styles.askTitle}`}>
              <Icon name="alert" size={18} /> {ask.kind === "over" ? "지시 수량 초과" : "지시 외 품목"}
            </h2>
            <div id="ask-body" className={styles.askBody}>
              <b className={styles.askItem}>{ask.item}</b>
              <dl className={styles.askRows}>
                {ask.kind === "over" && (
                  <>
                    <dt>지시</dt>
                    <dd className="mono">{ask.order}</dd>
                  </>
                )}
                <dt>싣고 나면</dt>
                <dd className={`mono ${styles.askAfter}`}>{ask.after}</dd>
              </dl>
              <p className={styles.help}>그래도 실으면 상차완료 때 차이 사유를 고릅니다.</p>
            </div>
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondary} onClick={closeAsk} disabled={pending} autoFocus>
                수량 고치기
              </button>
              <button type="button" className={styles.primary} onClick={() => (ask.source === "add" ? onAdd(true) : onCorrect(true))} disabled={pending}>
                {ask.source === "add" ? "그래도 싣기" : "그래도 정정"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="ask-title" className={styles.h2}>
              입력 취소
            </h2>
            <p id="ask-body" className={styles.askBody}>
              <b className={styles.askItem}>{ask.input.itemName}</b>{" "}
              <span className="mono">
                +{ask.input.addQty.toLocaleString()} {ask.input.unit}
              </span>
            </p>
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondary} onClick={closeAsk} disabled={pending} autoFocus>
                그만두기
              </button>
              <button type="button" className={styles.dangerBtn} onClick={() => onCancelInput(ask.input)} disabled={pending}>
                입력 취소
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );

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
            {/* 스캔한 품목 — 이름 + 라벨/값 상자 (2026-11-11 Sol: 이전 방식 유지, 필요한 줄만).
                품목코드 · 지시(지시 상차만) · 지금 합계. 스캔 단위는 기준 단위와 다를 때만 */}
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
                ...(preview.unit !== preview.baseUnit
                  ? ([["스캔 단위", <span key="u" className="mono">{preview.unit} = {preview.factor} {preview.baseUnit}</span>]] as [string, React.ReactNode][])
                  : []),
                ...(ordered
                  ? ([
                      [
                        "지시",
                        preview.orderBase ? (
                          qtyInUnit(preview.orderBase, preview.showUnit, preview.showFactor, preview.baseUnit)
                        ) : (
                          <span key="x" className={styles.warnInline}>
                            <Icon name="alert" size={15} /> 지시 외
                          </span>
                        ),
                      ],
                    ] as [string, React.ReactNode][])
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
                onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="0"
                autoComplete="off"
                enterKeyHint="done"
                disabled={pending}
              />
              <button type="submit" className={styles.primary} disabled={pending || !(Number(qty) > 0) || !!ask}>
                + 싣기
              </button>
            </div>
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
      </section>

      <Lines view={view} flash={flash} />

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
                    onChange={(e) => setEditing({ ...editing, qty: e.target.value.replace(/\D/g, "") })}
                    inputMode="numeric"
                    autoFocus
                    aria-label="정정할 수량"
                    disabled={pending}
                  />
                  <button type="button" className={styles.primary} onClick={() => onCorrect(false)} disabled={pending || !(Number(editing.qty) > 0) || !!ask}>
                    정정
                  </button>
                </div>
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
                    <button type="button" className={styles.small} onClick={() => setEditing({ id: i.id, qty: String(i.addQty) })} disabled={pending}>
                      정정
                    </button>
                    <button type="button" className={styles.smallDanger} onClick={() => setAsk({ type: "cancel", input: i })} disabled={pending}>
                      취소
                    </button>
                  </span>
                </span>
              </li>
            ),
          )}
        </ol>
      )}
        </div>
      </details>

      {/* 상차 정보 — 기본은 접어 두고 눌러서 펼친다 (2026-11-05 Sol 승인). 도착 센터는 머리에 있어 뺐다 (2026-11-11) */}
      <details className={styles.fold}>
        <summary className={styles.foldHead}>
          상차 정보
          <span className={styles.detailSum}>{view.asn?.orderNo ?? "ASN 없음"}</span>
          <span className={styles.detailChev}>
            <Icon name="chevD" size={16} />
          </span>
        </summary>
        <InfoRows
          tone="white"
          rows={[
            ["지시서", view.asn?.orderNo ? <span key="o" className="mono">{view.asn.orderNo}</span> : view.asn ? "-" : "ASN 없음"],
            ...(view.asn ? ([["출고일", <span key="d" className="mono">{view.asn.shipDate}</span>]] as [string, React.ReactNode][]) : []),
            ...(view.asn?.driverName ? ([["기사", `${view.asn.driverName}${view.asn.driverTel ? ` · ${view.asn.driverTel}` : ""}`]] as [string, React.ReactNode][]) : []),
            ["작업자", view.workers.length ? view.workers.map((w) => w.name).join(", ") : "-"],
          ]}
        />
      </details>


      {/* 아래 띠 — 지시 품목 일치 수(2026-11-11 Sol: 머리 → 여기) + [상차완료].
          품목을 1개 이상 실었을 때만, 확인 창에서 아직 고르지 않았으면 막는다 */}
      <div className={`${styles.bottomBar} ${styles.barRow}`}>
        {ordered && orderLineCount > 0 && (
          <span className={styles.barInfo}>
            <MatchText matched={matchedCount} total={orderLineCount} />
          </span>
        )}
        <button type="button" className={styles.blackPill} onClick={openFinish} disabled={pending || loadedLines === 0 || !!ask}>
          상차완료
        </button>
      </div>
      {finishSheet}
      {askSheet}
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
function Lines({ view, flash }: { view: LoadView; flash?: { itemId: number; n: number } | null }) {
  const ordered = view.type === "ORDERED";
  const refs = useRef(new Map<number, HTMLLIElement>());
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    if (!flash) return;
    refs.current.get(flash.itemId)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setLit(flash.itemId);
    const t = setTimeout(() => setLit(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);
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
              <li
                key={l.itemId}
                ref={(el) => {
                  if (el) refs.current.set(l.itemId, el);
                  else refs.current.delete(l.itemId);
                }}
                className={`${styles[`st_${st}`]} ${lit === l.itemId ? styles.lit : ""}`}
              >
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

/** 지시 품목 일치 수 — 다 맞으면 초록 */
function MatchText({ matched, total }: { matched: number; total: number }) {
  return (
    <span className={matched === total ? styles.matchAll : undefined}>
      일치 <b className="mono">{matched}</b>
      <span className="mono">/{total}</span>품목
    </span>
  );
}

/** 상차확인서의 ASN 대비 상차 요약 — 지시 품목 중 일치 수, 부족·초과·지시 외 품목 수 (2026-11-07 Sol 피드백) */
function LoadSummary({ view }: { view: LoadView }) {
  if (view.type !== "ORDERED") {
    return <span>무지시 상차 · {view.lines.filter((l) => l.loadBase > 0).length}품목</span>;
  }
  const order = view.lines.filter((l) => l.orderBase > 0);
  const n = (st: string) => view.lines.filter((l) => l.state === st && (l.orderBase > 0 || l.loadBase > 0)).length;
  const match = n("match");
  const parts = ([["부족", n("short")], ["초과", n("over")], ["지시 외", n("extra")]] as [string, number][]).filter(([, v]) => v > 0);
  return (
    <span>
      <b className={match === order.length ? styles.matchAll : undefined}>
        일치 {match}/{order.length}품목
      </b>
      {parts.length > 0 && <span className={styles.dim}> · {parts.map(([k, v]) => `${k} ${v}`).join(" · ")}</span>}
    </span>
  );
}

/** 출차 표시 (2026-11-12 Sol) — 출차 전 / "14:30 · 처리자" / "자동 출차(업무일 마감) 11-13 06:00" */
function DepartText({ view }: { view: LoadView }) {
  const d = view.departure;
  if (!d) return <span className={styles.warnInline}>출차 전</span>;
  if (d.auto) return <span>자동 출차(업무일 마감) · {fmtDateTime(d.at).slice(5, 16)}</span>;
  return <span>{timeOf(d.at)} · {d.by ?? "-"}</span>;
}
