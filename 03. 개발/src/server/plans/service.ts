import "server-only";
/**
 * 입고예정 처리 — 화주사 저장·취소, 3PL 승인·반려.
 * 근거: 정의서 v1.4 ①② · 4-1 · C1~C2 · D1·D3·D6·D19
 * 처리자를 인자로 받아 서버 액션(actions.ts)과 점검 스크립트가 같은 규칙을 쓴다.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { fail, type ActionResult } from "@/server/action-result";
import type { SessionUser } from "@/server/session";
import type { Prisma } from "@/generated/prisma/client";
import { can } from "@/domain/permissions";
import { CANCEL_GROUP, PLAN_REJECT_GROUP, REMAIN_CLOSE_GROUP } from "@/domain/master";
import { PLAN_STATUS_META, type PlanStatus } from "@/domain/plan-status";
import { CONFLICT_MSG, SAVE_CONFLICT_MSG, canReview, canShipperEdit, nextPlanNo, planNoPrefix } from "@/domain/plan-rules";
import { approvedCancelBlock, OPEN_ASN } from "@/domain/inquiry-rules";
import { MAX_CLOSE_BATCH, remainCloseBlock, remainOf } from "@/domain/close-rules";
import { PRE_APPROVAL } from "@/domain/business-day";
import { dailyTargets, rcvSums } from "@/server/plans/closing";
import { expiryTooEarlyMsg, minExpiryDate } from "@/domain/plan-entry";
import { minExpiryDays } from "@/server/plans/entry";
import { todayKst } from "@/lib/format";

/** 승인 건 취소 시점 version 불일치 (그사이 검수 배분 등으로 바뀜) */
const INQUIRY_CONFLICT_MSG = "그사이 내용이 바뀐 입고예정입니다. 최신 내용을 확인한 뒤 다시 처리하세요.";
/** 일마감 도중 실적·취소 대상이 바뀜 */
const DAILY_CONFLICT_MSG = "그사이 확정할 검수 실적이나 기한경과 대상이 바뀌었습니다. 화면을 새로 고쳐 다시 확인한 뒤 일마감하세요.";

type Tx = Prisma.TransactionClient;
export type PlanActor = Pick<SessionUser, "id" | "name" | "roles" | "clientId" | "centerId">;

const ok = <T>(message: string, data?: T): ActionResult<T> => ({ ok: true, message, data });
const forbidden = () => fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
const notFound = () => fail("NOT_FOUND", "입고예정을 찾을 수 없습니다. 목록을 새로 고쳐 보세요.");
const stateError = (s: PlanStatus, verb: string) => fail("STATE", `${PLAN_STATUS_META[s].label} 상태인 입고예정은 ${verb}할 수 없습니다.`);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** 동시 처리로 조건부 갱신이 0건이면 트랜잭션을 되돌리고 CONFLICT로 바꾼다 */
class Race extends Error {}

async function guarded<T>(fn: () => Promise<ActionResult<T>>, raceMsg: string): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Race) return fail("CONFLICT", raceMsg);
    if ((e as { code?: string }).code === "P2002") return fail("CONFLICT", "같은 번호로 동시에 저장되었습니다. 다시 저장하세요.");
    console.error(e);
    return fail("ERROR", "처리하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

/** 사유 코드 확인 (D19: 공통코드 드롭다운, '기타'류는 상세 필수) */
async function checkReason(tx: Tx, group: string, code: string, text: string) {
  const r = await tx.commonCode.findUnique({ where: { groupCode_code: { groupCode: group, code } } });
  if (!r || !r.isActive) return { error: fail("VALIDATION", "입력 내용을 확인하세요.", { reasonCode: "사유를 선택하세요." }) };
  if (r.requiresText && !text.trim())
    return { error: fail("VALIDATION", "입력 내용을 확인하세요.", { reasonText: `"${r.name}"을(를) 고르면 상세 내용을 입력해야 합니다.` }) };
  return { reason: r };
}

/* ═════════ 화주사: 저장(등록·수정·재저장) ═════════ */

const lineSchema = z.object({
  itemId: z.number().int().positive("품목을 선택하세요."),
  unit: z.enum(["EA", "BOX", "PLT"]),
  qty: z.number({ error: "수량을 입력하세요." }).int("수량은 정수로 입력하세요.").positive("수량은 0보다 커야 합니다.").max(999_999, "수량이 너무 큽니다."),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  lotNo: z.string().trim().max(40, "로트는 40자 이내로 입력하세요.").nullish(),
});

const saveSchema = z.object({
  id: z.number().int().positive().optional(),
  version: z.number().int().positive().optional(),
  centerId: z.number({ error: "센터를 선택하세요." }).int().positive("센터를 선택하세요."),
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "입고예정일을 선택하세요."),
  inputMethod: z.enum(["DIRECT", "EXCEL", "AI_IMAGE"]).default("DIRECT"),
  memo: z.string().trim().max(500, "메모는 500자 이내로 입력하세요.").nullish(),
  lines: z.array(lineSchema).min(1, "품목을 1개 이상 입력하세요.").max(300, "한 번에 300줄까지 입력할 수 있습니다."),
});
export type SavePlanInput = z.input<typeof saveSchema>;

