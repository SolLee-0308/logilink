import { NextResponse, type NextRequest } from "next/server";

/**
 * 1차(낙관적) 확인 — 세션 쿠키가 없으면 /login?next=원래경로 로 보낸다.
 * 세션이 실제로 유효한지는 서버(requireUser·getActor)가 DB로 다시 확인한다.
 * 화면이 로그인 후 돌아올 경로를 알 수 있도록 x-pathname 헤더를 넘긴다.
 */
const SESSION_COOKIE = "ll_session";
const PUBLIC = ["/login", "/pda/login"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const path = pathname + search;

  if (!PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    // PDA 화면은 PDA 로그인으로 보낸다
    const pda = pathname === "/pda" || pathname.startsWith("/pda/");
    url.pathname = pda ? "/pda/login" : "/login";
    url.search = pathname === "/" || pathname === "/pda" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/|.*\\.(?:svg|png|jpg|woff2?)$).*)"],
};
