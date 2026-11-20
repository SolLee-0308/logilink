/**
 * 대시보드 확인용 시험 데이터 추가 (시험용 로컬 DB 전용, 추가만 한다 — 기존 행은 지우거나 고치지 않는다)
 * 실행: npm run check:test -- scripts/seed-dashboard-demo.ts
 *
 * 만드는 것 (센터: 용인1센터 YI1, 화주사: 사용 중 품목이 있는 화주사 2곳)
 *  1. 최근 14업무일(오늘 포함) 날마다 검수 확정 차량 3~8대 — 입고예정 저장·승인 → ASN → 상차·상차완료 → (출차) → 입차 → 검수 확정·배분
 *     일부 차량은 검수 차이(수량 부족·훼손 반송), 일부 날은 입고예정보다 ASN을 덜 실어 입고율이 85~100% 사이로 흔들리게
 *  2. 오늘 출고 ASN 흐름 — 상차 대기 2 · 상차중 1 · 오는 중 2 · 입차(검수 전) 1 · 검수 입력 중 1
 * 방법: 서버 액션이 쓰는 service 함수를 오늘 날짜로 그대로 호출한 뒤, 새로 만든 행의 날짜·시각·문서번호만 과거로 옮긴다.
 * 표시: 차량번호 "99대NNNN" — 이미 있으면 아무것도 만들지 않고 끝낸다(두 번 쌓이지 않게). 일마감은 만들지 않는다.
 */
import "dotenv/config";
import { db } from "@/server/db";
import type { ActionResult } from "@/server/action-result";
import { approvePlan, savePlan, type PlanActor } from "@/server/plans/service";
import { createAsn } from "@/server/asn/service";
import { addLoadInput, completeLoad, departLoad, startOrderedLoad } from "@/server/loads/service";
import { addRcvImage, addRcvInput, confirmRcv, startRcv } from "@/server/rcv/service";
import { minExpiryDays } from "@/server/plans/entry";
import { businessDateOf, isBusinessDay, type OffDays } from "@/domain/business-day";
import { ASN_PREFIX, LOAD_ORDER_PREFIX, docNoPrefix, nextDocNo } from "@/domain/asn-rules";
import { LOAD_PREFIX } from "@/domain/load-rules";
import { RCV_PREFIX } from "@/domain/rcv-rules";
import { nextPlanNo, planNoPrefix } from "@/domain/plan-rules";
import { todayKst } from "@/lib/format";

const MARK = "99대";
const MEMO = "대시보드 시험 데이터";
const CENTER_CODE = "YI1";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]).toString("base64");

/* ───────── 유틸 ───────── */