export async function savePlan(me: PlanActor, input: SavePlanInput): Promise<ActionResult<{ id: number; planNo: string }>> {
  if (!can(me.roles, "planEntry", "edit") || !me.clientId) return forbidden();
  const p = saveSchema.safeParse(input);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) {
      const k = i.path.length > 1 ? `lines.${String(i.path[1])}.${String(i.path[2] ?? "")}` : String(i.path[0] ?? "_");
      fe[k] ??= i.message;
    }
    return fail("VALIDATION", "입력 내용을 확인하세요.", fe);
  }
  const v = p.data;
  const clientId = me.clientId;
  const today = todayKst();
  if (v.planDate < today) return fail("VALIDATION", "입력 내용을 확인하세요.", { planDate: "입고예정일은 오늘 이후로 선택하세요." });

  return guarded(
    () =>
      db.$transaction(async (tx) => {
        // 센터: 사용 중 + 이 화주사의 이용 센터
        const center = await tx.center.findUnique({ where: { id: v.centerId } });
        const linked = center && (await tx.clientCenter.findUnique({ where: { clientId_centerCode: { clientId, centerCode: center.code } } }));
        if (!center || !center.isActive || !linked) return fail("VALIDATION", "입력 내용을 확인하세요.", { centerId: "이용 중인 센터를 선택하세요." });

        // 품목: 이 화주사의 사용 중 품목 + 등록된 단위 (C1: 마스터 미매칭 0건)
        const items = await tx.item.findMany({ where: { id: { in: v.lines.map((l) => l.itemId) }, clientId }, include: { uoms: true } });
        const byId = new Map(items.map((i) => [i.id, i]));
        // 소비기한 하한 = 입고예정일 + 최소 잔여일수 (운영 설정)
        const minDays = await minExpiryDays(tx);
        const minExpiry = minExpiryDate(v.planDate, minDays);
        const fe: Record<string, string> = {};
        const seen = new Set<string>();
        const lines = v.lines.map((l, i) => {
          const item = byId.get(l.itemId);
          const at = (k: string, m: string) => (fe[`lines.${i}.${k}`] ??= m);
          if (!item || !item.isActive) {
            at("itemId", "사용 중인 품목만 입력할 수 있습니다.");
            return null;
          }
          const uom = item.uoms.find((u) => u.unit === l.unit);
          if (!uom) at("unit", `${item.name}에 등록되지 않은 단위입니다.`);
          const expiry = l.expiryDate || null;
          const lot = l.lotNo?.trim() || null;
          if (item.expiryManaged && !expiry) at("expiryDate", "소비기한 관리 품목은 소비기한을 입력하세요.");
          else if (item.expiryManaged && expiry && expiry < minExpiry) at("expiryDate", expiryTooEarlyMsg(minExpiry, minDays));
          if (item.lotManaged && !lot) at("lotNo", "로트 관리 품목은 로트를 입력하세요.");
          const key = `${l.itemId}:${l.unit}:${expiry}:${lot}`;
          if (seen.has(key)) at("itemId", "같은 품목·단위·소비기한·로트가 중복되었습니다. 한 줄로 합치세요.");
          seen.add(key);
          return {
            lineNo: i + 1,
            itemId: l.itemId,
            unit: l.unit,
            qty: l.qty,
            baseQty: l.qty * (uom?.qty ?? 1),
            expiryDate: item.expiryManaged && expiry ? asDate(expiry) : null,
            lotNo: item.lotManaged ? lot : null,
          };
        });
        if (Object.keys(fe).length) return fail("VALIDATION", "입력 내용을 확인하세요.", fe);
        const rows = lines.filter((l) => l !== null);
        const header = { centerId: v.centerId, planDate: asDate(v.planDate), inputMethod: v.inputMethod, memo: v.memo || null };

        if (!v.id) {
          const used = await tx.inboundPlan.findMany({ where: { planNo: { startsWith: planNoPrefix(today) } }, select: { planNo: true } });
          const planNo = nextPlanNo(today, used.map((u) => u.planNo));
          const plan = await tx.inboundPlan.create({
            data: { ...header, planNo, clientId, savedBy: me.name, createdBy: me.name, updatedBy: me.name, lines: { create: rows } },
          });
          await tx.inboundPlanHistory.create({ data: { planId: plan.id, action: "CREATE", version: 1, revisionNo: 1, actor: me.name, actorId: me.id } });
          return ok(`입고예정 ${planNo}을(를) 저장했습니다. 3PL 승인을 기다립니다.`, { id: plan.id, planNo });
        }

        const cur = await tx.inboundPlan.findUnique({ where: { id: v.id } });
        if (!cur || cur.clientId !== clientId) return notFound();
        if (!canShipperEdit(cur.status)) return stateError(cur.status, "수정");
        if (cur.version !== v.version) return fail("CONFLICT", SAVE_CONFLICT_MSG);
        const resubmit = cur.status === "REJECTED";
        const r = await tx.inboundPlan.updateMany({
          where: { id: cur.id, version: cur.version, status: cur.status },
          data: {
            ...header,
            status: "WAITING",
            version: { increment: 1 },
            revisionNo: resubmit ? { increment: 1 } : undefined,
            savedAt: new Date(),
            savedBy: me.name,
            updatedBy: me.name,
          },
        });
        if (r.count === 0) throw new Race();
        await tx.inboundPlanLine.deleteMany({ where: { planId: cur.id } });
        await tx.inboundPlanLine.createMany({ data: rows.map((l) => ({ ...l, planId: cur.id })) });
        const revisionNo = cur.revisionNo + (resubmit ? 1 : 0);
        await tx.inboundPlanHistory.create({
          data: { planId: cur.id, action: resubmit ? "RESUBMIT" : "UPDATE", version: cur.version + 1, revisionNo, actor: me.name, actorId: me.id },
        });
        return ok(
          resubmit ? `${cur.planNo}을(를) ${revisionNo}차로 다시 요청했습니다.` : `${cur.planNo} 수정 내용을 저장했습니다.`,
          { id: cur.id, planNo: cur.planNo },
        );
      }),
    SAVE_CONFLICT_MSG,
  );
}

