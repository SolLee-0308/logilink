"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { getActor, type SessionUser } from "@/server/session";
import { hashPassword, tempPassword } from "@/server/auth/password";
import { can, canReviewItemRequests, isShipperRole, type Op, type Resource } from "@/domain/permissions";
import { MSG, addressErrors, formatBizNo, formatPhone, isValidBizNo, isValidEmail, isValidPhone, isValidTime, textError } from "@/domain/validators";
import { fail, type ActionResult } from "@/server/action-result";
import { BARCODE_PATTERN, ITEM_REQ_REJECT_GROUP, ITEM_UNITS, ROLE_META, STORAGE_TEMPS, USER_ROLES, isManagerCandidate, normalizeAlias, sortRoles } from "@/domain/master";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/domain/master";
import { CLIENT_PREFIX_PATTERN, PREFIX_EXHAUSTED_MSG, composeClientCode, nextClientSerial } from "@/domain/client-code";
import { deactivateBlock, removeCenterBlock } from "@/domain/unclosed";
import { countUnclosed } from "@/server/master/unclosed";
import { fetchPublicHolidays } from "@/server/master/public-holidays";
import { todayKst } from "@/lib/format";
import { BULK_MAX_ROWS, fileDuplicates, parseItemRow, parseRequestRow, type BulkKind, type RawRow, type RequestDraft } from "@/domain/item-bulk";
import { readRows } from "@/server/master/excel";
import type { BulkPreview } from "@/features/master/types";

type Tx = Prisma.TransactionClient;

/* ───────── 공통 ───────── */

const trimmed = (max: number, label: string) =>
  z.string().trim().min(1, `${label}을(를) 입력하세요.`).max(max, `${label}은(는) ${max}자 이내로 입력하세요.`);

