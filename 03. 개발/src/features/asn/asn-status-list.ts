/* ASN·상차 현황(3PL) 조회조건 — 서버 페이지(주소 해석)와 화면이 함께 쓴다 */
import type { AsnStatusTab } from "./types";

export const ASN_STATUS_TABS: readonly AsnStatusTab[] = ["wait", "loading", "loaded", "done", "canceled"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface AsnStatusQuery {
  tab: AsnStatusTab | null;
  /** 화주사 id ("" = 전체) */
  client: string;
  q: string;
  item: string;
  from: string;
  to: string;
}

/** 상세 화면에서 [← 목록]으로 돌아갈 주소 */
export const ASN_STATUS_LIST_KEY = "logilink:asn-status:list";

export function asnStatusSearch(f: AsnStatusQuery) {
  const p = new URLSearchParams();
  if (f.tab) p.set("tab", f.tab);
  if (f.client) p.set("client", f.client);
  if (f.q) p.set("q", f.q);
  if (f.item) p.set("item", f.item);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function parseAsnStatusQuery(sp: Record<string, string | string[] | undefined>): AsnStatusQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") as AsnStatusTab;
  return {
    tab: ASN_STATUS_TABS.includes(tab) ? tab : null,
    client: /^\d+$/.test(one("client")) ? one("client") : "",
    q: one("q").slice(0, 30),
    item: one("item").slice(0, 100),
    from: YMD.test(one("from")) ? one("from") : "",
    to: YMD.test(one("to")) ? one("to") : "",
  };
}
