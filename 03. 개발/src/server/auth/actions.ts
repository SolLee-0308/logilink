"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { clientIp, createSession, destroySession, getSessionUser } from "@/server/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { isWebRole } from "@/domain/permissions";
import { isValidPassword, PASSWORD_RULE_TEXT } from "@/domain/validators";
import type { LoginResult } from "@/generated/prisma/client";

/** 연속 실패 허용 횟수 — 이 횟수째 실패하면 잠근다 */
const MAX_FAIL = 5;

const LOGIN_MSG = {
  generic: "아이디 또는 비밀번호가 올바르지 않습니다",
  locked: "계정이 잠겼습니다. 관리자에게 문의하세요",
  inactive: "사용이 중지된 계정입니다. 관리자에게 문의하세요",
  clientInactive: "사용이 중지된 화주사의 계정입니다. 관리자에게 문의하세요.",
  pda: "PDA 전용 계정입니다",
} as const;

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/** 로그인 후 이동할 경로 — 같은 사이트 안의 경로만 허용한다 */
function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || s.startsWith("/login")) return "/";
  return s;
}

async function logAttempt(loginInput: string, result: LoginResult, reason: string | null, userId: number | null) {
  await db.loginLog.create({ data: { loginInput: loginInput.slice(0, 100), userId, ip: await clientIp(), result, reason } });
}

/**
 * 로그인 판정 순서
 * 1) 아이디 없음 → 공통 실패 문구 (어느 쪽이 틀렸는지 알리지 않는다)
 * 2) 잠긴 계정 → 잠금 문구
 * 3) 비밀번호 불일치 → 실패 횟수 +1, 5회째면 잠금
 * 4) 비밀번호가 맞을 때만 사용 안 함 / 사용 안 함 화주사 소속 / PDA 전용 차단 문구를 보여 준다 (계정 상태가 비밀번호 없이 드러나지 않게)
 */
export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const input = String(form.get("loginId") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!input || !password) {
    return {
      fieldErrors: {
        ...(input ? {} : { loginId: "아이디를 입력하세요" }),
        ...(password ? {} : { password: "비밀번호를 입력하세요" }),
      },
    };
  }

  const user = await db.user.findUnique({ where: { loginId: input.toLowerCase() }, include: { client: { select: { isActive: true } } } });
  if (!user) {
    await verifyPassword(password, null);
    await logAttempt(input, "FAIL", "아이디 없음", null);
    return { error: LOGIN_MSG.generic };
  }
  if (user.lockedAt) {
    await logAttempt(input, "LOCKED", "잠긴 계정 로그인 시도", user.id);
    return { error: LOGIN_MSG.locked };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const u = await db.user.update({ where: { id: user.id }, data: { failCount: { increment: 1 } } });
    if (u.failCount >= MAX_FAIL) {
      await db.user.updateMany({ where: { id: user.id, lockedAt: null }, data: { lockedAt: new Date() } });
      await db.session.deleteMany({ where: { userId: user.id } });
      await logAttempt(input, "LOCKED", `${MAX_FAIL}회 연속 실패로 잠금`, user.id);
      return { error: LOGIN_MSG.locked };
    }
    await logAttempt(input, "FAIL", `비밀번호 불일치 (${u.failCount}회 연속)`, user.id);
    return { error: LOGIN_MSG.generic };
  }

  if (!user.isActive) {
    await logAttempt(input, "BLOCKED_INACTIVE", "사용 안 함 계정", user.id);
    return { error: LOGIN_MSG.inactive };
  }
  if (user.client && !user.client.isActive) {
    await logAttempt(input, "BLOCKED_INACTIVE", "사용 안 함 화주사 소속 계정", user.id);
    return { error: LOGIN_MSG.clientInactive };
  }
  if (!isWebRole(user.role)) {
    await logAttempt(input, "BLOCKED_PDA", "PDA 전용 역할의 Web 로그인", user.id);
    return { error: LOGIN_MSG.pda };
  }

  await db.user.update({ where: { id: user.id }, data: { failCount: 0, lastLoginAt: new Date() } });
  await createSession(user.id);
  await logAttempt(input, "SUCCESS", null, user.id);
  redirect(user.mustChangePw ? `/change-password?next=${encodeURIComponent(next)}` : next);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

/** 비밀번호 변경 — 관리자 초기화 후 첫 로그인에서 강제된다 */
export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const goto = safeNext(form.get("goto"));

  const fe: Record<string, string> = {};
  if (!current) fe.current = "현재 비밀번호를 입력하세요";
  if (!isValidPassword(next)) fe.next = `비밀번호 규칙을 확인하세요 (${PASSWORD_RULE_TEXT})`;
  else if (next === current) fe.next = "현재 비밀번호와 다른 비밀번호를 입력하세요";
  if (!fe.next && next !== confirm) fe.confirm = "새 비밀번호가 서로 다릅니다";
  if (Object.keys(fe).length) return { fieldErrors: fe };

  const user = await db.user.findUnique({ where: { id: me.id } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) return { fieldErrors: { current: "현재 비밀번호가 올바르지 않습니다" } };

  await db.user.update({
    where: { id: me.id },
    data: { passwordHash: await hashPassword(next), mustChangePw: false, pwChangedAt: new Date() },
  });
  await db.changeLog.create({
    data: { tableName: "tb_user", recordKey: String(me.id), action: "PASSWORD_CHANGE", actor: me.name, after: { password: "변경" } },
  });
  redirect(goto);
}
