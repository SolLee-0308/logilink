/**
 * 입고예정 처리 규칙 점검 (개발용) — 서버 액션이 쓰는 service.ts를 직접 호출한다.
 * 실행: npx tsx --conditions=react-server scripts/check-plan-rules.ts   (실행 후 `npx prisma db seed`로 되돌린다)
 */
import "dotenv/config";
import { db } from "@/server/db";
import { approvePlan, cancelPlanByShipper, rejectPlan, savePlan, type PlanActor } from "@/server/plans/service";
import { countUnclosed } from "@/server/master/unclosed";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", m, c || extra === undefined ? "" : JSON.stringify(extra));
};

async function actor(loginId: string): Promise<PlanActor> {
  const u = await db.user.findUniqueOrThrow({ where: { loginId } });
  return { id: u.id, name: u.name, roles: u.roles, clientId: u.clientId, centerId: u.centerId };
}
async function plan(clientCode: string, status: string, n = 0) {
  const rows = await db.inboundPlan.findMany({
    where: { client: { code: clientCode }, status: status as never },
    include: { lines: { orderBy: { lineNo: "asc" } } },
    orderBy: { planNo: "asc" },
  });
  return rows[n];
}
const linesOf = (p: Awaited<ReturnType<typeof plan>>) =>
  p.lines.map((l) => ({ itemId: l.itemId, unit: l.unit, qty: l.qty, expiryDate: l.expiryDate?.toISOString().slice(0, 10), lotNo: l.lotNo }));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const hb = await actor("hb.minji");
  const gm = await actor("gm.doyun");
  const of = await actor("of.seojun");
  const doo = await actor("do.yuna");
  const kim = await actor("kim.haneul");
  const jung = await actor("jung.minseo");
  const inspector = await actor("park.seoyeon");

  /* 화주사: 승인 전 수정 */
  const p1 = await plan("HB01", "WAITING");
  const base = { id: p1.id, version: p1.version, centerId: p1.centerId, planDate: ymd(p1.planDate), lines: linesOf(p1) };
  let r = await savePlan(hb, { ...base, lines: base.lines.map((l, i) => (i === 0 ? { ...l, qty: l.qty + 10 } : l)) });
  ok(r.ok, "화주사: 승인대기 건 수정 가능", r);
  const p1b = await db.inboundPlan.findUniqueOrThrow({ where: { id: p1.id } });
  ok(p1b.version === p1.version + 1 && p1b.revisionNo === 1 && p1b.status === "WAITING", "수정 시 version +1, 차수 유지");
  r = await savePlan(hb, base);
  ok(!r.ok && r.code === "CONFLICT", "옛 version으로 저장하면 충돌", r);
  r = await savePlan(gm, { ...base, version: p1b.version });
  ok(!r.ok && (r.code === "NOT_FOUND" || r.code === "VALIDATION"), "다른 화주사 건은 수정 불가", r);

  /* 화주사: 반려 건 재저장 → 차수 +1 */
  const p7 = await plan("OF01", "REJECTED");
  r = await savePlan(of, { id: p7.id, version: p7.version, centerId: p7.centerId, planDate: ymd(p7.planDate), lines: linesOf(p7).map((l) => ({ ...l, qty: 50 })) });
  ok(r.ok, "화주사: 반려 건 수정해 재저장 가능", r);
  const p7b = await db.inboundPlan.findUniqueOrThrow({ where: { id: p7.id }, include: { histories: { orderBy: { at: "desc" }, take: 1 } } });
  ok(p7b.status === "WAITING" && p7b.revisionNo === 2 && p7b.histories[0].action === "RESUBMIT", "재저장 → 승인대기, 차수 2, 이력 RESUBMIT");

  /* 화주사: 승인 전 취소 */
  const p8 = await plan("DO01", "REJECTED");
  r = await cancelPlanByShipper(doo, { id: p8.id, version: p8.version, reasonCode: "X99" });
  ok(!r.ok && r.code === "VALIDATION" && !!r.fieldErrors?.reasonText, "취소 사유 '기타'는 상세 필수", r);
  r = await cancelPlanByShipper(doo, { id: p8.id, version: p8.version, reasonCode: "X01" });
  ok(r.ok, "화주사: 반려 건 취소 가능", r);
  const p4 = await plan("DO01", "WAITING");
  r = await cancelPlanByShipper(doo, { id: p4.id, version: p4.version, reasonCode: "X03" });
  ok(r.ok, "화주사: 승인대기 건 취소 가능", r);

  /* 화주사: 승인 후 수정·취소 불가 */
  const p9 = await plan("HB01", "APPROVED");
  r = await savePlan(hb, { id: p9.id, version: p9.version, centerId: p9.centerId, planDate: ymd(new Date()), lines: linesOf(p9) });
  ok(!r.ok && r.code === "STATE", "승인 건 수정 불가", r);
  r = await cancelPlanByShipper(hb, { id: p9.id, version: p9.version, reasonCode: "X01" });
  ok(!r.ok && r.code === "STATE", "승인 건 화주사 취소 불가", r);

  /* 화주사: 입력 검사 */
  const items = await db.item.findMany({ where: { client: { code: "HB01" } } });
  const it = (code: string) => items.find((i) => i.clientCode === code)!.id;
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));
  r = await savePlan(hb, { centerId: p1.centerId, planDate: tomorrow, lines: [{ itemId: it("HB-1001"), unit: "BOX", qty: 5 }] });
  ok(!r.ok && !!r.fieldErrors?.["lines.0.expiryDate"], "소비기한 관리 품목은 소비기한 필수", r);
  r = await savePlan(hb, { centerId: p1.centerId, planDate: tomorrow, lines: [{ itemId: it("HB-2210"), unit: "BOX", qty: 5, expiryDate: "2027-05-01" }] });
  ok(!r.ok && !!r.fieldErrors?.["lines.0.unit"], "품목에 없는 단위 차단", r);
  r = await savePlan(hb, { centerId: p1.centerId, planDate: "2020-01-01", lines: [{ itemId: it("HB-2210"), unit: "EA", qty: 5, expiryDate: "2027-05-01" }] });
  ok(!r.ok && !!r.fieldErrors?.planDate, "지난 입고예정일 차단", r);
  const doItem = await db.item.findFirstOrThrow({ where: { clientCode: "DO-0099" } });
  r = await savePlan(doo, { centerId: p1.centerId, planDate: tomorrow, lines: [{ itemId: doItem.id, unit: "EA", qty: 5 }] });
  ok(!r.ok && !!r.fieldErrors?.["lines.0.itemId"], "사용 안 함 품목 차단", r);
  r = await savePlan(hb, { centerId: p1.centerId, planDate: tomorrow, lines: [{ itemId: it("HB-2210"), unit: "PLT", qty: 2, expiryDate: "2027-05-01" }] });
  ok(r.ok && /^IP-\d{8}-\d{4}$/.test(r.data!.planNo), `새 입고예정 저장 · 번호 ${r.ok ? r.data!.planNo : ""}`, r);
  const created = await db.inboundPlanLine.findFirstOrThrow({ where: { planId: r.ok ? r.data!.id : 0 } });
  ok(created.baseQty === 160, "PLT 2 → 기준 단위 EA 160 환산");
  r = await savePlan(inspector, { centerId: p1.centerId, planDate: tomorrow, lines: [{ itemId: it("HB-2210"), unit: "EA", qty: 1 }] });
  ok(!r.ok && r.code === "FORBIDDEN", "3PL 계정은 입고예정 저장 불가", r);

  /* 3PL: 승인 */
  const p3 = await plan("OF01", "WAITING", 0);
  r = await approvePlan(kim, { id: p3.id, version: p3.version - 1 || 99 });
  ok(!r.ok && r.code === "CONFLICT", "조회 시점 version이 다르면 승인 차단", r);
  r = await approvePlan(jung, { id: p3.id, version: p3.version });
  ok(!r.ok && r.code === "NOT_FOUND", "다른 센터 운영담당은 승인 불가", r);
  r = await approvePlan(hb, { id: p3.id, version: p3.version });
  ok(!r.ok && r.code === "FORBIDDEN", "화주사 계정은 승인 불가", r);
  r = await approvePlan(kim, { id: p3.id, version: p3.version });
  ok(r.ok, "3PL 승인", r);
  const p3b = await db.inboundPlan.findUniqueOrThrow({ where: { id: p3.id } });
  ok(p3b.status === "APPROVED" && p3b.approvedRevisionNo === p3.revisionNo, "승인 차수 기록");
  r = await approvePlan(kim, { id: p3.id, version: p3.version });
  ok(!r.ok && r.code === "STATE", "이미 승인된 건 다시 승인 불가", r);

  /* 3PL: 반려 + 반려본 스냅샷 */
  const p5 = await plan("HB01", "WAITING", 1);
  r = await rejectPlan(kim, { id: p5.id, version: p5.version, reasonCode: "R99" });
  ok(!r.ok && !!r.fieldErrors?.reasonText, "반려 사유 '기타'는 상세 필수", r);
  r = await rejectPlan(kim, { id: p5.id, version: p5.version, reasonCode: "R01", reasonText: "품목코드 확인" });
  ok(r.ok, "3PL 반려", r);
  const snap = await db.inboundPlanReject.findFirstOrThrow({ where: { planId: p5.id }, include: { lines: true } });
  ok(snap.lines.length === p5.lines.length && snap.revisionNo === p5.revisionNo, "반려본 스냅샷(헤더+라인 전체) 보관");
  let blocked = false;
  try {
    await db.inboundPlanReject.update({ where: { id: snap.id }, data: { reasonText: "변조" } });
  } catch {
    blocked = true;
  }
  ok(blocked, "반려본은 수정 불가 (Append-only 트리거)");

  /* 미종결 건수 · RLS */
  const hbClient = await db.client.findFirstOrThrow({ where: { code: "HB01" } });
  const uc = await countUnclosed([hbClient.id]);
  ok((uc.get(hbClient.id)?.plan ?? 0) > 0, `미종결 입고예정 건수 반영 (한빛식품 ${uc.get(hbClient.id)?.plan}건)`);
  const rls = await db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'tb_inb_plan%' AND relkind = 'r'",
  );
  ok(rls.length === 6 && rls.every((x) => x.relrowsecurity), "입고예정 테이블 6개(AI 판독 작업 포함) RLS 켜짐");

  console.log(`\n${pass}/${pass + fail} 통과`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
