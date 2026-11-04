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
  const [rows, clients, openRequests] = await Promise.all([listItems(), listClientOptions(), canRequest ? countOpenItemRequests() : 0]);
  const temp = one(sp.temp);
  const active = one(sp.active);
  const initial: ItemListQuery = {
    client: one(sp.client),
    temp: temp === "ROOM" || temp === "CHILLED" || temp === "FROZEN" ? temp : "all",
    active: active === "on" || active === "off" ? active : "all",
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
