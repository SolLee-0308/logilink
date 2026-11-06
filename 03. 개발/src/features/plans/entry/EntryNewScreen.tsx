"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { NoteBox } from "@/components/ui/NoteBox";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { AI_MAX_IMAGES, PLAN_MAX_LINES, type CatalogItem } from "@/domain/plan-entry";
import type { PlanInputMethod } from "@/domain/plan-status";
import { previewPlanExcel, readPlanImages } from "@/server/plans/actions";
import { SubHeader } from "@/features/master/shared";
import { ENTRY_RULES } from "../rules";
import type { EntryOptions } from "../types";
import { ENTRY_LIST_KEY, entryListUrl } from "./entry-list";
import { PlanEditor, fromDraft, type EditorLine } from "./PlanEditor";
import styles from "./EntryNewScreen.module.css";

export type EntryMode = "direct" | "excel" | "ai";
const METHOD: Record<EntryMode, PlanInputMethod> = { direct: "DIRECT", excel: "EXCEL", ai: "AI_IMAGE" };

/**
 * 입고예정 등록 (/plans/entry/new) — [직접 입력] / [엑셀 업로드] / [이미지 AI 판독] 탭.
 * 엑셀·판독은 파일을 올리면 초안 라인이 편집기에 채워지고, 확인 필요 줄을 고친 뒤 저장한다.
 * 세 탭은 모두 마운트해 두어 탭을 바꿔도 입력이 남는다. 탭은 주소(?mode=)에 남긴다.
 */