/* ═════════ 화주사: 취소 (승인 전만) ═════════ */

export async function cancelPlanByShipper(
  me: PlanActor,
  input: { id: number; version: number; reasonCode: string; reasonText?: string },
): Promise<ActionResult> {
  if (!can(me.roles, "planEntry", "edit") || !me.clientId) return forbidden();
  const text = input.reasonText?.trim() ?? "";
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        const cur = await tx.inboundPlan.findUnique({ where: { id: input.id } });
        if (!cur || cur.clientId !== me.clientId) return notFound();
        if (!canShipperEdit(cur.status)) return stateError(cur.status, "취소");
        if (cur.version !== input.version) return fail("CONFLICT", SAVE_CONFLICT_MSG);
        const { reason, error } = await checkReason(tx, CANCEL_GROUP, input.reasonCode, text);
        if (error) return error;
        const r = await tx.inboundPlan.updateMany({
          where: { id: cur.id, version: cur.version, status: cur.status },
          data: {
            status: "CANCELED",
            version: { increment: 1 },
            cancelReasonCode: reason.code,
            cancelReasonText: text || null,
            canceledAt: new Date(),
            canceledBy: me.name,
            updatedBy: me.name,
          },
        });
        if (r.count === 0) throw new Race();
        await tx.inboundPlanHistory.create({
          data: {
            planId: cur.id, action: "CANCEL", version: cur.version + 1, revisionNo: cur.revisionNo, actor: me.name, actorId: me.id,
            reasonCode: reason.code, reasonName: reason.name, reasonText: text || null,
          },
        });
        return ok(`${cur.planNo}을(를) 취소했습니다.`);
      }),
    SAVE_CONFLICT_MSG,
  );
}

