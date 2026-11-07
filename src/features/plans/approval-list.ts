/* 승인 대기 목록 조회조건 — 서버 페이지(주소 해석)와 화면(목록·상세)이 함께 쓴다 */
import type { ApprovalTab } from "./types";

export const APPROVAL_TABS: readonly ApprovalTab[] = ["wait", "rej", "done"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface ApprovalListQuery {
  tab: ApprovalTab;
  /** 화주사 id (화주사 찾기 창에서 고름) */
  client: string;
  /** 입고예정일 기간 YYYY-MM-DD (빈 값 = 제한 없음) */
  from: string;
  to: string;
  rev: boolean;
  /** 입고예정번호 */
  no: string;
  /** 품목코드 또는 품목명 */
  item: string;
}

/** 상세 화면에서 [← 목록]·처리 후 돌아갈 주소 */
export const APPROVAL_LIST_KEY = "logilink:approval:list";

export function approvalListSearch(f: ApprovalListQuery) {
  const p = new URLSearchParams();
  if (f.tab !== "wait") p.set("tab", f.tab);
  if (f.client) p.set("client", f.client);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.rev) p.set("rev", "1");
  if (f.no) p.set("no", f.no);
  if (f.item) p.set("item", f.item);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function approvalListUrl() {
  try {
    return sessionStorage.getItem(APPROVAL_LIST_KEY) ?? "/plans/approval";
  } catch {
    return "/plans/approval";
  }
}

/** 기간 안인지 — 시작·종료를 거꾸로 넣어도 기간으로 본다 */
export function inRange(date: string, from: string, to: string) {
  const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
  return (!lo || date >= lo) && (!hi || date <= hi);
}

export function parseApprovalListQuery(sp: Record<string, string | string[] | undefined>): ApprovalListQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") as ApprovalTab;
  return {
    tab: APPROVAL_TABS.includes(tab) ? tab : "wait",
    client: /^\d+$/.test(one("client")) ? one("client") : "",
    from: YMD.test(one("from")) ? one("from") : "",
    to: YMD.test(one("to")) ? one("to") : "",
    rev: one("rev") === "1",
    no: one("no").slice(0, 30),
    item: one("item").slice(0, 100),
  };
}