export function EntryNewScreen({ options, defaultMode }: { options: EntryOptions; defaultMode: EntryMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<EntryMode>(defaultMode);

  function change(m: EntryMode) {
    setMode(m);
    const u = new URL(window.location.href);
    if (m === "direct") u.searchParams.delete("mode");
    else u.searchParams.set("mode", m);
    window.history.replaceState(null, "", u.pathname + u.search);
  }

  const done = (id: number) => router.push(`/plans/entry/${id}`);
  const back = () => router.push(entryListUrl());

  return (
    <>
      <SubHeader group={["입고 계획"]} section="입고예정 등록" title="새 입고예정" backHref="/plans/entry" storageKey={ENTRY_LIST_KEY} rules={ENTRY_RULES} />
      <Tabs
        label="등록 방식"
        value={mode}
        onChange={change}
        panelId="entry-body"
        items={[
          { key: "direct", label: "직접 입력" },
          { key: "excel", label: "엑셀 업로드" },
          { key: "ai", label: "이미지 AI 판독" },
        ]}
      />
      <div id="entry-body" role="tabpanel" aria-labelledby={`tab-${mode}`} className={styles.body}>
        <div hidden={mode !== "direct"}>
          <PlanEditor
            options={options}
            method="DIRECT"
            initial={{ centerId: "", planDate: "", memo: "", lines: [] }}
            submitLabel="저장 (승인 요청)"
            onCancel={back}
            onSaved={done}
          />
        </div>
        <div hidden={mode !== "excel"}>
          <ExcelTab options={options} onSaved={done} onCancel={back} />
        </div>
        <div hidden={mode !== "ai"}>
          <AiTab options={options} onSaved={done} onCancel={back} />
        </div>
      </div>
    </>
  );
}

/* ───────── 공통: 파일 끌어다 놓기 영역 ───────── */

function DropZone({
  id,
  accept,
  multiple,
  busy,
  title,
  help,
  onFiles,
}: {
  id: string;
  accept: string;
  multiple?: boolean;
  busy: boolean;
  title: string;
  help: string;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // 영역 밖에 떨어뜨려도 브라우저가 파일을 열며 화면을 떠나지 않게
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
  return (
    <div
      className={`${styles.drop} ${over ? styles.dropOver : ""}`}
      aria-disabled={busy || undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) onFiles([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={ref}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <strong>{busy ? "읽는 중…" : over ? "여기에 놓으세요" : title}</strong>
      <span className="muted">
        또는{" "}
        <label htmlFor={id} className={styles.pick}>
          파일 선택
        </label>{" "}
        · {help}
      </span>
    </div>
  );
}

/* ───────── 엑셀 업로드 ───────── */

function ExcelTab({ options, onSaved, onCancel }: { options: EntryOptions; onSaved: (id: number) => void; onCancel: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<{ lines: EditorLine[]; items: CatalogItem[]; fileName: string; nonce: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function onFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (files.length > 1) return setError("파일은 한 번에 하나만 올릴 수 있습니다.");
    if (!/\.xlsx$/i.test(f.name)) return setError(".xlsx 엑셀 파일만 올릴 수 있습니다. (.xls·.csv는 엑셀에서 .xlsx로 저장해 주세요)");
    setError(null);
    const form = new FormData();
    form.set("file", f);
    start(async () => {
      const r = await previewPlanExcel(form);
      if (!r.ok) {
        setError(r.fieldErrors?.file ?? r.error);
        return;
      }
      toast.show(r.message);
      setDraft({ lines: r.data!.lines.map(fromDraft), items: r.data!.items, fileName: r.data!.fileName, nonce: Date.now() });
    });
  }

  if (draft)
    return (
      <div className={styles.body}>
        <div className={styles.sourceBar}>
          <span>
            엑셀 <strong>{draft.fileName}</strong>에서 <strong className="mono">{draft.lines.length}</strong>행을 불러왔습니다.
          </span>
          <Button size="sm" onClick={() => setDraft(null)}>
            다른 파일 올리기
          </Button>
        </div>
        <PlanEditor
          key={draft.nonce}
          options={options}
          method="EXCEL"
          extraItems={draft.items}
          initial={{ centerId: "", planDate: "", memo: "", lines: draft.lines }}
          submitLabel="저장 (승인 요청)"
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </div>
    );

  return (
    <div className={styles.body}>
      <Step no={1} title="양식 내려받기" description="품목 1개를 1행에 씁니다. 품목코드·바코드·품목명 중 하나와 수량은 꼭 넣고, 소비기한·로트는 관리 품목만 씁니다.">
        <a className={styles.download} href="/plans/entry/template" download>
          입고예정 양식 내려받기 (.xlsx)
        </a>
      </Step>
      <Step
        no={2}
        title="작성한 파일 올리기"
        description={`.xlsx 파일 1개, 최대 ${PLAN_MAX_LINES}행. 올리면 품목을 마스터와 맞춰 아래 편집 화면에 채웁니다. 센터·입고예정일은 다음 화면에서 고르고, 아직 저장하지 않습니다.`}
      >
        <DropZone id="pe-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" busy={busy} title="작성한 엑셀 파일을 이 영역에 끌어다 놓으세요" help=".xlsx 파일 1개" onFiles={onFiles} />
        {error && (
          <p className={styles.err} role="alert">
            {error}
          </p>
        )}
      </Step>
    </div>
  );
}

/* ───────── 이미지 AI 판독 ───────── */

/** 긴 변 2000px JPEG로 줄여 올린다 (용량을 줄여도 글자는 충분히 읽힌다) */
async function shrink(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

interface AiDraft {
  lines: EditorLine[];
  items: CatalogItem[];
  aiReadId: number;
  isExample: boolean;
  note: string | null;
  planDate: string | null;
  images: { name: string; url: string }[];
  nonce: number;
}

function AiTab({ options, onSaved, onCancel }: { options: EntryOptions; onSaved: (id: number) => void; onCancel: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // 미리보기 주소 정리
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), [files]);

  function onFiles(list: File[]) {
    const imgs = list.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    if (imgs.length < list.length) setError("JPG·PNG·WEBP 이미지만 올릴 수 있습니다. PDF는 화면을 캡처해 올려 주세요.");
    else setError(null);
    const next = [...files, ...imgs.map((f) => ({ file: f, url: URL.createObjectURL(f) }))];
    if (next.length > AI_MAX_IMAGES) {
      setError(`이미지는 한 번에 ${AI_MAX_IMAGES}장까지 올릴 수 있습니다.`);
      next.slice(AI_MAX_IMAGES).forEach((f) => URL.revokeObjectURL(f.url));
    }
    setFiles(next.slice(0, AI_MAX_IMAGES));
  }

  function read() {
    if (!files.length) return setError("판독할 이미지를 올리세요.");
    start(async () => {
      const form = new FormData();
      for (const f of files) form.append("images", await shrink(f.file));
      const r = await readPlanImages(form);
      if (!r.ok) {
        setError(r.fieldErrors?.images ?? r.error);
        return;
      }
      toast.show(r.message);
      const d = r.data!;
      setDraft({
        lines: d.lines.map(fromDraft),
        items: d.items,
        aiReadId: d.aiReadId,
        isExample: d.isExample,
        note: d.note,
        planDate: d.planDate && d.planDate >= options.today ? d.planDate : null,
        images: files.map((f) => ({ name: f.file.name, url: f.url })),
        nonce: Date.now(),
      });
    });
  }

  if (draft)
    return (
      <div className={styles.body}>
        <div className={styles.sourceBar}>
          <span>
            이미지 <strong className="mono">{draft.images.length}</strong>장에서 <strong className="mono">{draft.lines.length}</strong>줄을 판독했습니다. 판독 결과는 저장 전까지 초안입니다.
          </span>
          <Button
            size="sm"
            onClick={() => {
              setDraft(null);
              setFiles([]);
            }}
          >
            다른 이미지 판독
          </Button>
        </div>
        {draft.isExample && (
          <NoteBox tone="info">
            <strong>예시 판독 결과입니다.</strong> AI 판독 API 키가 아직 설정되지 않아, 올린 이미지 대신 이 화주사의 품목으로 만든 예시를 보여 줍니다. 화면 흐름 확인용이며, 키를 설정하면 실제 이미지를 읽습니다.
          </NoteBox>
        )}
        {draft.note && !draft.isExample && <NoteBox tone="warn">판독 메모: {draft.note}</NoteBox>}
        <PlanEditor
          key={draft.nonce}
          options={options}
          method="AI_IMAGE"
          aiReadId={draft.aiReadId}
          extraItems={draft.items}
          initial={{ centerId: "", planDate: draft.planDate ?? "", memo: "", lines: draft.lines }}
          submitLabel="저장 (승인 요청)"
          onCancel={onCancel}
          onSaved={onSaved}
          side={<SourceImages images={draft.images} />}
        />
      </div>
    );

  return (
    <div className={styles.body}>
      <Step
        no={1}
        title="이미지 올리기"
        description={`카카오톡·이메일로 받은 거래명세서·발주서·메시지 캡처를 올립니다. 한 입고예정에 해당하는 이미지만, 최대 ${AI_MAX_IMAGES}장.`}
      >
        <DropZone id="pe-images" accept="image/jpeg,image/png,image/webp,image/gif" multiple busy={busy} title="이미지를 이 영역에 끌어다 놓으세요" help={`JPG·PNG·WEBP, 최대 ${AI_MAX_IMAGES}장`} onFiles={onFiles} />
        {files.length > 0 && (
          <ul className={styles.thumbs} aria-label="올린 이미지">
            {files.map((f, i) => (
              <li key={f.url}>
                {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 미리보기(blob:) */}
                <img src={f.url} alt={f.file.name} />
                <span className={styles.thumbName}>{f.file.name}</span>
                <button
                  type="button"
                  className={styles.thumbRemove}
                  aria-label={`${f.file.name} 빼기`}
                  disabled={busy}
                  onClick={() => {
                    URL.revokeObjectURL(f.url);
                    setFiles(files.filter((_, j) => j !== i));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className={styles.err} role="alert">
            {error}
          </p>
        )}
      </Step>
      <Step no={2} title="판독 후 확인" description="AI가 품목과 수량을 읽어 편집 화면에 채웁니다. 원본 이미지와 대조해 확인 필요 줄을 고친 뒤 저장합니다.">
        <div>
          <Button variant="primary" onClick={read} disabled={busy || !files.length}>
            {busy ? "판독 중… (최대 1분)" : `이미지 ${files.length}장 판독`}
          </Button>
        </div>
      </Step>
    </div>
  );
}

/** 판독 원본 이미지 — 편집하면서 대조할 수 있게 품목 카드 위에 */
function SourceImages({ images }: { images: { name: string; url: string }[] }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);
  const cur = images[i] ?? images[0];
  return (
    <section className={styles.source} aria-label="원본 이미지">
      <div className={styles.sourceHead}>
        <h3>원본 이미지</h3>
        {images.length > 1 &&
          images.map((img, n) => (
            <button key={img.url} type="button" className={`${styles.srcTab} ${n === i ? styles.srcTabOn : ""}`} onClick={() => setI(n)} aria-pressed={n === i}>
              {n + 1}
            </button>
          ))}
        <a className={styles.srcOpen} href={cur.url} target="_blank" rel="noreferrer">
          새 창에서 크게 보기
        </a>
        <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "접기" : "펼치기"}
        </Button>
      </div>
      {open && (
        <div className={styles.srcView}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 미리보기(blob:) */}
          <img src={cur.url} alt={`원본 이미지 ${i + 1}: ${cur.name}`} />
        </div>
      )}
    </section>
  );
}

function Step({ no, title, description, children }: { no: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card step={no} title={title} description={description} label={`${no}단계 ${title}`}>
      {children}
    </Card>
  );
}

