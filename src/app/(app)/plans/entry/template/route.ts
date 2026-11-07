import { can } from "@/domain/permissions";
import { buildPlanTemplate } from "@/server/plans/entry";
import { getSessionUser } from "@/server/session";

/** 입고예정 엑셀 양식 내려받기 (화주사) */
export async function GET() {
  const me = await getSessionUser();
  if (!me || !can(me.roles, "planEntry", "view")) return new Response("권한이 없습니다.", { status: 403 });
  const body = await buildPlanTemplate();
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plan-template.xlsx"; filename*=UTF-8''${encodeURIComponent("입고예정_양식.xlsx")}`,
      "Cache-Control": "no-store",
    },
  });
}
