/**
 * ASN 처리 규칙 점검 (개발용) — 서버 액션이 쓰는 service.ts를 직접 호출한다.
 * 실행: npx tsx --conditions=react-server scripts/check-asn-rules.ts   (실행 후 `npx prisma db seed`로 되돌린다)
 */
import "dotenv/config";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { cancelAsn, createAsn, lineErrorKey } from "@/server/asn/service";
import { distributablePlans, getAsnDetail, getLoadOrderPrint, listMyAsns } from "@/server/asn/queries";
import { countUnclosed } from "@/server/master/unclosed";
import { DISTRIBUTE_CONFLICT_MSG } from "@/domain/asn-rules";
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
const centerId = async (code: string) => (await db.center.findUniqueOrThrow({ where: { code } })).id;
/** 화주사·품목코드·상태로 입고예정 라인 찾기 */
async function planLine(clientCode: string, itemCode: string, status: string, centerCode = "YI1") {
  const l = await db.inboundPlanLine.findFirst({
    where: { item: { code: itemCode }, plan: { client: { code: clientCode }, status: status as never, center: { code: centerCode } } },
    orderBy: { id: "asc" },
  });
  if (!l) throw new Error(`라인 없음 ${clientCode} ${itemCode} ${status} ${centerCode}`);
  return l;
}
const today = todayKst();
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

