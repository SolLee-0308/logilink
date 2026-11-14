/**
 * 입차·입차 취소·검수 시작·출차 구분·일마감 처리 점검 (개발용, 정의서 v1.9) — service.ts를 직접 호출한다.
 * 실행: 시드 직후의 DB에서 npx tsx --conditions=react-server scripts/check-arrival-rules.ts
 *       (데이터를 바꾸므로 Sol이 쓰는 시험 DB(3001)가 아니라 점검 전용 DB에서 돌린다)
 *
 * 시드 전제(그린마켓, 용인1센터): 31바7788 상차중(LD-0001) / 55사2020 상차완료 GM-0730(LD-0002, 지시) / 99허1004 무지시 상차완료(LD-0003)
 */
import "dotenv/config";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { runDailyClose } from "@/server/plans/service";
import { dailyCloseView } from "@/server/plans/closing";
import { addRcvInput, cancelRcvInput, startRcv, voidRcv } from "@/server/rcv/service";
import { departLoad, reopenLoad } from "@/server/loads/service";
import { todayKst } from "@/lib/format";

let pass = 0;
let failed = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  if (c) pass++;
  else failed++;
  console.log(c ? "PASS" : "FAIL", m, c || extra === undefined ? "" : JSON.stringify(extra));
};

async function actor(loginId: string): Promise<PlanActor> {
  const u = await db.user.findUniqueOrThrow({ where: { loginId } });
  return { id: u.id, name: u.name, roles: u.roles, clientId: u.clientId, centerId: u.centerId };
}
const ymd = todayKst().replaceAll("-", "");
const ld = (n: number) => `LD-${ymd}-000${n}`;

