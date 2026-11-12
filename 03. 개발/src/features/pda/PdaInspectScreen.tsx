"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { LOAD_TYPE_LABEL, qtyInUnit } from "@/domain/load-rules";
import { RCV_IMAGE_MAX, RCV_KIND_LABEL, RCV_LINE_STATE_LABEL, type RcvLineState } from "@/domain/rcv-rules";
import { fmtDateTime } from "@/lib/format";
import {
  addRcvImage, addRcvInput, cancelRcvInput, confirmRcv, correctRcvInput, deleteRcvImage, previewRcvScan, reloadRcv, setRcvLineInfo, setRcvZero,
} from "@/server/rcv/actions";
import type { ReasonOption } from "@/features/shared/RejectModal";
import type { RcvInputView, RcvLineView, RcvScanPreview, RcvView } from "@/features/rcv/types";
import { deviceId, takeNotice } from "./device";
import { Icon, InfoRows, Pill } from "./PdaParts";
import styles from "./Pda.module.css";

const POLL_MS = 5000;
const hm = (iso: string | null) => fmtDateTime(iso).slice(11);
const f = (l: Pick<RcvLineView, "showUnit" | "showFactor" | "baseUnit">, base: number) => qtyInUnit(base, l.showUnit, l.showFactor, l.baseUnit);

/** 사진을 PDA에서 줄여 올린다 — 긴 변 1280px, JPEG 0.72 (장당 약 300KB 이하) */
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = no;
      i.src = url;
    });
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72).split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * PDA 입고검수 (정의서 ⑥ · C7 · D15, 2026-11-05 Sol 결정 R2~R9)
 * 1) 품목 스캔 → 정상 / 훼손 반송 고르고 추가 수량 입력 (상차 실적에 없는 품목은 품목 불일치 반송으로만 기록)
 * 2) 품목마다 0(미도착) 확인·차이 사유·훼손 사진·소비기한·로트
 * 3) 여러 검수자가 함께 입력, 본인 입력만 취소·정정, 다른 검수자 입력은 몇 초마다 반영
 * 4) 검수 확정: 검수자·품목 합계를 보고 확정, 미입력 품목은 [돌아가서 스캔] / [남은 품목 전부 0 처리] → 자동 배분
 * 2026-11-12 Sol: 상차 작업과 같은 UI — 확정 확인·수량 경고·입력 취소는 아래에서 올라오는 창, 토스트 대신 그 품목 줄 강조,
 *   머리는 차량·상차 구분 + 짧은 상태 줄, 상차확인서·지시서·검수자는 접힌 '검수 정보', 완료 화면은 방금 확정/목록 조회 구분
 */