function fieldErrors(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function invalid(err: z.ZodError) {
  return fail("VALIDATION", "입력 내용을 확인하세요.", fieldErrors(err));
}

const conflict = () => fail("CONFLICT", "다른 사용자가 먼저 수정했습니다. 최신 내용을 불러옵니다.");

const forbidden = () => fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");

/** 처리자 + 권한 확인 — 화면 숨김과 별개로 서버에서 다시 검사한다 */
async function actorFor(resource: Resource, op: Op): Promise<SessionUser | null> {
  const me = await getActor();
  return can(me.roles, resource, op) ? me : null;
}

/** 화주사 계정은 자기 화주사 데이터만 바꿀 수 있다 */
const outOfScope = (me: SessionUser, clientId: number | null | undefined) =>
  isShipperRole(me.roles) && clientId !== me.clientId;

async function log(tx: Tx, tableName: string, recordKey: string, action: string, actor: string, before: object | null, after: object | null) {
  await tx.changeLog.create({
    data: {
      tableName,
      recordKey,
      action,
      actor,
      before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** 바뀐 필드만 남긴다 */
function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (before[k] !== after[k]) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return Object.keys(a).length ? { b, a } : null;
}

function done<T>(message: string, data?: T): ActionResult<T> {
  // 사이드바 건수도 함께 갱신되도록 앱 전체 레이아웃을 다시 그린다
  revalidatePath("/", "layout");
  return { ok: true, message, data };
}

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    // 확인과 갱신 사이에 다른 처리가 끼어든 경우 — 트랜잭션은 이미 롤백됨
    if (e instanceof Error && e.message === "CONFLICT_RACE")
      return fail("CONFLICT", "다른 사용자가 먼저 처리했습니다. 최신 내용을 불러온 뒤 다시 처리하세요.");
    console.error(e);
    const code = (e as { code?: string }).code;
    if (code === "P2002") return fail("VALIDATION", "같은 값이 이미 등록되어 있습니다.");
    return fail("ERROR", "저장하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

/* ───────── 화주사 (3PL 관리자만 등록·수정) ───────── */

interface ClientInput {
  id?: number;
  version?: number;
  /** 등록 시 영문 2자 (순번은 서버가 확정) */
  prefix?: string;
  name: string;
  bizNo: string;
  ceoName: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  tel: string;
  email: string;
  contactName: string;
  contactTel: string;
  contactEmail: string;
  managerUserId: number | null;
  centerCodes: string[];
  /** YYYY-MM-DD */
  contractStartDt: string;
  contractEndDt: string;
  isActive: boolean;
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const ymdDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** 화면과 같은 규칙으로 다시 검증 (validators.ts·client-code.ts) */
function clientErrors(v: ClientInput, isNew: boolean) {
  const e: Record<string, string> = {};
  if (isNew && !CLIENT_PREFIX_PATTERN.test((v.prefix ?? "").trim().toUpperCase())) e.prefix = "영문 대문자 2자를 입력하세요";
  const name = textError(v.name, "화주사명", 50);
  if (name) e.name = name;
  if (!isValidBizNo(v.bizNo)) e.bizNo = MSG.bizNo;
  const ceo = textError(v.ceoName, "대표자명", 20);
  if (ceo) e.ceoName = ceo;
  Object.assign(e, addressErrors(v));
  if (v.tel.trim() && !isValidPhone(v.tel)) e.tel = MSG.phone;
  if (v.email.trim() && !isValidEmail(v.email.trim())) e.email = MSG.email;
  const cn = textError(v.contactName, "화주사 담당자명", 20);
  if (cn) e.contactName = cn;
  if (!isValidPhone(v.contactTel)) e.contactTel = v.contactTel.trim() ? MSG.phone : "담당자 전화를 입력하세요";
  if (v.contactEmail.trim() && !isValidEmail(v.contactEmail.trim())) e.contactEmail = MSG.email;
  if (v.centerCodes.length === 0) e.centerCodes = "이용 센터를 1개 이상 고르세요";
  if (!v.managerUserId) e.managerUserId = "3PL 담당 운영자를 고르세요";
  if (!isYmd(v.contractStartDt)) e.contractStartDt = "계약 시작일을 입력하세요";
  if (v.contractEndDt && !isYmd(v.contractEndDt)) e.contractEndDt = "날짜 형식을 확인하세요";
  else if (v.contractEndDt && isYmd(v.contractStartDt) && v.contractEndDt < v.contractStartDt) e.contractEndDt = "계약 종료일은 시작일 이후로 입력하세요";
  return e;
}

export async function saveClient(input: ClientInput): Promise<ActionResult<{ id: number; code: string }>> {
  const me = await actorFor("clients", "edit");
  if (!me) return forbidden();
  const isNew = !input.id;
  const errs = clientErrors(input, isNew);
  if (Object.keys(errs).length) return fail("VALIDATION", "입력 내용을 확인하세요.", errs);

  const centerCodes = [...new Set(input.centerCodes)].sort();
  const v = {
    name: input.name.trim(),
    bizNo: formatBizNo(input.bizNo),
    ceoName: input.ceoName.trim(),
    zipCode: input.zipCode,
    addr1: input.addr1.trim(),
    addr2: input.addr2.trim(),
    tel: input.tel.trim() ? formatPhone(input.tel) : null,
    email: input.email.trim() || null,
    contactName: input.contactName.trim(),
    contactTel: formatPhone(input.contactTel),
    contactEmail: input.contactEmail.trim() || null,
    managerUserId: input.managerUserId!,
    contractStartDt: ymdDate(input.contractStartDt),
    contractEndDt: input.contractEndDt ? ymdDate(input.contractEndDt) : null,
    isActive: input.isActive,
  };

  /** 이력용 스냅샷 — 날짜는 문자열, 담당 운영자는 이름, 이용 센터는 코드 목록 */
  const snap = (x: typeof v, managerName: string, centers: string[]) => ({
    name: x.name, bizNo: x.bizNo, ceoName: x.ceoName, zipCode: x.zipCode, addr1: x.addr1, addr2: x.addr2,
    tel: x.tel, email: x.email, contactName: x.contactName, contactTel: x.contactTel, contactEmail: x.contactEmail,
    manager: managerName, contractStartDt: x.contractStartDt.toISOString().slice(0, 10),
    contractEndDt: x.contractEndDt ? x.contractEndDt.toISOString().slice(0, 10) : null,
    centers: centers.join(", "), isActive: x.isActive,
  });

  type Refs = { ok: false; errors: Record<string, string> } | { ok: true; managerName: string };
  async function checkRefs(tx: Tx, keepCenters: string[]): Promise<Refs> {
    // 이용 센터: 새로 넣는 센터는 사용 중이어야 한다 (이미 연결된 센터는 그대로 둘 수 있다)
    const centers = await tx.center.findMany({ where: { code: { in: centerCodes } } });
    if (centers.length !== centerCodes.length) return { ok: false, errors: { centerCodes: "센터를 찾을 수 없습니다. 목록을 새로 고쳐 보세요" } };
    const inactiveNew = centers.find((c) => !c.isActive && !keepCenters.includes(c.code));
    if (inactiveNew) return { ok: false, errors: { centerCodes: `${inactiveNew.name}은(는) 사용 안 함 센터라 고를 수 없습니다` } };
    // 3PL 담당 운영자: 사용 중 · 이용 센터 중 한 곳 소속 · 3PL 관리자/운영담당
    const m = await tx.user.findUnique({ where: { id: v.managerUserId }, include: { center: true } });
    const ok = m && m.isActive && isManagerCandidate(m.roles) && m.center && centerCodes.includes(m.center.code);
    if (!ok) return { ok: false, errors: { managerUserId: "이용 센터에 소속된 3PL 관리자·운영담당 중에서 고르세요" } };
    return { ok: true, managerName: m.name };
  }

  if (isNew) {
    const prefix = input.prefix!.trim().toUpperCase();
    // 같은 약어로 동시에 등록하면 유니크 제약에 걸린다 → 다음 순번으로 다시 시도
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await db.$transaction(async (tx) => {
          const refs = await checkRefs(tx, []);
          if (!refs.ok) return fail("VALIDATION", "입력 내용을 확인하세요.", refs.errors);
          const used = await tx.client.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } });
          const serial = nextClientSerial(prefix, used.map((u) => u.code));
          if (serial === null) return fail("VALIDATION", "입력 내용을 확인하세요.", { prefix: PREFIX_EXHAUSTED_MSG });
          const code = composeClientCode(prefix, serial);
          const row = await tx.client.create({
            data: { ...v, code, createdBy: me.name, updatedBy: me.name, centers: { create: centerCodes.map((c) => ({ centerCode: c, createdBy: me.name })) } },
          });
          await log(tx, "tb_client", String(row.id), "CREATE", me.name, null, { code, ...snap(v, refs.managerName, centerCodes) });
          return done(`화주사 ${row.name}을(를) 코드 ${code}(으)로 등록했습니다.`, { id: row.id, code });
        });
        return r;
      } catch (e) {
        if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
        console.error(e);
        return fail("ERROR", "저장하지 못했습니다. 잠시 후 다시 시도하세요.");
      }
    }
  }

  return run(() =>
    db.$transaction(async (tx) => {
      const cur = await tx.client.findUnique({ where: { id: input.id }, include: { centers: true, manager: { select: { name: true } } } });
      if (!cur) return fail("NOT_FOUND", "화주사를 찾을 수 없습니다.");
      if (cur.version !== input.version) return conflict();
      const before = cur.centers.map((c) => c.centerCode).sort();
      const refs = await checkRefs(tx, before);
      if (!refs.ok) return fail("VALIDATION", "입력 내용을 확인하세요.", refs.errors);

      // 미종결 전표가 있으면 사용 안 함 전환·이용 센터 제외를 막는다
      if (cur.isActive && !v.isActive) {
        const block = deactivateBlock((await countUnclosed([cur.id])).get(cur.id)!);
        if (block) return fail("STATE", block, { isActive: block });
      }
      const removed = before.filter((c) => !centerCodes.includes(c));
      for (const code of removed) {
        const center = await tx.center.findUnique({ where: { code } });
        const block = removeCenterBlock(center?.name ?? code, (await countUnclosed([cur.id], code)).get(cur.id)!);
        if (block) return fail("STATE", block, { centerCodes: block });
      }

      const curV = {
        name: cur.name, bizNo: cur.bizNo, ceoName: cur.ceoName, zipCode: cur.zipCode, addr1: cur.addr1, addr2: cur.addr2,
        tel: cur.tel, email: cur.email, contactName: cur.contactName, contactTel: cur.contactTel, contactEmail: cur.contactEmail,
        managerUserId: cur.managerUserId, contractStartDt: cur.contractStartDt, contractEndDt: cur.contractEndDt, isActive: cur.isActive,
      };
      const d = diff(snap(curV, cur.manager.name, before), snap(v, refs.managerName, centerCodes));
      if (!d) return done("바뀐 내용이 없습니다.", { id: cur.id, code: cur.code });
      const r = await tx.client.updateMany({
        where: { id: cur.id, version: input.version },
        data: { ...v, updatedBy: me.name, version: { increment: 1 } },
      });
      if (r.count === 0) return conflict();
      if (removed.length) await tx.clientCenter.deleteMany({ where: { clientId: cur.id, centerCode: { in: removed } } });
      const added = centerCodes.filter((c) => !before.includes(c));
      if (added.length) await tx.clientCenter.createMany({ data: added.map((c) => ({ clientId: cur.id, centerCode: c, createdBy: me.name })) });
      await log(tx, "tb_client", String(cur.id), "UPDATE", me.name, d.b, d.a);
      return done(`화주사 ${v.name} 정보를 저장했습니다.`, { id: cur.id, code: cur.code });
    }),
  );
}

/* ───────── 품목 ───────── */

const uomSchema = z.object({
  unit: z.enum(ITEM_UNITS),
  qty: z.number({ error: "환산 수량을 숫자로 입력하세요." }).int("환산 수량은 정수로 입력하세요.").min(1, "환산 수량은 1 이상입니다.").max(100000, "환산 수량이 너무 큽니다."),
});
const barcodeSchema = z.object({
  unit: z.enum(ITEM_UNITS),
  barcode: z.string().trim().regex(BARCODE_PATTERN, "바코드는 숫자 8~14자리로 입력하세요."),
  isPrimary: z.boolean(),
});

const itemSchema = z
  .object({
    id: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
    clientId: z.number({ error: "화주사를 선택하세요." }).int().positive("화주사를 선택하세요."),
    code: z.string().trim().min(1, "품목코드를 입력하세요.").max(40, "품목코드는 40자 이내로 입력하세요."),
    name: trimmed(200, "품목명"),
    baseUnit: z.enum(ITEM_UNITS, { error: "기준 단위를 선택하세요." }),
    storageTemp: z.enum(STORAGE_TEMPS, { error: "보관 온도대를 선택하세요." }),
    expiryManaged: z.boolean(),
    lotManaged: z.boolean(),
    isActive: z.boolean(),
    uoms: z.array(uomSchema),
    barcodes: z.array(barcodeSchema),
    aliases: z.array(z.string().trim().min(1).max(200)),
  })
  .superRefine((v, ctx) => {
    const units = new Set<string>();
    for (const u of v.uoms) {
      if (units.has(u.unit)) ctx.addIssue({ code: "custom", path: ["uoms"], message: `${u.unit} 단위가 두 번 들어 있습니다.` });
      units.add(u.unit);
      if (u.unit === v.baseUnit && u.qty !== 1) ctx.addIssue({ code: "custom", path: ["uoms"], message: "기준 단위의 환산 수량은 1입니다." });
      if (u.unit !== v.baseUnit && u.qty < 2) ctx.addIssue({ code: "custom", path: ["uoms"], message: `${u.unit} 환산 수량은 2 이상으로 입력하세요.` });
    }
    if (!units.has(v.baseUnit)) ctx.addIssue({ code: "custom", path: ["uoms"], message: "기준 단위가 단위 환산에 있어야 합니다." });
    if (v.barcodes.length === 0) ctx.addIssue({ code: "custom", path: ["barcodes"], message: "바코드를 하나 이상 입력하세요 (PDA 스캔 기준)." });
    const seen = new Set<string>();
    for (const b of v.barcodes) {
      if (!units.has(b.unit)) ctx.addIssue({ code: "custom", path: ["barcodes"], message: `${b.unit} 단위가 단위 환산에 없습니다.` });
      if (seen.has(b.barcode)) ctx.addIssue({ code: "custom", path: ["barcodes"], message: `바코드 ${b.barcode}이(가) 두 번 들어 있습니다.` });
      seen.add(b.barcode);
    }
    if (v.barcodes.length && v.barcodes.filter((b) => b.isPrimary).length !== 1)
      ctx.addIssue({ code: "custom", path: ["barcodes"], message: "대표 바코드를 하나 고르세요." });
    const al = new Set<string>();
    for (const a of v.aliases) {
      const n = normalizeAlias(a);
      if (al.has(n)) ctx.addIssue({ code: "custom", path: ["aliases"], message: `별칭 '${a}'이(가) 두 번 들어 있습니다.` });
      al.add(n);
    }
  });

type ItemInput = z.output<typeof itemSchema>;

/** 같은 화주사 안에서 품목코드·바코드·별칭 중복 확인 */
async function itemDuplicates(
  tx: Tx,
  clientId: number,
  v: { code?: string; barcodes?: string[]; aliases?: string[] },
  exceptItemId?: number,
) {
  const errs: Record<string, string> = {};
  const not = exceptItemId ? { NOT: { id: exceptItemId } } : {};
  if (v.code) {
    const byCode = await tx.item.findFirst({ where: { clientId, code: v.code, ...not } });
    if (byCode) errs.code = `이미 등록된 품목코드입니다 (${byCode.name}).`;
  }
  if (v.barcodes?.length) {
    const hit = await tx.itemBarcode.findFirst({
      where: { clientId, barcode: { in: v.barcodes }, ...(exceptItemId ? { NOT: { itemId: exceptItemId } } : {}) },
      include: { item: { select: { code: true, name: true } } },
    });
    if (hit) errs.barcodes = `바코드 ${hit.barcode}은(는) 같은 화주사의 ${hit.item.code} ${hit.item.name}이(가) 쓰고 있습니다.`;
  }
  if (v.aliases?.length) {
    const hit = await tx.itemAlias.findFirst({
      where: { clientId, normalized: { in: v.aliases.map(normalizeAlias) }, ...(exceptItemId ? { NOT: { itemId: exceptItemId } } : {}) },
      include: { item: { select: { code: true } } },
    });
    if (hit) errs.aliases = `별칭 '${hit.alias}'은(는) ${hit.item.code} 품목이 쓰고 있습니다.`;
  }
  return errs;
}

/** 단위·바코드·별칭을 화면 값으로 맞춘다 (별칭은 기존 출처 유지) */
async function syncItemChildren(tx: Tx, itemId: number, clientId: number, v: ItemInput, actor: string) {
  await tx.itemBarcode.deleteMany({ where: { itemId } });
  await tx.itemUom.deleteMany({ where: { itemId } });
  await tx.itemUom.createMany({ data: v.uoms.map((u) => ({ itemId, unit: u.unit, qty: u.qty })) });
  await tx.itemBarcode.createMany({
    data: v.barcodes.map((b) => ({ itemId, clientId, unit: b.unit, barcode: b.barcode, isPrimary: b.isPrimary })),
  });
  const keep = new Set(v.aliases.map(normalizeAlias));
  const existing = await tx.itemAlias.findMany({ where: { itemId } });
  const existingSet = new Set(existing.map((a) => a.normalized));
  await tx.itemAlias.deleteMany({ where: { itemId, normalized: { notIn: [...keep] } } });
  const add = v.aliases.filter((a) => !existingSet.has(normalizeAlias(a)));
  if (add.length)
    await tx.itemAlias.createMany({
      data: add.map((a) => ({ itemId, clientId, alias: a, normalized: normalizeAlias(a), source: "MANUAL" as const, createdBy: actor })),
    });
}

/** 이력 비교용 요약 문자열 */
const uomText = (u: { unit: string; qty: number }[]) =>
  [...u].sort((a, b) => a.qty - b.qty).map((x) => (x.qty === 1 ? x.unit : `${x.unit}=${x.qty}`)).join(", ");
const barcodeText = (b: { unit: string; barcode: string; isPrimary: boolean }[]) =>
  [...b].sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || x.barcode.localeCompare(y.barcode)).map((x) => `${x.barcode}(${x.unit}${x.isPrimary ? "·대표" : ""})`).join(", ");