/* ═════════ 3PL: 승인 건 취소 (입고예정 조회 상세, C3·D5) ═════════ */

/**
 * 승인 건 취소 — 3PL만, 승인 상태, 후행 전표(취소되지 않은 ASN·검수 배분)가 없을 때만, 사유 필수, 최종 상태 "취소".
 * ASN 분배(asn/service)가 입고예정 라인을 FOR UPDATE로 잠그고 상태를 확인하므로, 여기서도 같은 라인을 먼저 잠근다.
 */
export async function cancelApprovedPlan(
  me: PlanActor,
  input: { id: number; version: number; reasonCode: string; reasonText?: string },
): Promise<ActionResult> {
  if (!can(me.roles, "planInquiry", "edit")) return forbidden();
  const text = input.reasonText?.trim() ?? "";
  if (text.length > 500) return fail("VALIDATION", "입력 내용을 확인하세요.", { reasonText: "상세 내용은 500자 이내로 입력하세요." });
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        const cur = await tx.inboundPlan.findUnique({ where: { id: input.id }, include: { lines: { select: { id: true }, orderBy: { id: "asc" } } } });
        if (!cur || (me.centerId && cur.centerId !== me.centerId)) return notFound();
        const ids = cur.lines.map((l) => l.id);
        if (ids.length) await tx.$queryRaw`SELECT id FROM tb_inb_plan_d WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
        const [activeAsnCount, allocCount] = await Promise.all([
          tx.asn.count({ where: { status: { not: "CANCELED" }, lines: { some: { planId: cur.id } } } }),
          tx.rcvAlloc.count({ where: { planLineId: { in: ids }, reverse: false } }),
        ]);
        const block = approvedCancelBlock({ status: cur.status, activeAsnCount, allocCount });
        if (block) return fail("STATE", block);
        if (cur.version !== input.version) return fail("CONFLICT", INQUIRY_CONFLICT_MSG);
        const { reason, error } = await checkReason(tx, CANCEL_GROUP, input.reasonCode, text);
        if (error) return error;
        const r = await tx.inboundPlan.updateMany({
          where: { id: cur.id, version: cur.version, status: "APPROVED" },
          data: {
            status: "CANCELED",
            version: { increment: 1 },
            cancelReasonCode: reason.code,
            cancelReasonText: text || null,
            canceledAt: new Date(),
            canceledBy: me.name,
            updatedBy: me.name,
          },
        });
        if (r.count === 0) throw new Race();
        await tx.inboundPlanHistory.create({
          data: {
            planId: cur.id, action: "CANCEL_APPROVED", version: cur.version + 1, revisionNo: cur.revisionNo, actor: me.name, actorId: me.id,
            reasonCode: reason.code, reasonName: reason.name, reasonText: text || null,
          },
        });
        return ok(`${cur.planNo} 승인 건을 취소했습니다. 다시 입고하려면 화주사가 새 입고예정을 등록해야 합니다.`);
      }),
    INQUIRY_CONFLICT_MSG,
  );
}

/* ═════════ 3PL: 승인·반려 (상세를 보고 단건만, 처리 시점 version 비교) ═════════ */

/** 3PL 처리 대상 확인 — 권한·센터 범위·상태·version */
async function reviewTarget(tx: Tx, me: PlanActor, id: number, version: number) {
  const cur = await tx.inboundPlan.findUnique({ where: { id } });
  if (!cur || (me.centerId && cur.centerId !== me.centerId)) return { error: notFound() };
  if (cur.version !== version) return { error: fail("CONFLICT", CONFLICT_MSG) };
  if (!canReview(cur.status)) return { error: fail("STATE", `이미 처리된 입고예정입니다. (현재 상태: ${PLAN_STATUS_META[cur.status].label})`) };
  return { cur };
}

export async function approvePlan(me: PlanActor, input: { id: number; version: number }): Promise<ActionResult> {
  if (!can(me.roles, "approval", "edit")) return forbidden();
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        const { cur, error } = await reviewTarget(tx, me, input.id, input.version);
        if (error) return error;
        const r = await tx.inboundPlan.updateMany({
          where: { id: cur.id, version: cur.version, status: "WAITING" },
          data: { status: "APPROVED", approvedRevisionNo: cur.revisionNo, approvedAt: new Date(), approvedBy: me.name, updatedBy: me.name },
        });
        if (r.count === 0) throw new Race();
        await tx.inboundPlanHistory.create({
          data: { planId: cur.id, action: "APPROVE", version: cur.version, revisionNo: cur.revisionNo, actor: me.name, actorId: me.id },
        });
        return ok(`${cur.planNo} 승인 완료 · 승인 차수 ${cur.revisionNo} 기록, 수정 잠금`);
      }),
    CONFLICT_MSG,
  );
}

export async function rejectPlan(
  me: PlanActor,
  input: { id: number; version: number; reasonCode: string; reasonText?: string },
): Promise<ActionResult> {
  if (!can(me.roles, "approval", "edit")) return forbidden();
  const text = input.reasonText?.trim() ?? "";
  if (text.length > 500) return fail("VALIDATION", "입력 내용을 확인하세요.", { reasonText: "상세 내용은 500자 이내로 입력하세요." });
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        const { cur, error } = await reviewTarget(tx, me, input.id, input.version);
        if (error) return error;
        const { reason, error: reasonError } = await checkReason(tx, PLAN_REJECT_GROUP, input.reasonCode, text);
        if (reasonError) return reasonError;
        const r = await tx.inboundPlan.updateMany({
          where: { id: cur.id, version: cur.version, status: "WAITING" },
          data: { status: "REJECTED", updatedBy: me.name },
        });
        if (r.count === 0) throw new Race();
        // 반려하는 순간의 헤더·라인 전체를 n차 반려본으로 보관 (Append-only)
        const lines = await tx.inboundPlanLine.findMany({ where: { planId: cur.id }, orderBy: { lineNo: "asc" }, include: { item: true } });
        await tx.inboundPlanReject.create({
          data: {
            planId: cur.id,
            revisionNo: cur.revisionNo,
            version: cur.version,
            planDate: cur.planDate,
            memo: cur.memo,
            reasonCode: reason.code,
            reasonName: reason.name,
            reasonText: text || null,
            rejectedBy: me.name,
            lines: {
              create: lines.map((l) => ({
                lineNo: l.lineNo, itemId: l.itemId, itemCode: l.item.code, itemName: l.item.name,
                unit: l.unit, qty: l.qty, baseQty: l.baseQty, expiryDate: l.expiryDate, lotNo: l.lotNo,
              })),
            },
          },
        });
        await tx.inboundPlanHistory.create({
          data: {
            planId: cur.id, action: "REJECT", version: cur.version, revisionNo: cur.revisionNo, actor: me.name, actorId: me.id,
            reasonCode: reason.code, reasonName: reason.name, reasonText: text || null,
          },
        });
        return ok(`${cur.planNo}을(를) 반려했습니다 (${cur.revisionNo}차 반려본 보관).`);
      }),
    CONFLICT_MSG,
  );
}

/* ═════════ 3PL: 잔량 종결 (정의서 ⑦ · 4-2 · D17, 2026-11-12) ═════════ */

/**
 * 잔량 종결 — 건별·일괄. 고른 건을 한 번에 처리하며, 한 건이라도 막히면 아무것도 바꾸지 않는다(어느 건이 왜 막혔는지 알려 준다).
 * 건마다: 승인·부분입고 + 오는 중 ASN 없음 + 잔량 있음 + 화면에서 본 version 그대로일 때만.
 * 라인별 잔량(승인 − 입고 − 반송 − 종결)을 종결 수량으로 옮기고 상태를 종결로 바꾼다. 사유 필수(REMAIN_CLOSE).
 */
export async function closeRemainPlans(
  me: PlanActor,
  input: { items: { id: number; version: number }[]; reasonCode: string; reasonText?: string },
): Promise<ActionResult<{ count: number }>> {
  if (!can(me.roles, "closing", "edit")) return forbidden();
  const items = [...new Map((input.items ?? []).map((i) => [i.id, i])).values()];
  if (!items.length) return fail("VALIDATION", "종결할 입고예정을 고르세요.");
  if (items.length > MAX_CLOSE_BATCH) return fail("VALIDATION", `한 번에 ${MAX_CLOSE_BATCH}건까지 종결할 수 있습니다.`);
  const text = input.reasonText?.trim() ?? "";
  if (text.length > 500) return fail("VALIDATION", "입력 내용을 확인하세요.", { reasonText: "상세 내용은 500자 이내로 입력하세요." });
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        const { reason, error } = await checkReason(tx, REMAIN_CLOSE_GROUP, input.reasonCode, text);
        if (error) return error;
        const ids = items.map((i) => i.id);
        // 헤더를 id 순서로 잠근다 (동시에 검수 배분·다른 종결이 들어오지 않게)
        await tx.$queryRaw`SELECT id FROM tb_inb_plan_h WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
        const plans = await tx.inboundPlan.findMany({ where: { id: { in: ids } }, include: { lines: { orderBy: { id: "asc" } } } });
        const lineIds = plans.flatMap((p) => p.lines.map((l) => l.id));
        if (lineIds.length) await tx.$queryRaw`SELECT id FROM tb_inb_plan_d WHERE id = ANY(${lineIds}::int[]) ORDER BY id FOR UPDATE`;
        const openAsn = await tx.asnLine.findMany({
          where: { planId: { in: ids }, asn: { status: { in: [...OPEN_ASN] } } },
          select: { planId: true, asnId: true },
          distinct: ["planId", "asnId"],
        });
        const blocked: string[] = [];
        for (const it of items) {
          const p = plans.find((x) => x.id === it.id);
          if (!p || (me.centerId && p.centerId !== me.centerId)) return notFound();
          if (p.version !== it.version) blocked.push(`${p.planNo}: 그사이 내용이 바뀌었습니다.`);
          else {
            const why = remainCloseBlock({ status: p.status, openAsnCount: openAsn.filter((a) => a.planId === p.id).length, remain: p.lines.reduce((s, l) => s + remainOf(l), 0) });
            if (why) blocked.push(`${p.planNo}: ${why}`);
          }
        }
        if (blocked.length) return fail("STATE", `종결하지 못한 건이 있어 아무것도 처리하지 않았습니다.\n${blocked.join("\n")}`);

        const now = new Date();
        for (const p of plans) {
          for (const l of p.lines) {
            const r = remainOf(l);
            if (r > 0) await tx.inboundPlanLine.update({ where: { id: l.id }, data: { closeQty: { increment: r } } });
          }
          const u = await tx.inboundPlan.updateMany({
            where: { id: p.id, version: p.version, status: { in: ["APPROVED", "PARTIAL"] } },
            data: { status: "CLOSED", version: { increment: 1 }, closeReasonCode: reason.code, closeReasonText: text || null, closedAt: now, closedBy: me.name, updatedBy: me.name },
          });
          if (u.count === 0) throw new Race();
          await tx.inboundPlanHistory.create({
            data: {
              planId: p.id, action: "CLOSE", version: p.version + 1, revisionNo: p.revisionNo, actor: me.name, actorId: me.id,
              reasonCode: reason.code, reasonName: reason.name, reasonText: text || null,
            },
          });
        }
        return ok(plans.length === 1 ? `${plans[0].planNo} 잔량을 종결했습니다.` : `${plans.length}건의 잔량을 종결했습니다.`, { count: plans.length });
      }),
    INQUIRY_CONFLICT_MSG,
  );
}

