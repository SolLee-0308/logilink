/**
 * 3PL·화주사 대시보드 집계 점검 (개발용, 읽기 전용) — 데이터를 바꾸지 않는다.
 * 실행: npm run check:test -- scripts/check-dashboard.ts
 */
import "dotenv/config";
import { db } from "@/server/db";
import type { PlanActor } from "@/server/plans/service";
import { shipperDashboard, tplDashboard } from "@/server/dashboard/queries";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", m, c || extra === undefined ? "" : JSON.stringify(extra));
};

async function main() {
  const users = await db.user.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
  const tpl = users.find((u) => u.roles.includes("TPL_ADMIN") || u.roles.includes("TPL_OPERATOR"));
  const shipper = users.find((u) => u.roles.includes("SHIPPER_STAFF"));
  if (!tpl) throw new Error("3PL 계정이 없습니다");
  const me: PlanActor = { id: tpl.id, name: tpl.name, roles: tpl.roles, clientId: tpl.clientId, centerId: tpl.centerId };

  const d = await tplDashboard(me, "");
  ok(!!d, `3PL(${tpl.loginId}) 대시보드 조회`);
  if (!d) return;
  console.log(JSON.stringify({ centers: d.centers, todo: d.todo, flow: d.flow, watch: { ...d.watch, expire: d.watch.expire.length, overdueAsn: d.watch.overdueAsn.length, issueRcv: d.watch.issueRcv.length } }, null, 1));

  // 숫자 칸이 DB 직접 집계와 같은지
  const ids = d.centers.map((c) => c.id);
  ok(d.todo.approvalWaiting === (await db.inboundPlan.count({ where: { centerId: { in: ids }, status: "WAITING" } })), "승인 대기 건수 일치");
  ok(d.todo.partial === (await db.inboundPlan.count({ where: { centerId: { in: ids }, status: "PARTIAL" } })), "부분입고 건수 일치");
  ok(d.todo.expireTargets === d.centers.reduce((s, c) => s + c.expireTargets, 0), "기한경과 대상 = 센터별 합");
  ok(d.watch.expire.every((r) => r.status === "WAITING" || r.status === "REJECTED"), "기한경과 목록은 승인 전 건만");
  ok(d.centers.every((c) => /^\d{2}:\d{2}$/.test(c.businessDayStart)), "센터 업무일 시작 시각 형식");
  ok(d.centers.every((c) => Array.isArray(c.weeklyOffDays) && c.weeklyOffDays.every((x) => x >= 0 && x <= 6)), "센터 정기 휴무 요일 읽기");

  if (shipper) {
    const sm: PlanActor = { id: shipper.id, name: shipper.name, roles: shipper.roles, clientId: shipper.clientId, centerId: shipper.centerId };
    const s = await tplDashboard(sm, "");
    ok(s === null, "화주사 계정은 3PL 대시보드를 볼 수 없다");
    ok((await shipperDashboard(me, "")) === null, "3PL 계정은 화주사 대시보드를 볼 수 없다");

    // 화주사 대시보드 — 자기 화주사 건, 이용 센터
    const sd = await shipperDashboard(sm, "");
    ok(!!sd, `화주사(${shipper.loginId}) 대시보드 조회`);
    if (sd) {
      const cid = shipper.clientId!;
      console.log(JSON.stringify({ centers: sd.centers.map((c) => c.name), todo: sd.todo, flow: sd.flow, watch: { ...sd.watch, expire: sd.watch.expire.length, overdueAsn: sd.watch.overdueAsn.length, issueRcv: sd.watch.issueRcv.length } }, null, 1));
      const links = await db.clientCenter.findMany({ where: { clientId: cid }, select: { centerCode: true } });
      const sids = sd.centers.map((c) => c.id);
      const linked = await db.center.findMany({ where: { code: { in: links.map((l) => l.centerCode) }, isActive: true }, select: { id: true } });
      ok(sids.length === linked.length && linked.every((c) => sids.includes(c.id)), "화주사 센터 = 이용 센터(사용 중)");
      const sc = { clientId: cid, centerId: { in: sids } };
      ok(sd.todo.rejected === (await db.inboundPlan.count({ where: { ...sc, status: "REJECTED" } })), "반려 건수 일치 (자기 화주사)");
      ok(sd.todo.waiting === (await db.inboundPlan.count({ where: { ...sc, status: "WAITING" } })), "승인 대기 건수 일치 (자기 화주사)");
      ok(sd.todo.itemRejected === (await db.itemRequest.count({ where: { clientId: cid, status: "REJECTED" } })), "품목 등록 요청 반려 건수 일치");
      ok(sd.todo.expireTargets === sd.watch.expireTargetCount && sd.todo.expireTargets === sd.centers.reduce((s, c) => s + c.expireTargets, 0), "기한경과 대상 = 센터별 합");
      ok(sd.watch.expireCount === sd.centers.reduce((s, c) => s + c.expireTargets + c.expireGrace, 0), "기한경과 목록 = 대상 + 유예 중");
      ok(sd.watch.expire.every((r) => r.status === "WAITING" || r.status === "REJECTED"), "기한경과 목록은 승인 전 건만");
      const clientName = (await db.client.findUnique({ where: { id: cid } }))?.name;
      ok([...sd.watch.expire, ...sd.watch.overdueAsn, ...sd.watch.issueRcv].every((r) => r.clientName === clientName), "주의 목록에 다른 화주사 건이 없다");
      ok(sd.watch.issueRcv.every((r) => r.href.startsWith("/plans/asn/") || r.href.startsWith("/plans/loads/")), "검수 차이 줄은 화주사 화면으로");
      // 3PL과 같은 범위(같은 센터 1곳)로 보면 화주사 흐름 ≤ 3PL 흐름
      if (sids.length > 0 && !tpl.centerId) {
        const t1 = await tplDashboard(me, String(sids[0]));
        const s1 = await shipperDashboard(sm, String(sids[0]));
        ok(
          !!t1 && !!s1 && (Object.keys(s1.flow) as (keyof typeof s1.flow)[]).every((k) => s1.flow[k] <= t1.flow[k]),
          "같은 센터에서 화주사 흐름 ≤ 3PL 흐름",
        );
      }
    }
  }
  if (!tpl.centerId && d.centerOptions.length > 0) {
    const one = await tplDashboard(me, String(d.centerOptions[0].id));
    ok(one?.centers.length === 1, "센터 고르기 → 그 센터만");
  }
}

main()
  .catch((e) => {
    fail++;
    console.error(e);
  })
  .finally(async () => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
  });
