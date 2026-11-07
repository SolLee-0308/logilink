import { can } from "@/domain/permissions";
import { buildTemplate } from "@/server/master/excel";
import { getSessionUser } from "@/server/session";

/** 품목 엑셀 양식 내려받기 — 3PL은 일괄 등록 양식, 화주사는 등록 요청 양식 */
export async function GET() {
  const me = await getSessionUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });
  const kind = can(me.roles, "items", "edit") ? "ITEM" : can(me.roles, "itemRequests", "edit") ? "REQUEST" : null;
  if (!kind) return new Response("권한이 없습니다.", { status: 403 });
  const body = await buildTemplate(kind);
  const name = kind === "ITEM" ? "품목_일괄등록_양식.xlsx" : "품목_등록요청_양식.xlsx";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
