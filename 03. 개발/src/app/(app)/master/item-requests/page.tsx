import type { Metadata } from "next";
import { ItemRequestsScreen } from "@/features/master/ItemRequestsScreen";
import { ITEM_REQ_REJECT_GROUP } from "@/domain/master";
import { listClientOptions, listCodeOptions, listItemKeys, listItemRequests } from "@/server/master/queries";

export const metadata: Metadata = { title: "품목 등록 요청" };
export const dynamic = "force-dynamic";

export default async function ItemRequestsPage() {
  const [rows, clients, itemKeys, reasons] = await Promise.all([
    listItemRequests(),
    listClientOptions(),
    listItemKeys(),
    listCodeOptions(ITEM_REQ_REJECT_GROUP),
  ]);
  return <ItemRequestsScreen rows={rows} clients={clients} itemKeys={itemKeys} reasons={reasons} />;
}
