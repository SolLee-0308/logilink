import { can } from "@/domain/permissions";
import { rcvImage } from "@/server/rcv/queries";
import { getAnySessionUser } from "@/server/session";

/**
 * 훼손 사진 한 장 — 입고검수자(소속 센터), 3PL 웹(ASN·상차 현황 권한, 소속 센터), 화주사 담당자(자기 화주사)만 본다.
 * PDA·웹 화면 모두 <img src="/rcv-image/{id}">로 쓴다.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getAnySessionUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("잘못된 요청입니다.", { status: 400 });
  const img = await rcvImage(id);
  if (!img) return new Response("사진을 찾을 수 없습니다.", { status: 404 });
  const centerOk = !me.centerId || me.centerId === img.rcv.centerId;
  const allowed =
    ((can(me.roles, "inspection", "view") || can(me.roles, "asnStatus", "view")) && centerOk) || (can(me.roles, "asn", "view") && me.clientId === img.rcv.clientId);
  if (!allowed) return new Response("권한이 없습니다.", { status: 403 });
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=3600" } });
}