/* ═════════ 3PL: 일마감 (정의서 ⑦ · D18 · D21, 2026-11-12) ═════════ */

/** 기한경과 취소 사유 — 일마감 자동 처리 전용 (CANCEL 그룹, 사람이 고르는 목록에서는 뺀다) */
const EXPIRE_REASON_CODE = "X04";

/**
 * 일마감 — 센터의 지금 업무일을 마감한다(센터·업무일당 1회, 되돌리기 없음).
 * 1) 아직 일마감되지 않은 검수 확정 실적을 확정한다(실적 → 이 일마감).
 * 2) 기한경과 승인 전 입고예정을 취소한다(사유 "기한경과(일마감 자동)", 이력 기한경과 취소).
 * 화면에서 본 대상(실적·취소 건 id)과 지금 대상이 다르면 아무것도 하지 않고 다시 확인하게 한다.
 * 전표를 닫지 않으므로 미종결 입고예정·승인 이후 건은 건드리지 않는다.
 */
export async function runDailyClose(
  me: PlanActor,
  input: { centerId: number; businessDate: string; rcvIds: number[]; expireIds: number[] },
): Promise<ActionResult<{ dailyCloseId: number }>> {
  if (!can(me.roles, "closing", "edit")) return forbidden();
  if (me.centerId && me.centerId !== input.centerId) return fail("FORBIDDEN", "소속 센터만 일마감할 수 있습니다.");
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        // 같은 센터 일마감이 동시에 두 번 돌지 않게 센터 행을 잠근다
        await tx.$queryRaw`SELECT id FROM tb_center WHERE id = ${input.centerId} FOR UPDATE`;
        const center = await tx.center.findUnique({ where: { id: input.centerId } });
        if (!center) return fail("NOT_FOUND", "센터를 찾을 수 없습니다.");
        const now = new Date();
        const { today, rcvs, expire } = await dailyTargets(tx, center, now);
        if (today !== input.businessDate) return fail("STATE", `업무일이 바뀌었습니다(지금 ${today}). 화면을 새로 고쳐 다시 확인하세요.`);
        const done = await tx.dailyClose.findUnique({ where: { centerId_businessDate: { centerId: center.id, businessDate: new Date(`${today}T00:00:00Z`) } } });
        if (done) return fail("STATE", `${center.name} ${today} 업무일은 이미 일마감했습니다 (${done.closedBy}).`);
        const same = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
        if (!same(rcvs.map((r) => r.id), input.rcvIds) || !same(expire.map((p) => p.id), input.expireIds)) return fail("CONFLICT", DAILY_CONFLICT_MSG);

        const reason = expire.length ? await tx.commonCode.findUnique({ where: { groupCode_code: { groupCode: CANCEL_GROUP, code: EXPIRE_REASON_CODE } } }) : null;
        if (expire.length && !reason) return fail("STATE", "기한경과 취소 사유 코드(X04)가 없습니다. 기준정보 › 사유 코드를 확인하세요.");

        const sums = rcvs.map((r) => rcvSums(r.lines));
        const close = await tx.dailyClose.create({
          data: {
            centerId: center.id,
            businessDate: new Date(`${today}T00:00:00Z`),
            closedAt: now,
            closedBy: me.name,
            closeUserId: me.id,
            rcvCount: rcvs.length,
            rcvLineCount: sums.reduce((s, x) => s + x.lineCount, 0),
            goodBaseQty: sums.reduce((s, x) => s + x.good, 0),
            returnBaseQty: sums.reduce((s, x) => s + x.ret, 0),
            expireCount: expire.length,
          },
        });
        if (rcvs.length) {
          const u = await tx.rcv.updateMany({ where: { id: { in: rcvs.map((r) => r.id) }, status: "CONFIRMED", dailyCloseId: null }, data: { dailyCloseId: close.id } });
          if (u.count !== rcvs.length) throw new Race();
        }
        if (expire.length) {
          const ids = expire.map((p) => p.id);
          await tx.$queryRaw`SELECT id FROM tb_inb_plan_h WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
          for (const p of expire) {
            const u = await tx.inboundPlan.updateMany({
              where: { id: p.id, version: p.version, status: { in: [...PRE_APPROVAL] } },
              data: { status: "CANCELED", version: { increment: 1 }, cancelReasonCode: reason!.code, cancelReasonText: null, canceledAt: now, canceledBy: `${me.name} (일마감)`, updatedBy: me.name },
            });
            if (u.count === 0) throw new Race();
            await tx.inboundPlanHistory.create({
              data: { planId: p.id, action: "EXPIRE_CANCEL", version: p.version + 1, revisionNo: p.revisionNo, actor: me.name, actorId: me.id, reasonCode: reason!.code, reasonName: reason!.name },
            });
          }
        }
        return ok(`${center.name} ${today} 일마감을 마쳤습니다 · 검수 실적 ${rcvs.length}건 확정${expire.length ? ` · 기한경과 ${expire.length}건 취소` : ""}`, { dailyCloseId: close.id });
      }),
    DAILY_CONFLICT_MSG,
  );
}
