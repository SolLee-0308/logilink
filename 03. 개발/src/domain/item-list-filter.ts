import type { StorageTemp } from "@/domain/master";
import { includesText } from "@/lib/format";

/**
 * 품목 목록 조회조건 — 화면(품목 관리·품목 조회)과 엑셀 다운로드가 같은 규칙으로 거른다 (U58, 2026-11-15 Sol)
 * 화면 밖(서버 라우트)에서도 쓰므로 "use client" 파일에 두지 않는다.
 */
export type ItemTempFilter = "all" | StorageTemp;
export type ItemActiveFilter = "all" | "on" | "off";

export interface ItemFilter {
  /** 화주사 id (빈 값 = 화주사 조건 없음) */
  client: string;
  temp: ItemTempFilter;
  active: ItemActiveFilter;
  q: string;
}

interface FilterableItem {
  clientId: number;
  code: string;
  clientCode: string | null;
  name: string;
  storageTemp: StorageTemp;
  isActive: boolean;
  barcodes: { barcode: string }[];
  aliases: { alias: string }[];
}

export function matchItem(r: FilterableItem, f: ItemFilter) {
  return (
    (!f.client || r.clientId === Number(f.client)) &&
    (f.temp === "all" || r.storageTemp === f.temp) &&
    (f.active === "all" || (f.active === "on") === r.isActive) &&
    includesText([r.code, r.clientCode ?? "", r.name, ...r.barcodes.map((b) => b.barcode), ...r.aliases.map((a) => a.alias)], f.q)
  );
}

/** 주소 값 → 조회조건 (사용 여부 기본 = 사용, 2026-11-14 Sol) */
export function parseItemFilter(get: (key: string) => string): ItemFilter {
  const temp = get("temp");
  const active = get("active");
  return {
    client: get("client"),
    temp: temp === "ROOM" || temp === "CHILLED" || temp === "FROZEN" ? temp : "all",
    active: active === "all" || active === "off" ? active : "on",
    q: get("q"),
  };
}

/** 조회조건 → 주소 쿼리 (기본값은 생략) */
export function itemFilterParams(f: ItemFilter) {
  const p = new URLSearchParams();
  if (f.client) p.set("client", f.client);
  if (f.temp !== "all") p.set("temp", f.temp);
  if (f.active !== "on") p.set("active", f.active);
  if (f.q) p.set("q", f.q);
  return p;
}
