import "server-only";
/**
 * ASN 처리 — 화주사 등록(상차지시서 동시 발행)·취소.
 * 근거: 정의서 v1.4 ③ · 4-2 · C4 · C10 · D7~D9 · D19
 * 처리자를 인자로 받아 서버 액션(actions.ts)과 점검 스크립트가 같은 규칙을 쓴다.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { fail, type ActionResult } from "@/server/action-result";
import type { PlanActor } from "@/server/plans/service";
import { distributedByLine } from "@/server/asn/queries";
import { can } from "@/domain/permissions";
import { CANCEL_GROUP } from "@/domain/master";
import {
  ASN_CONFLICT_MSG,
  ASN_PREFIX,
  ASN_STATUS_META,
  DISTRIBUTABLE_PLAN,
  DISTRIBUTE_CONFLICT_MSG,
  LOAD_ORDER_PREFIX,
  canCancelAsn,
  distributeError,
  docNoPrefix,
  nextDocNo,
  normalizeVehicleNo,
  remainingBase,
  toLineUnitQty,
} from "@/domain/asn-rules";
import { todayKst } from "@/lib/format";

const ok = <T>(message: string, data?: T): ActionResult<T> => ({ ok: true, message, data });
const forbidden = () => fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
const invalid = (fe: Record<string, string>) => fail("VALIDATION", "입력 내용을 확인하세요.", fe);
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

/* ═════════ 등록 (상차지시서 동시 발행) ═════════ */

const createSchema = z.object({
  centerId: z.number({ error: "센터를 선택하세요." }).int().positive("센터를 선택하세요."),
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "출고일을 선택하세요."),
  vehicleNo: z.string().trim().min(1, "차량번호를 입력하세요.").max(20, "차량번호는 20자 이내로 입력하세요."),
  driverName: z.string().trim().max(20, "기사 이름은 20자 이내로 입력하세요.").nullish(),
  driverTel: z.string().trim().max(15, "연락처는 15자 이내로 입력하세요.").regex(/^[0-9-]*$/, "연락처는 숫자와 -만 입력하세요.").nullish(),
  memo: z.string().trim().max(500, "메모는 500자 이내로 입력하세요.").nullish(),
  lines: z
    .array(
      z.object({
        planLineId: z.number().int().positive(),
        qty: z.number({ error: "수량을 입력하세요." }).int("수량은 정수로 입력하세요.").positive("수량은 1 이상이어야 합니다.").max(999_999, "수량이 너무 큽니다."),
      }),
    )
    .min(1, "차량에 담을 품목을 1개 이상 입력하세요.")
    .max(300, "한 차량에 300줄까지 담을 수 있습니다."),
});
export type CreateAsnInput = z.input<typeof createSchema>;

/** 오류 키: 헤더는 필드 이름, 라인은 line.{입고예정 라인 id} */
export const lineErrorKey = (planLineId: number) => `line.${planLineId}`;

