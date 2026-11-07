"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Overlay.module.css";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** 열린 대화상자 순서 — Esc는 맨 위 하나만 닫는다 (편집 모달 위 확인창 등) */
const stack: symbol[] = [];

/** 열려 있는 동안 Esc 닫기 · Tab 가두기 · 닫히면 원래 위치로 포커스 복귀 */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | HTMLFormElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const me = Symbol("dialog");
    stack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  return ref;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** form으로 렌더해 Enter 제출을 받을 때 */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** lg: 넓은 2열 편집 모달 */
  size?: "md" | "lg";
}

/** 가운데 모달. 바깥 클릭으로는 닫지 않는다(입력 중 내용 보호) — 취소 버튼·Esc로 닫기 */
export function Modal({ open, onClose, title, description, children, footer, onSubmit, size = "md" }: ModalProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  const descId = useId();
  if (!open) return null;

  const content = (
    <>
      <header className={styles.mHead}>
        <h2 id={titleId}>{title}</h2>
        {description && <p id={descId}>{description}</p>}
      </header>
      <div className={styles.mBody}>{children}</div>
      {footer && <footer className={styles.mFoot}>{footer}</footer>}
    </>
  );
  const common = {
    className: `${styles.modal} ${size === "lg" ? styles.lg : ""}`,
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": titleId,
    "aria-describedby": description ? descId : undefined,
  } as const;

  return createPortal(
    <div className={styles.scrim}>
      {onSubmit ? (
        <form
          ref={ref as React.RefObject<HTMLFormElement>}
          {...common}
          noValidate
          onSubmit={(e) => {
            // 포털이어도 React 이벤트는 부모 폼으로 전파되므로 막는다
            e.stopPropagation();
            onSubmit(e);
          }}
        >
          {content}
        </form>
      ) : (
        <div ref={ref as React.RefObject<HTMLDivElement>} {...common}>
          {content}
        </div>
      )}
    </div>,
    document.body,
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/** 오른쪽 시트 (도움말 등 읽기용) — 바깥 클릭·Esc·닫기로 닫힘 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <>
      <div className={`${styles.scrim} ${styles.light}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.sHead}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.sClose} onClick={onClose}>
            닫기
          </button>
        </header>
        <div className={styles.sBody}>{children}</div>
      </div>
    </>,
    document.body,
  );
}
