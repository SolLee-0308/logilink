"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup } from "@/components/ui/FilterBar";
import { FormField } from "@/components/ui/Form";
import { ClientPicker } from "@/features/plans/ClientFinder";
import { NoteBox } from "@/components/ui/NoteBox";
import { ListToolbar } from "@/components/ui/SplitView";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedChanges } from "@/components/ui/UnsavedGuard";
import { BULK_MAX_ROWS, columnsOf, type BulkKind } from "@/domain/item-bulk";
import { commitItemBulk, previewItemBulk } from "@/server/master/actions";
import { ITEM_LIST_KEY } from "./ItemsScreen";
import { reqListUrl } from "./item-request-list";
import { RULES } from "./rules";
import { SubHeader } from "./shared";
import type { BulkPreview, BulkPreviewRow, ClientOption } from "./types";
import styles from "./ItemBulkScreen.module.css";

type RowFilter = "all" | "ok" | "err";

/** 오류 행을 CSV로 내려받기 (엑셀에서 바로 열리도록 UTF-8 BOM) — 고쳐서 양식에 붙여 다시 올린다 */
function downloadErrors(kind: BulkKind, rows: BulkPreviewRow[]) {
  const cols = columnsOf(kind);
  const q = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const lines = [
    [...cols.map((c) => c.header), "엑셀 행", "오류"].map(q).join(","),
    ...rows.map((r) => [...cols.map((c) => r.raw[c.key] ?? ""), String(r.rowNo), r.errors.join(" / ")].map(q).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = kind === "ITEM" ? "품목_일괄등록_오류.csv" : "품목_등록요청_오류.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 품목 엑셀 일괄 등록(3PL) · 일괄 요청(화주사)
 * ① 양식 내려받기 → ② 파일 올리기 → ③ 행마다 검사 결과 확인 → ④ 오류 없는 행만 등록(요청)
 */
export function ItemBulkScreen({
  kind,
  clients,
  defaultClientId,
  clientName,
  embedded = false,
  onDirtyChange,
}: {
  kind: BulkKind;
  /** 3PL: 사용 중인 화주사 */
  clients: ClientOption[];
  defaultClientId: string;
  /** 화주사 계정의 화주사명 */
  clientName: string;
  /** 품목 등록·등록 요청 화면의 [엑셀로 여러 품목] 안에 들어갈 때 — 머리(SubHeader)는 등록 화면이 그린다 */
  embedded?: boolean;
  /** 파일을 올렸거나 검사 결과가 있으면 true — 등록 화면이 입력 방법을 바꿀 때 경고한다 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState(clients.some((c) => String(c.id) === defaultClientId) ? defaultClientId : clients.length === 1 ? String(clients[0].id) : "");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [filter, setFilter] = useState<RowFilter>("all");
  const [errors, setErrors] = useState<{ form?: string; clientId?: string; file?: string }>({});
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const isItem = kind === "ITEM";
  const verb = isItem ? "등록" : "요청";
  const busy = checking || saving;

  // 끌어다 놓기 영역 밖에 파일을 떨어뜨려도 브라우저가 파일을 열며 화면을 떠나지 않게 막는다
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  /** 파일 선택·끌어다 놓기 공통 — .xlsx 한 개만 받는다 */
  function pickFile(files: FileList | null) {
    const file = files?.[0];
    setPreview(null);
    if (!file) {
      setFileName("");
      return;
    }
    if (files.length > 1 || !/\.xlsx$/i.test(file.name)) {
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      setErrors({ file: files.length > 1 ? "파일은 한 번에 하나만 올릴 수 있습니다." : ".xlsx 엑셀 파일만 올릴 수 있습니다. (.xls·.csv는 엑셀에서 .xlsx로 저장해 주세요)" });
      return;
    }
    // 끌어다 놓은 파일도 파일 입력에 넣어 [파일 확인]이 같은 경로로 읽게 한다
    if (fileRef.current && fileRef.current.files !== files) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileRef.current.files = dt.files;
    }
    setFileName(file.name);
    setErrors({});
  }

  // 확인만 하고 등록하지 않은 채 나가려 하면 확인창
  const okRows = useMemo(() => preview?.rows.filter((r) => r.errors.length === 0) ?? [], [preview]);
  const errRows = useMemo(() => preview?.rows.filter((r) => r.errors.length > 0) ?? [], [preview]);
  useUnsavedChanges(okRows.length > 0 && !saving);
  const hasInput = !!fileName || !!preview;
  useEffect(() => onDirtyChange?.(hasInput), [hasInput, onDirtyChange]);

  const shown = filter === "ok" ? okRows : filter === "err" ? errRows : (preview?.rows ?? []);
  const cols = columnsOf(kind);
  // 표에는 핵심 열만: 품목코드·품목명 + (등록) 온도대·기준단위·바코드 / (요청) 단위·바코드
  const keyCols = cols.filter((c) => (isItem ? ["code", "name", "storageTemp", "baseUnit", "boxQty", "eaBarcode", "boxBarcode"] : ["code", "name", "unit", "barcode", "storageTemp"]).includes(c.key));

  const columns: Column<BulkPreviewRow>[] = [
    { key: "row", header: "행", align: "right", render: (r) => <span className="mono">{r.rowNo}</span> },
    {
      key: "state",
      header: "검사",
      render: (r) => (r.errors.length ? <Badge tone="rej">오류</Badge> : <Badge tone="ok">{verb} 가능</Badge>),
    },
    ...keyCols.map((c) => ({
      key: c.key,
      header: c.header,
      wrap: c.key === "name",
      render: (r: BulkPreviewRow) => {
        const v = r.raw[c.key];
        return v ? <span className={/code|barcode|Barcode|Qty|Unit|unit/.test(c.key) ? "mono" : undefined}>{v}</span> : <span className="muted">–</span>;
      },
    })),
    {
      key: "errors",
      header: "오류 내용",
      wrap: true,
      render: (r) =>
        r.errors.length ? (
          <ul className={styles.errors}>
            {r.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <span className="muted">–</span>
        ),
    },
  ];

  function check() {
    const file = fileRef.current?.files?.[0];
    const e: typeof errors = {};
    if (isItem && !clientId) e.clientId = "화주사를 선택하세요.";
    if (!file) e.file = "엑셀 파일을 끌어다 놓거나 고르세요.";
    setErrors(e);
    if (Object.keys(e).length || !file) return;
    const form = new FormData();
    form.set("file", file);
    if (isItem) form.set("clientId", clientId);
    startCheck(async () => {
      const r = await previewItemBulk(form);
      if (!r.ok) {
        setPreview(null);
        setErrors({ form: r.fieldErrors ? undefined : r.error, ...(r.fieldErrors ?? {}) });
        toast.show(r.error, { tone: "error" });
        return;
      }
      setPreview(r.data!);
      setFilter(r.data!.rows.some((x) => x.errors.length) ? "err" : "all");
    });
  }

  function commit() {
    if (!preview || !okRows.length) return;
    startSave(async () => {
      const r = await commitItemBulk({ clientId: preview.clientId, rows: okRows.map((x) => ({ rowNo: x.rowNo, raw: x.raw })) });
      if (!r.ok) {
        setErrors({ form: r.error });
        toast.show(r.error, { tone: "error" });
        return;
      }
      toast.show(r.message);
      setPreview(null);
      router.push(isItem ? `/master/items?client=${preview.clientId}` : reqListUrl("wait"));
    });
  }

  function reset() {
    setPreview(null);
    setFileName("");
    setErrors({});
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      {!embedded && (
        <SubHeader
          section={isItem ? "품목 관리" : "품목 등록 요청"}
          title={isItem ? "엑셀 일괄 등록" : "엑셀 일괄 요청"}
          backHref={isItem ? "/master/items" : "/master/item-requests"}
          storageKey={isItem ? ITEM_LIST_KEY : undefined}
          rules={isItem ? RULES.items : RULES.itemRequests}
        />
      )}

      {/* ① 양식 → ② 파일 → ③ 검사 결과: 단계마다 카드를 나눠 지금 할 일이 보이게 한다 */}
      <Step
        no={1}
        title="양식 내려받기"
        state={fileName || preview ? "done" : "current"}
        // 요청 양식 설명은 뺀다 (2026-11-07 Sol 피드백)
        description={isItem ? "품목 1개를 1행에 씁니다. BOX·PLT 입수와 단위별 바코드, 별칭까지 한 번에 넣을 수 있습니다." : undefined}
        aside={
          // 라우트 핸들러가 역할에 맞는 양식을 만들어 준다
          <a className={styles.download} href="/master/items/template" download>
            {isItem ? "품목 일괄 등록 양식" : "품목 등록 요청 양식"} 내려받기 (.xlsx)
          </a>
        }
      />

      <Step
        no={2}
        title="작성한 파일 올리기"
        state={preview ? "done" : fileName ? "current" : "todo"}
        description={`.xlsx 1개, 최대 ${BULK_MAX_ROWS.toLocaleString()}행 · 파일 확인만으로는 저장되지 않습니다`}
        // [파일 확인]은 화주사 선택(3PL)·파일 올리기가 모두 끝났을 때만 켠다 (2026-11-06 Sol 결정)
        footer={
          <Button variant={preview ? "secondary" : "primary"} onClick={check} disabled={busy || !fileName || (isItem && !clientId)}>
            {checking ? "확인 중…" : preview ? "다시 확인" : "파일 확인"}
          </Button>
        }
      >
        {isItem ? (
          <div className={styles.uploadRow}>
            <FormField label="화주사" htmlFor="b-client" required error={errors.clientId}>
              <ClientPicker
                id="b-client"
                value={clientId}
                onChange={(v) => {
                  setClientId(v);
                  setPreview(null);
                }}
                clients={clients}
                placeholder="화주사를 선택하세요"
                block
                clearable={false}
                disabled={busy}
              />
            </FormField>
          </div>
        ) : (
          <p className={styles.static}>
            <span className="muted">화주사</span> <strong>{clientName}</strong>
          </p>
        )}
        <div
          className={`${styles.drop} ${dragOver ? styles.dropOver : ""} ${fileName ? styles.dropHas : ""} ${errors.file ? styles.dropErr : ""}`}
          aria-disabled={busy || undefined}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = busy ? "none" : "copy";
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!busy) pickFile(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileRef}
            id="b-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={busy}
            aria-invalid={!!errors.file || undefined}
            aria-describedby="b-file-help"
            onChange={(e) => pickFile(e.target.files)}
          />
          {fileName ? (
            <>
              <strong className={styles.dropName}>{fileName}</strong>
              <span className="muted" id="b-file-help">
                다른 파일을 끌어다 놓거나{" "}
                <label htmlFor="b-file" className={styles.dropPick}>
                  파일 다시 고르기
                </label>
              </span>
            </>
          ) : (
            <>
              <strong>{dragOver ? "여기에 놓으세요" : "작성한 엑셀 파일을 이 영역에 끌어다 놓으세요"}</strong>
              <span className="muted" id="b-file-help">
                또는{" "}
                <label htmlFor="b-file" className={styles.dropPick}>
                  파일 선택
                </label>{" "}
                · .xlsx 파일 1개
              </span>
            </>
          )}
        </div>
        {errors.file && (
          <p className={styles.fileErr} role="alert">
            {errors.file}
          </p>
        )}
        {errors.form && <NoteBox tone="error">{errors.form}</NoteBox>}
      </Step>

      <Step
        no={3}
        title={`검사 결과 확인 후 ${verb}`}
        state={preview ? "current" : "todo"}
        description={`오류 없는 행만 ${verb}됩니다 · 오류 행은 고쳐서 다시 올리세요`}
        // [다시 올리기]·[요청]은 단계 제목 줄 오른쪽 (2026-11-07 Sol 피드백, 요청 = 보라 채움)
        aside={
          preview && (
            <div className={styles.stepActions}>
              <Button onClick={reset} disabled={saving}>
                다시 올리기
              </Button>
              <Button variant="create" onClick={commit} disabled={saving || okRows.length === 0}>
                {saving ? `${verb} 중…` : `${okRows.length.toLocaleString()}건 ${verb}`}
              </Button>
            </div>
          )
        }
      >
        {!preview ? (
          <p className={styles.placeholder}>파일을 올리고 [파일 확인]을 누르면 행마다 검사 결과가 여기에 표시됩니다.</p>
        ) : (
          <>
          <div className={styles.summary}>
            <span>
              <strong>{preview.clientName}</strong> · {preview.fileName}
            </span>
            <span>
              총 <strong className="mono">{preview.rows.length.toLocaleString()}</strong>행 · {verb} 가능{" "}
              <strong className="mono">{okRows.length.toLocaleString()}</strong> · 오류{" "}
              <strong className={`mono ${errRows.length ? styles.bad : ""}`}>{errRows.length.toLocaleString()}</strong>
            </span>
          </div>
          {errRows.length > 0 && okRows.length > 0 && (
            <NoteBox tone="warn">오류 {errRows.length}행은 빼고 {okRows.length}행만 {verb}합니다. 오류 행은 [오류 행 내려받기]로 받아 고친 뒤 다시 올리세요.</NoteBox>
          )}
          {okRows.length === 0 && <NoteBox tone="error">{verb}할 수 있는 행이 없습니다. 오류를 고친 뒤 다시 올리세요.</NoteBox>}

          <ListToolbar total={shown.length}>
            <ChipGroup
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `전체 ${preview.rows.length}` },
                { value: "ok", label: `${verb} 가능 ${okRows.length}` },
                { value: "err", label: `오류 ${errRows.length}` },
              ]}
            />
            {errRows.length > 0 && (
              <Button size="sm" onClick={() => downloadErrors(kind, errRows)}>
                오류 행 내려받기
              </Button>
            )}
          </ListToolbar>
          <DataTable
            caption="엑셀 검사 결과"
            columns={columns}
            rows={shown}
            rowKey={(r) => String(r.rowNo)}
            compact
            empty={filter === "err" ? "오류 행이 없습니다." : "표시할 행이 없습니다."}
          />
          </>
        )}
      </Step>
    </>
  );
}

type StepState = "done" | "current" | "todo";

/** 단계 카드: 번호 + 제목·설명 (+ 오른쪽 버튼) / 본문 / 아래 버튼 */
function Step({
  no,
  title,
  state,
  description,
  aside,
  footer,
  children,
}: {
  no: number;
  title: string;
  state: StepState;
  description?: string;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className={styles.step} aria-label={`${no}단계 ${title}`}>
      <div className={styles.stepHead}>
        <span className={`${styles.stepNo} ${styles[`no_${state}`]}`} aria-hidden>
          {no}
        </span>
        <div className={styles.stepText}>
          <h2>{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        {aside && <div className={styles.stepAside}>{aside}</div>}
      </div>
      {children && <div className={styles.stepBody}>{children}</div>}
      {footer && <div className={styles.stepFoot}>{footer}</div>}
    </section>
  );
}
