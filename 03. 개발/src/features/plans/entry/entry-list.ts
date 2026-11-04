/* 입고예정 등록 목록 조회조건 — 서버 페이지(주소 해석)와 화면(목록·상세)이 함께 쓴다 */
import type { EntryTab } from "../types";

export const ENTRY_TABS: readonly EntryTab[] = ["wait", "rej", "approved", "canceled"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface EntryListQuery {
  tab: EntryTab | null;
  /** 센터 id · "all"(전체를 직접 고름) · ""(주소에 없음 → 사용자 기본 센터) */
  center: string;
  no: string;
  item: string;
  from: string;
  to: string;
}

/** 등록·상세 화면에서 [← 목록]·저장 후 돌아갈 주소 */
export const ENTRY_LIST_KEY = "logilink:plan-entry:list";

export function entryListSearch(f: EntryListQuery) {
  const p = new URLSearchParams();
  if (f.tab) p.set("tab", f.tab);
  if (f.center) p.set("center", f.center);
  if (f.no) p.set("no", f.no);
  if (f.item) p.set("item", f.item);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** 기억해 둔 목록 주소 (tab을 주면 그 탭으로) */
export function entryListUrl(tab?: EntryTab) {
  let url = "/plans/entry";
  try {
    url = sessionStorage.getItem(ENTRY_LIST_KEY) ?? url;
  } catch {
    /* 저장소를 못 쓰면 기본 목록 */
  }
  const u = new URL(url, "http://x");
  if (tab) u.searchParams.set("tab", tab);
  return u.pathname + u.search;
}

export function parseEntryListQuery(sp: Record<string, string | string[] | undefined>): EntryListQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") as EntryTab;
  const center = one("center");
  return {
    tab: ENTRY_TABS.includes(tab) ? tab : null,
    center: center === "all" || /^\d+$/.test(center) ? center : "",
    no: one("no").slice(0, 30),
    item: one("item").slice(0, 100),
    from: YMD.test(one("from")) ? one("from") : "",
    to: YMD.test(one("to")) ? one("to") : "",
  };
}