const aliasText = (a: string[]) => [...a].sort().join(", ");

/** 이력에 남기는 품목 값 */
const itemSnapshot = (v: Omit<ItemInput, "id" | "version" | "clientId" | "code">) => ({
  name: v.name,
  baseUnit: v.baseUnit,
  storageTemp: v.storageTemp,
  expiryManaged: v.expiryManaged,
  lotManaged: v.lotManaged,
  isActive: v.isActive,
  uoms: uomText(v.uoms),
  barcodes: barcodeText(v.barcodes),
  aliases: aliasText(v.aliases),
});

/** 품목 1건 등록 (단건 등록·엑셀 일괄 등록 공용) — 중복 확인은 호출하는 쪽에서 */
async function createItemTx(tx: Tx, v: ItemInput, actor: string, logExtra: Record<string, unknown> = {}) {
  const row = await tx.item.create({
    data: {
      clientId: v.clientId, code: v.code, name: v.name, baseUnit: v.baseUnit, storageTemp: v.storageTemp,
      expiryManaged: v.expiryManaged, lotManaged: v.lotManaged, isActive: v.isActive, createdBy: actor, updatedBy: actor,
    },
  });
  await syncItemChildren(tx, row.id, v.clientId, v, actor);
  await log(tx, "tb_item", String(row.id), "CREATE", actor, null, { code: row.code, ...itemSnapshot(v), ...logExtra });
  return row;
}

export async function saveItem(input: z.input<typeof itemSchema>): Promise<ActionResult<{ id: number }>> {
  // 품목 등록·수정은 3PL만. 화주사는 등록 요청으로 보낸다 (2026-11-04 Sol, U6)
  const me = await actorFor("items", "edit");
  if (!me) return forbidden();
  const p = itemSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const actor = me.name;
  const snapshot = itemSnapshot(v);

  return run(() =>
    db.$transaction(async (tx) => {
      if (outOfScope(me, v.clientId)) return forbidden();
      if (!v.id) {
        const client = await tx.client.findUnique({ where: { id: v.clientId } });
        if (!client?.isActive) return fail("VALIDATION", "입력 내용을 확인하세요.", { clientId: "사용 중인 화주사를 선택하세요." });
        const dup = await itemDuplicates(tx, v.clientId, { code: v.code, barcodes: v.barcodes.map((b) => b.barcode), aliases: v.aliases });
        if (Object.keys(dup).length) return fail("VALIDATION", "입력 내용을 확인하세요.", dup);
        const row = await createItemTx(tx, v, actor);
        return done(`품목 ${row.code}을(를) 등록했습니다.`, { id: row.id });
      }

      const cur = await tx.item.findUnique({ where: { id: v.id }, include: { uoms: true, barcodes: true, aliases: true } });
      if (!cur) return fail("NOT_FOUND", "품목을 찾을 수 없습니다.");
      if (outOfScope(me, cur.clientId)) return forbidden();
      if (cur.version !== v.version) return conflict();
      // 화주사·품목코드는 전표가 참조하므로 바꾸지 않는다
      const dup = await itemDuplicates(tx, cur.clientId, { barcodes: v.barcodes.map((b) => b.barcode), aliases: v.aliases }, cur.id);
      if (Object.keys(dup).length) return fail("VALIDATION", "입력 내용을 확인하세요.", dup);
      const before = {
        name: cur.name, baseUnit: cur.baseUnit, storageTemp: cur.storageTemp, expiryManaged: cur.expiryManaged,
        lotManaged: cur.lotManaged, isActive: cur.isActive, uoms: uomText(cur.uoms), barcodes: barcodeText(cur.barcodes),
        aliases: aliasText(cur.aliases.map((a) => a.alias)),
      };
      const d = diff(before, snapshot);
      if (!d) return done("바뀐 내용이 없습니다.", { id: cur.id });
      const r = await tx.item.updateMany({
        where: { id: v.id, version: v.version },
        data: {
          name: v.name, baseUnit: v.baseUnit, storageTemp: v.storageTemp, expiryManaged: v.expiryManaged,
          lotManaged: v.lotManaged, isActive: v.isActive, updatedBy: actor, version: { increment: 1 },
        },
      });
      if (r.count === 0) return conflict();
      await syncItemChildren(tx, cur.id, cur.clientId, v, actor);
      await log(tx, "tb_item", String(cur.id), "UPDATE", actor, d.b, d.a);
      return done(`품목 ${cur.code} 정보를 저장했습니다.`, { id: cur.id });
    }),
  );
}

/* ───────── 품목 등록 요청 ───────── */

const registerSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  itemCode: z.string().trim().min(1, "품목코드를 입력하세요.").max(40, "품목코드는 40자 이내로 입력하세요."),
  itemName: trimmed(200, "품목명"),
  unit: z.enum(ITEM_UNITS, { error: "단위를 선택하세요." }),
  barcode: z.string().trim().regex(BARCODE_PATTERN, "바코드는 숫자 8~14자리로 입력하세요."),
  storageTemp: z.enum(STORAGE_TEMPS, { error: "보관 온도대를 선택하세요." }),
  expiryManaged: z.boolean(),
  lotManaged: z.boolean(),
  /** 3PL이 품목명을 고쳤을 때 화주사가 보낸 원래 품목명을 별칭으로 남길지 */
  keepRequestNameAsAlias: z.boolean(),
});

const FIELD_LABEL: Record<string, string> = { itemCode: "품목코드", itemName: "품목명", unit: "단위", barcode: "바코드" };

