/**
 * 입고검수 규칙 점검 (개발용) — 서버 액션이 쓰는 service.ts를 직접 호출한다.
 * 실행: npx tsx --conditions=react-server scripts/check-rcv-rules.ts   (실행 후 `npx prisma db seed`로 되돌린다)
 * 근거: 정의서 v1.4 ⑥ · 4-2 · 5장 · C6 · C7 · C8 · D14~D17, 2026-11-05 Sol 결정(R1~R10)
 *
 * 시드 전제(그린마켓, 용인1센터): 31바7788 상차중(LD-0001) / 55사2020 상차완료 GM-0730 10 BOX(LD-0002, ASN 지시 12 BOX)
 *                               / 99허1004 무지시 상차완료 GM-0501 2 BOX(LD-0003)
 */
import "dotenv/config";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import {
  addRcvImage, addRcvInput, cancelRcvInput, confirmRcv, correctRcvInput, deleteRcvImage, previewRcvScan, setRcvLineInfo, setRcvZero, startRcv,
} from "@/server/rcv/service";
import { getPdaRcv, getRcvOfLoad, pdaRcvDashboard, pdaRcvHistory, pdaRcvHome } from "@/server/rcv/queries";
import { getAsnDetail } from "@/server/asn/queries";
import { RCV_CONFLICT_MSG } from "@/domain/rcv-rules";
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
const today = todayKst();
const ymd = today.replaceAll("-", "");
const ld = (n: number) => `LD-${ymd}-000${n}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]).toString("base64");

async function boxBarcode(code: string) {
  const b = await db.itemBarcode.findFirstOrThrow({ where: { unit: "BOX", item: { code } } });
  return b.barcode;
}

async function main() {
  const seoyeon = await actor("park.seoyeon"); // 입고검수자 (용인1센터)
  const woojin = await actor("choi.woojin"); // 두 번째 입고검수자 (용인1센터)
  const sera = await actor("gm.sera"); // 그린마켓 상차담당
  const kim = await actor("kim.haneul"); // 3PL 운영담당 (Web)
  const ic2 = await db.center.findUniqueOrThrow({ where: { code: "IC2" } });
  const outsider: PlanActor = { ...seoyeon, id: woojin.id, name: "이천 검수자", centerId: ic2.id };
  const bx0730 = await boxBarcode("GM-0730");
  const bx0501 = await boxBarcode("GM-0501");
  const ea0512 = (await db.itemBarcode.findFirstOrThrow({ where: { unit: "EA", item: { code: "GM-0512" } } })).barcode;

  /* 첫 화면 */
  const home = (await pdaRcvHome(seoyeon))!;
  ok(home.waiting.some((w) => w.loadNo === ld(2)) && home.waiting.some((w) => w.loadNo === ld(3)), "첫 화면: 상차완료 2대(지시·무지시)가 검수 대기", home.waiting.map((w) => w.loadNo));
  ok(!home.waiting.some((w) => w.loadNo === ld(1)), "첫 화면: 상차 중인 차량은 검수 대기에 없다");
  ok(home.working.length === 0 && home.doneCount === 0, "첫 화면: 검수 중·확정 없음");
  ok((await pdaRcvHome(outsider))!.waiting.length === 0, "다른 센터 검수자에게는 용인1센터 차량이 보이지 않는다");

  /* 권한·시작 조건 (R1 · C6) */
  ok((await startRcv(sera, { code: ld(2) })).ok === false, "화주사 상차담당은 검수를 시작할 수 없다");
  ok((await startRcv(kim, { code: ld(2) })).ok === false, "3PL 운영담당(Web)은 검수를 시작할 수 없다");
  let r = await startRcv(outsider, { code: ld(2) });
  ok(!r.ok && r.code === "NOT_FOUND", "다른 센터 검수자: 상차확인서를 찾을 수 없음", r);
  r = await startRcv(seoyeon, { code: ld(1) });
  ok(!r.ok && r.code === "STATE", "상차 중인 차량(상차확인서 스캔)은 검수를 시작할 수 없다", r);
  r = await startRcv(seoyeon, { code: "31바 7788" });
  ok(!r.ok && r.code === "STATE", "상차 중인 차량(차량번호)은 검수를 시작할 수 없다", r);
  r = await startRcv(seoyeon, { code: "00가0000" });
  ok(!r.ok && r.code === "NOT_FOUND", "검수할 실적이 없는 차량번호", r);

  const lo3 = (await db.load.findFirstOrThrow({ where: { loadNo: ld(2) }, include: { loadOrder: true } })).loadOrder!.orderNo;
  r = await startRcv(seoyeon, { code: ` ${lo3.toLowerCase()} ` });
  ok(r.ok && !!r.data?.rcvId, "상차지시서 바코드(소문자·공백)로 검수 시작", r);
  const rcvA = r.ok ? r.data!.rcvId! : 0;
  r = await startRcv(woojin, { code: ld(2) });
  ok(r.ok && r.data?.rcvId === rcvA, "두 번째 검수자: 같은 차량 상차확인서 스캔 → 같은 검수에 함께 들어감(잠금 없음)", r);
  r = await startRcv(woojin, { code: "55사2020" });
  ok(r.ok && r.data?.rcvId === rcvA, "차량번호로도 같은 검수에 들어감", r);

  let v = (await getPdaRcv(seoyeon, rcvA))!;
  ok(v.lines.length === 1 && v.lines[0].expect === 80 && v.lines[0].state === "todo", "기대수량 = 상차완료 수량(GM-0730 10 BOX = 80 EA), 미입력", v.lines);
  ok(v.lines[0].showUnit === "BOX", "보여 줄 단위 = ASN 지시 단위(BOX)");

  /* 스캔·입력 (R3 · R4) */
  const pv = await previewRcvScan(seoyeon, { rcvId: rcvA, scan: bx0730 });
  ok(pv.ok && !pv.data!.mismatch && pv.data!.unit === "BOX" && pv.data!.expect === 80, "미리 보기: 상차 실적 품목, BOX 바코드", pv);
  const pvx = await previewRcvScan(seoyeon, { rcvId: rcvA, scan: ea0512 });
  ok(pvx.ok && pvx.data!.mismatch, "미리 보기: 상차 실적에 없는 품목은 품목 불일치", pvx);
  ok(!(await previewRcvScan(seoyeon, { rcvId: rcvA, scan: "0000000000000" })).ok, "등록되지 않은 바코드");

  let a = await addRcvInput(seoyeon, { rcvId: rcvA, scan: bx0730, qty: 5, kind: "GOOD", deviceId: "PDA-A" });
  ok(a.ok, "검수자 A: 정상 5 BOX", a);
  const inA = a.ok ? a.data!.inputId : 0;
  a = await addRcvInput(woojin, { rcvId: rcvA, scan: bx0730, qty: 4, kind: "GOOD", deviceId: "PDA-B" });
  ok(a.ok, "검수자 B: 같은 품목 정상 4 BOX (동시 작업)", a);
  const inB = a.ok ? a.data!.inputId : 0;
  a = await addRcvInput(woojin, { rcvId: rcvA, scan: bx0730, qty: 2, kind: "DAMAGED" });
  ok(!a.ok && a.code === "CONFIRM", "기대수량(10 BOX)을 넘으면 경고 (막지는 않음)", a);
  ok((await cancelRcvInput(seoyeon, { inputId: inB })).ok === false, "다른 검수자 입력은 취소할 수 없다");
  ok((await correctRcvInput(seoyeon, { inputId: inA, qty: 4 })).ok, "본인 입력 정정 5 → 4 BOX");
  a = await addRcvInput(woojin, { rcvId: rcvA, scan: bx0730, qty: 1, kind: "DAMAGED" });
  ok(a.ok, "검수자 B: 훼손 1 BOX", a);
  a = await addRcvInput(seoyeon, { rcvId: rcvA, scan: bx0730, qty: 1, kind: "GOOD" });
  ok(a.ok, "검수자 A: 정상 1 BOX 더 (정상 9 + 훼손 1 = 10 BOX)", a);
  v = (await getPdaRcv(seoyeon, rcvA))!;
  ok(v.lines[0].good === 72 && v.lines[0].damaged === 8 && v.lines[0].diff === 0, "합계: 정상 72 EA, 훼손 8 EA, 차이 0", v.lines[0]);
  ok(v.lines[0].reasonCode === "V03" && v.lines[0].needsReason, "훼손이 있으면 사유 '훼손·오염(반송)'이 미리 골라진다");
  ok(v.workers.length === 2, "검수자 2명이 보인다", v.workers);

  /* 확정 검사 (C7) */
  r = (await confirmRcv(seoyeon, { rcvId: rcvA, lastInputId: v.lastInputId - 1 })) as typeof r;
  ok(!r.ok && r.code === "CONFLICT" && r.error === RCV_CONFLICT_MSG, "확인 화면 이후 다른 입력이 있으면 확정을 막는다", r);
  r = (await confirmRcv(seoyeon, { rcvId: rcvA, lastInputId: v.lastInputId })) as typeof r;
  ok(!r.ok && r.code === "VALIDATION" && r.error.includes("사진"), "훼손 반송은 사진 1장 이상 필요", r);
  const im1 = await addRcvImage(woojin, { rcvId: rcvA, itemId: v.lines[0].itemId, mime: "image/jpeg", base64: JPEG });
  ok(im1.ok, "훼손 사진 올리기", im1);
  ok((await addRcvImage(woojin, { rcvId: rcvA, itemId: v.lines[0].itemId, mime: "text/plain", base64: JPEG })).ok === false, "사진 형식이 아니면 막는다");
  ok((await deleteRcvImage(seoyeon, { imageId: im1.ok ? im1.data!.imageId : 0 })).ok === false, "다른 검수자 사진은 지울 수 없다");

  // 품목 불일치: 상차 실적에 없는 GM-0512 20 EA → 반송 기록만
  a = await addRcvInput(seoyeon, { rcvId: rcvA, scan: ea0512, qty: 20, kind: "GOOD" });
  ok(a.ok && a.message.includes("품목 불일치"), "상차 실적에 없는 품목은 GOOD으로 보내도 품목 불일치 반송", a);
  v = (await getPdaRcv(seoyeon, rcvA))!;
  const mm = v.lines.find((l) => l.mismatch)!;
  ok(!!mm && mm.mismatchQty === 20 && mm.reasonCode === "V04", "품목 불일치 라인: 20 EA, 사유 '품목 불일치(반송)'", mm);

  // 사유 '기타'는 상세 필수
  await setRcvLineInfo(seoyeon, { rcvId: rcvA, itemId: v.lines[0].itemId, reasonCode: "V99", reasonText: "" });
  v = (await getPdaRcv(seoyeon, rcvA))!;
  r = (await confirmRcv(seoyeon, { rcvId: rcvA, lastInputId: v.lastInputId })) as typeof r;
  ok(!r.ok && r.code === "VALIDATION" && r.error.includes("상세"), "'기타' 사유는 상세 내용 필수", r);
  await setRcvLineInfo(seoyeon, { rcvId: rcvA, itemId: v.lines[0].itemId, reasonCode: "V03" });

  const before0730 = await db.inboundPlanLine.findFirstOrThrow({ where: { item: { code: "GM-0730" }, plan: { client: { code: "GM01" }, status: "APPROVED", asnLines: { some: {} } } }, include: { plan: true }, orderBy: { id: "asc" } });
  r = (await confirmRcv(woojin, { rcvId: rcvA, lastInputId: v.lastInputId })) as typeof r;
  ok(r.ok, "검수 확정 (검수자 B가 확정해도 된다)", r);

  /* 확정 결과 — 자동 배분 (C8 · 5-2) */
  const allocs = await db.rcvAlloc.findMany({ where: { rcvId: rcvA }, orderBy: { id: "asc" } });
  ok(allocs.length === 2 && allocs.every((x) => x.step === 1 && x.planLineId === before0730.id), "배분: 1단계(원 ASN 라인)로 같은 입고예정 라인에", allocs);
  ok(allocs.find((x) => x.kind === "GOOD")?.allocQty === 72 && allocs.find((x) => x.kind === "RETURN")?.allocQty === 8, "배분: 정상 72 → 입고 누계, 반송 8 → 반송 누계");
  const after0730 = await db.inboundPlanLine.findUniqueOrThrow({ where: { id: before0730.id }, include: { plan: true } });
  ok(after0730.rcvQty === before0730.rcvQty + 72 && after0730.returnQty === before0730.returnQty + 8, "입고예정 라인 누계 갱신", after0730);
  ok(after0730.plan.status === "PARTIAL", "입고예정: 잔량이 남아 부분입고", after0730.plan.status);
  const hist = await db.inboundPlanHistory.findFirst({ where: { planId: after0730.planId, action: "RECEIVE" } });
  ok(!!hist, "입고예정 이력: 입고검수 확정");
  const lA = await db.load.findFirstOrThrow({ where: { loadNo: ld(2) }, include: { asn: true, loadOrder: true } });
  ok(lA.asn?.status === "RECEIVED" && lA.loadOrder?.status === "INSPECTED", "ASN 입고완료, 상차지시서 검수완료", { asn: lA.asn?.status, lo: lA.loadOrder?.status });
  ok((await db.rcvAlloc.count({ where: { rcvLine: { mismatch: true } } })) === 0, "품목 불일치 반송은 배분하지 않는다");

  // ASN 분배 잔량: 입고완료 ASN은 실제 입고·반송으로 센다 → 덜 실은 2 BOX(16 EA)를 다시 담을 수 있다
  const open = await db.asnLine.aggregate({ where: { planLineId: before0730.id, asn: { status: { in: ["REGISTERED", "LOADING", "LOADED"] } } }, _sum: { baseQty: true } });
  const remain = after0730.baseQty - after0730.closeQty - after0730.rcvQty - after0730.returnQty - (open._sum.baseQty ?? 0);
  ok(remain === 16, "ASN 분배 잔량: 덜 실은 16 EA(2 BOX)가 다시 분배 가능", remain);

  // 확정 뒤에는 고칠 수 없다
  ok((await addRcvInput(seoyeon, { rcvId: rcvA, scan: bx0730, qty: 1, kind: "GOOD" })).ok === false, "확정 뒤 입력 불가");
  ok((await confirmRcv(seoyeon, { rcvId: rcvA, lastInputId: 0 })).ok === false, "확정은 한 번만");
  r = await startRcv(seoyeon, { code: ld(2) });
  ok(r.ok && r.data?.rcvId === rcvA && !!r.data?.notice, "확정된 차량을 다시 스캔하면 결과 화면으로 안내", r);

  /* 무지시 상차 검수 — 2단계부터 배분, 미입력 라인 경고 (D15) */
  r = await startRcv(seoyeon, { code: ld(3) });
  const rcvB = r.ok ? r.data!.rcvId! : 0;
  ok(r.ok && !!rcvB, "무지시 상차 차량 검수 시작", r);
  let vb = (await getPdaRcv(seoyeon, rcvB))!;
  r = (await confirmRcv(seoyeon, { rcvId: rcvB, lastInputId: vb.lastInputId })) as typeof r;
  ok(!r.ok && r.code === "CONFIRM" && !!r.fieldErrors?.unentered, "미입력 라인이 있으면 경고 목록 (시스템이 0 처리하지 않음)", r);
  ok((await setRcvZero(seoyeon, { rcvId: rcvB, itemId: vb.lines[0].itemId, on: true })).ok, "검수자가 0(미도착) 확인");
  vb = (await getPdaRcv(seoyeon, rcvB))!;
  ok(vb.lines[0].zeroConfirm && vb.lines[0].reasonCode === "V05" && vb.lines[0].state === "zero", "0 확인 표시 + 사유 '미도착' 기본", vb.lines[0]);
  ok((await setRcvZero(seoyeon, { rcvId: rcvB, itemId: vb.lines[0].itemId, on: false })).ok, "0 확인 풀기");
  a = await addRcvInput(seoyeon, { rcvId: rcvB, scan: bx0501, qty: 2, kind: "GOOD" });
  ok(a.ok, "정상 2 BOX", a);
  ok((await setRcvZero(seoyeon, { rcvId: rcvB, itemId: vb.lines[0].itemId, on: true })).ok === false, "입력이 있는 품목은 0으로 할 수 없다");
  vb = (await getPdaRcv(seoyeon, rcvB))!;
  const pl0501 = await db.inboundPlanLine.findFirstOrThrow({ where: { item: { code: "GM-0501" }, plan: { client: { code: "GM01" }, centerId: lA.centerId, status: { in: ["APPROVED", "PARTIAL"] } } }, orderBy: { id: "asc" } });
  r = (await confirmRcv(seoyeon, { rcvId: rcvB, lastInputId: vb.lastInputId })) as typeof r;
  ok(r.ok, "무지시 차량 검수 확정", r);
  const ab = await db.rcvAlloc.findMany({ where: { rcvId: rcvB } });
  ok(ab.length === 1 && ab[0].step === 2 && ab[0].planLineId === pl0501.id && ab[0].allocQty === 8, "무지시: 원 ASN이 없어 2단계(같은 화주사 미종결 입고예정)로 배분", ab);

  /* 미입력 → [남은 라인 전부 0 처리] 경로는 시작만 한 새 검수가 없어 서비스 플래그로 점검 */
  const rcvC = await db.rcv.create({
    data: { rcvNo: `RC-${ymd}-9999`, loadId: (await db.load.findFirstOrThrow({ where: { loadNo: ld(3) } })).id, clientId: vb.lines.length ? (await db.rcv.findUniqueOrThrow({ where: { id: rcvB } })).clientId : 0, centerId: (await db.rcv.findUniqueOrThrow({ where: { id: rcvB } })).centerId, vehicleNo: "TEST", rcvDate: new Date(`${today}T00:00:00Z`), createdBy: "점검", status: "WORKING" },
  }).catch(() => null);
  ok(rcvC === null, "DB 제약: 상차 실적당 진행·확정 검수는 1건");

  /* 웹·PDA 조회 */
  const card = await getRcvOfLoad(lA.id);
  ok(!!card && card.status === "CONFIRMED" && card.allocs.length === 2 && card.lines.some((l) => l.imageIds.length === 1), "웹: ASN 상세 검수 결과 카드(배분·사진)", card?.allocs);
  const asnDetail = await getAsnDetail(await actor("gm.doyun"), lA.asnId!);
  ok(asnDetail?.status === "RECEIVED", "화주사 ASN 상세: 입고완료", asnDetail?.status);
  const hist2 = (await pdaRcvHistory(seoyeon, today))!;
  ok(hist2.rows.length === 2 && hist2.rows.some((x) => x.issueCount > 0), "검수 내역: 오늘 확정 2대, 이상 있음 표시", hist2.rows.map((x) => [x.vehicleNo, x.issueCount]));
  const dash = (await pdaRcvDashboard(seoyeon))!;
  ok(dash.done === 2 && dash.waiting === 0 && dash.myInputs >= 3, "대시보드: 확정 2, 대기 0, 내 입력", dash);

  /* DB 제약·RLS */
  let blocked = false;
  try {
    await db.rcvAlloc.create({ data: { rcvId: rcvA, rcvLineId: allocs[0].rcvLineId, kind: "GOOD", step: 3, planLineId: before0730.id, allocQty: 1 } });
  } catch {
    blocked = true;
  }
  ok(blocked, "DB 제약: 3단계(초과) 배분은 입고예정 라인이 없어야 한다");
  const rls = await db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tb_rcv_h','tb_rcv_d','tb_rcv_input','tb_rcv_image','tb_rcv_alloc')",
  );
  ok(rls.length === 5 && rls.every((x) => x.relrowsecurity), "검수 테이블 5개 RLS 켜짐", rls);

  console.log(`\n${pass} 통과 / ${fail} 실패`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
