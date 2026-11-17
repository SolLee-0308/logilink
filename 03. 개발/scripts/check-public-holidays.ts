/**
 * 공공데이터 특일 정보(공휴일) 연결 점검 (개발용, 읽기 전용) — DB에 저장하지 않고 조회 결과만 보여 준다
 * 실행: npm run check:test -- scripts/check-public-holidays.ts [연도...]
 */
import "dotenv/config";
import { fetchPublicHolidays } from "@/server/master/public-holidays";

async function main() {
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  for (const y of years.length ? years : [2026, 2027]) {
    const r = await fetchPublicHolidays(y);
    if (!r.ok) {
      console.log(`FAIL ${y}: ${r.error}`);
      continue;
    }
    console.log(`PASS ${y}: ${r.rows.length}일`);
    for (const h of r.rows) console.log(`  ${h.date} ${h.name}`);
  }
}
main();
