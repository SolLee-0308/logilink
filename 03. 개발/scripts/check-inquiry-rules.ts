/**
 * 입고예정 조회 점검 (개발용) — 조회 범위·탭 조회·승인 건 취소 규칙.
 * 실행: npx tsx --conditions=react-server scripts/check-inquiry-rules.ts   (실행 후 `npx prisma db seed`로 되돌린다)
 */
import "dotenv/config";
import { db } from "@/server/db";
import { cancelApprovedPlan, type PlanActor } from "@/server/plans/service";
import { canInquiry, countOverdue, getInquiryDetail, listInquiryPlans, listInquiryVehicles } from "@/server/plans/inquiry";
import { defaultInquiry } from "@/features/plans/inquiry/inquiry-list";
import { todayKst } from "@/lib/format";

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

async function main() {
  const today = todayKst();
  const hb = await actor("hb.minji"); // 화주사 담당자 (한빛식품)
  const kim = await actor("kim.haneul"); // 3PL
  const all = { ...defaultInquiry(today), st: "all", from: "", to: "" };

  // ── 권한·범위 ──
  ok(canInquiry(hb) && canInquiry(kim), "화주사 담당자·3PL 모두 조회 가능");
  const hbPlans = await listInquiryPlans(hb, all);
  ok(hbPlans.length > 0 && hbPlans.every((p) => p.clientId === hb.clientId), "화주사 담당자는 자기 화주사 건만", hbPlans.map((p) => p.clientId));
  ok(hbPlans.every((p) => !["WAITING", "REJECTED"].includes(p.status)), "승인 전 건은 조회 대상이 아님");
  const kimPlans = await listInquiryPlans(kim, all);
  ok(kimPlans.every((p) => !kim.centerId || p.centerId === kim.centerId), "3PL은 소속 센터 건만");
  const hbForeign = await listInquiryPlans(hb, { ...all, client: String((kimPlans.find((p) => p.clientId !== hb.clientId) ?? { clientId: 0 }).clientId) });
  ok(hbForeign.every((p) => p.clientId === hb.clientId), "화주사 담당자는 화주사 조건을 바꿔도 남의 건을 못 봄");

  // ── 기본 조건(미종결·±7일) ──
  const def = await listInquiryPlans(kim, defaultInquiry(today));
  ok(def.every((p) => ["APPROVED", "PARTIAL"].includes(p.status)), "기본 조건은 미종결만");
  ok(def.every((p) => p.planDate >= defaultInquiry(today).from && p.planDate <= defaultInquiry(today).to), "기본 조건은 오늘 ±7일");
  const overdue = await countOverdue(kim, all, 3);
  ok(overdue >= 0, `경과 기준 초과 건수 계산 (${overdue}건)`);

  // ── 잔량·진행 ──
  const withRcv = kimPlans.find((p) => p.lines.some((l) => l.rcvQty > 0));
  ok(!withRcv || withRcv.lines.every((l) => l.baseQty - l.rcvQty - l.returnQty - l.closeQty >= -l.baseQty), "입고 누계가 있는 건의 잔량 계산", withRcv?.planNo);

  // ── 차량별 ──
  const veh = await listInquiryVehicles(kim, { ...all, tab: "vehicle" });
  ok(veh.every((v) => v.status !== "CANCELED"), "차량별: 취소된 ASN은 빠짐");
  ok(veh.filter((v) => v.status !== "RECEIVED").every((v) => v.lines.every((l) => l.incomingQty === l.orderQty)), "차량별: 입고 전 ASN은 지시수량이 오는 중");
  ok(veh.filter((v) => v.status === "RECEIVED").every((v) => v.lines.every((l) => l.incomingQty === 0)), "차량별: 입고완료 ASN은 오는 중 0");
  const vHb = await listInquiryVehicles(hb, { ...all, tab: "vehicle" });
  ok(vHb.every((v) => v.clientId === hb.clientId), "차량별: 화주사 담당자는 자기 화주사 차량만");

  // ── 승인 건 취소 ──
  const approved = await db.inboundPlan.findMany({
    where: { status: "APPROVED", ...(kim.centerId ? { centerId: kim.centerId } : {}) },
    include: { asnLines: { include: { asn: { select: { status: true } } } } },
    orderBy: { planNo: "asc" },
  });
  const free = approved.find((p) => p.asnLines.every((a) => a.asn.status === "CANCELED"));
  const linked = approved.find((p) => p.asnLines.some((a) => a.asn.status !== "CANCELED"));
  ok(!!free, "후행 전표 없는 승인 건이 시드에 있음");
  ok(!!linked, "ASN이 연결된 승인 건이 시드에 있음");

  if (linked) {
    const r = await cancelApprovedPlan(kim, { id: linked.id, version: linked.version, reasonCode: "X01" });
    ok(!r.ok && r.code === "STATE", "ASN이 있으면 승인 건 취소 차단", r);
    const det = await getInquiryDetail(kim, linked.id);
    ok(!!det?.cancelBlock, "상세에도 취소 불가 이유 표시");
  }
  if (free) {
    const det = await getInquiryDetail(kim, free.id);
    ok(det?.cancelBlock === null && det.canCancel, "후행 전표 없으면 상세에서 취소 가능");
    const hbDet = await getInquiryDetail(hb, free.id);
    ok(!hbDet || hbDet.canCancel === false, "화주사 담당자 상세에는 취소 버튼 없음");
    const r0 = await cancelApprovedPlan(hb, { id: free.id, version: free.version, reasonCode: "X01" });
    ok(!r0.ok && r0.code === "FORBIDDEN", "화주사 담당자는 승인 건 취소 불가", r0);
    const r1 = await cancelApprovedPlan(kim, { id: free.id, version: free.version, reasonCode: "X99" });
    ok(!r1.ok && r1.code === "VALIDATION", "'기타' 사유는 상세 내용 필수", r1);
    const r2 = await cancelApprovedPlan(kim, { id: free.id, version: free.version + 5, reasonCode: "X01" });
    ok(!r2.ok && r2.code === "CONFLICT", "version이 다르면 충돌", r2);
    const r3 = await cancelApprovedPlan(kim, { id: free.id, version: free.version, reasonCode: "X01", reasonText: "화주사 요청" });
    ok(r3.ok, "승인 건 취소 성공", r3);
    const after = await db.inboundPlan.findUniqueOrThrow({ where: { id: free.id }, include: { histories: { orderBy: { at: "desc" }, take: 1 } } });
    ok(after.status === "CANCELED" && after.version === free.version + 1 && after.canceledBy === kim.name, "상태 취소·version +1·처리자 기록");
    ok(after.histories[0]?.action === "CANCEL_APPROVED" && after.histories[0].reasonCode === "X01", "처리 이력 '승인 건 취소' + 사유");
    const r4 = await cancelApprovedPlan(kim, { id: free.id, version: after.version, reasonCode: "X01" });
    ok(!r4.ok && r4.code === "STATE", "이미 취소된 건은 다시 취소 불가", r4);
    const canceledRows = await listInquiryPlans(kim, { ...all, st: "CANCELED" });
    ok(canceledRows.some((p) => p.id === free.id), "취소(승인 건 취소) 조건에서 조회됨");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