export function PdaInspectScreen({ initial, reasons }: { initial: RcvView; reasons: ReasonOption[] }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  /** 방금 입력·정정·취소한 품목 — 목록에서 그 줄로 옮겨 잠깐 강조 (토스트 대신, 상차 작업과 같게 2026-11-12 Sol) */
  const [flash, setFlash] = useState<{ itemId: number; n: number } | null>(null);
  /** 확인 창 — 수량 경고(그대로 입력) / 내 입력 취소 (화면 안 경고·브라우저 확인창 대신, 상차 작업과 같게) */
  const [ask, setAsk] = useState<{ type: "warn"; message: string } | { type: "cancel"; input: RcvInputView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [preview, setPreview] = useState<RcvScanPreview | null>(null);
  const [kind, setKind] = useState<"GOOD" | "DAMAGED">("GOOD");
  const [qty, setQty] = useState("");
  const [editing, setEditing] = useState<{ id: number; qty: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [unentered, setUnentered] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const working = view.status === "WORKING";
  /**
   * 확정 화면을 어떻게 열었는지 (상차 작업과 같게 2026-11-12 Sol) — me: 내가 방금 확정 / other: 검수 중 다른 검수자가 확정 /
   * null: 목록에서 지난 결과를 엶. 방금 확정한 경우에만 "확정했습니다"와 체크 원을 보여 준다.
   */
  const [doneBy, setDoneBy] = useState<"me" | "other" | null>(null);
  const meDone = useRef(false);
  const prevStatus = useRef(initial.status);

  useEffect(() => setNotice(takeNotice()), []);

  useEffect(() => {
    if (prevStatus.current === "WORKING" && view.status === "CONFIRMED") setDoneBy(meDone.current ? "me" : "other");
    prevStatus.current = view.status;
  }, [view.status]);

  const reload = useCallback(async () => {
    const r = await reloadRcv(view.id);
    if (r.ok && r.data) setView(r.data);
  }, [view.id]);

  useEffect(() => {
    if (!working || finishing) return;
    const t = setInterval(() => document.visibilityState === "visible" && void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [working, finishing, reload]);

  const resetScan = () => {
    setScan("");
    setPreview(null);
    setQty("");
    setAsk(null);
    setKind("GOOD");
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  /** 품목 줄에서 고친 결과 — 실패만 알리고 최신 내용으로 다시 읽는다 (바뀐 값은 펼친 줄에 바로 보인다) */
  const after = async (r: { ok: boolean; message?: string; error?: string }) => {
    if (!r.ok) setError(r.error ?? null);
    await reload();
  };

  const onScan = (value: string) =>
    start(async () => {
      setError(null);
      const r = await previewRcvScan({ rcvId: view.id, scan: value });
      if (r.ok && r.data) {
        setPreview(r.data);
        setQty("");
        setKind("GOOD");
        setTimeout(() => qtyRef.current?.focus(), 0);
      } else if (!r.ok) {
        setError(r.error);
        setScan("");
        if (r.code === "STATE") await reload();
        scanRef.current?.focus();
      }
    });

  const onAdd = (confirm = false) =>
    start(async () => {
      if (!preview) return;
      setError(null);
      const r = await addRcvInput({ rcvId: view.id, scan: preview.scan, qty: Number(qty), kind, deviceId: deviceId(), confirm });
      if (r.ok) {
        const itemId = preview.itemId;
        resetScan();
        await reload();
        setFlash({ itemId, n: Date.now() });
      } else if (r.code === "CONFIRM") setAsk({ type: "warn", message: r.error });
      else {
        setAsk(null);
        setError(r.error);
        if (r.code === "STATE") await reload();
      }
    });

  const onCancelInput = (i: RcvInputView) =>
    start(async () => {
      setError(null);
      setAsk(null);
      const r = await cancelRcvInput({ inputId: i.id });
      await after(r);
      if (r.ok) setFlash({ itemId: i.itemId, n: Date.now() });
    });

  const onCorrect = () =>
    start(async () => {
      if (!editing) return;
      setError(null);
      const r = await correctRcvInput({ inputId: editing.id, qty: Number(editing.qty), deviceId: deviceId() });
      const itemId = view.inputs.find((x) => x.id === editing.id)?.itemId;
      if (r.ok) setEditing(null);
      await after(r);
      if (r.ok && itemId) setFlash({ itemId, n: Date.now() });
    });

  /** 확인 창 [수량 고치기]·[그만두기] — 고치던 수량 칸으로 돌아간다 */
  const closeAsk = () => {
    const warned = ask?.type === "warn";
    setAsk(null);
    if (warned) setTimeout(() => qtyRef.current?.select(), 0);
  };

  const onComplete = (zeroRest = false) =>
    start(async () => {
      setError(null);
      setConflict(null);
      const r = await confirmRcv({ rcvId: view.id, lastInputId: view.lastInputId, zeroRest });
      if (r.ok) {
        meDone.current = true;
        await reload();
        setFinishing(false);
        setUnentered(null);
      } else if (r.code === "CONFIRM" && r.fieldErrors?.unentered) setUnentered(r.fieldErrors.unentered.split("\n"));
      else if (r.code === "CONFLICT") {
        setConflict(r.error);
        await reload();
      } else {
        setError(r.error);
        await reload();
      }
    });

  const myInputs = view.inputs.filter((i) => i.mine && !i.canceled);
  const anyEntered = view.lines.some((l) => l.state !== "todo");
  /** 세는 동안 바로 손볼 품목(훼손 사진) — 아래 띠·품목 줄에 표시. 차이 사유는 확정 확인 창에서 받는다 (2026-11-12 Sol) */
  const attention = view.lines.filter((l) => workProblem(l));
  /** 확정 확인 창 — 차이 품목(사유 고르기)·사진 없는 훼손 품목, 하나라도 남으면 확정 버튼을 막는다 */
  // 0(실물 없음) 확인 품목은 사유가 "미도착"으로 자동이라 고르지 않는다 (2026-11-12 Sol)
  const diffLines = view.lines.filter((l) => l.state !== "todo" && !l.zeroConfirm && (l.needsReason || !!l.reasonCode));
  const photoMissing = view.lines.filter((l) => workProblem(l));
  const confirmBlocked = view.lines.some((l) => lineProblem(l, reasons));

  const planned = view.lines.filter((l) => !l.mismatch);
  const enteredCount = planned.filter((l) => l.state !== "todo").length;

  /**
   * 차량 머리 — 상차 작업과 같은 모양 (2026-11-06 Sol 결정: 화면 구성 일관성, 2026-11-12 Sol: 상차 작업과 더 같게).
   * 차량번호·상차 구분 알약 + 상태 한 줄(검수 중 · 시작 · 화주사). 상차확인서·지시서·검수자는 아래 '검수 정보'로.
   */
  const head = (
    <section className={styles.vHead}>
      <span className={styles.idHead}>
        <Icon name="truck" size={18} />
        <b className={`mono ${styles.idNo}`}>{view.vehicleNo}</b>
        <Pill tone={view.load.type === "ORDERED" ? "blue" : "amber"}>{LOAD_TYPE_LABEL[view.load.type]}</Pill>
      </span>
      <span className={styles.vStatus}>
        <b>검수 중</b> · {hm(view.createdAt)} 시작 · {view.clientName}
      </span>
    </section>
  );

  /* ═════════ 확정 뒤 — 결과·배분 ═════════ */
  if (!working) {
    return (
      <>
        <section className={styles.success}>
          {/* 방금 확정했을 때만 체크 원 + "확정했습니다" — 목록에서 지난 결과를 열면 조회 제목 (상차 작업과 같게 2026-11-12 Sol) */}
          {doneBy && (
            <span className={styles.checkHalo} aria-hidden="true">
              <span>
                <Icon name="check" size={24} stroke={2.8} />
              </span>
            </span>
          )}
          <h2 className={styles.successTitle}>{doneBy === "other" ? "다른 검수자가 검수를 확정했습니다." : doneBy === "me" ? "검수를 확정했습니다." : "검수 결과"}</h2>
          <p className={styles.successSub}>입고예정에 자동 배분했습니다. 확정 뒤에는 고칠 수 없습니다. 잘못 확정했으면 3PL 관리자가 일마감 전에 웹에서 입고취소한 뒤 다시 검수합니다.</p>
          <InfoRows
            rows={[
              ["검수 번호", <b key="n" className="mono">{view.rcvNo}</b>],
              ["차량번호", <span key="v" className="mono">{view.vehicleNo}</span>],
              ["화주사", view.clientName],
              ["상차확인서", <span key="l" className="mono">{view.load.loadNo}</span>],
              ["확정", `${fmtDateTime(view.confirmedAt)} · ${view.confirmedBy ?? ""}`],
            ]}
          />
          <button type="button" className={styles.blackPill} onClick={() => router.push("/pda/inspect")}>
            처음으로
          </button>
        </section>
        <RcvLines view={view} reasons={reasons} pending={pending} onDone={after} />
        <section className={styles.sheet}>
          <h2 className={styles.h2}>
            자동 배분 <span className={styles.count}>{view.allocs.length}</span>
          </h2>
          {view.allocs.length === 0 ? (
            <p className={styles.empty}>배분한 수량이 없습니다 (0 확인·품목 불일치만).</p>
          ) : (
            <ul className={styles.lines}>
              {view.allocs.map((a, i) => (
                <li key={i}>
                  <span className={styles.lineName}>
                    {a.itemName}
                    <span className={`${styles.dim} mono`}>{a.planNo ?? "초과 (입고예정 없음)"}</span>
                  </span>
                  <span className={styles.lineQty}>
                    <b className="mono">{a.qty}</b>
                    <Pill tone={a.step === 3 ? "red" : a.kind === "RETURN" ? "amber" : "green"}>
                      {a.kind === "RETURN" ? "반송" : "입고"} · {a.step}단계
                    </Pill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  /*
   * ═════════ 검수 확정 확인 — 작업 화면 위에 아래에서 올라오는 확인 창 (상차완료와 같게 2026-11-12 Sol) ═════════
   * 손볼 품목(사유·사진)은 창을 닫고 목록에서 고친다. 미입력 품목은 창 안에서 [돌아가서 스캔] / [남은 품목 전부 0 처리].
   */
  const finishSheet = finishing && (
    <div className={styles.modalScrim} onClick={(e) => e.target === e.currentTarget && !pending && !unentered && setFinishing(false)}>
      <section className={styles.modalSheet} role="dialog" aria-modal="true" aria-labelledby="rcv-finish-title">
        <h2 id="rcv-finish-title" className={styles.h2}>
          검수 확정
        </h2>
        <p className={styles.help}>검수 확정은 차량당 한 번입니다. 확정하면 입고예정에 자동 배분하고, 이후에는 고칠 수 없습니다.</p>
        <p className={styles.finishSum}>
          입력 <b className="mono">{enteredCount}</b>
          <span className="mono">/{planned.length}</span>품목
          {diffLines.length > 0 && <span className={styles.warnInline}> · 차이 {diffLines.length}</span>}
        </p>
        {/* 차이 품목 — 수량을 보고 여기서 사유를 고른다 (2026-11-12 Sol: 세는 동안에는 묻지 않고 확정 때 한 번) */}
        {diffLines.length > 0 && (
          <ul className={styles.reasonList} aria-label="차이 품목 사유">
            {diffLines.map((l) => (
              <ReasonPick key={l.itemId} view={view} line={l} reasons={reasons} pending={pending} onDone={after} />
            ))}
          </ul>
        )}
        {photoMissing.length > 0 && (
          <p className={styles.warnText}>
            훼손 사진이 없는 품목: {photoMissing.map((l) => l.itemName).join(", ")} — 창을 닫고 품목 줄에서 찍으세요.
          </p>
        )}
        {/* 검수자 — 이름 한 줄 (상차완료 확인과 같게). 여러 명이면 아직 세는 사람이 없는지 확인 */}
        <p className={styles.finishSum}>
          검수자 {view.workers.length}명 <span className={styles.dim}>· {view.workers.map((w) => w.name).join(", ") || "-"}</span>
        </p>
        {view.workers.length > 1 && <p className={styles.warnText}>다른 검수자가 아직 세고 있지 않은지 확인하세요.</p>}
        {unentered && (
          <div className={styles.confirm} role="alertdialog" aria-label="입력하지 않은 품목">
            <p>
              <b>입력하지 않은 품목이 {unentered.length}개 있습니다.</b> 시스템이 대신 0으로 처리하지 않습니다.
            </p>
            <ul className={styles.unentered}>
              {unentered.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
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
        {unentered ? (
          <div className={styles.btnRow}>
            <button type="button" className={styles.secondary} onClick={() => (setUnentered(null), setFinishing(false), resetScan())} disabled={pending}>
              돌아가서 스캔
            </button>
            <button type="button" className={styles.primary} onClick={() => onComplete(true)} disabled={pending || confirmBlocked}>
              남은 품목 전부 0 처리
            </button>
          </div>
        ) : (
          <div className={styles.btnRow}>
            <button type="button" className={styles.secondary} onClick={() => setFinishing(false)} disabled={pending}>
              더 검수
            </button>
            <button type="button" className={styles.primary} onClick={() => onComplete(false)} disabled={pending || confirmBlocked}>
              검수 확정
            </button>
          </div>
        )}
      </section>
    </div>
  );

  /* ═════════ 확인 창 — 수량 경고 / 입력 취소 (상차 작업과 같게 2026-11-12 Sol). 밖을 눌러도 닫지 않는다 ═════════ */
  const askSheet = ask && (
    <div className={styles.modalScrim}>
      <section className={styles.modalSheet} role="alertdialog" aria-modal="true" aria-labelledby="rcv-ask-title" aria-describedby="rcv-ask-body">
        {ask.type === "warn" ? (
          <>
            <h2 id="rcv-ask-title" className={`${styles.h2} ${styles.askTitle}`}>
              <Icon name="alert" size={18} /> 수량 확인
            </h2>
            <p id="rcv-ask-body" className={styles.askBody}>
              {ask.message}
            </p>
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondary} onClick={closeAsk} disabled={pending} autoFocus>
                수량 고치기
              </button>
              <button type="button" className={styles.primary} onClick={() => onAdd(true)} disabled={pending}>
                그대로 입력
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="rcv-ask-title" className={styles.h2}>
              입력 취소
            </h2>
            <p id="rcv-ask-body" className={styles.askBody}>
              <b className={styles.askItem}>{ask.input.itemName}</b>{" "}
              <span className="mono">
                +{ask.input.addQty.toLocaleString()} {ask.input.unit}
              </span>
              {ask.input.kind !== "GOOD" && <span className={styles.metaWarn}> · {ask.input.kind === "DAMAGED" ? "훼손" : "불일치"}</span>}
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

  /* ═════════ 검수 중 ═════════ */
  return (
    <>
      {head}
      {notice && <p className={styles.warnText}>{notice}</p>}

      {/* 스캔 칸 — 상차 작업과 같이 화면 너비 끝까지·위에 붙음 */}
      <section className={styles.scanCard}>
        {!preview ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) onScan(scan);
            }}
          >
            <label htmlFor="pda-rcv-scan" className={styles.label}>
              품목 바코드
            </label>
            <div className={`${styles.searchPill} ${styles.searchPillLight}`}>
              <span className={styles.searchIcon}>
                <Icon name="scan" size={18} />
              </span>
              <input
                ref={scanRef}
                id="pda-rcv-scan"
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
            {preview.mismatch ? (
              <p className={styles.error}>상차 실적에 없는 품목입니다. 입고하지 않고 품목 불일치 반송으로 기록합니다.</p>
            ) : (
              <InfoRows
                tone="white"
                rows={[
                  ["스캔 단위", <span key="u" className="mono">{preview.unit}{preview.unit !== preview.baseUnit ? ` (= ${preview.factor} ${preview.baseUnit})` : ""}</span>],
                  ["상차 수량", qtyInUnit(preview.expect, preview.showUnit, preview.showFactor, preview.baseUnit)],
                  ["지금 정상 / 반송", `${qtyInUnit(preview.good, preview.showUnit, preview.showFactor, preview.baseUnit)} / ${qtyInUnit(preview.damaged, preview.showUnit, preview.showFactor, preview.baseUnit)}`],
                ]}
              />
            )}
            {!preview.mismatch && (
              <div className={styles.segment} role="radiogroup" aria-label="검수 구분">
                {(["GOOD", "DAMAGED"] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? styles.segOn : styles.seg} onClick={() => (setKind(k), setAsk(null))} disabled={pending}>
                    {RCV_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="pda-rcv-qty" className={styles.label}>
              추가로 센 수량 ({preview.unit})
            </label>
            <div className={styles.qtyRow}>
              <input
                ref={qtyRef}
                id="pda-rcv-qty"
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
                + 입력
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

      <RcvLines view={view} reasons={reasons} pending={pending} onDone={after} editable flash={flash} />

      {/* 내 입력 — 상차 작업과 같이 아래 접힌 줄 */}
      <details className={styles.fold}>
        <summary className={styles.foldHead}>
          내 입력 <span className={styles.count}>{myInputs.length}</span>
          <span className={styles.detailSum}>{myInputs[0] ? `마지막 ${hm(myInputs[0].inputAt)}` : "없음"}</span>
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
                        {i.itemName} <span className={styles.dim}>({RCV_KIND_LABEL[i.kind]} · {i.unit})</span>
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
                        <button type="button" className={styles.primary} onClick={onCorrect} disabled={pending || !(Number(editing.qty) > 0)}>
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
                        <b className="mono">{hm(i.inputAt)}</b>
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
                          {i.kind !== "GOOD" && <span className={styles.metaWarn}> · {i.kind === "DAMAGED" ? "훼손" : "불일치"}</span>}
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
          <p className={styles.help}>본인이 입력한 건만 정정·취소할 수 있습니다.</p>
        </div>
      </details>

      {/* 검수 정보 — 기본은 접어 두고 눌러서 펼친다 (상차 작업의 '상차 정보'와 같게 2026-11-12 Sol) */}
      <details className={styles.fold}>
        <summary className={styles.foldHead}>
          검수 정보
          <span className={`${styles.detailSum} mono`}>{view.load.loadNo}</span>
          <span className={styles.detailChev}>
            <Icon name="chevD" size={16} />
          </span>
        </summary>
        <InfoRows
          tone="white"
          rows={[
            ["상차확인서", <span key="l" className="mono">{view.load.loadNo}</span>],
            ["지시서", view.load.orderNo ? <span key="o" className="mono">{view.load.orderNo}</span> : "ASN 없음 (무지시)"],
            ["상차완료", hm(view.load.completedAt)],
            ...(view.load.driverName ? ([["기사", view.load.driverName]] as [string, React.ReactNode][]) : []),
            ["검수자", view.workers.length ? view.workers.map((w) => w.name).join(", ") : "-"],
          ]}
        />
      </details>

      {/* 아래 띠 — 확인 필요 수 + [검수 확정] (상차 작업과 같은 줄 배치). 미입력 개수는 표시하지 않는다 — 확정할 때 묻는다 (2026-11-06 Sol) */}
      <div className={`${styles.bottomBar} ${styles.barRow}`}>
        {attention.length > 0 && (
          <span className={`${styles.barInfo} ${styles.warnInline}`}>
            확인 필요 <b className="mono">{attention.length}</b>
          </span>
        )}
        {/* 1개 이상 검수했을 때만 (2026-11-06 Sol) */}
        <button
          type="button"
          className={styles.blackPill}
          onClick={() => start(async () => (setConflict(null), setError(null), setUnentered(null), await reload(), setFinishing(true)))}
          disabled={pending || !anyEntered || !!ask}
        >
          검수 확정
        </button>
      </div>
      {finishSheet}
      {askSheet}
    </>
  );
}

/**
 * 세는 동안 바로 손볼 것 — 훼손 사진만 (발견한 사람이 그 자리에서 찍는다).
 * 상차 수량과의 차이는 다른 검수자가 아직 세는 중일 수 있어 확정 때 묻는다 (2026-11-12 Sol: 동시 검수 중 사유 요구 불편)
 */
function workProblem(l: RcvLineView): string | null {
  if (l.state !== "todo" && l.damaged > 0 && l.imageIds.length === 0) return "훼손 사진을 찍으세요";
  return null;
}

/** 확정 전에 갖춰야 할 것 — 사유 없음(미리 고를 값도 없음)·상세 없음·훼손 사진 없음. 미입력 품목은 확정 때 따로 묻는다 */
function lineProblem(l: RcvLineView, reasons: ReasonOption[]): string | null {
  if (l.state === "todo") return null;
  if (l.needsReason && !l.reasonCode) return "차이 사유를 고르세요";
  if (l.reasonCode && reasons.find((r) => r.code === l.reasonCode)?.requiresText && !l.reasonText?.trim()) return "상세 내용을 입력하세요";
  if (l.damaged > 0 && l.imageIds.length === 0) return "훼손 사진을 찍으세요";
  return null;
}

/** 품목별 합계 — 누르면 0 확인·사유·소비기한·로트·사진 */
function RcvLines({
  view,
  reasons,
  pending,
  onDone,
  editable = false,
  flash,
}: {
  view: RcvView;
  reasons: ReasonOption[];
  pending: boolean;
  onDone: (r: { ok: boolean; message?: string; error?: string }) => Promise<void>;
  editable?: boolean;
  /** 방금 입력·정정·취소한 품목 — 그 줄로 옮겨 잠깐 강조 (상차 작업과 같게) */
  flash?: { itemId: number; n: number } | null;
}) {
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`rcv-line-${flash.itemId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setLit(flash.itemId);
    const t = setTimeout(() => setLit(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);
  const planned = view.lines.filter((l) => !l.mismatch);
  const entered = planned.filter((l) => l.state !== "todo").length;
  return (
    <section className={styles.flat}>
      <h2 className={styles.h2}>
        품목 <span className={styles.count}>{view.lines.length}</span>
        {/* 입력 진행 강조 (2026-11-06 Sol) */}
        <span className={`${styles.progressTag} ${planned.length > 0 && entered === planned.length ? styles.progressDone : ""}`}>
          입력 <b className="mono">{entered}</b> / {planned.length}
        </span>
      </h2>
      <ul className={`${styles.rcvLines} ${styles.rcvFlat}`}>
        {view.lines.map((l) => (
          <RcvLineItem key={l.itemId} view={view} line={l} reasons={reasons} pending={pending} onDone={onDone} editable={editable && view.status === "WORKING"} lit={lit === l.itemId} />
        ))}
      </ul>
    </section>
  );
}

function RcvLineItem({
  view,
  line: l,
  reasons,
  pending,
  onDone,
  editable,
  lit = false,
}: {
  view: RcvView;
  line: RcvLineView;
  reasons: ReasonOption[];
  pending: boolean;
  onDone: (r: { ok: boolean; message?: string; error?: string }) => Promise<void>;
  editable: boolean;
  lit?: boolean;
}) {
  const [busy, startBusy] = useTransition();
  const [text, setText] = useState(l.reasonText ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  // 세는 동안에는 훼손 사진만 바로 손본다 — 차이 사유는 확정 확인 창에서 (2026-11-12 Sol)
  const problem = workProblem(l);
  const chosen = reasons.find((r) => r.code === l.reasonCode);
  // 손볼 것이 생기면 펼친다. 해결돼도 저절로 접지 않는다 (방금 올린 사진·고른 사유가 보이게)
  const [open, setOpen] = useState(editable && !!problem);
  useEffect(() => {
    if (editable && problem) setOpen(true);
  }, [editable, problem]);
  const dis = pending || busy;
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => startBusy(async () => onDone(await fn()));

  // 검수자별 이 품목 수량(기준 단위) — 검수자가 2명 이상일 때만, 안 넣은 사람은 null
  const byWorker: [string, number | null][] = (() => {
    if (view.workers.length < 2 && l.workers.length < 2) return [];
    const sum = new Map<string, number>();
    for (const i of view.inputs) if (!i.canceled && i.itemId === l.itemId) sum.set(i.workerName, (sum.get(i.workerName) ?? 0) + i.baseQty);
    const names = [...new Set([...sum.keys(), ...view.workers.map((w) => w.name)])];
    return names.map((n) => [n, sum.has(n) ? sum.get(n)! : null]);
  })();

  const qtyText = l.mismatch
    ? `반송 ${f(l, l.mismatchQty)}`
    : `${f(l, l.good)}${l.damaged ? ` · 반송 ${f(l, l.damaged)}` : ""} / ${f(l, l.expect)}`;

  return (
    <li id={`rcv-line-${l.itemId}`} className={`${styles.rcvLine} ${lit ? styles.lit : ""} ${l.zeroConfirm ? styles.rcvZero : ""}`}>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={styles.rcvSum}>
          <span className={styles.lineName}>
            {l.itemName}
            {/* 누가 몇 개 넣었는지 — 다른 검수자가 아직 세는 중인지 짐작할 수 있게 (2026-11-12 Sol). 검수자가 2명 이상이면 안 넣은 사람은 — */}
            <span className={`${styles.dim} mono`}>
              {l.itemCode}
              {byWorker.length > 0 && ` · ${byWorker.map(([n, q]) => `${n} ${q === null ? "—" : f(l, q)}`).join(" · ")}`}
            </span>
          </span>
          <span className={styles.lineQty}>
            <b className="mono">{qtyText}</b>
            <span className={`${styles.stText} ${problem && editable ? styles.rst_problem : styles[`rst_${l.state}`]}`}>{problem && editable ? "확인 필요" : RCV_LINE_STATE_LABEL[l.state]}</span>
          </span>
          {/* 진행 막대 — 상차 수량 대비 센 수량(정상+반송), 상차 작업의 품목 줄과 같은 색 */}
          {!l.mismatch && l.expect > 0 && (
            <span className={`${styles.rcvBar} ${styles[BAR_TONE[l.state]] ?? ""}`} aria-hidden="true">
              <span className={styles.lnBar}>
                <span style={{ width: `${Math.min(100, ((l.good + l.damaged) / l.expect) * 100)}%` }} />
              </span>
            </span>
          )}
        </summary>
        <div className={styles.rcvBody}>
          {problem && editable && <p className={styles.metaWarn}>{problem}</p>}
          {editable && !l.mismatch && !l.hasInputs && (
            <button type="button" className={l.zeroConfirm ? styles.secondary : styles.outlinePill} onClick={() => run(() => setRcvZero({ rcvId: view.id, itemId: l.itemId, on: !l.zeroConfirm }))} disabled={dis}>
              {l.zeroConfirm ? "0 확인 풀기" : "실물 없음 · 0(미도착)으로 확인"}
            </button>
          )}
          {/* 0(실물 없음) 확인 품목은 사유 드롭다운을 두지 않는다 — 사유는 서버가 "미도착"으로 자동 지정 (2026-11-12 Sol) */}
          {l.state !== "todo" &&
            !l.zeroConfirm &&
            (l.needsReason || l.reasonCode) &&
            (editable ? (
              <>
                <select
                  className={styles.field}
                  value={l.reasonCode ?? ""}
                  onChange={(e) => run(() => setRcvLineInfo({ rcvId: view.id, itemId: l.itemId, reasonCode: e.target.value || null, reasonText: text }))}
                  disabled={dis}
                  aria-label={`${l.itemName} 차이 사유`}
                >
                  <option value="">차이 사유를 고르세요</option>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {chosen?.requiresText && (
                  <textarea
                    className={`${styles.field} ${styles.textarea}`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onBlur={() => text !== (l.reasonText ?? "") && run(() => setRcvLineInfo({ rcvId: view.id, itemId: l.itemId, reasonCode: l.reasonCode, reasonText: text }))}
                    placeholder="상세 내용 (필수)"
                    maxLength={500}
                    rows={2}
                    disabled={dis}
                  />
                )}
              </>
            ) : (
              <p className={styles.dim}>
                사유: {l.reasonName}
                {l.reasonText ? ` — ${l.reasonText}` : ""}
              </p>
            ))}
          {/* 0(실물 없음) 확인 품목은 소비기한·로트를 받지 않는다 — 받을 실물이 없음 (2026-11-12 Sol) */}
          {(l.expiryManaged || l.lotManaged) && !l.mismatch && !l.zeroConfirm && (
            <div className={styles.btnRow}>
              {l.expiryManaged && (
                <label className={styles.miniField}>
                  <span>소비기한</span>
                  <input
                    type="date"
                    className={styles.field}
                    defaultValue={l.expiryDate ?? l.planExpiry ?? ""}
                    onBlur={(e) => e.target.value !== (l.expiryDate ?? "") && run(() => setRcvLineInfo({ rcvId: view.id, itemId: l.itemId, expiryDate: e.target.value || null }))}
                    disabled={!editable || dis}
                  />
                </label>
              )}
              {l.lotManaged && (
                <label className={styles.miniField}>
                  <span>로트</span>
                  <input
                    className={`${styles.field} mono`}
                    defaultValue={l.lotNo ?? l.planLot ?? ""}
                    onBlur={(e) => e.target.value.trim() !== (l.lotNo ?? "") && run(() => setRcvLineInfo({ rcvId: view.id, itemId: l.itemId, lotNo: e.target.value }))}
                    maxLength={40}
                    disabled={!editable || dis}
                  />
                </label>
              )}
            </div>
          )}
          {(l.damaged > 0 || l.imageIds.length > 0) && (
            <div className={styles.photos}>
              {l.imageIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.photo}
                  onClick={() => editable && window.confirm("이 사진을 지울까요? (본인이 찍은 사진만)") && run(() => deleteRcvImage({ imageId: id }))}
                  disabled={!editable || dis}
                  aria-label="훼손 사진"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/rcv-image/${id}`} alt="" />
                </button>
              ))}
              {editable && l.imageIds.length < RCV_IMAGE_MAX && (
                <>
                  <button type="button" className={styles.photoAdd} onClick={() => fileRef.current?.click()} disabled={dis}>
                    <Icon name="plus" size={18} />
                    <span>사진</span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) run(async () => addRcvImage({ rcvId: view.id, itemId: l.itemId, mime: "image/jpeg", base64: await compress(file) }));
                    }}
                  />
                </>
              )}
              <span className={styles.dim}>
                훼손 사진 {l.imageIds.length}/{RCV_IMAGE_MAX}
              </span>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

/** 진행 막대 색 — 상차 작업 품목 줄의 상태 색을 그대로 쓴다 */
const BAR_TONE: Record<RcvLineState, string> = { todo: "st_none", short: "st_short", match: "st_match", over: "st_over", zero: "st_none", mismatch: "st_extra" };

/**
 * 검수 확정 확인 창의 차이 품목 한 줄 — 수량(센 / 상차)과 상태를 보고 사유를 고른다 (2026-11-12 Sol).
 * 사유는 품목 줄에서 미리 골라 둘 수도 있고, 고른 값이 여기에 그대로 보인다.
 */
function ReasonPick({
  view,
  line: l,
  reasons,
  pending,
  onDone,
}: {
  view: RcvView;
  line: RcvLineView;
  reasons: ReasonOption[];
  pending: boolean;
  onDone: (r: { ok: boolean; message?: string; error?: string }) => Promise<void>;
}) {
  const [busy, startBusy] = useTransition();
  const [text, setText] = useState(l.reasonText ?? "");
  const chosen = reasons.find((r) => r.code === l.reasonCode);
  const dis = pending || busy;
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => startBusy(async () => onDone(await fn()));
  const qty = l.mismatch ? `반송 ${f(l, l.mismatchQty)}` : `${f(l, l.good + l.damaged)} / ${f(l, l.expect)}`;
  const missing = !l.reasonCode || (!!chosen?.requiresText && !l.reasonText?.trim());
  return (
    <li className={missing ? styles.reasonMissing : undefined}>
      <span className={styles.reasonHead}>
        <span className={styles.diffName}>{l.itemName}</span>
        <span className={`mono ${styles.diffQty}`}>{qty}</span>
        <span className={`${styles.stText} ${styles[`rst_${l.state}`]}`}>{RCV_LINE_STATE_LABEL[l.state]}</span>
      </span>
      <select
        className={styles.field}
        value={l.reasonCode ?? ""}
        onChange={(e) => run(() => setRcvLineInfo({ rcvId: view.id, itemId: l.itemId, reasonCode: e.target.value || null, reasonText: text }))}
        disabled={dis}
        aria-label={`${l.itemName} 차이 사유`}
      >
        <option value="">차이 사유를 고르세요</option>
        {reasons.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </select>
      {chosen?.requiresText && (
        <textarea
          className={`${styles.field} ${styles.textarea}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (l.reasonText ?? "") && run(() => setRcvLineInfo({ rcvId: view.id, itemId: l.itemId, reasonCode: l.reasonCode, reasonText: text }))}
          placeholder="상세 내용 (필수)"
          maxLength={500}
          rows={2}
          disabled={dis}
        />
      )}
    </li>
  );
}
