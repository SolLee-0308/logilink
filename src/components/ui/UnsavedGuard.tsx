"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Overlay";

/**
 * 저장하지 않은 변경 보호
 * - 편집 중인 폼이 useUnsavedChanges(dirty)로 알린다.
 * - 화면 안 링크 이동(사이드바 등)은 확인창으로, 새로고침·탭 닫기는 브라우저 기본 확인으로 막는다.
 * - 모달 닫기·Esc 등은 화면이 confirmLeave()를 불러 같은 확인창을 쓴다.
 */
export const UNSAVED_MSG = "저장하지 않은 변경 사항이 있습니다. 닫을까요?";

interface GuardValue {
  setDirty: (key: string, dirty: boolean) => void;
  /** 변경이 없으면 바로 true, 있으면 확인창 결과 */
  confirmLeave: () => Promise<boolean>;
}

const GuardContext = createContext<GuardValue | null>(null);

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const dirty = useRef(new Set<string>());
  const [asking, setAsking] = useState<((ok: boolean) => void) | null>(null);

  const setDirty = useCallback((key: string, d: boolean) => {
    if (d) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);

  const confirmLeave = useCallback(
    () => (dirty.current.size === 0 ? Promise.resolve(true) : new Promise<boolean>((resolve) => setAsking(() => resolve))),
    [],
  );

  const answer = (ok: boolean) => {
    asking?.(ok);
    setAsking(null);
    if (ok) dirty.current.clear();
  };

  useEffect(() => {
    // 링크 클릭을 React(Next Link)보다 먼저 가로챈다
    function onClick(e: MouseEvent) {
      if (dirty.current.size === 0 || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      const href = a.pathname + a.search + a.hash;
      confirmLeave().then((ok) => ok && router.push(href));
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [confirmLeave, router]);

  const value = useMemo(() => ({ setDirty, confirmLeave }), [setDirty, confirmLeave]);

  return (
    <GuardContext.Provider value={value}>
      {children}
      <Modal
        open={asking !== null}
        onClose={() => answer(false)}
        title={UNSAVED_MSG}
        description="닫으면 입력한 내용이 사라집니다."
        footer={
          <>
            <Button onClick={() => answer(false)} data-autofocus>
              계속 편집
            </Button>
            <Button variant="danger" onClick={() => answer(true)}>
              닫기
            </Button>
          </>
        }
      />
    </GuardContext.Provider>
  );
}

export function useUnsavedGuard() {
  const ctx = useContext(GuardContext);
  if (!ctx) throw new Error("UnsavedGuardProvider가 없습니다.");
  return ctx;
}

/** 이 폼에 저장하지 않은 변경이 있는지 알린다 (언마운트되면 자동 해제) */
export function useUnsavedChanges(isDirty: boolean) {
  const key = useId();
  const { setDirty } = useUnsavedGuard();
  useEffect(() => {
    setDirty(key, isDirty);
    return () => setDirty(key, false);
  }, [key, isDirty, setDirty]);
}
