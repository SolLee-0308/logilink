"use server";

/**
 * 편집 모달을 여는 순간 최신 데이터와 version을 다시 읽는 서버 액션.
 * 조회 권한을 확인하고, 화주사 계정은 자기 화주사 범위만 읽는다(queries의 clientScope).
 */
import { db } from "@/server/db";
import { getActor } from "@/server/session";
import { fail, type ActionResult } from "@/server/action-result";
import { can, type Resource } from "@/domain/permissions";
import { CLIENT_PREFIX_PATTERN, PREFIX_EXHAUSTED_MSG, composeClientCode, nextClientSerial } from "@/domain/client-code";
import { getCompany, listCenterRows, listClients, listCommonCodes, listItems, listSettings, listUsers } from "@/server/master/queries";
import type { CenterRow, ClientRow, CommonCodeRow, CompanyRow, ItemRow, SettingRow, UserRow } from "@/features/master/types";

async function allowed(resource: Resource) {
  const me = await getActor();
  return can(me.role, resource, "view");
}

const notFound = (what: string) => fail("NOT_FOUND", `${what}을(를) 찾을 수 없습니다. 목록을 새로 고쳐 보세요.`);

export async function loadCompany(): Promise<ActionResult<CompanyRow>> {
  if (!(await allowed("company"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const row = await getCompany();
  return row ? { ok: true, message: "", data: row } : notFound("회사 정보");
}

export async function loadClient(id: number): Promise<ActionResult<ClientRow>> {
  if (!(await allowed("clients"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const [row] = await listClients(id);
  return row ? { ok: true, message: "", data: row } : notFound("화주사");
}

export async function loadCenter(id: number): Promise<ActionResult<CenterRow>> {
  if (!(await allowed("centers"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const [row] = await listCenterRows(id);
  return row ? { ok: true, message: "", data: row } : notFound("센터");
}

export async function loadUser(id: number): Promise<ActionResult<UserRow>> {
  if (!(await allowed("users"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const [row] = await listUsers(id);
  return row ? { ok: true, message: "", data: row } : notFound("사용자");
}

export async function loadItem(id: number): Promise<ActionResult<ItemRow>> {
  if (!(await allowed("master"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const [row] = await listItems(id);
  return row ? { ok: true, message: "", data: row } : notFound("품목");
}

export async function loadCommonCode(id: number): Promise<ActionResult<CommonCodeRow>> {
  if (!(await allowed("master"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const [row] = await listCommonCodes(id);
  return row ? { ok: true, message: "", data: row } : notFound("사유 코드");
}

export async function loadSetting(key: string): Promise<ActionResult<SettingRow>> {
  if (!(await allowed("master"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const [row] = await listSettings(key);
  return row ? { ok: true, message: "", data: row } : notFound("운영 설정");
}

/** 등록 모달: 약어의 다음 순번 미리 보기 (최종 순번은 저장 시 서버에서 확정) */
export async function previewClientCode(prefix: string): Promise<ActionResult<{ code: string | null; serial: string | null; error: string | null }>> {
  if (!(await allowed("clients"))) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  const p = prefix.trim().toUpperCase();
  if (!CLIENT_PREFIX_PATTERN.test(p)) return { ok: true, message: "", data: { code: null, serial: null, error: null } };
  const used = await db.client.findMany({ where: { code: { startsWith: p } }, select: { code: true } });
  const n = nextClientSerial(p, used.map((u) => u.code));
  if (n === null) return { ok: true, message: "", data: { code: null, serial: null, error: PREFIX_EXHAUSTED_MSG } };
  const code = composeClientCode(p, n);
  return { ok: true, message: "", data: { code, serial: code.slice(2), error: null } };
}
