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
import { CANCEL_GROUP, PLAN_REJECT_GROUP } from "@/domain/master";
import { PLAN_STATUS_META, type PlanStatus } from "@/domain/plan-status";
import { CONFLICT_MSG, SAVE_CONFLICT_MSG, canReview, canShipperEdit, nextPlanNo, planNoPrefix } from "@/domain/plan-rules";
import { todayKst } from "@/lib/format";

type Tx = Prisma.TransactionClient;
export type PlanActor = Pick<SessionUser, "id" | "name" | "role" | "clientId" | "centerId">;

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
  if (!can(me.role, "planEntry", "edit") || !me.clientId) return forbidden();
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
          if (item.expiryManaged && !expiry) at("expiryDate", "유통기한 관리 품목은 유통기한을 입력하세요.");
          if (item.lotManaged && !lot) at("lotNo", "로트 관리 품목은 로트를 입력하세요.");
          const key = `${l.itemId}:${l.unit}:${expiry}:${lot}`;
          if (seen.has(key)) at("itemId", "같은 품목·단위·유통기한·로트가 중복되었습니다. 한 줄로 합치세요.");
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
  if (!can(me.role, "planEntry", "edit") || !me.clientId) return forbidden();
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
  if (!can(me.role, "approval", "edit")) return forbidden();
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
  if (!can(me.role, "approval", "edit")) return forbidden();
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