async function main() {
  const seoyeon = await actor("park.seoyeon"); // 입고검수자 (용인1센터)
  const sera = await actor("gm.sera"); // 그린마켓 상차담당
  const kim = await actor("kim.haneul"); // 3PL 운영담당
  const load2 = await db.load.findUniqueOrThrow({ where: { loadNo: ld(2) } });
  const bx0730 = (await db.itemBarcode.findFirstOrThrow({ where: { unit: "BOX", item: { clientCode: "GM-0730" } } })).barcode;

  /* 진입 방법 (v1.9 ⑥) */
  const part = await startRcv(seoyeon, { code: "2020" });
  ok(part.ok && !!part.data?.candidates?.some((c) => c.loadNo === ld(2)) && !part.data?.rcvId, "일부만 입력(2020) → 1건이어도 후보 목록, 입차하지 않음", part);
  ok((await db.load.findUniqueOrThrow({ where: { id: load2.id } })).arrivedAt === null, "후보 목록만 보여 줄 때는 입차 기록 없음");
  const short = await startRcv(seoyeon, { code: "5" });
  ok(!short.ok && short.code === "VALIDATION", "1자 입력 → 2자 이상 안내", short);
  const none = await startRcv(seoyeon, { code: "99하9999" });
  ok(!none.ok && none.code === "NOT_FOUND", "일치 대상 없음 → 안내", none);

  /* 입차 — 정확한 차량번호 1건 → 바로 진입, 출차 기록 없으면 입차 처리(시스템) */
  const arrive = await startRcv(seoyeon, { code: "55사 2020" });
  ok(arrive.ok && !!arrive.data?.rcvId && arrive.data.arrived === true, "정확한 차량번호 → 바로 입차", arrive);
  const rcvId = (arrive.ok ? arrive.data : undefined)!.rcvId!;
  let l2 = await db.load.findUniqueOrThrow({ where: { id: load2.id } });
  ok(!!l2.arrivedAt && l2.arrivedBy === seoyeon.name, "입차 시각·처리자 저장");
  ok(l2.departType === "ARRIVAL" && l2.departedAt?.getTime() === l2.arrivedAt?.getTime(), "출차 = 입차 처리(시스템), 시각 = 입차 시각", l2);
  let rcv = await db.rcv.findUniqueOrThrow({ where: { id: rcvId } });
  ok(rcv.status === "WORKING" && rcv.startedAt === null, "입고검수 전표 생성, 검수 시작 시각은 비어 있음(도착·검수 대기)");
  const his = await db.loadHistory.findMany({ where: { loadId: load2.id }, orderBy: { id: "asc" } });
  ok(his.some((h) => h.action === "ARRIVE") && his.some((h) => h.action === "DEPART" && h.reasonText === "입차 처리(시스템)"), "상차 이력: 입차 + 출차(입차 처리)", his.map((h) => h.action));
  const asnHis = await db.asnHistory.findMany({ where: { asnId: load2.asnId! } });
  ok(asnHis.some((h) => h.action === "ARRIVE") && asnHis.some((h) => h.action === "LOAD_DEPART"), "ASN 이력: 입차 + 출차");

  /* 다시 스캔 → 새 입차 없이 같은 전표 */
  const again = await startRcv(seoyeon, { code: ld(2) });
  ok(again.ok && again.data?.rcvId === rcvId, "입차한 차량을 다시 스캔 → 같은 검수 화면", again);
  ok((await db.rcv.count({ where: { loadId: load2.id } })) === 1, "전표는 1건 그대로");

  /* 출차·입차 후 상차 재개 불가 */
  const reopen = await reopenLoad(sera, { loadId: load2.id, reasonCode: "R01" });
  ok(!reopen.ok && reopen.code === "STATE", "입차(출차 저장)한 차량은 상차 재개 불가", reopen);

  /* 입차 취소 — 첫 입력 전, 사유 필수 */
  const noReason = await voidRcv(seoyeon, { rcvId, reasonCode: "" });
  ok(!noReason.ok && noReason.code === "VALIDATION", "사유 없이 입차 취소 불가");
  const etc = await voidRcv(seoyeon, { rcvId, reasonCode: "A99" });
  ok(!etc.ok && etc.code === "VALIDATION", "기타는 상세 내용 필수");
  const v = await voidRcv(seoyeon, { rcvId, reasonCode: "A01" });
  ok(v.ok, "입차 취소", v);
  rcv = await db.rcv.findUniqueOrThrow({ where: { id: rcvId } });
  ok(rcv.status === "VOIDED" && rcv.voidReasonCode === "A01", "전표 = 입차 취소 + 사유");
  l2 = await db.load.findUniqueOrThrow({ where: { id: load2.id } });
  ok(l2.arrivedAt === null && l2.departType === "ARRIVAL", "입차 기록은 지우고 출차는 유지(되돌리기 없음)", l2);

  /* 다시 입차 → 새 전표, 출차 이력은 다시 쌓이지 않음 */
  const re = await startRcv(seoyeon, { code: ld(2) });
  ok(re.ok && !!re.data?.rcvId && re.data.rcvId !== rcvId, "입차 취소 뒤 다시 입차 → 새 전표", re);
  const rcvId2 = (re.ok ? re.data : undefined)!.rcvId!;
  ok((await db.loadHistory.count({ where: { loadId: load2.id, action: "DEPART" } })) === 1, "출차 이력은 1건 그대로");

  /* 첫 입력 = 검수 시작 → 이후 입차 취소 불가 */
  const add = await addRcvInput(seoyeon, { rcvId: rcvId2, scan: bx0730, qty: 1, kind: "GOOD" });
  ok(add.ok, "품목 스캔 입력", add);
  rcv = await db.rcv.findUniqueOrThrow({ where: { id: rcvId2 } });
  ok(!!rcv.startedAt, "첫 입력 때 검수 시작 시각 저장");
  await cancelRcvInput(seoyeon, { inputId: (add.ok ? add.data : undefined)!.inputId });
  const v2 = await voidRcv(seoyeon, { rcvId: rcvId2, reasonCode: "A01" });
  ok(!v2.ok && v2.code === "STATE", "입력을 취소해도 검수를 시작한 차량은 입차 취소 불가", v2);
  ok((await db.rcv.findUniqueOrThrow({ where: { id: rcvId2 } })).startedAt?.getTime() === rcv.startedAt?.getTime(), "검수 시작 시각은 처음 값 그대로");

  /* 일마감 처리(시스템) — 전날까지 상차완료한 미출차 차량만 */
  const load3 = await db.load.findUniqueOrThrow({ where: { loadNo: ld(3) } });
  const center = await db.center.findUniqueOrThrow({ where: { id: load3.centerId } });
  let view = (await dailyCloseView(kim, String(center.id)))!;
  ok(!view.departs.some((d) => d.id === load3.id), "오늘 상차완료한 차량은 일마감 처리 대상 아님", view.departs);
  await db.load.update({ where: { id: load3.id }, data: { completedAt: new Date(Date.now() - 2 * 86_400_000) } });
  view = (await dailyCloseView(kim, String(center.id)))!;
  ok(view.departs.some((d) => d.id === load3.id), "전날 이전 상차완료 + 출차·입차 없음 → 대상", view.departs);
  ok(!view.departs.some((d) => d.id === load2.id), "출차 기록이 있는 차량은 대상 아님");
  const stale = await runDailyClose(kim, { centerId: center.id, businessDate: view.center.businessDate, rcvIds: view.rcvs.map((r) => r.id), expireIds: view.expire.map((e) => e.id), departIds: [] });
  ok(!stale.ok && stale.code === "CONFLICT", "화면에서 본 미출차 대상과 다르면 막는다", stale);
  const close = await runDailyClose(kim, {
    centerId: center.id, businessDate: view.center.businessDate, rcvIds: view.rcvs.map((r) => r.id), expireIds: view.expire.map((e) => e.id), departIds: view.departs.map((d) => d.id),
  });
  ok(close.ok, "일마감 실행", close);
  const l3 = await db.load.findUniqueOrThrow({ where: { id: load3.id } });
  ok(l3.departType === "DAILY_CLOSE" && l3.departedBy === kim.name, "일마감 처리(시스템) 출차 저장, 처리자 = 일마감한 담당자", l3);
  const dc = await db.dailyClose.findUniqueOrThrow({ where: { id: (close.ok ? close.data : undefined)!.dailyCloseId } });
  ok(dc.departCount === view.departs.length, "일마감 기록에 출차 처리 대수", dc);
  const dep = await departLoad(sera, { loadId: load3.id });
  ok(!dep.ok && dep.error.includes("일마감 처리(시스템)"), "이미 일마감 처리된 차량은 [출차] 불가, 구분 안내", dep);

  console.log(`\n${pass} PASS / ${failed} FAIL`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