/** 등록 — version이 같고 등록대기일 때만. 3PL이 고친 값이 있으면 이력 메모로 남긴다 */
export async function registerItemRequest(input: z.input<typeof registerSchema>): Promise<ActionResult<{ itemId: number }>> {
  const p = registerSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const me = await getActor();
  if (!canReviewItemRequests(me.roles)) return forbidden();
  const actor = me.name;

  return run(() =>
    db.$transaction(async (tx) => {
      const req = await tx.itemRequest.findUnique({ where: { id: v.id }, include: { client: true } });
      if (!req) return fail("NOT_FOUND", "요청을 찾을 수 없습니다.");
      if (outOfScope(me, req.clientId)) return forbidden();
      if (req.version !== v.version)
        return fail("CONFLICT", "화주사가 수정한 요청입니다. 변경 내용을 확인한 뒤 다시 처리하세요.");
      if (req.status !== "WAITING") return fail("STATE", "등록대기 상태의 요청만 등록할 수 있습니다.");
      if (!req.client.isActive) return fail("STATE", "사용 안 함 상태인 화주사의 요청은 등록할 수 없습니다.");

      const nameChanged = normalizeAlias(req.itemName) !== normalizeAlias(v.itemName);
      const aliases = v.keepRequestNameAsAlias && nameChanged ? [req.itemName] : [];
      const dup = await itemDuplicates(tx, req.clientId, { code: v.itemCode, barcodes: [v.barcode], aliases });
      if (Object.keys(dup).length)
        return fail("VALIDATION", "이미 등록된 품목과 겹칩니다. 값을 고치거나 반려하세요.", {
          ...(dup.code ? { itemCode: dup.code } : {}),
          ...(dup.barcodes ? { barcode: dup.barcodes } : {}),
          ...(dup.aliases ? { itemName: dup.aliases } : {}),
        });

      const changed = (["itemCode", "itemName", "unit", "barcode"] as const)
        .filter((k) => req[k] !== v[k])
        .map((k) => `${FIELD_LABEL[k]} '${req[k]}' → '${v[k]}'`);

      const item = await tx.item.create({
        data: {
          clientId: req.clientId, code: v.itemCode, name: v.itemName, baseUnit: v.unit, storageTemp: v.storageTemp,
          expiryManaged: v.expiryManaged, lotManaged: v.lotManaged, createdBy: actor, updatedBy: actor,
          uoms: { create: [{ unit: v.unit, qty: 1 }] },
        },
      });
      await tx.itemBarcode.create({ data: { itemId: item.id, clientId: req.clientId, unit: v.unit, barcode: v.barcode, isPrimary: true } });
      if (aliases.length)
        await tx.itemAlias.create({
          data: { itemId: item.id, clientId: req.clientId, alias: req.itemName, normalized: normalizeAlias(req.itemName), source: "REQUEST", createdBy: actor },
        });

      const r = await tx.itemRequest.updateMany({
        where: { id: v.id, version: v.version, status: "WAITING" },
        data: { status: "REGISTERED", itemId: item.id, processedBy: actor, processedAt: new Date(), version: { increment: 1 } },
      });
      if (r.count === 0) throw new Error("CONFLICT_RACE");
      const memo = [
        changed.length ? `수정 후 등록: ${changed.join(", ")}` : "",
        aliases.length ? `요청 품목명 '${req.itemName}'을(를) 별칭으로 등록` : "",
      ].filter(Boolean).join(" / ");
      await tx.itemRequestHistory.create({ data: { requestId: v.id, action: "REGISTER", actor, actorId: me.id, memo: memo || null } });
      await log(tx, "tb_item", String(item.id), "CREATE", actor, null, {
        code: item.code, name: item.name, baseUnit: item.baseUnit, storageTemp: item.storageTemp,
        expiryManaged: item.expiryManaged, lotManaged: item.lotManaged, isActive: true,
        uoms: `${v.unit}`, barcodes: `${v.barcode}(${v.unit}·대표)`, aliases: aliasText(aliases), fromRequest: req.requestNo,
      });
      return done(`${req.requestNo} 품목 ${item.code}을(를) 등록했습니다. 단위 환산·추가 바코드는 품목 화면에서 넣을 수 있습니다.`, { itemId: item.id });
    }),
  );
}

const rejectSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  reasonCode: z.string().min(1, "반려 사유를 선택하세요."),
  reasonText: z.string().trim().max(500, "상세 내용은 500자 이내로 입력하세요.").optional().default(""),
});

