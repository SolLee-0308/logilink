"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./Toast.module.css";

interface ToastValue {
  /** 처리 결과를 화면 아래에 잠깐 알린다 */
  show: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);
const DURATION = 2600;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string) => {
    setMessage(m);
    setSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!message) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), DURATION);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, seq]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* 알림 영역은 항상 두고 내용만 바꿔야 스크린리더가 읽는다 */}
      <div className={styles.region} role="status" aria-live="polite">
        {message && (
          <div key={seq} className={styles.toast}>
            {message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast는 ToastProvider 안에서 써야 합니다.");
  return ctx;
}
