import type { Metadata } from "next";
import { ItemsScreen, type ItemListQuery } from "@/features/master/ItemsScreen";
import { itemsTitle } from "@/domain/master";
import { Forbidden } from "@/features/master/Forbidden";
import { can } from "@/domain/permissions";
import { countOpenItemRequests, listClientOptions, listItems } from "@/server/master/queries";
import { requireUser } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const me = await requireUser();
  return { title: itemsTitle(can(me.roles, "items", "edit")) };
}
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!can(me.roles, "items", "view")) return <Forbidden title="품목 조회" />;
  const sp = await searchParams;
  const canRequest = can(me.roles, "itemRequests", "edit");
  const [clients, openRequests] = await Promise.all([listClientOptions(), canRequest ? countOpenItemRequests() : 0]);
  // 화주사가 여럿이면(3PL) 화주사를 먼저 고른다 — 고르기 전에는 품목을 읽지 않는다 (2026-11-14 Sol, 목록이 커지는 것 방지)
  const picked = clients.find((c) => String(c.id) === one(sp.client));
  const rows = clients.length <= 1 ? await listItems() : picked ? await listItems(undefined, picked.id) : [];
  const temp = one(sp.temp);
  const active = one(sp.active);
  const initial: ItemListQuery = {
    client: one(sp.client),
    temp: temp === "ROOM" || temp === "CHILLED" || temp === "FROZEN" ? temp : "all",
    // 사용 여부 기본 = 사용 (2026-11-14 Sol). 전체는 주소에 active=all
    active: active === "all" || active === "off" ? active : "on",
    q: one(sp.q),
    item: Number(one(sp.item)) > 0 ? Number(one(sp.item)) : null,
  };
  return (
    <ItemsScreen
      rows={rows}
      clients={clients}
      initial={initial}
      canEdit={can(me.roles, "items", "edit")}
      canRequest={canRequest}
      openRequests={openRequests}
    />
  );
}
