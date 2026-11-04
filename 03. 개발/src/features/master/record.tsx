"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import { Modal } from "@/components/ui/Overlay";
import { useUnsavedChanges, useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { useToast } from "@/components/ui/Toast";
import type { ActionResult } from "@/server/action-result";
import styles from "./record.module.css";

/**
 * 목록형 기준정보의 조회/편집 분리 패턴
 * - 우측 패널: 조회 전용(텍스트) + [수정] (권한 있을 때만)
 * - 편집 모달: [+ 등록]·[수정] 공용. 열 때 서버에서 최신 데이터·version을 다시 읽는다
 */

export type ViewItem = [label: string, value: React.ReactNode, opts?: { full?: boolean }];

const empty = <span className={styles.empty}>없음</span>;

/** 조회 구역: 구역 제목 + 라벨/값 (값이 비면 "없음") */
export function ViewSection({ title, items }: { title: string; items: ViewItem[] }) {
  return (
    <section className={styles.view}>
      <h3>{title}</h3>
      <dl>
        {items.map(([label, value, opts]) => (
          <div key={label} className={opts?.full ? styles.full : undefined}>
            <dt>{label}</dt>
            <dd>{value === null || value === undefined || value === "" ? empty : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 편집 모달 안 구역: 제목 + 2열 */
export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.formSect}>
      <h3>{title}</h3>
      <div className={styles.grid}>{children}</div>
    </section>
  );
}

/** 2열 중 한 줄 전체를 쓰는 칸 */
export function Full({ children }: { children: React.ReactNode }) {
  return <div className={styles.full}>{children}</div>;
}

/** 패널 상단 오른쪽 [수정] 버튼 */
export function EditButton({ onClick, label = "수정" }: { onClick: () => void; label?: string }) {
  return (
    <Button size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

/**
 * 편집 모달 — 저장하지 않은 변경이 있으면 닫기·Esc·[취소]·링크 이동 때 확인창을 띄운다.
 * dirty일 때만 [저장] 활성.
 */
export function EditModal({
  open,
  title,
  description,
  dirty,
  pending,
  error,
  submitLabel = "저장",
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  dirty: boolean;
  pending: boolean;
  error?: string | null;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  const guard = useUnsavedGuard();
  useUnsavedChanges(open && dirty);

  async function close() {
    if (dirty && !(await guard.confirmLeave())) return;
    onClose();
  }

  return (
    <Modal
      open={open}
      size="lg"
      onClose={close}
      title={title}
      description={description}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !pending) onSubmit();
      }}
      footer={
        <>
          <Button onClick={close} disabled={pending}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || pending}>
            {pending ? "저장 중…" : submitLabel}
          </Button>
        </>
      }
    >
      {error && <NoteBox tone="error">{error}</NoteBox>}
      {children}
    </Modal>
  );
}

/**
 * 편집 대상 불러오기 — [수정]을 누르는 순간 서버에서 최신 데이터와 version을 다시 읽는다.
 * target: null(닫힘) / "new"(등록) / 불러온 행
 */
export function useEditTarget<T>(load: (id: number) => Promise<ActionResult<T>>) {
  const toast = useToast();
  const [target, setTarget] = useState<T | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  /** 같은 행을 다시 불러올 때 폼을 새로 그리기 위한 번호 */
  const [nonce, setNonce] = useState(0);

  async function openEdit(id: number) {
    setLoading(true);
    const r = await load(id);
    setLoading(false);
    if (!r.ok) return toast.show(r.error);
    setTarget(r.data as T);
    setNonce((n) => n + 1);
  }

  return {
    target,
    loading,
    nonce,
    openNew: () => {
      setTarget("new");
      setNonce((n) => n + 1);
    },
    openEdit,
    /** 저장 충돌 시: 최신 내용을 다시 불러와 폼을 새로 채운다 */
    reload: (id: number) => openEdit(id),
    close: () => setTarget(null),
  };
}

