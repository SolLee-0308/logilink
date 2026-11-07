"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./Toast.module.css";

export type ToastTone = "default" | "error";

interface ToastValue {
  /** 처리 결과를 화면 아래에 잠깐 알린다. 저장 실패 등은 tone: "error" — 붉은색으로 더 오래 (2026-11-07 Sol 확정) */
  show: (message: string, opts?: { tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastValue | null>(null);
const DURATION: Record<ToastTone, number> = { default: 2600, error: 6000 };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>("default");
  const [seq, setSeq] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string, opts?: { tone?: ToastTone }) => {
    setMessage(m);
    setTone(opts?.tone ?? "default");
    setSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!message) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), DURATION[tone]);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, seq, tone]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* 알림 영역은 항상 두고 내용만 바꿔야 스크린리더가 읽는다 */}
      <div className={styles.region} role="status" aria-live="polite">
        {message && (
          <div key={seq} className={`${styles.toast} ${tone === "error" ? styles.error : ""}`}>
            {tone === "error" && (
              <span className={styles.icon} aria-hidden="true">
                !
              </span>
            )}
            {message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * 저장 실패 후 오류가 보이게 화면을 옮긴다 — 스크롤을 내린 상태에서도 놓치지 않게 (2026-11-07 Sol 확정).
 * 칸별 오류가 있으면 첫 오류 칸으로(포커스), 없으면 화면 안의 첫 오류 상자(role=alert)로.
 */
export function revealError(root: ParentNode = document) {
  // 오류 표시가 그려진 뒤에 찾는다
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const field = root.querySelector<HTMLElement>(
        "[data-invalid] input:not([type=hidden]):not([readonly]), [data-invalid] select, [data-invalid] textarea, [data-invalid] button, input[aria-invalid=true], select[aria-invalid=true]",
      );
      if (field) {
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      root.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
    }),
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast는 ToastProvider 안에서 써야 합니다.");
  return ctx;
}
