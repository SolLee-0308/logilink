/* ASN 목록 조회조건 — 서버 페이지(주소 해석)와 화면(목록·상세)이 함께 쓴다 */
import type { AsnTab } from "./types";

export const ASN_TABS: readonly AsnTab[] = ["wait", "loading", "done", "canceled"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface AsnListQuery {
  tab: AsnTab | null;
  /** 센터 id · "all"(전체를 직접 고름) · ""(주소에 없음 → 사용자 기본 센터) */
  center: string;
  /** ASN번호·차량번호·입고예정번호 */
  q: string;
  item: string;
  from: string;
  to: string;
}

/** 등록·상세 화면에서 [← 목록]·저장 후 돌아갈 주소 */
export const ASN_LIST_KEY = "logilink:asn:list";

export function asnListSearch(f: AsnListQuery) {
  const p = new URLSearchParams();
  if (f.tab) p.set("tab", f.tab);
  if (f.center) p.set("center", f.center);
  if (f.q) p.set("q", f.q);
  if (f.item) p.set("item", f.item);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** 기억해 둔 목록 주소 (tab을 주면 그 탭으로) */
export function asnListUrl(tab?: AsnTab) {
  let url = "/plans/asn";
  try {
    url = sessionStorage.getItem(ASN_LIST_KEY) ?? url;
  } catch {
    /* 저장소를 못 쓰면 기본 목록 */
  }
  const u = new URL(url, "http://x");
  if (tab) u.searchParams.set("tab", tab);
  return u.pathname + u.search;
}

export function parseAsnListQuery(sp: Record<string, string | string[] | undefined>): AsnListQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") as AsnTab;
  const center = one("center");
  return {
    tab: ASN_TABS.includes(tab) ? tab : null,
    center: center === "all" || /^\d+$/.test(center) ? center : "",
    q: one("q").slice(0, 30),
    item: one("item").slice(0, 100),
    from: YMD.test(one("from")) ? one("from") : "",
    to: YMD.test(one("to")) ? one("to") : "",
  };
}

/** ASN번호·차량번호·입고예정번호 검색 — 공백·하이픈은 무시 */
export function matchAsnText(r: { asnNo: string; vehicleNo: string; loadOrderNo: string | null; planNos: string[] }, q: string) {
  const n = q.replace(/[\s-]/g, "").toUpperCase();
  if (!n) return true;
  return [r.asnNo, r.vehicleNo, r.loadOrderNo ?? "", ...r.planNos].some((t) => t.replace(/[\s-]/g, "").toUpperCase().includes(n));
}
