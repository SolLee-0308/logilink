/**
 * 화면 점검용 (개발용): 오션푸드 담당자가 승인대기 AI 판독 건의 고등어 수량을 70으로 고쳐 저장한다.
 * 실행: npx tsx --conditions=react-server scripts/dev-shipper-edit.ts
 */
import "dotenv/config";
import { db } from "@/server/db";
import { savePlan } from "@/server/plans/service";

async function main() {
  const u = await db.user.findUniqueOrThrow({ where: { loginId: "of.seojun" } });
  const p = await db.inboundPlan.findFirstOrThrow({
    where: { client: { code: "OF01" }, status: "WAITING", inputMethod: "AI_IMAGE" },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { item: true } } },
  });
  const r = await savePlan(
    { id: u.id, name: u.name, roles: u.roles, clientId: u.clientId, centerId: u.centerId },
    {
      id: p.id,
      version: p.version,
      centerId: p.centerId,
      planDate: p.planDate.toISOString().slice(0, 10),
      inputMethod: p.inputMethod,
      lines: p.lines.map((l) => ({
        itemId: l.itemId,
        unit: l.unit,
        qty: l.item.code === "OF-2201" ? 70 : l.qty,
        expiryDate: l.expiryDate?.toISOString().slice(0, 10),
        lotNo: l.lotNo,
      })),
    },
  );
  console.log(r.ok ? `EDITED ${p.planNo}` : `FAILED ${JSON.stringify(r)}`);
  await db.$disconnect();
}
main();
