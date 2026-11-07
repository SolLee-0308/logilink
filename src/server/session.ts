import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { isPdaRole, isWebRole } from "@/domain/permissions";
import type { UserRole } from "@/domain/master";

/**
 * 로그인 세션 — 쿠키에는 무작위 토큰만 두고, DB(tb_session)에는 토큰의 HMAC만 저장한다.
 * 세션 행을 지우면 즉시 로그아웃된다 (비밀번호 초기화·잠금 시).
 */
export const SESSION_COOKIE = "ll_session";
const TTL_MS = 12 * 60 * 60 * 1000; // 12시간 (무활동 타임아웃은 추후 범위)

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET이 설정되지 않았습니다 (.env).");
  return s;
}

const sessionId = (token: string) => createHmac("sha256", secret()).update(token).digest("hex");

export interface SessionUser {
  id: number;
  loginId: string;
  name: string;
  /** 역할 (여러 개일 수 있음, 같은 소속끼리만) */
  roles: UserRole[];
  clientId: number | null;
  clientName: string | null;
  centerId: number | null;
  centerName: string | null;
  mustChangePw: boolean;
}

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null)?.slice(0, 64) ?? null;
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({ data: { id: sessionId(token), userId, expiresAt, ip: await clientIp() } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sessionId(token) } });
  store.delete(SESSION_COOKIE);
}

/** 세션 사용자 (Web·PDA 구분 전) — 만료·사용 안 함·잠금·사용 안 함 화주사 소속이면 null. 요청 안에서 한 번만 읽는다 */
const readSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({
    where: { id: sessionId(token) },
    include: { user: { include: { client: { select: { name: true, isActive: true } }, center: { select: { name: true } } } } },
  });
  if (!s || s.expiresAt < new Date()) return null;
  const u = s.user;
  // 사용 안 함 계정·잠금·사용 안 함 화주사 소속이면 세션을 인정하지 않는다
  if (!u.isActive || u.lockedAt || (u.client && !u.client.isActive)) return null;
  return {
    id: u.id,
    loginId: u.loginId,
    name: u.name,
    roles: u.roles,
    clientId: u.clientId,
    clientName: u.client?.name ?? null,
    centerId: u.centerId,
    centerName: u.center?.name ?? null,
    mustChangePw: u.mustChangePw,
  };
});

/** Web 세션 사용자 — Web 역할이 없으면(PDA 전용 계정) null */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const u = await readSessionUser();
  return u && isWebRole(u.roles) ? u : null;
});

/** PDA 세션 사용자 — PDA 역할이 없으면 null (Web·PDA 역할을 함께 가진 계정은 둘 다 쓸 수 있다) */
export const getPdaSessionUser = cache(async (): Promise<SessionUser | null> => {
  const u = await readSessionUser();
  return u && isPdaRole(u.roles) ? u : null;
});

/** 비밀번호 변경 화면용 — Web·PDA 어느 쪽이든 */
export const getAnySessionUser = readSessionUser;

/** PDA 화면용: 로그인이 없으면 /pda/login, 비밀번호 변경이 필요하면 /change-password?next=/pda */
export async function requirePdaUser(): Promise<SessionUser> {
  const u = await getPdaSessionUser();
  if (!u) {
    const path = await currentPath();
    redirect(path.startsWith("/pda/") ? `/pda/login?next=${encodeURIComponent(path)}` : "/pda/login");
  }
  if (u.mustChangePw) redirect("/change-password?next=/pda/dashboard");
  return u;
}

/** PDA 서버 액션용 처리자 */
export async function getPdaActor(): Promise<SessionUser> {
  const u = await getPdaSessionUser();
  if (!u) redirect("/pda/login");
  if (u.mustChangePw) redirect("/change-password?next=/pda/dashboard");
  return u;
}

/** 로그인 후 돌아올 경로 — proxy가 넣어 준 x-pathname */
async function currentPath() {
  return (await headers()).get("x-pathname") || "/";
}

export async function loginUrl(next?: string) {
  const path = next ?? (await currentPath());
  return path && path !== "/" ? `/login?next=${encodeURIComponent(path)}` : "/login";
}

/** 화면용: 로그인이 없으면 /login, 비밀번호 변경이 필요하면 /change-password로 보낸다 */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect(await loginUrl());
  if (u.mustChangePw) {
    const path = await currentPath();
    redirect(path && path !== "/" ? `/change-password?next=${encodeURIComponent(path)}` : "/change-password");
  }
  return u;
}

/** 서버 액션용 처리자 — 화면과 같은 기준으로 확인한다 */
export async function getActor(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (u.mustChangePw) redirect("/change-password");
  return u;
}
