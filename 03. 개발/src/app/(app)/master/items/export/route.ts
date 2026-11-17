import { can } from "@/domain/permissions";
import { matchItem, parseItemFilter } from "@/domain/item-list-filter";
import { buildItemListExport } from "@/server/master/excel";
import { listClientOptions, listItems } from "@/server/master/queries";
import { getSessionUser } from "@/server/session";

/**
 * 품목 목록 엑셀 다운로드 (U58, 2026-11-15 Sol)
 * - 범위: 화주사는 자기 품목만(listItems가 세션으로 막음), 3PL은 고른 화주사의 품목
 * - 화면 조회조건(?client=&temp=&active=&q=)에 걸린 품목만 내려받는다
 * - 내려받기 전용 — 고쳐서 다시 올리는 기능은 없다
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });
  if (!can(me.roles, "items", "view")) return new Response("권한이 없습니다.", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const filter = parseItemFilter((k) => sp.get(k) ?? "");
  const clients = await listClientOptions();
  // 화주사가 여럿이면(3PL) 화면과 같이 화주사를 먼저 골라야 한다
  const picked = clients.length <= 1 ? clients[0] : clients.find((c) => String(c.id) === filter.client);
  if (!picked) return new Response("화주사를 먼저 고르세요.", { status: 400 });

  const rows = (await listItems(undefined, picked.id)).filter((r) => matchItem(r, { ...filter, client: "" }));
  const body = await buildItemListExport(rows, "품목 목록");

  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()).replaceAll("-", "");
  const name = `품목목록_${picked.name}_${today}.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="items.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