// 같은 결과가 나오게 고정 시드 난수
let seed = 20261117;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const shuffle = <T>(xs: T[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

const MIN = 60_000;
const KST = 9 * 60 * MIN;
const kst = (ymd: string, h: number, m = 0) => new Date(Date.parse(`${ymd}T00:00:00Z`) - KST + (h * 60 + m) * MIN);
const ymdOf = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10);
const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const plus = (d: Date, min: number) => new Date(d.getTime() + min * MIN);
const hhmm = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(11, 16);

function must<T>(r: ActionResult<T>, what: string): T {
  if (!r.ok) throw new Error(`${what} 실패: [${r.code}] ${r.error} ${JSON.stringify(r.fieldErrors ?? {})}`);
  return r.data as T;
}

async function actor(loginId: string): Promise<PlanActor> {
  const u = await db.user.findUniqueOrThrow({ where: { loginId } });
  return { id: u.id, name: u.name, roles: u.roles, clientId: u.clientId, centerId: u.centerId };
}

/** 그 접두의 다음 번호 (이미 쓰인 번호 뒤로) */
async function nextNo(kind: "IP" | "ASN" | "LO" | "LD" | "RC", ymd: string) {
  if (kind === "IP") {
    const used = await db.inboundPlan.findMany({ where: { planNo: { startsWith: planNoPrefix(ymd) } }, select: { planNo: true } });
    return nextPlanNo(ymd, used.map((u) => u.planNo));
  }
  const prefix = { ASN: ASN_PREFIX, LO: LOAD_ORDER_PREFIX, LD: LOAD_PREFIX, RC: RCV_PREFIX }[kind];
  const p = docNoPrefix(prefix, ymd);
  const used =
    kind === "ASN"
      ? (await db.asn.findMany({ where: { asnNo: { startsWith: p } }, select: { asnNo: true } })).map((x) => x.asnNo)
      : kind === "LO"
        ? (await db.loadOrder.findMany({ where: { orderNo: { startsWith: p } }, select: { orderNo: true } })).map((x) => x.orderNo)
        : kind === "LD"
          ? (await db.load.findMany({ where: { loadNo: { startsWith: p } }, select: { loadNo: true } })).map((x) => x.loadNo)
          : (await db.rcv.findMany({ where: { rcvNo: { startsWith: p } }, select: { rcvNo: true } })).map((x) => x.rcvNo);
  return nextDocNo(prefix, ymd, used);
}

/* ───────── 준비 ───────── */

type ItemRow = { id: number; name: string; unit: "EA" | "BOX" | "PLT"; barcode: string; expiryManaged: boolean; lotManaged: boolean; min: number; max: number };
type Party = { client: { id: number; name: string }; staff: PlanActor; items: ItemRow[] };

type Stage = "asn" | "loading" | "loaded" | "arrived" | "inspecting" | "confirmed";
type Diff = "none" | "short" | "damaged";
interface Spec {
  party: Party;
  vehicleNo: string;
  driver: string;
  lines: { item: ItemRow; planQty: number; asnQty: number }[];
  stage: Stage;
  diff: Diff;
  inspector: PlanActor;
  manualDepart: boolean;
}
interface Made {
  planId: number;
  asnId: number;
  loadId?: number;
  rcvId?: number;
  good: number;
  ret: number;
  planQty: number;
}

const DRIVERS = ["김영수", "이정호", "박상민", "최동욱", "정기철", "강민호", "윤재석", "장성훈", "임태준", "한경수", "오세진", "서준혁"];

/** 서비스 함수로 한 차량을 지정한 단계까지 진행한다 (모두 '지금' 시각으로 저장됨) */
async function runVehicle(s: Spec, ctx: { centerId: number; approver: PlanActor; today: string; minDays: number }): Promise<Made> {
  const { staff } = s.party;
  const expiry = addDays(ctx.today, ctx.minDays + randInt(20, 90));
  const plan = must(
    await savePlan(staff, {
      centerId: ctx.centerId,
      planDate: ctx.today,
      memo: MEMO,
      lines: s.lines.map((l) => ({
        itemId: l.item.id,
        unit: l.item.unit, // 기준 단위로 입력 (스캔도 기준 단위 바코드)
        qty: l.planQty,
        expiryDate: l.item.expiryManaged ? expiry : null,
        lotNo: l.item.lotManaged ? `LT${ctx.today.replaceAll("-", "").slice(2)}${randInt(10, 99)}` : null,
      })),
    }),
    `입고예정 저장(${s.vehicleNo})`,
  )!;
  must(await approvePlan(ctx.approver, { id: plan.id, version: 1 }), `입고예정 승인(${plan.planNo})`);
  const planLines = await db.inboundPlanLine.findMany({ where: { planId: plan.id }, orderBy: { lineNo: "asc" } });
  const asn = must(
    await createAsn(staff, {
      centerId: ctx.centerId,
      shipDate: ctx.today,
      vehicleNo: s.vehicleNo,
      driverName: s.driver,
      driverTel: `010-${randInt(2000, 9899)}-${randInt(1000, 9999)}`,
      memo: MEMO,
      lines: planLines.map((pl, i) => ({ planLineId: pl.id, qty: s.lines[i].asnQty })),
    }),
    `ASN 등록(${s.vehicleNo})`,
  )!;
  const made: Made = { planId: plan.id, asnId: asn.id, good: 0, ret: 0, planQty: s.lines.reduce((a, l) => a + l.planQty, 0) };
  if (s.stage === "asn") return made;

  // 상차
  const loader = staff;
  const load = must(await startOrderedLoad(loader, { orderNo: asn.orderNo }), `상차 시작(${s.vehicleNo})`)!;
  made.loadId = load.loadId;
  const toLoad = s.stage === "loading" ? s.lines.slice(0, 1).map((l) => ({ ...l, asnQty: Math.max(1, Math.floor(l.asnQty / 2)) })) : s.lines;
  for (const l of toLoad) {
    // 두 번에 나눠 싣는다 (입력 행 여러 개)
    const first = l.asnQty > 1 ? Math.ceil(l.asnQty / 2) : l.asnQty;
    must(await addLoadInput(loader, { loadId: load.loadId, scan: l.item.barcode, qty: first, deviceId: "PDA-DEMO", confirm: true }), "상차 입력");
    if (l.asnQty - first > 0)
      must(await addLoadInput(loader, { loadId: load.loadId, scan: l.item.barcode, qty: l.asnQty - first, deviceId: "PDA-DEMO", confirm: true }), "상차 입력");
  }
  if (s.stage === "loading") return made;
  const lastLoadInput = await db.loadInput.findFirst({ where: { loadId: load.loadId }, orderBy: { id: "desc" } });
  must(await completeLoad(loader, { loadId: load.loadId, lastInputId: lastLoadInput!.id }), `상차완료(${s.vehicleNo})`);
  if (s.manualDepart) must(await departLoad(loader, { loadId: load.loadId }), `출차(${s.vehicleNo})`);
  if (s.stage === "loaded") return made;

  // 입차 (검수 전표 생성)
  const rcv = must(await startRcv(s.inspector, { loadId: load.loadId }), `입차(${s.vehicleNo})`)!;
  made.rcvId = rcv.rcvId!;
  if (s.stage === "arrived") return made;

  // 검수 입력 — 차이 차량은 한 줄에서 부족 또는 훼손
  const diffIdx = s.diff === "none" ? -1 : randInt(0, s.lines.length - 1);
  const toCheck = s.stage === "inspecting" ? s.lines.slice(0, Math.max(1, s.lines.length - 1)) : s.lines;
  for (const [i, l] of toCheck.entries()) {
    let good = l.asnQty;
    let damaged = 0;
    if (i === diffIdx) {
      const k = Math.max(1, Math.min(l.asnQty - 1, randInt(1, Math.max(1, Math.round(l.asnQty * 0.08)))));
      good = l.asnQty - k;
      if (s.diff === "damaged") damaged = k;
    }
    if (good > 0) {
      const first = good > 3 ? Math.ceil(good * 0.6) : good;
      must(await addRcvInput(s.inspector, { rcvId: rcv.rcvId!, scan: l.item.barcode, qty: first, kind: "GOOD", deviceId: "PDA-DEMO" }), "검수 입력");
      if (good - first > 0) must(await addRcvInput(s.inspector, { rcvId: rcv.rcvId!, scan: l.item.barcode, qty: good - first, kind: "GOOD", deviceId: "PDA-DEMO" }), "검수 입력");
    }
    if (damaged > 0) {
      must(await addRcvInput(s.inspector, { rcvId: rcv.rcvId!, scan: l.item.barcode, qty: damaged, kind: "DAMAGED", deviceId: "PDA-DEMO" }), "훼손 입력");
      must(await addRcvImage(s.inspector, { rcvId: rcv.rcvId!, itemId: l.item.id, mime: "image/jpeg", base64: JPEG }), "훼손 사진");
    }
    made.good += good;
    made.ret += damaged;
  }
  if (s.stage === "inspecting") return made;
  const lastRcvInput = await db.rcvInput.findFirst({ where: { rcvId: rcv.rcvId! }, orderBy: { id: "desc" } });
  must(await confirmRcv(s.inspector, { rcvId: rcv.rcvId!, lastInputId: lastRcvInput!.id }), `검수 확정(${s.vehicleNo})`);
  return made;
}

/* ───────── 시각·번호 옮기기 (새로 만든 행만) ───────── */

interface Times {
  planDate: string;
  shipDate: string;
  planCreated: Date;
  approvedAt: Date;
  asnCreated: Date;
  loadStart?: Date;
  completedAt?: Date;
  departedAt?: Date | null; // 사람 출차면 시각, 입차 처리(시스템)면 null → 입차 시각
  arrivedAt?: Date;
  startedAt?: Date;
  confirmedAt?: Date;
  /** 아직 끝나지 않은 단계의 마지막 시각 (검수·상차 입력 중) */
  inputEnd?: Date;
}

/** 시각 목록을 [from, to] 사이에 고르게 */
const spread = (n: number, from: Date, to: Date) => Array.from({ length: n }, (_, i) => new Date(from.getTime() + ((to.getTime() - from.getTime()) * (i + 1)) / (n + 1)));

async function shift(m: Made, t: Times) {
  // 입고예정
  const plan = await db.inboundPlan.findUniqueOrThrow({ where: { id: m.planId } });
  const planNo = ymdOf(t.planCreated) === ymdOf(plan.createdAt) ? plan.planNo : await nextNo("IP", ymdOf(t.planCreated));
  const planEnd = t.confirmedAt ?? t.approvedAt;
  await db.inboundPlan.update({
    where: { id: m.planId },
    data: { planNo, planDate: asDate(t.planDate), savedAt: t.planCreated, createdAt: t.planCreated, approvedAt: t.approvedAt, updatedAt: planEnd },
  });
  await db.inboundPlanHistory.updateMany({ where: { planId: m.planId, action: "CREATE" }, data: { at: t.planCreated } });
  await db.inboundPlanHistory.updateMany({ where: { planId: m.planId, action: "APPROVE" }, data: { at: t.approvedAt } });

  // ASN·상차지시서
  const asn = await db.asn.findUniqueOrThrow({ where: { id: m.asnId }, include: { loadOrder: true } });
  const sameDay = ymdOf(t.asnCreated) === ymdOf(asn.createdAt);
  const asnNo = sameDay ? asn.asnNo : await nextNo("ASN", ymdOf(t.asnCreated));
  const orderNo = sameDay ? asn.loadOrder!.orderNo : await nextNo("LO", ymdOf(t.asnCreated));
  const asnEnd = t.confirmedAt ?? t.arrivedAt ?? t.departedAt ?? t.completedAt ?? t.inputEnd ?? t.asnCreated;
  await db.asn.update({ where: { id: m.asnId }, data: { asnNo, shipDate: asDate(t.shipDate), createdAt: t.asnCreated, updatedAt: asnEnd } });
  await db.loadOrder.update({ where: { id: asn.loadOrder!.id }, data: { orderNo, issuedAt: t.asnCreated, updatedAt: asnEnd } });
  await db.asnHistory.updateMany({ where: { asnId: m.asnId, action: "CREATE" }, data: { at: t.asnCreated } });

  if (!m.loadId || !t.loadStart) return;
  // 상차
  const load = await db.load.findUniqueOrThrow({ where: { id: m.loadId } });
  const loadNo = ymdOf(t.loadStart) === ymdOf(load.createdAt) ? load.loadNo : await nextNo("LD", ymdOf(t.loadStart));
  const inputs = await db.loadInput.findMany({ where: { loadId: m.loadId }, orderBy: { id: "asc" } });
  const loadInputEnd = t.completedAt ? plus(t.completedAt, -2) : t.inputEnd!;
  const at = spread(inputs.length, t.loadStart, loadInputEnd);
  for (const [i, x] of inputs.entries()) await db.loadInput.update({ where: { id: x.id }, data: { inputAt: at[i] } });
  const departAt = t.departedAt ?? (load.departType === "ARRIVAL" ? t.arrivedAt : undefined);
  await db.load.update({
    where: { id: m.loadId },
    data: {
      loadNo,
      loadDate: asDate(ymdOf(t.loadStart)),
      createdAt: t.loadStart,
      ...(t.completedAt ? { completedAt: t.completedAt } : {}),
      ...(load.departedAt && departAt ? { departedAt: departAt } : {}),
      ...(t.arrivedAt && load.arrivedAt ? { arrivedAt: t.arrivedAt } : {}),
      updatedAt: t.arrivedAt ?? departAt ?? t.completedAt ?? loadInputEnd,
    },
  });
  if (at[0]) await db.asnHistory.updateMany({ where: { asnId: m.asnId, action: "LOAD_START" }, data: { at: at[0] } });
  if (t.completedAt) {
    await db.loadHistory.updateMany({ where: { loadId: m.loadId, action: "COMPLETE" }, data: { at: t.completedAt } });
    await db.asnHistory.updateMany({ where: { asnId: m.asnId, action: "LOAD_COMPLETE" }, data: { at: t.completedAt } });
  }
  if (departAt) {
    await db.loadHistory.updateMany({ where: { loadId: m.loadId, action: "DEPART" }, data: { at: departAt } });
    await db.asnHistory.updateMany({ where: { asnId: m.asnId, action: "LOAD_DEPART" }, data: { at: departAt } });
  }
  if (!m.rcvId || !t.arrivedAt) return;
  await db.loadHistory.updateMany({ where: { loadId: m.loadId, action: "ARRIVE" }, data: { at: t.arrivedAt } });
  await db.asnHistory.updateMany({ where: { asnId: m.asnId, action: "ARRIVE" }, data: { at: t.arrivedAt } });

  // 입고검수
  const rcv = await db.rcv.findUniqueOrThrow({ where: { id: m.rcvId } });
  const rcvNo = ymdOf(t.arrivedAt) === ymdOf(rcv.createdAt) ? rcv.rcvNo : await nextNo("RC", ymdOf(t.arrivedAt));
  const rInputs = await db.rcvInput.findMany({ where: { rcvId: m.rcvId }, orderBy: { id: "asc" } });
  const rEnd = t.confirmedAt ? plus(t.confirmedAt, -3) : t.inputEnd!;
  const rAt = t.startedAt ? [t.startedAt, ...spread(Math.max(rInputs.length - 1, 0), t.startedAt, rEnd)] : [];
  for (const [i, x] of rInputs.entries()) await db.rcvInput.update({ where: { id: x.id }, data: { inputAt: rAt[i] } });
  for (const img of await db.rcvImage.findMany({ where: { rcvId: m.rcvId } })) {
    const near = rInputs.find((x) => x.itemId === img.itemId && x.kind === "DAMAGED");
    const idx = near ? rInputs.indexOf(near) : rInputs.length - 1;
    await db.rcvImage.update({ where: { id: img.id }, data: { createdAt: plus(rAt[idx] ?? rEnd, 1) } });
  }
  await db.rcv.update({
    where: { id: m.rcvId },
    data: {
      rcvNo,
      rcvDate: asDate(ymdOf(t.arrivedAt)),
      createdAt: t.arrivedAt,
      ...(rInputs.length && t.startedAt ? { startedAt: t.startedAt } : {}),
      ...(t.confirmedAt ? { confirmedAt: t.confirmedAt } : {}),
      updatedAt: t.confirmedAt ?? rEnd ?? t.arrivedAt,
    },
  });
  if (!t.confirmedAt) return;
  await db.rcvAlloc.updateMany({ where: { rcvId: m.rcvId }, data: { createdAt: t.confirmedAt } });
  // 이력 문구 속 검수 번호도 새 번호로
  for (const h of await db.inboundPlanHistory.findMany({ where: { action: "RECEIVE", reasonText: { contains: rcv.rcvNo } } }))
    await db.inboundPlanHistory.update({ where: { id: h.id }, data: { at: t.confirmedAt, reasonText: h.reasonText!.replace(rcv.rcvNo, rcvNo) } });
  for (const h of await db.asnHistory.findMany({ where: { asnId: m.asnId, action: "RECEIVE" } }))
    await db.asnHistory.update({ where: { id: h.id }, data: { at: t.confirmedAt, reasonText: h.reasonText?.replace(rcv.rcvNo, rcvNo) ?? null } });
}

/* ───────── 실행 ───────── */

async function main() {
  const already = await db.asn.count({ where: { vehicleNo: { startsWith: MARK } } });
  if (already) {
    console.log(`이미 이 스크립트가 만든 데이터가 있습니다(차량번호 ${MARK}… ASN ${already}건). 두 번 쌓이지 않도록 아무것도 만들지 않고 끝냅니다.`);
    return;
  }

  const center = await db.center.findUniqueOrThrow({ where: { code: CENTER_CODE }, include: { holidays: true, clientLinks: true } });
  if (!center.isActive) throw new Error(`${center.name}이(가) 사용 중이 아닙니다.`);
  const off: OffDays = { weekly: center.weeklyOffDays, holidays: new Set(center.holidays.map((h) => h.date.toISOString().slice(0, 10))) };
  const now = new Date();
  const today = businessDateOf(now, center.businessDayStart);
  if (today !== todayKst()) throw new Error(`업무일(${today})과 달력 날짜(${todayKst()})가 다른 새벽 시간입니다. 업무일 시작(${center.businessDayStart}) 이후에 실행하세요.`);
  if (!isBusinessDay(today, off)) console.log(`주의: 오늘(${today})은 ${center.name} 휴무일입니다. 그래도 오늘 흐름을 만듭니다.`);

  // 최근 14업무일 (오늘 포함)
  const days: string[] = [today];
  for (let d = addDays(today, -1); days.length < 14; d = addDays(d, -1)) if (isBusinessDay(d, off)) days.unshift(d);

  // 화주사: 이 센터를 쓰고, 담당자 겸 상차담당 계정과 사용 중 품목(기준 단위 바코드)이 있는 곳
  const users = await db.user.findMany({ where: { isActive: true, clientId: { in: center.clientLinks.map((l) => l.clientId) } }, orderBy: { id: "asc" } });
  const parties: Party[] = [];
  for (const u of users) {
    if (!u.roles.includes("SHIPPER_STAFF") || !u.roles.includes("SHIPPER_LOADER") || parties.some((p) => p.client.id === u.clientId)) continue;
    const items = await db.item.findMany({ where: { clientId: u.clientId!, isActive: true }, include: { barcodes: true }, orderBy: { id: "asc" } });
    const rows: ItemRow[] = [];
    for (const i of items) {
      const bc = i.barcodes.find((b) => b.unit === i.baseUnit);
      if (!bc) continue;
      const box = i.baseUnit === "BOX";
      rows.push({ id: i.id, name: i.name, unit: i.baseUnit, barcode: bc.barcode, expiryManaged: i.expiryManaged, lotManaged: i.lotManaged, min: box ? 10 : 40, max: box ? 60 : 240 });
    }
    if (rows.length < 3) continue;
    const client = await db.client.findUniqueOrThrow({ where: { id: u.clientId! } });
    parties.push({ client: { id: client.id, name: client.name }, staff: await actor(u.loginId), items: rows });
  }
  if (parties.length < 2) throw new Error(`${center.name}을(를) 쓰는 화주사 중 조건(담당자 겸 상차담당 + 품목 3개 이상)을 갖춘 곳이 2곳 미만입니다.`);
  const approver = await actor("kim.haneul");
  const inspectors = [await actor("park.seoyeon"), await actor("choi.woojin"), await actor("lee.jun")];
  for (const a of [approver, ...inspectors]) if (a.centerId && a.centerId !== center.id) throw new Error(`${a.name} 계정이 ${center.name} 소속이 아닙니다.`);
  const minDays = await minExpiryDays();
  const ctx = { centerId: center.id, approver, today, minDays };
  console.log(`센터 ${center.name} · 화주사 ${parties.map((p) => p.client.name).join(", ")} · 오늘 업무일 ${today} · 기간 ${days[0]} ~ ${today}`);

  let vno = 1001;
  const nextVehicle = () => `${MARK}${vno++}`;
  const makeLines = (party: Party, rate: number) =>
    shuffle(party.items)
      .slice(0, randInt(1, 3))
      .map((item) => {
        const planQty = randInt(item.min, item.max);
        const r = rate >= 1 ? 1 : Math.min(1, Math.max(0.7, rate + (rand() - 0.5) * 0.08));
        return { item, planQty, asnQty: Math.max(1, Math.min(planQty, Math.round(planQty * r))) };
      });

  /* 1. 날짜별 검수 확정 차량 */
  type DayRow = { day: string; vehicles: number; diffs: number; plan: number; good: number; ret: number };
  const report: DayRow[] = [];
  const nowMin = now.getTime();
  for (const day of days) {
    const isToday = day === today;
    // 오늘은 지금 시각 이전에만 확정할 수 있다 (KST 08~17시가 아직 안 왔으면 업무일 시작 직후로 당긴다)
    let lo = kst(day, 9, 0);
    let hi = kst(day, 17, 0);
    if (isToday) {
      hi = new Date(Math.min(hi.getTime(), nowMin - 15 * MIN));
      lo = nowMin - 15 * MIN > kst(day, 10, 0).getTime() ? kst(day, 8, 0) : kst(day, 6, 50);
      if (hi <= lo) {
        console.log(`오늘은 아직 확정 시각을 넣을 여유가 없어(지금 ${hhmm(now)}) 오늘 확정 차량을 건너뜁니다.`);
        continue;
      }
    }
    const n = isToday ? 3 : randInt(3, 8);
    const rate = rand() < 0.4 ? 1 : 0.86 + rand() * 0.12; // 날마다 입고율이 85~100% 사이로
    const row: DayRow = { day, vehicles: 0, diffs: 0, plan: 0, good: 0, ret: 0 };
    const confirmTimes = spread(n, lo, hi)
      .map((d) => plus(d, randInt(-15, 15)))
      .map((d) => new Date(Math.min(Math.max(d.getTime(), lo.getTime()), hi.getTime())))
      .sort((a, b) => a.getTime() - b.getTime());
    for (let i = 0; i < n; i++) {
      const party = parties[(i + days.indexOf(day)) % parties.length];
      const diff: Diff = rand() < 0.16 ? (rand() < 0.65 ? "short" : "damaged") : "none";
      const spec: Spec = {
        party, vehicleNo: nextVehicle(), driver: pick(DRIVERS), lines: makeLines(party, rate), stage: "confirmed", diff,
        inspector: pick(inspectors), manualDepart: rand() < 0.7,
      };
      const made = await runVehicle(spec, ctx);
      // 시각: 확정 ← 검수 20~60분 ← 입차 ← 출차·상차완료 ← 상차 시작, 입고예정·ASN은 전날 오후
      const confirmedAt = confirmTimes[i];
      const arrivedAt = plus(confirmedAt, -randInt(20, 60));
      const startedAt = plus(arrivedAt, randInt(3, 8));
      const completedAt = plus(arrivedAt, -randInt(isToday ? 30 : 60, isToday ? 70 : 150));
      const departedAt = spec.manualDepart ? plus(completedAt, randInt(5, 15)) : null;
      const loadStart = plus(completedAt, -randInt(20, 45));
      const planDate = rand() < 0.25 ? addDays(day, -1) : day;
      const planCreated = kst(addDays(planDate, -1), randInt(13, 16), randInt(0, 59));
      const approvedAt = plus(planCreated, randInt(30, 120));
      const asnCreated = new Date(Math.max(plus(approvedAt, randInt(20, 60)).getTime(), kst(addDays(day, -1), 17, randInt(0, 50)).getTime()));
      await shift(made, { planDate, shipDate: day, planCreated, approvedAt, asnCreated, loadStart, completedAt, departedAt, arrivedAt, startedAt, confirmedAt });
      row.vehicles++;
      if (diff !== "none") row.diffs++;
      row.plan += made.planQty;
      row.good += made.good;
      row.ret += made.ret;
      process.stdout.write(".");
    }
    report.push(row);
  }
  console.log("");

  /* 2. 오늘 출고 ASN 흐름 */
  const flow: { stage: Stage; label: string; n: number }[] = [
    { stage: "asn", label: "상차 대기(ASN 등록만)", n: 2 },
    { stage: "loading", label: "상차중", n: 1 },
    { stage: "loaded", label: "오는 중(상차완료·입차 전)", n: 2 },
    { stage: "arrived", label: "도착·검수 대기(입차만)", n: 1 },
    { stage: "inspecting", label: "검수 입력 중", n: 1 },
  ];
  const yesterday = days[days.length - 2];
  let k = 0;
  for (const f of flow) {
    for (let i = 0; i < f.n; i++, k++) {
      const party = parties[k % parties.length];
      const spec: Spec = { party, vehicleNo: nextVehicle(), driver: pick(DRIVERS), lines: makeLines(party, 1), stage: f.stage, diff: "none", inspector: pick(inspectors), manualDepart: f.stage === "loaded" && i === 0 };
      const made = await runVehicle(spec, ctx);
      // 입고예정·ASN은 어제 오후 등록, 오늘 단계 시각은 지금 기준으로 조금씩 앞당긴다
      const planCreated = kst(yesterday, randInt(13, 16), randInt(0, 59));
      const approvedAt = plus(planCreated, randInt(30, 90));
      const asnCreated = kst(yesterday, 17, randInt(10, 55));
      const t: Times = { planDate: today, shipDate: today, planCreated, approvedAt, asnCreated };
      const back = (m: number) => plus(now, -m);
      if (f.stage === "loading") Object.assign(t, { loadStart: back(randInt(10, 20)), inputEnd: back(2) });
      if (f.stage === "loaded") {
        const completedAt = back(randInt(25, 70));
        Object.assign(t, { loadStart: plus(completedAt, -randInt(20, 40)), completedAt, departedAt: spec.manualDepart ? plus(completedAt, 8) : null });
      }
      if (f.stage === "arrived" || f.stage === "inspecting") {
        const arrivedAt = back(f.stage === "arrived" ? randInt(5, 12) : randInt(25, 35));
        const completedAt = plus(arrivedAt, -randInt(50, 80));
        Object.assign(t, {
          loadStart: plus(completedAt, -randInt(20, 40)), completedAt, departedAt: null, arrivedAt,
          ...(f.stage === "inspecting" ? { startedAt: plus(arrivedAt, 5), inputEnd: back(2) } : {}),
        });
      }
      await shift(made, t);
      process.stdout.write(".");
    }
  }
  console.log("");

  /* 보고 */
  console.log("\n[날짜별 검수 확정]  업무일 | 확정 차량 | 차이 차량 | 입고예정(기준단위) | 정상 | 반송 | 입고율(정상/예정)");
  const tot = { vehicles: 0, diffs: 0, plan: 0, good: 0, ret: 0 };
  for (const r of report) {
    console.log(`${r.day} | ${r.vehicles} | ${r.diffs} | ${r.plan} | ${r.good} | ${r.ret} | ${((r.good / r.plan) * 100).toFixed(1)}%`);
    for (const key of Object.keys(tot) as (keyof typeof tot)[]) tot[key] += r[key];
  }
  console.log(`합계 | ${tot.vehicles} | ${tot.diffs} | ${tot.plan} | ${tot.good} | ${tot.ret}`);
  console.log("\n[오늘 흐름]");
  for (const f of flow) console.log(`${f.label}: ${f.n}대`);
  console.log(`입고완료(오늘 확정): ${report.find((r) => r.day === today)?.vehicles ?? 0}대`);
  console.log(`\n차량번호 ${MARK}1001 ~ ${MARK}${vno - 1}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