/** 반려 — 사유 코드 필수, "기타"류는 상세 내용 필수 (D19) */
export async function rejectItemRequest(input: z.input<typeof rejectSchema>): Promise<ActionResult> {
  const p = rejectSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const me = await getActor();
  if (!canReviewItemRequests(me.roles)) return forbidden();
  const actor = me.name;

  return run(() =>
    db.$transaction(async (tx) => {
      const code = await tx.commonCode.findUnique({
        where: { groupCode_code: { groupCode: ITEM_REQ_REJECT_GROUP, code: v.reasonCode } },
      });
      if (!code?.isActive) return fail("VALIDATION", "입력 내용을 확인하세요.", { reasonCode: "사용 중인 반려 사유를 선택하세요." });
      if (code.requiresText && !v.reasonText)
        return fail("VALIDATION", `"${code.name}"을(를) 고르면 상세 내용을 입력해야 합니다.`, { reasonText: "상세 내용을 입력하세요." });

      const req = await tx.itemRequest.findUnique({ where: { id: v.id } });
      if (!req) return fail("NOT_FOUND", "요청을 찾을 수 없습니다.");
      if (outOfScope(me, req.clientId)) return forbidden();
      if (req.version !== v.version)
        return fail("CONFLICT", "화주사가 수정한 요청입니다. 변경 내용을 확인한 뒤 다시 처리하세요.");
      if (req.status !== "WAITING") return fail("STATE", "등록대기 상태의 요청만 반려할 수 있습니다.");

      const r = await tx.itemRequest.updateMany({
        where: { id: v.id, version: v.version, status: "WAITING" },
        data: {
          status: "REJECTED",
          rejectReasonCode: v.reasonCode,
          rejectReasonText: v.reasonText || null,
          processedBy: actor,
          processedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (r.count === 0) return fail("CONFLICT", "화주사가 수정한 요청입니다. 변경 내용을 확인한 뒤 다시 처리하세요.");
      await tx.itemRequestHistory.create({
        data: { requestId: v.id, action: "REJECT", actor, actorId: me.id, reasonCode: v.reasonCode, reasonText: v.reasonText || null },
      });
      return done(`${req.requestNo} 요청을 반려했습니다.`);
    }),
  );
}

/* ───────── 품목 등록 요청 — 화주사 요청·재요청 ───────── */

const requestSchema = z.object({
  /** 반려된 요청을 고쳐 다시 보낼 때 */
  id: z.number().int().positive().optional(),
  version: z.number().int().positive().optional(),
  itemCode: z.string().trim().min(1, "품목코드를 입력하세요.").max(40, "품목코드는 40자 이내로 입력하세요."),
  itemName: trimmed(200, "품목명"),
  unit: z.enum(ITEM_UNITS, { error: "단위를 선택하세요." }),
  barcode: z.string().trim().regex(BARCODE_PATTERN, "바코드는 숫자 8~14자리로 입력하세요."),
  storageTemp: z.enum(STORAGE_TEMPS).nullable(),
  expiryManaged: z.boolean().nullable(),
  lotManaged: z.boolean().nullable(),
  note: z.string().trim().max(500, "메모는 500자 이내로 입력하세요."),
  /** 새 요청의 원본 — 입고예정 등록 중 엑셀(EXCEL)·AI 판독(AI)에서 보낸 미매칭 신규 품목 */
  source: z.enum(["DIRECT", "EXCEL", "AI"]).default("DIRECT"),
});



/** 품목 등록 요청번호 IR-YYYYMMDD-NNNN (요청일 기준 일련번호) */
async function nextRequestNos(tx: Tx, count: number) {
  const prefix = `IR-${todayKst().replaceAll("-", "")}-`;
  const used = await tx.itemRequest.findMany({ where: { requestNo: { startsWith: prefix } }, select: { requestNo: true } });
  const max = used.reduce((m, u) => Math.max(m, Number(u.requestNo.slice(prefix.length)) || 0), 0);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, "0")}`);
}

/**
 * 요청 중복 확인 — 같은 화주사에 이미 등록된 품목, 또는 검토 중(등록대기·반려)인 다른 요청과 품목코드·바코드가 겹치면 막는다
 * 결과 키: itemCode / barcode
 */
async function requestDuplicates(tx: Tx, clientId: number, items: { itemCode: string; barcode: string }[], exceptRequestId?: number) {
  const codes = items.map((i) => i.itemCode);
  const barcodes = items.map((i) => i.barcode);
  const [itemByCode, itemByBarcode, reqs] = await Promise.all([
    tx.item.findMany({ where: { clientId, code: { in: codes } }, select: { code: true, name: true } }),
    tx.itemBarcode.findMany({ where: { clientId, barcode: { in: barcodes } }, select: { barcode: true, item: { select: { code: true } } } }),
    tx.itemRequest.findMany({
      where: {
        clientId,
        status: { in: ["WAITING", "REJECTED"] },
        OR: [{ itemCode: { in: codes } }, { barcode: { in: barcodes } }],
        ...(exceptRequestId ? { NOT: { id: exceptRequestId } } : {}),
      },
      select: { requestNo: true, itemCode: true, barcode: true },
    }),
  ]);
  return items.map((i) => {
    const e: Record<string, string> = {};
    const ic = itemByCode.find((x) => x.code === i.itemCode);
    if (ic) e.itemCode = `이미 등록된 품목코드입니다 (${ic.name}).`;
    const ib = itemByBarcode.find((x) => x.barcode === i.barcode);
    if (ib) e.barcode = `이미 ${ib.item.code} 품목이 쓰는 바코드입니다.`;
    const rc = reqs.find((x) => x.itemCode === i.itemCode);
    if (rc && !e.itemCode) e.itemCode = `검토 중인 요청 ${rc.requestNo}과(와) 품목코드가 같습니다.`;
    const rb = reqs.find((x) => x.barcode === i.barcode);
    if (rb && !e.barcode) e.barcode = `검토 중인 요청 ${rb.requestNo}과(와) 바코드가 같습니다.`;
    return e;
  });
}

/** 화주사: 품목 등록 요청 (단건) — 새 요청 또는 반려된 요청을 고쳐 재요청 */
export async function submitItemRequest(input: z.input<typeof requestSchema>): Promise<ActionResult<{ id: number; requestNo: string }>> {
  const me = await actorFor("itemRequests", "edit");
  if (!me?.clientId) return forbidden();
  const clientId = me.clientId;
  const p = requestSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const actor = me.name;
  const fields = {
    itemCode: v.itemCode, itemName: v.itemName, unit: v.unit, barcode: v.barcode, storageTemp: v.storageTemp,
    expiryManaged: v.expiryManaged, lotManaged: v.lotManaged, sourceNote: v.note || null,
  };

  return run(() =>
    db.$transaction(async (tx) => {
      const [dup] = await requestDuplicates(tx, clientId, [v], v.id);
      if (Object.keys(dup).length) return fail("VALIDATION", "입력 내용을 확인하세요.", dup);

      if (!v.id) {
        const [requestNo] = await nextRequestNos(tx, 1);
        const row = await tx.itemRequest.create({ data: { ...fields, requestNo, clientId, source: v.source, requestedBy: actor } });
        await tx.itemRequestHistory.create({ data: { requestId: row.id, action: "REQUEST", actor, actorId: me.id } });
        return done(`품목 등록 요청 ${requestNo}을(를) 보냈습니다. 3PL이 검토 후 등록합니다.`, { id: row.id, requestNo });
      }

      const cur = await tx.itemRequest.findUnique({ where: { id: v.id } });
      if (!cur || cur.clientId !== clientId) return fail("NOT_FOUND", "요청을 찾을 수 없습니다.");
      if (cur.version !== v.version) return fail("CONFLICT", "3PL이 먼저 처리했거나 다른 사용자가 고친 요청입니다. 최신 내용을 불러옵니다.");
      if (cur.status !== "REJECTED") return fail("STATE", "반려된 요청만 고쳐서 다시 보낼 수 있습니다.");
      const r = await tx.itemRequest.updateMany({
        where: { id: v.id, version: v.version, status: "REJECTED" },
        data: { ...fields, status: "WAITING", resubmitCount: { increment: 1 }, version: { increment: 1 }, requestedBy: actor, requestedAt: new Date() },
      });
      if (r.count === 0) throw new Error("CONFLICT_RACE");
      const changed = (["itemCode", "itemName", "unit", "barcode"] as const).filter((k) => cur[k] !== v[k]).map((k) => `${FIELD_LABEL[k]} '${cur[k]}' → '${v[k]}'`);
      await tx.itemRequestHistory.create({
        data: { requestId: cur.id, action: "RESUBMIT", actor, actorId: me.id, memo: changed.length ? `수정: ${changed.join(", ")}` : null },
      });
      return done(`${cur.requestNo} 요청을 고쳐 다시 보냈습니다.`, { id: cur.id, requestNo: cur.requestNo });
    }),
  );
}

/* ───────── 품목 엑셀 일괄 등록(3PL) · 일괄 요청(화주사) ───────── */

/** 3PL은 품목 일괄 등록, 화주사는 품목 등록 요청을 일괄로 보낸다 */
async function bulkActor(): Promise<{ me: SessionUser; kind: BulkKind } | null> {
  const me = await getActor();
  if (can(me.roles, "items", "edit")) return { me, kind: "ITEM" };
  if (can(me.roles, "itemRequests", "edit") && me.clientId) return { me, kind: "REQUEST" };
  return null;
}

type BulkChecked =
  | { rowNo: number; raw: RawRow; errors: string[]; item?: undefined; request?: undefined }
  | { rowNo: number; raw: RawRow; errors: []; item: ItemInput; request?: undefined }
  | { rowNo: number; raw: RawRow; errors: []; item?: undefined; request: RequestDraft };

/** 행마다 형식 → 파일 안 중복 → 기존 품목·검토 중 요청과 중복 순으로 확인한다 */
async function checkBulk(tx: Tx, kind: BulkKind, clientId: number, rows: { rowNo: number; raw: RawRow }[]): Promise<BulkChecked[]> {
  if (kind === "ITEM") {
    const parsed = rows.map((r): { rowNo: number; raw: RawRow; errors: string[]; item?: ItemInput } => {
      const p = parseItemRow(r.raw);
      if (!p.ok) return { ...r, errors: p.errors };
      const z = itemSchema.safeParse({ ...p.value, clientId, isActive: true });
      if (!z.success) return { ...r, errors: [...new Set(z.error.issues.map((i) => i.message))] };
      return { ...r, errors: [] as string[], item: z.data };
    });
    const ok = parsed.filter((p) => p.item);
    const inFile = fileDuplicates(ok.map((p) => ({ rowNo: p.rowNo, code: p.item!.code, barcodes: p.item!.barcodes.map((b) => b.barcode), aliases: p.item!.aliases })));
    const codes = ok.map((p) => p.item!.code);
    const barcodes = ok.flatMap((p) => p.item!.barcodes.map((b) => b.barcode));
    const aliases = ok.flatMap((p) => p.item!.aliases.map(normalizeAlias));
    const [byCode, byBarcode, byAlias] = await Promise.all([
      tx.item.findMany({ where: { clientId, code: { in: codes } }, select: { code: true, name: true } }),
      tx.itemBarcode.findMany({ where: { clientId, barcode: { in: barcodes } }, select: { barcode: true, item: { select: { code: true } } } }),
      tx.itemAlias.findMany({ where: { clientId, normalized: { in: aliases } }, select: { alias: true, normalized: true, item: { select: { code: true } } } }),
    ]);
    return parsed.map((p): BulkChecked => {
      if (!p.item) return { rowNo: p.rowNo, raw: p.raw, errors: p.errors };
      const item = p.item;
      const e = [...(inFile.get(p.rowNo) ?? [])];
      const c = byCode.find((x) => x.code === item.code);
      if (c) e.push(`이미 등록된 품목코드입니다 (${c.name}).`);
      for (const b of item.barcodes) {
        const hit = byBarcode.find((x) => x.barcode === b.barcode);
        if (hit) e.push(`바코드 ${b.barcode}은(는) ${hit.item.code} 품목이 쓰고 있습니다.`);
      }
      for (const a of item.aliases) {
        const hit = byAlias.find((x) => x.normalized === normalizeAlias(a));
        if (hit) e.push(`별칭 '${a}'은(는) ${hit.item.code} 품목이 쓰고 있습니다.`);
      }
      return e.length ? { rowNo: p.rowNo, raw: p.raw, errors: e } : { rowNo: p.rowNo, raw: p.raw, errors: [], item };
    });
  }

  const parsed = rows.map((r): { rowNo: number; raw: RawRow; errors: string[]; request?: RequestDraft } => {
    const p = parseRequestRow(r.raw);
    return p.ok ? { ...r, errors: [] as string[], request: p.value } : { ...r, errors: p.errors };
  });
  const ok = parsed.filter((p) => p.request);
  const inFile = fileDuplicates(ok.map((p) => ({ rowNo: p.rowNo, code: p.request!.code, barcodes: [p.request!.barcode] })));
  const dups = await requestDuplicates(tx, clientId, ok.map((p) => ({ itemCode: p.request!.code, barcode: p.request!.barcode })));
  const dupBy = new Map(ok.map((p, i) => [p.rowNo, dups[i]]));
  return parsed.map((p): BulkChecked => {
    if (!p.request) return { rowNo: p.rowNo, raw: p.raw, errors: p.errors };
    const e = [...(inFile.get(p.rowNo) ?? []), ...Object.values(dupBy.get(p.rowNo) ?? {})];
    return e.length ? { rowNo: p.rowNo, raw: p.raw, errors: e } : { rowNo: p.rowNo, raw: p.raw, errors: [], request: p.request };
  });
}

/** 화주사 확인 — 3PL은 고른 화주사(사용 중), 화주사 계정은 자기 화주사 */
async function bulkClient(me: SessionUser, kind: BulkKind, clientId: number | null) {
  const id = kind === "REQUEST" ? me.clientId : clientId;
  if (!id) return null;
  const c = await db.client.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
  return c?.isActive ? c : null;
}

/** 1단계: 파일을 읽어 행마다 검사 결과를 돌려준다 (저장하지 않음) */
export async function previewItemBulk(form: FormData): Promise<ActionResult<BulkPreview>> {
  const who = await bulkActor();
  if (!who) return forbidden();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("VALIDATION", "엑셀 파일을 고르세요.", { file: "엑셀 파일을 고르세요." });
  if (!/\.xlsx$/i.test(file.name)) return fail("VALIDATION", "확장자가 .xlsx인 엑셀 파일만 올릴 수 있습니다.", { file: ".xlsx 파일을 고르세요." });
  const client = await bulkClient(who.me, who.kind, Number(form.get("clientId")) || null);
  if (!client) return fail("VALIDATION", "화주사를 선택하세요.", { clientId: "사용 중인 화주사를 선택하세요." });

  const read = await readRows(who.kind, await file.arrayBuffer());
  if (!read.ok) return fail("VALIDATION", read.error, { file: read.error });
  const checked = await checkBulk(db as unknown as Tx, who.kind, client.id, read.rows);
  return {
    ok: true,
    message: "",
    data: {
      kind: who.kind,
      clientId: client.id,
      clientName: client.name,
      fileName: file.name,
      rows: checked.map((c) => ({ rowNo: c.rowNo, raw: c.raw, errors: c.errors })),
    },
  };
}

/**
 * 2단계: 오류 없는 행만 등록(요청). 미리보기 뒤 그사이 다른 사람이 같은 코드·바코드를 등록했을 수 있어 서버에서 다시 검사하고,
 * 하나라도 걸리면 아무것도 저장하지 않고 다시 확인하게 한다.
 */
export async function commitItemBulk(input: { clientId: number; rows: { rowNo: number; raw: RawRow }[] }): Promise<ActionResult<{ count: number }>> {
  const who = await bulkActor();
  if (!who) return forbidden();
  const { me, kind } = who;
  if (!Array.isArray(input.rows) || input.rows.length === 0) return fail("VALIDATION", "등록할 행이 없습니다.");
  if (input.rows.length > BULK_MAX_ROWS) return fail("VALIDATION", `한 번에 ${BULK_MAX_ROWS.toLocaleString()}행까지 등록할 수 있습니다.`);
  const client = await bulkClient(me, kind, input.clientId);
  if (!client) return fail("VALIDATION", "사용 중인 화주사를 선택하세요.");
  const actor = me.name;
  const rows = input.rows.map((r) => ({ rowNo: Number(r.rowNo), raw: Object.fromEntries(Object.entries(r.raw ?? {}).map(([k, v]) => [k, String(v ?? "")])) }));

  return run(() =>
    db.$transaction(
      async (tx) => {
        const checked = await checkBulk(tx, kind, client.id, rows);
        const bad = checked.filter((c) => c.errors.length);
        if (bad.length)
          return fail(
            "CONFLICT",
            `${bad.map((b) => `${b.rowNo}행`).slice(0, 5).join(", ")}${bad.length > 5 ? ` 외 ${bad.length - 5}건` : ""}이(가) 그사이 등록된 품목·요청과 겹칩니다. 파일을 다시 올려 확인하세요.`,
          );

        if (kind === "ITEM") {
          for (const c of checked) await createItemTx(tx, c.item!, actor, { fromExcel: true });
          return done(`${client.name} 품목 ${checked.length.toLocaleString()}건을 등록했습니다.`, { count: checked.length });
        }

        const nos = await nextRequestNos(tx, checked.length);
        const created = await tx.itemRequest.createManyAndReturn({
          data: checked.map((c, i) => {
            const r = c.request!;
            return {
              requestNo: nos[i], clientId: client.id, itemCode: r.code, itemName: r.name, unit: r.unit, barcode: r.barcode,
              storageTemp: r.storageTemp, expiryManaged: r.expiryManaged, lotManaged: r.lotManaged, sourceNote: r.note,
              source: "ITEM_EXCEL" as const, requestedBy: actor,
            };
          }),
          select: { id: true },
        });
        await tx.itemRequestHistory.createMany({ data: created.map((r) => ({ requestId: r.id, action: "REQUEST" as const, actor, actorId: me.id, memo: "엑셀 일괄 요청" })) });
        return done(`품목 등록 요청 ${created.length.toLocaleString()}건을 보냈습니다. 3PL이 검토 후 등록합니다.`, { count: created.length });
      },
      { timeout: 120_000, maxWait: 10_000 },
    ),
  );
}

/* ───────── 사유 코드 ───────── */

const codeSchema = z.object({
  id: z.number().int().positive().optional(),
  version: z.number().int().positive().optional(),
  groupCode: z.string().min(1),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,20}$/, "코드는 영문 대문자·숫자·밑줄 20자 이내로 입력하세요."),
  name: trimmed(100, "코드명"),
  sortOrder: z.number({ error: "순서를 숫자로 입력하세요." }).int("순서는 정수로 입력하세요.").min(0, "순서는 0 이상으로 입력하세요.").max(9999, "순서는 9999 이하로 입력하세요."),
  requiresText: z.boolean(),
  isActive: z.boolean(),
});

export async function saveCommonCode(input: z.input<typeof codeSchema>): Promise<ActionResult<{ id: number }>> {
  const p = codeSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const me = await getActor();
  const actor = me.name;

  return run(() =>
    db.$transaction(async (tx) => {
      if (!v.id) {
        const group = await tx.codeGroup.findUnique({ where: { code: v.groupCode } });
        if (!group) return fail("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.");
        if (await tx.commonCode.findUnique({ where: { groupCode_code: { groupCode: v.groupCode, code: v.code } } }))
          return fail("VALIDATION", "입력 내용을 확인하세요.", { code: "이 그룹에 이미 있는 코드입니다." });
        const row = await tx.commonCode.create({
          data: { groupCode: v.groupCode, code: v.code, name: v.name, sortOrder: v.sortOrder, requiresText: v.requiresText, isActive: v.isActive, createdBy: actor, updatedBy: actor },
        });
        await log(tx, "tb_common_code", String(row.id), "CREATE", actor, null, {
          groupCode: row.groupCode, code: row.code, name: row.name, sortOrder: row.sortOrder, requiresText: row.requiresText, isActive: row.isActive,
        });
        return done(`코드 ${row.code} ${row.name}을(를) 등록했습니다.`, { id: row.id });
      }
      const cur = await tx.commonCode.findUnique({ where: { id: v.id } });
      if (!cur) return fail("NOT_FOUND", "코드를 찾을 수 없습니다.");
      if (cur.version !== v.version) return conflict();
      const d = diff(cur, { name: v.name, sortOrder: v.sortOrder, requiresText: v.requiresText, isActive: v.isActive });
      if (!d) return done("바뀐 내용이 없습니다.", { id: cur.id });
      const r = await tx.commonCode.updateMany({
        where: { id: v.id, version: v.version },
        data: { name: v.name, sortOrder: v.sortOrder, requiresText: v.requiresText, isActive: v.isActive, updatedBy: actor, version: { increment: 1 } },
      });
      if (r.count === 0) return conflict();
      await log(tx, "tb_common_code", String(cur.id), "UPDATE", actor, d.b, d.a);
      return done(`코드 ${cur.code} 정보를 저장했습니다.`, { id: cur.id });
    }),
  );
}

/* ───────── 사용자 ───────── */

const userSchema = z
  .object({
    id: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
    loginId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,50}$/, "아이디는 영문 소문자·숫자·점(.)·밑줄·하이픈 3~50자로 입력하세요."),
    name: trimmed(50, "이름"),
    roles: z.array(z.enum(USER_ROLES)).min(1, "역할을 하나 이상 고르세요."),
    clientId: z.number().int().positive().nullable(),
    centerId: z.number().int().positive().nullable(),
    /** 화주사 사용자의 기본 센터 (입고예정 등록 센터 기본값) */
    defaultCenterId: z.number().int().positive().nullable().default(null),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.roles.length) return;
    const orgs = new Set(v.roles.map((r) => ROLE_META[r].org));
    if (orgs.size > 1) return ctx.addIssue({ code: "custom", path: ["roles"], message: "3PL 역할과 화주사 역할은 함께 줄 수 없습니다." });
    const org = ROLE_META[v.roles[0]].org;
    if (org === "SHIPPER" && !v.clientId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "화주사를 선택하세요." });
    if (org === "TPL" && !v.centerId) ctx.addIssue({ code: "custom", path: ["centerId"], message: "센터를 선택하세요." });
  });

/** 이력 비교·표시용: 역할 코드를 정렬해 쉼표로 잇는다 */
const rolesText = (roles: readonly UserRole[]) => sortRoles(roles).join(",");

export async function saveUser(input: z.input<typeof userSchema>): Promise<ActionResult<{ id: number }>> {
  const me = await actorFor("users", "edit");
  if (!me) return forbidden();
  const p = userSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = { ...p.data, roles: sortRoles(p.data.roles) };
  const org = ROLE_META[v.roles[0]].org;
  const scope = {
    clientId: org === "SHIPPER" ? v.clientId : null,
    centerId: org === "TPL" ? v.centerId : null,
    defaultCenterId: org === "SHIPPER" ? v.defaultCenterId : null,
  };
  const actor = me.name;

  return run(() =>
    db.$transaction(async (tx) => {
      // 화주사 계정은 자기 화주사 사용자만, 3PL 관리자 역할은 3PL 관리자만 부여·수정한다
      if (isShipperRole(me.roles) && (org !== "SHIPPER" || scope.clientId !== me.clientId)) return forbidden();
      const meAdmin = me.roles.includes("TPL_ADMIN");
      if (v.roles.includes("TPL_ADMIN") && !meAdmin) return forbidden();
      if (scope.clientId) {
        const c = await tx.client.findUnique({ where: { id: scope.clientId } });
        if (!c) return fail("VALIDATION", "입력 내용을 확인하세요.", { clientId: "화주사를 찾을 수 없습니다." });
        if (!c.isActive && (!v.id || (await tx.user.findUnique({ where: { id: v.id } }))?.clientId !== c.id))
          return fail("VALIDATION", "입력 내용을 확인하세요.", { clientId: "사용 중인 화주사를 고르세요." });
        // 기본 센터는 그 화주사가 이용하는 센터 중에서만
        if (scope.defaultCenterId) {
          const center = await tx.center.findUnique({ where: { id: scope.defaultCenterId }, select: { code: true } });
          const linked = center && (await tx.clientCenter.findUnique({ where: { clientId_centerCode: { clientId: scope.clientId, centerCode: center.code } } }));
          if (!linked) return fail("VALIDATION", "입력 내용을 확인하세요.", { defaultCenterId: "이 화주사가 이용하는 센터를 고르세요." });
        }
      }
      if (!v.id) {
        if (await tx.user.findUnique({ where: { loginId: v.loginId } }))
          return fail("VALIDATION", "입력 내용을 확인하세요.", { loginId: "이미 쓰고 있는 아이디입니다." });
        const row = await tx.user.create({
          data: { loginId: v.loginId, name: v.name, roles: v.roles, ...scope, isActive: v.isActive, createdBy: actor, updatedBy: actor },
        });
        await log(tx, "tb_user", String(row.id), "CREATE", actor, null, {
          loginId: row.loginId, name: row.name, roles: rolesText(row.roles), clientId: row.clientId, centerId: row.centerId, defaultCenterId: row.defaultCenterId, isActive: row.isActive,
        });
        return done(`사용자 ${row.name}(${row.loginId})을(를) 등록했습니다.`, { id: row.id });
      }
      const cur = await tx.user.findUnique({ where: { id: v.id } });
      if (!cur) return fail("NOT_FOUND", "사용자를 찾을 수 없습니다.");
      if (outOfScope(me, cur.clientId) || (cur.roles.includes("TPL_ADMIN") && !meAdmin)) return forbidden();
      if (cur.version !== v.version) return conflict();
      const d = diff({ ...cur, roles: rolesText(cur.roles) }, { name: v.name, roles: rolesText(v.roles), clientId: scope.clientId, centerId: scope.centerId, defaultCenterId: scope.defaultCenterId, isActive: v.isActive });
      if (!d) return done("바뀐 내용이 없습니다.", { id: cur.id });
      const r = await tx.user.updateMany({
        where: { id: v.id, version: v.version },
        data: { name: v.name, roles: v.roles, ...scope, isActive: v.isActive, updatedBy: actor, version: { increment: 1 } },
      });
      if (r.count === 0) return conflict();
      await log(tx, "tb_user", String(cur.id), "UPDATE", actor, d.b, d.a);
      return done(`사용자 ${v.name} 정보를 저장했습니다.`, { id: cur.id });
    }),
  );
}

/* ───────── 운영 설정 ───────── */

const settingSchema = z.object({
  key: z.string().min(1),
  version: z.number().int().positive(),
  value: z.string().trim().min(1, "값을 입력하세요."),
});

export async function saveSetting(input: z.input<typeof settingSchema>): Promise<ActionResult> {
  const p = settingSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const me = await getActor();
  const actor = me.name;

  return run(() =>
    db.$transaction(async (tx) => {
      const cur = await tx.setting.findUnique({ where: { key: v.key } });
      if (!cur) return fail("NOT_FOUND", "설정을 찾을 수 없습니다.");
      if (cur.version !== v.version) return conflict();
      if (cur.valueType === "TIME") {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.value))
          return fail("VALIDATION", "입력 내용을 확인하세요.", { value: "시각을 HH:MM 형식(00:00~23:59)으로 입력하세요." });
      } else if (cur.minValue !== null || cur.maxValue !== null) {
        const n = Number(v.value);
        const lo = cur.minValue ?? -Infinity;
        const hi = cur.maxValue ?? Infinity;
        if (!Number.isInteger(n) || n < lo || n > hi)
          return fail("VALIDATION", "입력 내용을 확인하세요.", { value: `${cur.minValue}~${cur.maxValue} 사이의 정수로 입력하세요.` });
      }
      if (cur.value === v.value) return done("바뀐 내용이 없습니다.");
      const r = await tx.setting.updateMany({
        where: { key: v.key, version: v.version },
        data: { value: v.value, updatedBy: actor, version: { increment: 1 } },
      });
      if (r.count === 0) return conflict();
      await log(tx, "tb_setting", v.key, "UPDATE", actor, { value: cur.value }, { value: v.value });
      return done(`${cur.label}을(를) ${v.value}${cur.unit ?? ""}(으)로 저장했습니다.`);
    }),
  );
}

/* ───────── 회사 정보 (3PL 관리자만 수정) ───────── */

interface CompanyInput {
  version: number;
  name: string;
  bizNo: string;
  ceoName: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  phone: string;
  email: string;
}

/** 화면과 같은 규칙으로 서버에서 다시 검증한다 (validators.ts) */
function companyErrors(v: CompanyInput) {
  const e: Record<string, string> = {};
  const name = textError(v.name, "회사명", 50);
  if (name) e.name = name;
  if (!isValidBizNo(v.bizNo)) e.bizNo = MSG.bizNo;
  const ceo = textError(v.ceoName, "대표자명", 20);
  if (ceo) e.ceoName = ceo;
  Object.assign(e, addressErrors(v));
  if (v.phone.trim() && !isValidPhone(v.phone)) e.phone = MSG.phone;
  if (v.email.trim() && (!isValidEmail(v.email.trim()) || v.email.trim().length > 100)) e.email = MSG.email;
  return e;
}

export async function saveCompany(input: CompanyInput): Promise<ActionResult> {
  const me = await actorFor("company", "edit");
  if (!me) return forbidden();
  const errs = companyErrors(input);
  if (Object.keys(errs).length) return fail("VALIDATION", "입력 내용을 확인하세요.", errs);
  const v = {
    name: input.name.trim(),
    bizNo: formatBizNo(input.bizNo),
    ceoName: input.ceoName.trim(),
    zipCode: input.zipCode,
    addr1: input.addr1.trim(),
    addr2: input.addr2.trim(),
    phone: input.phone.trim() ? formatPhone(input.phone) : null,
    email: input.email.trim() || null,
  };

  return run(() =>
    db.$transaction(async (tx) => {
      const cur = await tx.company.findUnique({ where: { id: 1 } });
      if (!cur) return fail("NOT_FOUND", "회사 정보를 찾을 수 없습니다.");
      if (cur.version !== input.version) return conflict();
      const d = diff(cur, v);
      if (!d) return done("바뀐 내용이 없습니다.");
      const r = await tx.company.updateMany({ where: { id: 1, version: input.version }, data: { ...v, updatedBy: me.name, version: { increment: 1 } } });
      if (r.count === 0) return conflict();
      await log(tx, "tb_company", "1", "UPDATE", me.name, d.b, d.a);
      return done("회사 정보를 저장했습니다.");
    }),
  );
}

/* ───────── 센터 (3PL 관리자만 등록·수정, 삭제 없음) ───────── */

interface CenterInput {
  id?: number;
  version?: number;
  code: string;
  name: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  inboundTel: string;
  managerUserId: number | null;
  dailyCloseTime: string;
  isActive: boolean;
}

function centerErrors(v: CenterInput, isNew: boolean) {
  const e: Record<string, string> = {};
  if (isNew && !/^[A-Z0-9]{3,5}$/.test(v.code.trim())) e.code = "센터 코드는 영문 대문자·숫자 3~5자로 입력하세요";
  const name = textError(v.name, "센터명", 100);
  if (name) e.name = name;
  Object.assign(e, addressErrors(v));
  if (!isValidPhone(v.inboundTel)) e.inboundTel = v.inboundTel.trim() ? MSG.phone : "입고 문의 전화를 입력하세요";
  if (!isValidTime(v.dailyCloseTime)) e.dailyCloseTime = "일마감 예정 시각을 HH:mm(00:00~23:59)으로 입력하세요";
  return e;
}

export async function saveCenter(input: CenterInput): Promise<ActionResult<{ id: number }>> {
  const me = await actorFor("centers", "edit");
  if (!me) return forbidden();
  const isNew = !input.id;
  const errs = centerErrors(input, isNew);
  if (Object.keys(errs).length) return fail("VALIDATION", "입력 내용을 확인하세요.", errs);
  const v = {
    name: input.name.trim(),
    zipCode: input.zipCode,
    addr1: input.addr1.trim(),
    addr2: input.addr2.trim(),
    inboundTel: formatPhone(input.inboundTel),
    managerUserId: input.managerUserId,
    dailyCloseTime: input.dailyCloseTime,
    isActive: input.isActive,
  };

  return run(() =>
    db.$transaction(async (tx) => {
      // 담당자: 그 센터 소속 · 사용 중 · 3PL 관리자/운영담당만
      if (v.managerUserId) {
        const m = await tx.user.findUnique({ where: { id: v.managerUserId } });
        const ok = m && m.isActive && isManagerCandidate(m.roles) && !isNew && m.centerId === input.id;
        if (!ok) return fail("VALIDATION", "입력 내용을 확인하세요.", { managerUserId: "이 센터에 소속된 3PL 관리자·운영담당 중에서 고르세요" });
      }
      const sameName = await tx.center.findFirst({ where: { name: v.name, ...(isNew ? {} : { NOT: { id: input.id } }) } });
      if (sameName) return fail("VALIDATION", "입력 내용을 확인하세요.", { name: "이미 등록된 센터명입니다" });

      if (isNew) {
        const code = input.code.trim();
        if (await tx.center.findUnique({ where: { code } }))
          return fail("VALIDATION", "입력 내용을 확인하세요.", { code: "이미 사용 중인 센터 코드입니다" });
        const row = await tx.center.create({ data: { code, companyId: 1, ...v, createdBy: me.name, updatedBy: me.name } });
        await log(tx, "tb_center", String(row.id), "CREATE", me.name, null, { code, ...v });
        return done(`센터 ${row.name}을(를) 등록했습니다.`, { id: row.id });
      }

      const cur = await tx.center.findUnique({ where: { id: input.id } });
      if (!cur) return fail("NOT_FOUND", "센터를 찾을 수 없습니다.");
      if (cur.version !== input.version) return conflict();
      const d = diff(cur, v);
      if (!d) return done("바뀐 내용이 없습니다.", { id: cur.id });
      const r = await tx.center.updateMany({
        where: { id: cur.id, version: input.version },
        data: { ...v, updatedBy: me.name, version: { increment: 1 } },
      });
      if (r.count === 0) return conflict();
      await log(tx, "tb_center", String(cur.id), "UPDATE", me.name, d.b, d.a);
      return done(`센터 ${v.name} 정보를 저장했습니다.`, { id: cur.id });
    }),
  );
}

/* ───────── 휴무일 ───────── */

const holidaySchema = z.object({
  centerId: z.number({ error: "센터를 선택하세요." }).int().positive("센터를 선택하세요."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요."),
  name: trimmed(100, "휴무일 이름"),
  kind: z.enum(["PUBLIC", "CENTER"], { error: "구분을 선택하세요." }),
});

export async function addHoliday(input: z.input<typeof holidaySchema>): Promise<ActionResult<{ id: number }>> {
  const me = await actorFor("holidays", "edit");
  if (!me) return forbidden();
  const p = holidaySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const date = new Date(`${v.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== v.date)
    return fail("VALIDATION", "입력 내용을 확인하세요.", { date: "올바른 날짜를 선택하세요." });
  const actor = me.name;

  return run(() =>
    db.$transaction(async (tx) => {
      const exists = await tx.holiday.findUnique({ where: { centerId_date: { centerId: v.centerId, date } } });
      if (exists) return fail("VALIDATION", "입력 내용을 확인하세요.", { date: `이미 등록된 날짜입니다 (${exists.name}).` });
      const center = await tx.center.findUnique({ where: { id: v.centerId } });
      if (!center?.isActive) return fail("VALIDATION", "입력 내용을 확인하세요.", { centerId: "사용 중인 센터를 선택하세요." });
      const row = await tx.holiday.create({ data: { centerId: v.centerId, date, name: v.name, kind: v.kind, source: "MANUAL", createdBy: actor } });
      await log(tx, "tb_holiday", String(row.id), "CREATE", actor, null, { date: v.date, name: v.name, kind: v.kind, source: "MANUAL" });
      return done(`${v.date} ${v.name}을(를) 휴무일로 등록했습니다.`, { id: row.id });
    }),
  );
}

/** 휴무일은 전표가 참조하지 않으므로 삭제한다(공공데이터에서 불러온 것도). 삭제 내역은 변경 이력에 남는다 */
export async function deleteHoliday(input: { id: number }): Promise<ActionResult> {
  const me = await actorFor("holidays", "edit");
  if (!me) return forbidden();
  const actor = me.name;
  return run(() =>
    db.$transaction(async (tx) => {
      const cur = await tx.holiday.findUnique({ where: { id: input.id } });
      if (!cur) return fail("NOT_FOUND", "이미 삭제된 휴무일입니다.");
      await tx.holiday.delete({ where: { id: cur.id } });
      const date = cur.date.toISOString().slice(0, 10);
      await log(tx, "tb_holiday", String(cur.id), "DELETE", actor, { date, name: cur.name, kind: cur.kind, source: cur.source }, null);
      return done(`${date} ${cur.name}을(를) 휴무일에서 뺐습니다.`);
    }),
  );
}

const importSchema = z.object({
  year: z.number().int().min(2000, "연도를 확인하세요.").max(2100, "연도를 확인하세요."),
  /** 비우면 사용 중인 모든 센터 */
  centerId: z.number().int().positive().nullable(),
});

/**
 * 공공데이터(특일 정보)의 공휴일을 센터 휴무일로 넣는다.
 * 이미 휴무일이 있는 날짜(직접 등록 포함)는 건너뛴다. 전에 삭제한 공휴일은 다시 들어간다 (2026-11-04 Sol 결정).
 */
export async function importPublicHolidays(input: z.input<typeof importSchema>): Promise<ActionResult<{ added: number; skipped: number }>> {
  const me = await actorFor("holidays", "edit");
  if (!me) return forbidden();
  const p = importSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const actor = me.name;

  const fetched = await fetchPublicHolidays(v.year);
  if (!fetched.ok) return fail("EXTERNAL", fetched.error);
  if (fetched.rows.length === 0) return fail("EXTERNAL", `공공데이터에 ${v.year}년 공휴일이 아직 없습니다. 보통 전년도 하반기에 공개됩니다.`);

  return run(() =>
    db.$transaction(async (tx) => {
      const centers = await tx.center.findMany({ where: { isActive: true, ...(v.centerId ? { id: v.centerId } : {}) }, select: { id: true, name: true } });
      if (!centers.length) return fail("VALIDATION", "입력 내용을 확인하세요.", { centerId: "사용 중인 센터를 선택하세요." });
      const dates = fetched.rows.map((r) => ymdDate(r.date));
      const existing = await tx.holiday.findMany({ where: { centerId: { in: centers.map((c) => c.id) }, date: { in: dates } }, select: { centerId: true, date: true } });
      const taken = new Set(existing.map((e) => `${e.centerId}|${e.date.toISOString().slice(0, 10)}`));
      // 같은 날 이름이 둘이면(예: 어린이날·부처님오신날 겹침) 한 행으로 합친다
      const byDate = new Map<string, string>();
      for (const r of fetched.rows) byDate.set(r.date, byDate.has(r.date) ? `${byDate.get(r.date)} · ${r.name}`.slice(0, 100) : r.name);
      let added = 0;
      let skipped = 0;
      for (const c of centers) {
        for (const [date, name] of byDate) {
          if (taken.has(`${c.id}|${date}`)) {
            skipped++;
            continue;
          }
          const row = await tx.holiday.create({ data: { centerId: c.id, date: ymdDate(date), name, kind: "PUBLIC", source: "API", createdBy: actor } });
          await log(tx, "tb_holiday", String(row.id), "CREATE", actor, null, { date, name, kind: "PUBLIC", source: "API" });
          added++;
        }
      }
      const where = centers.length === 1 ? centers[0].name : `센터 ${centers.length}곳`;
      const msg = added
        ? `${v.year}년 공휴일 ${added}건을 ${where}에 불러왔습니다.${skipped ? ` 이미 등록된 ${skipped}건은 건너뛰었습니다.` : ""}`
        : `${v.year}년 공휴일이 ${where}에 모두 등록되어 있습니다. 새로 넣은 날짜는 없습니다.`;
      return done(msg, { added, skipped });
    }),
  );
}

/* ───────── 계정 관리 (3PL 관리자만) ───────── */

/** 잠금 해제 — 연속 실패 횟수도 0으로 */
export async function unlockUser(input: { id: number }): Promise<ActionResult> {
  const me = await actorFor("accounts", "edit");
  if (!me) return forbidden();
  return run(() =>
    db.$transaction(async (tx) => {
      const cur = await tx.user.findUnique({ where: { id: input.id } });
      if (!cur) return fail("NOT_FOUND", "사용자를 찾을 수 없습니다.");
      if (!cur.lockedAt) return done("잠긴 계정이 아닙니다.");
      await tx.user.update({ where: { id: cur.id }, data: { lockedAt: null, failCount: 0 } });
      await log(tx, "tb_user", String(cur.id), "UNLOCK", me.name, { locked: true }, { locked: false });
      return done(`${cur.name}(${cur.loginId}) 계정의 잠금을 해제했습니다.`);
    }),
  );
}

/**
 * 비밀번호 초기화 — 임시 비밀번호를 만들어 한 번만 보여 준다.
 * 잠금도 함께 풀고, 다음 로그인에서 비밀번호 변경을 강제하며, 열려 있던 세션은 모두 끊는다.
 */
export async function resetUserPassword(input: { id: number }): Promise<ActionResult<{ tempPassword: string }>> {
  const me = await actorFor("accounts", "edit");
  if (!me) return forbidden();
  const temp = tempPassword();
  const hash = await hashPassword(temp);
  return run(() =>
    db.$transaction(async (tx) => {
      const cur = await tx.user.findUnique({ where: { id: input.id } });
      if (!cur) return fail("NOT_FOUND", "사용자를 찾을 수 없습니다.");
      await tx.user.update({
        where: { id: cur.id },
        data: { passwordHash: hash, mustChangePw: true, lockedAt: null, failCount: 0 },
      });
      await tx.session.deleteMany({ where: { userId: cur.id } });
      await log(tx, "tb_user", String(cur.id), "PASSWORD_RESET", me.name, null, { password: "초기화(첫 로그인 시 변경)" });
      return done(`${cur.name}(${cur.loginId}) 비밀번호를 초기화했습니다.`, { tempPassword: temp });
    }),
  );
}
