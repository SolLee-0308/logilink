/**
 * 상차등록 규칙 점검 (개발용) — 서버 액션이 쓰는 service.ts를 직접 호출한다.
 * 실행: npx tsx --conditions=react-server scripts/check-load-rules.ts   (실행 후 `npx prisma db seed`로 되돌린다)
 * 근거: 정의서 v1.4 ④ · 4-2 · C5 · C6 · D10~D13
 */
import "dotenv/config";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { cancelAsn, createAsn } from "@/server/asn/service";
import { getAsnDetail, getAsnStatusDetail, listAsnStatus, listMyAsns } from "@/server/asn/queries";
import { addLoadInput, cancelLoadInput, completeLoad, correctLoadInput, previewScan, startOrderedLoad, startUnorderedLoad } from "@/server/loads/service";
import { getLoadConfirmPrint, getLoadView, getPdaLoad, pdaHome } from "@/server/loads/queries";
import { countUnclosed } from "@/server/master/unclosed";
import { LOAD_CONFLICT_MSG } from "@/domain/load-rules";
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
const ymd = todayKst().replaceAll("-", "");
const lo = (n: number) => `LO-${ymd}-000${n}`;

async function main() {
  const jiho = await actor("hb.jiho"); // 한빛식품 상차담당
  // 같은 화주사의 두 번째 상차담당 (동시 작업 점검용 — 처리자 정보만 다르게)
  const minjiUser = await db.user.findUniqueOrThrow({ where: { loginId: "hb.minji" } });
  const worker2: PlanActor = { id: minjiUser.id, name: "두번째 작업자", roles: ["SHIPPER_LOADER"], clientId: jiho.clientId, centerId: null };
  const minji = await actor("hb.minji"); // 화주사 담당자 (Web)
  const sera = await actor("gm.sera"); // 그린마켓 상차담당
  const doyun = await actor("gm.doyun"); // 그린마켓 담당자
  const yuna = await actor("do.yuna"); // 다온생활 담당자 겸 상차담당 (오늘 ASN 없음)
  const kim = await actor("kim.haneul"); // 3PL 운영담당
  const yi1 = (await db.center.findUniqueOrThrow({ where: { code: "YI1" } })).id;

  /* PDA 첫 화면 */
  const home = (await pdaHome(jiho))!;
  ok(home.orders.some((o) => o.orderNo === lo(2) && !o.loadId), "첫 화면: 상차 대기 지시서(LO-0002)가 보인다", home.orders);
  ok(home.orders.some((o) => o.shipDate < home.today), "첫 화면: 출고일 지난 지시서도 보인다");
  ok(!home.orders.some((o) => o.orderNo === lo(1)), "첫 화면: 취소된 지시서는 보이지 않는다");
  ok(home.working.length === 0 && home.done.length === 0, "첫 화면: 한빛식품은 작업 중·상차완료 없음");
  const gmHome = (await pdaHome(sera))!;
  ok(gmHome.working.length === 1 && gmHome.done.length === 2 && !gmHome.orders.some((o) => o.orderNo === lo(2)), "첫 화면: 그린마켓은 작업 중 1대, 오늘 상차완료 2대(지시·무지시), 다른 화주사 지시서는 안 보임", {
    w: gmHome.working.length,
    d: gmHome.done.length,
  });

  /* 권한 */
  ok((await startOrderedLoad(minji, { orderNo: lo(2) })).ok === false, "화주사 담당자(Web 역할)는 상차를 시작할 수 없다");
  ok((await startOrderedLoad(kim, { orderNo: lo(2) })).ok === false, "3PL 사용자는 상차를 시작할 수 없다");
  let r = await startOrderedLoad(sera, { orderNo: lo(2) });
  ok(!r.ok && r.code === "NOT_FOUND", "다른 화주사 지시서는 '찾을 수 없음'", r);

  /* 지시 상차 시작 */
  r = await startOrderedLoad(jiho, { orderNo: lo(1) });
  ok(!r.ok && r.code === "STATE", "취소된 상차지시서로는 시작할 수 없다", r);
  r = await startOrderedLoad(jiho, { orderNo: "LO-19990101-0001" });
  ok(!r.ok && r.code === "NOT_FOUND", "없는 지시서 번호", r);
  r = await startOrderedLoad(jiho, { orderNo: ` ${lo(2).toLowerCase()} ` });
  ok(r.ok && !!r.data?.loadId, "소문자·공백이 섞인 스캔값도 지시서로 찾는다", r);
  const loadId = r.ok ? r.data!.loadId : 0;
  const asn2 = await db.asn.findFirstOrThrow({ where: { loadOrder: { orderNo: lo(2) } } });
  ok(asn2.status === "REGISTERED", "스캔만 하면 ASN은 아직 등록 상태(첫 입력부터 상차중)");
  const r2 = await startOrderedLoad(worker2, { orderNo: lo(2) });
  ok(r2.ok && r2.data?.loadId === loadId, "두 번째 작업자가 같은 지시서를 스캔하면 같은 실적에 함께 들어간다(잠금 없음)", r2);
  let v = (await getPdaLoad(jiho, loadId))!;
  ok(v.lines.length === 1 && v.lines[0].orderBase === 320 && v.lines[0].showUnit === "PLT", "지시수량은 기준 단위로(생수 4PLT = 320EA), 보여 줄 단위는 PLT", v.lines);

  /* 스캔 미리 보기 · 입력 */
  let p = await previewScan(jiho, { loadId, scan: "8801100022109\r\n" });
  ok(p.ok && p.data?.unit === "EA" && p.data.itemCode === "HB-2210", "바코드 스캔(줄바꿈 포함) → 품목·스캔 단위(EA)", p);
  p = await previewScan(jiho, { loadId, scan: "hb-2210" });
  ok(p.ok && p.data?.by === "code", "품목코드 손 입력도 찾는다(대소문자 무시)", p);
  p = await previewScan(jiho, { loadId, scan: "0000000000000" });
  ok(!p.ok && p.code === "NOT_FOUND", "등록되지 않은 바코드", p);
  p = await previewScan(jiho, { loadId, scan: "18801100010011" }); // 두부 BOX — 아직 오늘 ASN에 없음
  ok(!p.ok && p.code === "STATE" && p.error.includes("오늘 ASN에 없는"), "오늘 ASN에 없는 품목은 지시 상차에서도 차단(C5)", p);
  // 화주사 담당자가 두부를 담은 ASN을 오늘 하나 더 등록하면(정의서 ③ 추가 등록) 지시 외 품목으로 실을 수 있다
  const tofuLine = await db.inboundPlanLine.findFirstOrThrow({ where: { item: { code: "HB-1001" }, plan: { client: { code: "HB01" }, status: "APPROVED", center: { code: "YI1" } } }, orderBy: { id: "asc" } });
  const extraAsn = await createAsn(minji, { centerId: yi1, shipDate: todayKst(), vehicleNo: "60다 3030", lines: [{ planLineId: tofuLine.id, qty: 10 }] });
  ok(extraAsn.ok, "한빛식품 오늘 ASN 추가 등록(두부 10BOX)", extraAsn);
  const extraOrderNo = extraAsn.ok ? extraAsn.data!.orderNo : "";
  p = await previewScan(jiho, { loadId, scan: "18801100010011" });
  ok(p.ok && p.data?.orderBase === 0 && p.data.unit === "BOX", "오늘 다른 ASN 품목은 스캔할 수 있다(지시 외, BOX 바코드)", p);

  let a = await addLoadInput(jiho, { loadId, scan: "8801100022109", qty: 0 });
  ok(!a.ok && !!a.fieldErrors?.qty, "수량 0은 막는다", a);
  a = await addLoadInput(jiho, { loadId, scan: "8801100022109", qty: 160, deviceId: "PDA-T1" });
  ok(a.ok, "추가수량 160EA 입력", a);
  const asn2b = await db.asn.findUniqueOrThrow({ where: { id: asn2.id }, include: { histories: true } });
  ok(asn2b.status === "LOADING" && asn2b.version === asn2.version + 1 && asn2b.histories.some((h) => h.action === "LOAD_START"), "첫 입력에서 ASN 상차중 + 이력(상차 시작)");
  const c = await cancelAsn(minji, { id: asn2.id, version: asn2b.version, reasonCode: "X03" });
  ok(!c.ok && c.code === "STATE", "상차중인 ASN은 화주사가 취소할 수 없다", c);
  a = await addLoadInput(worker2, { loadId, scan: "HB-2210", qty: 140, deviceId: "PDA-T2" });
  ok(a.ok, "두 번째 작업자 입력 140EA (합계 300EA)", a);
  a = await addLoadInput(jiho, { loadId, scan: "8801100022109", qty: 30 });
  ok(!a.ok && a.code === "CONFIRM", "지시수량(320EA)을 넘으면 경고 후 확인을 받는다", a);
  a = await addLoadInput(jiho, { loadId, scan: "18801100010011", qty: 1 });
  ok(!a.ok && a.code === "CONFIRM", "지시 외 품목도 경고", a);
  a = await addLoadInput(jiho, { loadId, scan: "18801100010011", qty: 1, confirm: true });
  ok(a.ok, "경고를 확인하면 지시 외 품목도 싣는다(두부 1BOX)", a);
  const extraInputId = a.ok ? a.data!.inputId : 0;
  v = (await getPdaLoad(jiho, loadId))!;
  const water = v.lines.find((l) => l.itemCode === "HB-2210")!;
  const tofu = v.lines.find((l) => l.itemCode === "HB-1001")!;
  ok(water.loadBase === 300 && water.state === "short" && tofu.loadBase === 20 && tofu.state === "extra", "품목별 합계 = 입력 행 합계(생수 300EA 부족, 두부 20EA 지시 외)", v.lines);
  ok(v.workers.length === 2 && v.inputs.filter((i) => i.mine).length === 2, "작업자 2명, 내 입력 2건");

  /* 본인 입력만 정정·취소 */
  const otherInput = v.inputs.find((i) => !i.mine)!;
  let x = await cancelLoadInput(jiho, { inputId: otherInput.id });
  ok(!x.ok && x.code === "FORBIDDEN", "다른 작업자 입력은 취소할 수 없다", x);
  x = await cancelLoadInput(jiho, { inputId: extraInputId });
  ok(x.ok, "본인 입력 취소(두부)", x);
  x = await cancelLoadInput(jiho, { inputId: extraInputId });
  ok(!x.ok && x.code === "STATE", "이미 취소한 입력은 다시 취소할 수 없다", x);
  const myWater = v.inputs.find((i) => i.mine && i.itemCode === "HB-2210")!;
  let cr = await correctLoadInput(jiho, { inputId: myWater.id, qty: 200 });
  ok(!cr.ok && cr.code === "CONFIRM", "정정으로 지시수량을 넘으면 경고(160→200, 합계 340EA)", cr);
  cr = await correctLoadInput(jiho, { inputId: myWater.id, qty: 180 });
  ok(cr.ok, "정정 160 → 180EA (합계 320EA = 지시)", cr);
  v = (await getPdaLoad(jiho, loadId))!;
  ok(v.lines.length === 1 && v.lines[0].loadBase === 320 && v.lines[0].state === "match", "정정 후 합계 일치, 취소한 지시 외 품목은 목록에서 빠진다", v.lines);
  ok(v.inputs.some((i) => i.id === myWater.id && i.canceled) && v.inputs.some((i) => i.corrected && !i.canceled), "정정 = 원래 행 취소 + 새 행(이력 남음)");

  /* 상차완료 */
  const stale = v.lastInputId;
  await addLoadInput(worker2, { loadId, scan: "HB-2210", qty: 1, confirm: true });
  let done = await completeLoad(jiho, { loadId, lastInputId: stale });
  ok(!done.ok && done.code === "CONFLICT" && done.error === LOAD_CONFLICT_MSG, "확인 화면 뒤에 다른 작업자 입력이 들어오면 상차완료를 막는다", done);
  v = (await getPdaLoad(jiho, loadId))!;
  ok(v.hasDiff, "1EA 더 실어 차이 생김");
  done = await completeLoad(jiho, { loadId, lastInputId: v.lastInputId });
  ok(!done.ok && !!done.fieldErrors?.reasonCode, "차이가 있으면 사유 필수", done);
  done = await completeLoad(jiho, { loadId, lastInputId: v.lastInputId, reasonCode: "L99" });
  ok(!done.ok && !!done.fieldErrors?.reasonText, "'기타'는 상세 내용 필수", done);
  done = await completeLoad(jiho, { loadId, lastInputId: v.lastInputId, reasonCode: "X03" });
  ok(!done.ok && !!done.fieldErrors?.reasonCode, "다른 그룹 사유 코드는 받지 않는다", done);
  done = await completeLoad(jiho, { loadId, lastInputId: v.lastInputId, reasonCode: "L99", reasonText: "기사 요청으로 1개 더" });
  ok(done.ok && !!done.data?.loadNo.startsWith(`LD-${ymd}-`), "상차완료 → 상차확인서 번호 발행", done);
  const asn2c = await db.asn.findUniqueOrThrow({ where: { id: asn2.id }, include: { loadOrder: true, histories: true } });
  ok(asn2c.status === "LOADED" && asn2c.loadOrder?.status === "LOADED" && asn2c.histories.some((h) => h.action === "LOAD_COMPLETE" && h.reasonCode === "L99"), "ASN·상차지시서 상차완료 + 이력(사유)");
  done = await completeLoad(jiho, { loadId, lastInputId: v.lastInputId, reasonCode: "L99", reasonText: "x" });
  ok(!done.ok && done.code === "STATE", "상차완료는 차량당 1회", done);
  a = await addLoadInput(worker2, { loadId, scan: "HB-2210", qty: 1, confirm: true });
  ok(!a.ok && a.code === "STATE", "상차완료 뒤 입력은 거부", a);
  x = await cancelLoadInput(worker2, { inputId: v.inputs.find((i) => i.mine === false && !i.canceled)!.id });
  ok(!x.ok && x.code === "STATE", "상차완료 뒤 정정·취소도 거부", x);
  r = await startOrderedLoad(jiho, { orderNo: lo(2) });
  ok(r.ok && r.data?.loadId === loadId && !!r.data.notice, "상차완료된 지시서를 다시 스캔하면 결과 화면으로(입력 불가 안내)", r);

  /* 상차할 것이 없으면 완료 불가 */
  const overdue = await db.asn.findFirstOrThrow({ where: { clientId: jiho.clientId!, status: "REGISTERED", shipDate: { lt: new Date(`${todayKst()}T00:00:00Z`) } }, include: { loadOrder: true } });
  r = await startOrderedLoad(jiho, { orderNo: overdue.loadOrder!.orderNo });
  ok(r.ok && !!r.data?.notice?.includes("출고일"), "출고일 지난 지시서는 안내와 함께 시작", r);
  const emptyLoad = r.ok ? r.data!.loadId : 0;
  done = await completeLoad(jiho, { loadId: emptyLoad, lastInputId: 0 });
  ok(!done.ok && done.code === "STATE", "아무것도 싣지 않으면 상차완료할 수 없다", done);
  // 스캔만 하고 싣지 않은 ASN은 화주사가 취소할 수 있고, 빈 실적은 지워진다
  const ov = await db.asn.findUniqueOrThrow({ where: { id: overdue.id } });
  x = await cancelAsn(minji, { id: ov.id, version: ov.version, reasonCode: "X03" });
  ok(x.ok && !(await db.load.findUnique({ where: { id: emptyLoad } })), "스캔만 한 ASN 취소 → 빈 상차 실적 삭제", x);

  /* 무지시 상차 */
  r = await startUnorderedLoad(jiho, { centerId: yi1, vehicleNo: "60다3030" });
  ok(!r.ok && r.code === "CONFIRM" && r.fieldErrors?.orderNo === extraOrderNo, "같은 차량번호로 상차할 ASN이 있으면 지시 상차로 안내", r);
  r = await startUnorderedLoad(yuna, { centerId: yi1, vehicleNo: "12가3456" });
  ok(!r.ok && r.code === "STATE", "오늘 ASN이 없는 화주사는 무지시 상차로 실을 품목이 없다(C5)", r);
  r = await startUnorderedLoad(jiho, { centerId: yi1, vehicleNo: "" });
  ok(!r.ok && !!r.fieldErrors?.vehicleNo, "차량번호 필수", r);
  r = await startUnorderedLoad(jiho, { centerId: yi1, vehicleNo: "88 거 1234" });
  ok(r.ok, "무지시 상차 시작(차량번호 공백 제거)", r);
  const freeId = r.ok ? r.data!.loadId : 0;
  r = await startUnorderedLoad(worker2, { centerId: yi1, vehicleNo: "88거1234" });
  ok(r.ok && r.data?.loadId === freeId, "같은 차량 무지시 상차는 두 번째 작업자도 같은 실적으로", r);
  a = await addLoadInput(jiho, { loadId: freeId, scan: "18801100031054", qty: 3, confirm: true });
  ok(!a.ok && a.code === "STATE", "무지시 상차도 오늘 ASN에 없는 품목(김치)은 차단", a);
  a = await addLoadInput(jiho, { loadId: freeId, scan: "18801100010011", qty: 3 });
  ok(a.ok, "무지시 상차는 오늘 ASN 품목이면 경고 없이 입력(두부 3BOX)", a);

  // 그린마켓: 오늘 ASN 1건(세제) 등록 후 무지시 상차 → ASN에 없는 품목(종이타월)은 차단
  const gmLine = await db.inboundPlanLine.findFirstOrThrow({ where: { item: { code: "GM-0501" }, plan: { client: { code: "GM01" }, status: "APPROVED" } } });
  const ca = await createAsn(doyun, { centerId: yi1, shipDate: todayKst(), vehicleNo: "70나1111", lines: [{ planLineId: gmLine.id, qty: 5 }] });
  ok(ca.ok, "그린마켓 오늘 ASN 등록(세제 5BOX)", ca);
  r = await startUnorderedLoad(sera, { centerId: yi1, vehicleNo: "70나2222" });
  ok(r.ok, "그린마켓 무지시 상차 시작", r);
  const gmFree = r.ok ? r.data!.loadId : 0;
  a = await addLoadInput(sera, { loadId: gmFree, scan: "GM-0801", qty: 1, confirm: true });
  ok(!a.ok && a.code === "STATE" && a.error.includes("오늘 ASN에 없는"), "오늘 ASN에 없는 품목은 확인해도 차단(C5·D10)", a);
  a = await addLoadInput(sera, { loadId: gmFree, scan: "GM-0501", qty: 2 });
  ok(a.ok, "오늘 ASN 품목(세제)은 실을 수 있다", a);
  a = await addLoadInput(sera, { loadId: freeId, scan: "18801100010011", qty: 1 });
  ok(!a.ok && a.code === "NOT_FOUND", "다른 화주사 실적에는 입력할 수 없다", a);

  const fv = (await getPdaLoad(jiho, freeId))!;
  done = await completeLoad(jiho, { loadId: freeId, lastInputId: fv.lastInputId });
  ok(!done.ok && !!done.fieldErrors?.reasonCode, "무지시 상차는 항상 차이 → 사유 필수", done);
  done = await completeLoad(jiho, { loadId: freeId, lastInputId: fv.lastInputId, reasonCode: "L04" });
  ok(done.ok, "무지시 상차완료(예정 외 차량)", done);

  /* 웹 조회 · 범위 */
  const mine = await listMyAsns(minji);
  ok(mine.some((x) => x.kind === "load" && x.vehicleNo === "88거1234" && x.status === "LOADED"), "화주사 ASN 목록에 무지시 상차가 '상차완료'로 보인다");
  const asnRow = mine.find((x) => x.kind === "asn" && x.id === asn2.id)!;
  ok(!!asnRow.loadNo?.startsWith("LD-") && asnRow.tab === "loading", "지시 상차 ASN 행에 상차확인서 번호, 상차 진행 탭", asnRow);
  ok(!(await listMyAsns(doyun)).some((x) => x.kind === "load" && x.clientId === jiho.clientId), "다른 화주사 무지시 실적은 보이지 않는다");
  const tpl = await listAsnStatus(kim);
  ok(tpl.some((x) => x.kind === "load" && x.vehicleNo === "88거1234") && tpl.some((x) => x.kind === "load" && x.vehicleNo === "70나2222" && x.status === "LOADING"), "3PL 현황에 무지시 상차(상차완료·상차중)가 보인다");
  const det = (await getAsnDetail(minji, asn2.id))!;
  ok(det.load?.status === "COMPLETED" && det.load.diffReasonName === "기타" && det.load.diffReasonText === "기사 요청으로 1개 더", "화주사 ASN 상세에 상차 실적·차이 사유", det.load);
  ok(!!(await getAsnStatusDetail(kim, asn2.id))?.load, "3PL ASN 상세에도 상차 실적");
  ok((await getLoadView(doyun, freeId)) === null, "다른 화주사 담당자는 무지시 실적을 볼 수 없다");
  ok(!!(await getLoadView(kim, freeId)), "3PL은 소속 센터 무지시 실적을 본다");
  const print = await getLoadConfirmPrint(minji, loadId);
  ok(!!print && print.sender.name.length > 0 && print.lines.length === 1, "상차확인서 인쇄 데이터(발송인·품목)", print?.lines);
  ok((await getLoadConfirmPrint(doyun, (await db.load.findFirstOrThrow({ where: { status: "WORKING", clientId: doyun.clientId! } })).id)) === null, "작업 중 실적은 상차확인서를 인쇄할 수 없다");
  ok((await getLoadConfirmPrint(doyun, loadId)) === null, "다른 화주사는 상차확인서를 볼 수 없다");

  /* 미종결 · DB 제약 */
  ok((await countUnclosed([jiho.clientId!])).get(jiho.clientId!)!.asn >= 1, "상차중 ASN은 미종결 건수에 들어간다");
  let blocked = false;
  try {
    await db.loadInput.create({ data: { loadId, itemId: water.itemId, unit: "EA", addQty: 0, baseQty: 0, workerId: jiho.id, workerName: "x" } });
  } catch {
    blocked = true;
  }
  ok(blocked, "DB 제약: 입력 수량 0 행은 들어가지 않는다");
  blocked = false;
  try {
    await db.load.create({ data: { loadNo: "LD-TEST-0001", loadType: "ORDERED", clientId: jiho.clientId!, centerId: yi1, vehicleNo: "X", loadDate: new Date(), createdBy: "x" } });
  } catch {
    blocked = true;
  }
  ok(blocked, "DB 제약: 지시 상차는 지시서·ASN 참조가 있어야 한다");
  const rls = await db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tb_load_h','tb_load_d','tb_load_input')",
  );
  ok(rls.length === 3 && rls.every((x) => x.relrowsecurity), "상차 테이블 3개 RLS 켜짐", rls);

  console.log(`\n${pass} 통과 / ${fail} 실패`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
