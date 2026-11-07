"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { NavCountKey } from "@/config/navigation";

type Counts = Partial<Record<NavCountKey, number>>;

interface NavCountsValue {
  counts: Counts;
  setCount: (key: NavCountKey, value: number) => void;
}

const NavCountsContext = createContext<NavCountsValue | null>(null);

/** 사이드바 건수 배지 — 화면이 처리 결과에 맞춰 갱신한다 */
export function NavCountsProvider({
  initial = {},
  children,
}: {
  initial?: Counts;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<Counts>(initial);
  const setCount = useCallback((key: NavCountKey, value: number) => {
    setCounts((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  const value = useMemo(() => ({ counts, setCount }), [counts, setCount]);
  return <NavCountsContext.Provider value={value}>{children}</NavCountsContext.Provider>;
}

export function useNavCounts() {
  const ctx = useContext(NavCountsContext);
  if (!ctx) throw new Error("useNavCounts는 NavCountsProvider 안에서 써야 합니다.");
  return ctx;
}
