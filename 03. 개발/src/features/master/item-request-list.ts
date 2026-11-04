import { ITEM_REQUEST_SOURCES, type ItemRequestSource } from "@/domain/master";

/* 품목 등록 요청 목록 조회조건 — 서버 페이지(주소 해석)와 화면(목록·상세)이 함께 쓴다 */

export type ReqTab = "wait" | "rej" | "done";
export const REQ_TABS: readonly ReqTab[] = ["wait", "rej", "done"];
export type SourceFilter = "all" | ItemRequestSource;

/** 목록 조회조건 — 주소(?tab=&client=&source=&q=)에 남겨 상세에서 돌아와도 그대로 */
export interface ReqListQuery {
  tab: ReqTab | null;
  client: string;
  source: SourceFilter;
  q: string;
}

/** 상세·재요청 화면에서 [← 목록]·처리 후 돌아갈 주소 */
export const REQ_LIST_KEY = "logilink:item-requests:list";

export function reqListSearch(f: ReqListQuery) {
  const p = new URLSearchParams();
  if (f.tab) p.set("tab", f.tab);
  if (f.client) p.set("client", f.client);
  if (f.source !== "all") p.set("source", f.source);
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** 기억해 둔 목록 주소 (tab을 주면 그 탭으로) */
export function reqListUrl(tab?: ReqTab) {
  let url = "/master/item-requests";
  try {
    url = sessionStorage.getItem(REQ_LIST_KEY) ?? url;
  } catch {
    /* 저장소를 못 쓰면 기본 목록 */
  }
  const u = new URL(url, "http://x");
  if (tab) u.searchParams.set("tab", tab);
  return u.pathname + u.search;
}

export function parseReqListQuery(sp: Record<string, string | string[] | undefined>): ReqListQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") as ReqTab;
  const source = one("source") as ItemRequestSource;
  return {
    tab: REQ_TABS.includes(tab) ? tab : null,
    client: /^\d+$/.test(one("client")) ? one("client") : "",
    source: ITEM_REQUEST_SOURCES.includes(source) ? source : "all",
    q: one("q").slice(0, 100),
  };
}

