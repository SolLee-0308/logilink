import type { Metadata } from "next";
import { ItemsScreen } from "@/features/master/ItemsScreen";
import { listClientOptions, listItems } from "@/server/master/queries";

export const metadata: Metadata = { title: "품목" };
export const dynamic = "force-dynamic";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = Number((await searchParams).client);
  const [rows, clients] = await Promise.all([listItems(), listClientOptions()]);
  return <ItemsScreen rows={rows} clients={clients} initialClientId={Number.isInteger(client) && client > 0 ? client : undefined} />;
}
