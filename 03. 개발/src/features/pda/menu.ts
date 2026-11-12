import type { UserRole } from "@/domain/master";

/**
 * PDA 메뉴 (2026-11-05 Sol 확정) — 로그인한 역할로 아래 메뉴 띠를 정한다
 * - 화주사 상차담당: 대시보드 · 상차등록 (2026-11-12 Sol: 상차내역은 상차등록의 날짜·"상차완료" 거르기로 합침)
 * - 3PL 입고검수자: 대시보드 · 입고검수 · 검수 내역
 * 2026-11-06 Sol: 대시보드를 맨 왼쪽으로, 로그아웃은 머리에서 메뉴 띠 맨 오른쪽으로 (PdaShell)
 * 화주사·3PL 역할은 한 계정에 섞이지 않으므로(같은 소속끼리만) 둘 중 하나만 나온다.
 */
export type PdaTabKey = "load" | "loads" | "inspect" | "inspects" | "dashboard";

export interface PdaTab {
  key: PdaTabKey;
  href: string;
  label: string;
  icon: "truck" | "list" | "chart" | "scan";
}

const LOADER_TABS: PdaTab[] = [
  { key: "dashboard", href: "/pda/dashboard", label: "대시보드", icon: "chart" },
  { key: "load", href: "/pda", label: "상차등록", icon: "truck" },
];

const INSPECTOR_TABS: PdaTab[] = [
  { key: "dashboard", href: "/pda/dashboard", label: "대시보드", icon: "chart" },
  { key: "inspect", href: "/pda/inspect", label: "입고검수", icon: "scan" },
  { key: "inspects", href: "/pda/inspect/history", label: "검수 내역", icon: "list" },
];

export const isLoader = (roles: readonly UserRole[]) => roles.includes("SHIPPER_LOADER");
export const isInspector = (roles: readonly UserRole[]) => roles.includes("TPL_INSPECTOR");

export function pdaTabs(roles: readonly UserRole[]): PdaTab[] {
  if (isLoader(roles)) return LOADER_TABS;
  if (isInspector(roles)) return INSPECTOR_TABS;
  return [];
}
