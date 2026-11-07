/* 입고예정 조회 조회조건 — 서버 페이지(주소 해석)와 화면이 함께 쓴다 */
import { ASN_STATE_FILTERS, DEFAULT_RANGE_DAYS, PLAN_STATE_FILTERS, addDays } from "@/domain/inquiry-rules";
import type { InquiryTab } from "./types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface InquiryQuery {
  tab: InquiryTab;
  /** 상태 조건 (탭마다 선택지가 다르다, 기본 open = 미종결) */
  st: string;
  /** 기간 — 품목별: 입고예정일 / 차량별: 출고일. 빈 값 = 제한 없음 */
  from: string;
  to: string;
  /** 화주사 id ("" = 전체, 화주사 계정은 무시) */
  client: string;
  /** 센터 id ("" = 전체) */
  center: string;
  /** 번호 검색 — 입고예정번호·ASN번호·차량번호 */
  q: string;
  /** 품목코드·품목명 */
  item: string;
}

/** 상세에서 [← 목록]으로 돌아갈 주소 */
export const INQUIRY_LIST_KEY = "logilink:inquiry:list";

/** 처음 들어올 때 — 품목별 탭·미종결·오늘 ±7일 */
export const defaultInquiry = (today: string): InquiryQuery => ({
  tab: "plan",
  st: "open",
  from: addDays(today, -DEFAULT_RANGE_DAYS),
  to: addDays(today, DEFAULT_RANGE_DAYS),
  client: "",
  center: "",
  q: "",
  item: "",
});

/** 기간은 기본값과 다를 때만 주소에 남긴다 — 빈 기간은 "-"로 표시 */
export function inquirySearch(f: InquiryQuery, today: string) {
  const d = defaultInquiry(today);
  const p = new URLSearchParams();
  if (f.tab !== "plan") p.set("tab", f.tab);
  if (f.st !== "open") p.set("st", f.st);
  if (f.from !== d.from) p.set("from", f.from || "-");
  if (f.to !== d.to) p.set("to", f.to || "-");
  if (f.client) p.set("client", f.client);
  if (f.center) p.set("center", f.center);
  if (f.q) p.set("q", f.q);
  if (f.item) p.set("item", f.item);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function parseInquiryQuery(sp: Record<string, string | string[] | undefined>, today: string): InquiryQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const d = defaultInquiry(today);
  const tab: InquiryTab = one("tab") === "vehicle" ? "vehicle" : "plan";
  const states: readonly string[] = tab === "vehicle" ? ASN_STATE_FILTERS : PLAN_STATE_FILTERS;
  const date = (k: "from" | "to") => (one(k) === "-" ? "" : YMD.test(one(k)) ? one(k) : d[k]);
  return {
    tab,
    st: states.includes(one("st")) ? one("st") : "open",
    from: date("from"),
    to: date("to"),
    client: /^\d+$/.test(one("client")) ? one("client") : "",
    center: /^\d+$/.test(one("center")) ? one("center") : "",
    q: one("q").slice(0, 30),
    item: one("item").slice(0, 100),
  };
}
