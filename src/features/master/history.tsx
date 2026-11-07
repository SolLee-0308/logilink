"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Overlay";
import { Timeline, type TimelineEntry, type TimelineTone } from "@/components/ui/Timeline";
import { PanelFootNote } from "@/components/ui/SplitView";
import { fmtDateTime } from "@/lib/format";
import type { ChangeEntry } from "./types";
import styles from "./history.module.css";

const ACTION_LABEL: Record<string, string> = {
  CREATE: "등록",
  UPDATE: "수정",
  DELETE: "삭제",
  UNLOCK: "잠금 해제",
  PASSWORD_RESET: "비밀번호 초기화",
  PASSWORD_CHANGE: "비밀번호 변경",
};
const ACTION_TONE: Record<string, TimelineTone> = { CREATE: "save", DELETE: "reject" };

export interface HistoryProps {
  /** 공통 변경 로그 (최신 순) */
  entries: ChangeEntry[];
  /** 필드명 → 화면 라벨. 라벨이 없는 필드는 보여 주지 않는다 */
  labels: Record<string, string>;
  /** 값 표시 방식 (코드 → 이름 등) */
  format?: (field: string, value: unknown) => string;
  /** 등록 로그가 없는 옛 데이터용 등록 정보 */
  created?: { at: string; by: string };
}

function defaultShow(k: string, v: unknown) {
  if (typeof v === "boolean") return k === "isActive" ? (v ? "사용" : "사용 안 함") : v ? "예" : "아니오";
  if (v === null || v === undefined || v === "") return "없음";
  return String(v);
}

/** 변경 로그 → 타임라인 항목: 일시·변경자·구분·필드(이전 값 → 새 값) */
function toTimeline({ entries, labels, format, created }: HistoryProps): TimelineEntry[] {
  const show = (k: string, v: unknown) => (format ? format(k, v) : defaultShow(k, v));
  const items: TimelineEntry[] = entries.map((e) => {
    const after = e.after ?? {};
    const before = e.before ?? {};
    const keys = Object.keys(e.action === "DELETE" ? before : after).filter((k) => labels[k]);
    const lines = keys.map((k) =>
      e.action === "CREATE" ? (
        <li key={k}>
          <span className={styles.field}>{labels[k]}</span> {show(k, after[k])}
        </li>
      ) : e.action === "DELETE" ? (
        <li key={k}>
          <span className={styles.field}>{labels[k]}</span> {show(k, before[k])}
        </li>
      ) : (
        <li key={k}>
          <span className={styles.field}>{labels[k]}</span> <span className={styles.before}>{show(k, before[k])}</span> →{" "}
          <strong>{show(k, after[k])}</strong>
        </li>
      ),
    );
    const fromRequest = e.action === "CREATE" && after.fromRequest ? `품목 등록 요청 ${String(after.fromRequest)}에서 등록` : null;
    return {
      key: e.id,
      tone: ACTION_TONE[e.action] ?? "neutral",
      title: (
        <span>
          <strong>{e.actor}</strong> · {ACTION_LABEL[e.action] ?? e.action}
        </span>
      ),
      detail:
        lines.length || fromRequest ? (
          <>
            {fromRequest && <span className={styles.note}>{fromRequest}</span>}
            {lines.length > 0 && <ul className={styles.changes}>{lines}</ul>}
          </>
        ) : undefined,
      at: fmtDateTime(e.at),
    };
  });
  if (created && !entries.some((e) => e.action === "CREATE"))
    items.push({ key: "created", tone: "save", title: <span><strong>{created.by}</strong> · 등록</span>, at: fmtDateTime(created.at) });
  return items;
}

/** 변경 이력 드로어 (오른쪽 슬라이드) */
export function HistoryDrawer({ open, onClose, title, ...rest }: HistoryProps & { open: boolean; onClose: () => void; title: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={`변경 이력 · ${title}`}>
      <Timeline entries={toTimeline(rest)} />
    </Sheet>
  );
}

/**
 * 상세 하단 왼쪽: "최종 변경 {변경자} · {YYYY-MM-DD HH:mm} · 이력 보기"
 * version은 화면에 보이지 않고 저장 시 동시 수정 확인에만 쓴다.
 */
export function LastChanged({ by, at, title, ...history }: HistoryProps & { by: string; at: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PanelFootNote>
        최종 변경 {by} · <span className="mono">{fmtDateTime(at)}</span> ·{" "}
        <button type="button" className={styles.link} onClick={() => setOpen(true)}>
          이력 보기
        </button>
      </PanelFootNote>
      <HistoryDrawer open={open} onClose={() => setOpen(false)} title={title} {...history} />
    </>
  );
}