async function main() {
  const hb = await actor("hb.minji");
  const gm = await actor("gm.doyun");
  const kim = await actor("kim.haneul");
  const yi1 = await centerId("YI1");
  const ic2 = await centerId("IC2");
  const head = { centerId: yi1, shipDate: today, vehicleNo: "82 가 5678", driverName: "오정훈", driverTel: "010-1111-2222" };

  /* 분배 대상 */
  const dist = await distributablePlans(hb.clientId!);
  const water = await planLine("HB01", "HB-2210", "APPROVED");
  const waterView = dist.flatMap((p) => p.lines).find((l) => l.planLineId === water.id);
  ok(waterView?.qty === 6 && waterView.distributedQty === 4 && waterView.remainingQty === 2, "생수 6PLT 중 등록 ASN 4PLT(취소 ASN 제외) → 남은 2PLT", waterView);
  ok(dist.every((p) => ["APPROVED", "PARTIAL"].includes(p.status)), "분배 대상은 승인·미종결 입고예정만");
  ok(dist.some((p) => p.centerId === ic2) && dist.some((p) => p.centerId === yi1), "이용 센터 두 곳의 입고예정이 모두 나온다(화면에서 센터로 거름)");

  /* 권한 */
  ok((await createAsn(kim, { ...head, lines: [{ planLineId: water.id, qty: 1 }] })).ok === false, "3PL 사용자는 ASN을 등록할 수 없다");

  /* 입력 검사 */
  let r = await createAsn(hb, { ...head, vehicleNo: "  ", lines: [{ planLineId: water.id, qty: 1 }] });
  ok(!r.ok && !!r.fieldErrors?.vehicleNo, "차량번호 필수", r);
  r = await createAsn(hb, { ...head, shipDate: yesterday, lines: [{ planLineId: water.id, qty: 1 }] });
  ok(!r.ok && !!r.fieldErrors?.shipDate, "출고일은 오늘 이후", r);
  r = await createAsn(hb, { ...head, lines: [] });
  ok(!r.ok && !!r.fieldErrors?.lines, "담은 품목 1개 이상", r);
  r = await createAsn(hb, { ...head, lines: [{ planLineId: water.id, qty: 1 }, { planLineId: water.id, qty: 1 }] });
  ok(!r.ok && !!r.fieldErrors?.[lineErrorKey(water.id)], "같은 라인 두 번은 막는다", r);
  r = await createAsn(hb, { ...head, lines: [{ planLineId: water.id, qty: 3 }] });
  ok(!r.ok && r.error === DISTRIBUTE_CONFLICT_MSG && /남은 수량\(2\)/.test(r.fieldErrors?.[lineErrorKey(water.id)] ?? ""), "남은 수량(2) 초과는 막는다 (C4)", r);

  const ic2Line = await planLine("HB01", "HB-2210", "APPROVED", "IC2");
  r = await createAsn(hb, { ...head, lines: [{ planLineId: water.id, qty: 1 }, { planLineId: ic2Line.id, qty: 1 }] });
  ok(!r.ok && /다른 센터/.test(r.fieldErrors?.[lineErrorKey(ic2Line.id)] ?? ""), "한 차량에 다른 센터 입고예정은 못 담는다", r);
  const gmLine = await planLine("GM01", "GM-0501", "APPROVED");
  r = await createAsn(hb, { ...head, lines: [{ planLineId: gmLine.id, qty: 1 }] });
  ok(!r.ok && /찾을 수 없습니다/.test(r.fieldErrors?.[lineErrorKey(gmLine.id)] ?? ""), "다른 화주사 입고예정 라인은 못 담는다", r);
  const waitLine = await planLine("HB01", "HB-1001", "WAITING");
  r = await createAsn(hb, { ...head, lines: [{ planLineId: waitLine.id, qty: 1 }] });
  ok(!r.ok && /승인·미종결/.test(r.fieldErrors?.[lineErrorKey(waitLine.id)] ?? ""), "승인대기 입고예정은 못 담는다 (D8)", r);
  r = await createAsn(hb, { ...head, centerId: yi1 + ic2 + 100, lines: [{ planLineId: water.id, qty: 1 }] });
  ok(!r.ok && !!r.fieldErrors?.centerId, "이용하지 않는 센터는 막는다", r);

  /* 등록 — 여러 입고예정을 한 차량에, 번호·상차지시서 동시 발행 */
  const tofu = await planLine("HB01", "HB-1001", "APPROVED");
  const kimchi = await planLine("HB01", "HB-3105", "APPROVED");
  const soy = await planLine("HB01", "HB-4402", "APPROVED");
  const created = await createAsn(hb, {
    ...head,
    memo: "오전 도착",
    lines: [
      { planLineId: tofu.id, qty: 40 },
      { planLineId: kimchi.id, qty: 30 },
      { planLineId: soy.id, qty: 40 },
      { planLineId: water.id, qty: 2 },
    ],
  });
  const ymd = today.replaceAll("-", "");
  ok(created.ok && created.data?.asnNo === `ASN-${ymd}-0003` && created.data.orderNo === `LO-${ymd}-0003`, "등록: 오늘 3번째 ASN·상차지시서 번호", created);
  if (!created.ok || !created.data) throw new Error("등록 실패 — 이후 점검 중단");
  const a = await db.asn.findUniqueOrThrow({ where: { id: created.data.id }, include: { lines: true, loadOrder: true, histories: true } });
  ok(a.vehicleNo === "82가5678" && a.status === "REGISTERED" && a.version === 1, "차량번호 공백 제거, 상태 등록", a.vehicleNo);
  ok(a.lines.length === 4 && new Set(a.lines.map((l) => l.planId)).size === 3, "한 차량에 입고예정 3건(라인 4줄)");
  ok(a.lines.find((l) => l.planLineId === tofu.id)?.baseQty === 40 * 20, "기준 단위 환산 저장 (두부 BOX 20입)");
  ok(a.loadOrder?.status === "ISSUED" && a.histories.length === 1 && a.histories[0].action === "CREATE", "상차지시서 발행 + 등록 이력");

  const after = (await distributablePlans(hb.clientId!)).flatMap((p) => p.lines);
  ok(after.find((l) => l.planLineId === tofu.id)?.remainingQty === 60, "두부 100 − 40 = 남은 60");
  ok(!after.some((l) => l.planLineId === water.id && l.remainingQty > 0), "생수는 다 담아 남은 수량 0");
  const soyPlan = (await distributablePlans(hb.clientId!)).find((p) => p.lines.some((l) => l.planLineId === soy.id));
  ok(!!soyPlan && soyPlan.lines.find((l) => l.planLineId === soy.id)?.remainingQty === 0, "어제 입고예정(잔량)도 오늘 ASN에 담을 수 있다 (D8)");

  /* 다른 화주사는 못 본다 */
  ok((await getAsnDetail(gm, a.id)) === null && (await getLoadOrderPrint(gm, a.id)) === null, "다른 화주사는 상세·상차지시서를 볼 수 없다");
  const print = await getLoadOrderPrint(hb, a.id);
  ok(print?.sender.bizNo === "214-86-50011" && print.receiver.name.length > 0 && print.lines.every((l) => l.planNo.startsWith("IP-")), "상차지시서: 발송인(화주사 법인)·센터·입고예정번호", print?.sender);
  ok(!!print?.lines.find((l) => l.itemCode === "HB-1001")?.barcode, "상차지시서 품목 바코드");
  ok((await listMyAsns(hb)).some((x) => x.id === a.id && x.tab === "wait"), "목록 상차 대기 탭");
  ok((await countUnclosed([hb.clientId!])).get(hb.clientId!)!.asn === 2, "미종결 ASN 2건(등록) — 취소 건 제외");

  /* 동시 저장 — 같은 라인의 남은 수량(두부 60)을 두 차량이 동시에 전부 담으면 하나만 성공 */
  const [c1, c2] = await Promise.all([
    createAsn(hb, { ...head, vehicleNo: "11가1111", lines: [{ planLineId: tofu.id, qty: 60 }] }),
    createAsn(hb, { ...head, vehicleNo: "22나2222", lines: [{ planLineId: tofu.id, qty: 60 }] }),
  ]);
  ok([c1, c2].filter((x) => x.ok).length === 1, "동시 저장: 남은 수량을 넘는 쪽은 막힌다", [c1, c2].map((x) => (x.ok ? x.data?.asnNo : x.error)));
  const tofuSum = await db.asnLine.aggregate({ where: { planLineId: tofu.id, asn: { status: { not: "CANCELED" } } }, _sum: { qty: true } });
  ok(tofuSum._sum.qty === 100, "두부 분배 합계 = 승인 100 (초과 없음)", tofuSum._sum.qty);

  /* 취소 */
  r = await cancelAsn(hb, { id: a.id, version: 99, reasonCode: "X03" });
  ok(!r.ok && r.code === "CONFLICT", "version이 다르면 취소 막음", r);
  r = await cancelAsn(hb, { id: a.id, version: 1, reasonCode: "X99" });
  ok(!r.ok && !!r.fieldErrors?.reasonText, "기타 사유는 상세 필수", r);
  r = await cancelAsn(gm, { id: a.id, version: 1, reasonCode: "X03" });
  ok(!r.ok && r.code === "NOT_FOUND", "다른 화주사 ASN은 취소 못 함", r);
  r = await cancelAsn(hb, { id: a.id, version: 1, reasonCode: "X03", reasonText: "차량 변경" });
  const ac = await db.asn.findUniqueOrThrow({ where: { id: a.id }, include: { loadOrder: true, histories: true } });
  ok(r.ok && ac.status === "CANCELED" && ac.version === 2 && ac.loadOrder?.status === "CANCELED", "취소: ASN·상차지시서 함께 취소", r);
  ok(ac.histories.some((h) => h.action === "CANCEL" && h.reasonName === "입고 일정 변경" && h.reasonText === "차량 변경"), "취소 이력·사유 보관");
  const back = (await distributablePlans(hb.clientId!)).flatMap((p) => p.lines);
  ok(back.find((l) => l.planLineId === water.id)?.remainingQty === 2 && back.find((l) => l.planLineId === kimchi.id)?.remainingQty === 30, "취소하면 담았던 수량이 다시 남은 수량으로");
  r = await cancelAsn(hb, { id: a.id, version: 2, reasonCode: "X03" });
  ok(!r.ok && r.code === "STATE", "이미 취소한 ASN은 다시 취소 못 함", r);
  const won = c1.ok ? c1 : c2.ok ? c2 : null;
  if (!won?.data) throw new Error("동시 저장 둘 다 실패 — 이후 점검 중단");
  await db.asn.update({ where: { id: won.data.id }, data: { status: "LOADING" } });
  r = await cancelAsn(hb, { id: won.data.id, version: 1, reasonCode: "X03" });
  ok(!r.ok && r.code === "STATE" && /상차 시작 전/.test(r.error), "상차중 ASN은 취소 못 함 (4-2)", r);

  /* RLS */
  const rls = await db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tb_asn_h','tb_asn_d','tb_load_order','tb_asn_his')",
  );
  ok(rls.length === 4 && rls.every((x) => x.relrowsecurity), "ASN 테이블 4개 RLS 켜짐", rls);

  console.log(`\n${pass} 통과 / ${fail} 실패`);
  if (fail) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
