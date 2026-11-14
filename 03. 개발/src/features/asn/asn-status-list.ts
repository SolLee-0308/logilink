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

/** 출고일 기본 기간 — 오늘 ±3일 (2026-11-14 Sol). 서버가 이 기간만 읽는다 */
export const ASN_STATUS_RANGE_DAYS = 3;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const defaultAsnStatusRange = (today: string) => ({ from: addDays(today, -ASN_STATUS_RANGE_DAYS), to: addDays(today, ASN_STATUS_RANGE_DAYS) });

/** 기간은 기본값과 다를 때만 주소에 남긴다 — 빈 기간은 "-" */
export function asnStatusSearch(f: AsnStatusQuery, today: string) {
  const d = defaultAsnStatusRange(today);
  const p = new URLSearchParams();
  if (f.tab) p.set("tab", f.tab);
  if (f.client) p.set("client", f.client);
  if (f.q) p.set("q", f.q);
  if (f.item) p.set("item", f.item);
  if (f.from !== d.from) p.set("from", f.from || "-");
  if (f.to !== d.to) p.set("to", f.to || "-");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function parseAsnStatusQuery(sp: Record<string, string | string[] | undefined>, today: string): AsnStatusQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = one("tab") as AsnStatusTab;
  const d = defaultAsnStatusRange(today);
  const date = (k: "from" | "to") => (one(k) === "-" ? "" : YMD.test(one(k)) ? one(k) : d[k]);
  return {
    tab: ASN_STATUS_TABS.includes(tab) ? tab : null,
    client: /^\d+$/.test(one("client")) ? one("client") : "",
    q: one("q").slice(0, 30),
    item: one("item").slice(0, 100),
    from: date("from"),
    to: date("to"),
  };
}