export async function createAsn(me: PlanActor, input: CreateAsnInput): Promise<ActionResult<{ id: number; asnNo: string; orderNo: string }>> {
  if (!can(me.roles, "asn", "edit") || !me.clientId) return forbidden();
  const p = createSchema.safeParse(input);
  if (!p.success) {
    const fe: Record<string, string> = {};
    for (const i of p.error.issues) {
      const k = i.path[0] === "lines" && typeof i.path[1] === "number" ? lineErrorKey(input.lines?.[i.path[1]]?.planLineId ?? 0) : String(i.path[0] ?? "_");
      fe[k] ??= i.message;
    }
    return invalid(fe);
  }
  const v = p.data;
  const clientId = me.clientId;
  const today = todayKst();
  if (v.shipDate < today) return invalid({ shipDate: "출고일은 오늘 이후로 선택하세요." });
  const vehicleNo = normalizeVehicleNo(v.vehicleNo);
  const ids = v.lines.map((l) => l.planLineId);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) return invalid({ [lineErrorKey(dup)]: "같은 입고예정 라인이 두 번 들어 있습니다." });

  return guarded(
    () =>
      db.$transaction(async (tx) => {
        // 센터: 사용 중 + 이 화주사의 이용 센터
        const center = await tx.center.findUnique({ where: { id: v.centerId } });
        const linked = center && (await tx.clientCenter.findUnique({ where: { clientId_centerCode: { clientId, centerCode: center.code } } }));
        if (!center || !center.isActive || !linked) return invalid({ centerId: "이용 중인 센터를 선택하세요." });

        // 같은 입고예정 라인에 동시에 분배하는 저장을 줄 세운다 (잔량 초과 방지, C4)
        await tx.$queryRaw`SELECT id FROM tb_inb_plan_d WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
        const planLines = await tx.inboundPlanLine.findMany({
          where: { id: { in: ids } },
          include: { plan: true, item: { select: { name: true, uoms: { select: { unit: true, qty: true } } } } },
        });
        const byId = new Map(planLines.map((l) => [l.id, l]));
        const dist = await distributedByLine(ids, tx);

        const fe: Record<string, string> = {};
        let stale = false;
        const rows = v.lines.map((l, i) => {
          const pl = byId.get(l.planLineId);
          const at = (m: string) => (fe[lineErrorKey(l.planLineId)] ??= m);
          if (!pl || pl.plan.clientId !== clientId) {
            at("입고예정 라인을 찾을 수 없습니다.");
            return null;
          }
          if (!DISTRIBUTABLE_PLAN.includes(pl.plan.status)) {
            at(`${pl.plan.planNo}은(는) 승인·미종결 상태가 아니어서 담을 수 없습니다.`);
            stale = true;
            return null;
          }
          if (pl.plan.centerId !== v.centerId) {
            at(`${pl.plan.planNo}은(는) 다른 센터 입고예정입니다. 한 차량에는 한 센터 입고예정만 담습니다.`);
            return null;
          }
          const factor = pl.item.uoms.find((u) => u.unit === pl.unit)?.qty ?? 1;
          const remaining = toLineUnitQty(remainingBase(pl, dist.get(pl.id) ?? 0), factor);
          const err = distributeError(l.qty, remaining);
          if (err) {
            at(err);
            if (l.qty > remaining) stale = true;
            return null;
          }
          return { lineNo: i + 1, planId: pl.planId, planLineId: pl.id, itemId: pl.itemId, unit: pl.unit, qty: l.qty, baseQty: l.qty * factor };
        });
        if (Object.keys(fe).length) return fail("VALIDATION", stale ? DISTRIBUTE_CONFLICT_MSG : "입력 내용을 확인하세요.", fe);

        const [usedAsn, usedOrder] = await Promise.all([
          tx.asn.findMany({ where: { asnNo: { startsWith: docNoPrefix(ASN_PREFIX, today) } }, select: { asnNo: true } }),
          tx.loadOrder.findMany({ where: { orderNo: { startsWith: docNoPrefix(LOAD_ORDER_PREFIX, today) } }, select: { orderNo: true } }),
        ]);
        const asnNo = nextDocNo(ASN_PREFIX, today, usedAsn.map((u) => u.asnNo));
        const orderNo = nextDocNo(LOAD_ORDER_PREFIX, today, usedOrder.map((u) => u.orderNo));
        const asn = await tx.asn.create({
          data: {
            asnNo,
            clientId,
            centerId: v.centerId,
            shipDate: asDate(v.shipDate),
            vehicleNo,
            driverName: v.driverName || null,
            driverTel: v.driverTel || null,
            memo: v.memo || null,
            createdBy: me.name,
            updatedBy: me.name,
            lines: { create: rows.filter((r) => r !== null) },
            loadOrder: { create: { orderNo, issuedBy: me.name } },
          },
        });
        await tx.asnHistory.create({ data: { asnId: asn.id, action: "CREATE", version: 1, actor: me.name, actorId: me.id } });
        return ok(`ASN ${asnNo}을(를) 등록하고 상차지시서 ${orderNo}을(를) 발행했습니다.`, { id: asn.id, asnNo, orderNo });
      }),
    DISTRIBUTE_CONFLICT_MSG,
  );
}

/* ═════════ 취소 (상차 시작 전만) ═════════ */

export async function cancelAsn(me: PlanActor, input: { id: number; version: number; reasonCode: string; reasonText?: string }): Promise<ActionResult> {
  if (!can(me.roles, "asn", "edit") || !me.clientId) return forbidden();
  const text = input.reasonText?.trim() ?? "";
  if (text.length > 500) return invalid({ reasonText: "상세 내용은 500자 이내로 입력하세요." });
  return guarded(
    () =>
      db.$transaction(async (tx) => {
        const cur = await tx.asn.findUnique({ where: { id: input.id } });
        if (!cur || cur.clientId !== me.clientId) return fail("NOT_FOUND", "ASN을 찾을 수 없습니다. 목록을 새로 고쳐 보세요.");
        if (!canCancelAsn(cur.status)) return fail("STATE", `${ASN_STATUS_META[cur.status].label} 상태인 ASN은 취소할 수 없습니다. 취소는 상차 시작 전까지만 할 수 있습니다.`);
        if (cur.version !== input.version) return fail("CONFLICT", ASN_CONFLICT_MSG);
        const reason = await tx.commonCode.findUnique({ where: { groupCode_code: { groupCode: CANCEL_GROUP, code: input.reasonCode } } });
        if (!reason || !reason.isActive) return invalid({ reasonCode: "사유를 선택하세요." });
        if (reason.requiresText && !text) return invalid({ reasonText: `"${reason.name}"을(를) 고르면 상세 내용을 입력해야 합니다.` });
        const r = await tx.asn.updateMany({
          where: { id: cur.id, version: cur.version, status: "REGISTERED" },
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
        await tx.loadOrder.updateMany({ where: { asnId: cur.id }, data: { status: "CANCELED" } });
        await tx.asnHistory.create({
          data: {
            asnId: cur.id, action: "CANCEL", version: cur.version + 1, actor: me.name, actorId: me.id,
            reasonCode: reason.code, reasonName: reason.name, reasonText: text || null,
          },
        });
        return ok(`${cur.asnNo}을(를) 취소했습니다. 담았던 수량은 다시 다른 차량에 담을 수 있습니다.`);
      }),
    ASN_CONFLICT_MSG,
  );
}
