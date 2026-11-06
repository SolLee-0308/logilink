/**
 * 시험용 로컬 DB로 명령을 실행한다 — `node scripts/with-test-db.mjs <명령...>`
 * .env.testdb의 DB 주소를 먼저 넣고, 나머지 값은 각 도구가 .env에서 읽는다(dotenv는 이미 있는 값을 덮어쓰지 않는다).
 * 안전장치: 주소가 localhost가 아니면 실행하지 않는다(운영 DB 오접속 방지).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

const FILE = ".env.testdb";
if (!existsSync(FILE)) {
  console.error(`${FILE}이 없습니다. 시험용 DB 설정 파일을 먼저 만드세요.`);
  process.exit(1);
}
const vars = parse(readFileSync(FILE));
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const host = vars[key] ? new URL(vars[key]).hostname : "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.error(`${FILE}의 ${key}가 로컬 주소가 아닙니다(${host || "없음"}). 실행을 멈춥니다.`);
    process.exit(1);
  }
}
const cmd = process.argv.slice(2).join(" ");
if (!cmd) {
  console.error("실행할 명령을 넣으세요. 예: node scripts/with-test-db.mjs next dev");
  process.exit(1);
}
console.log(`[시험 DB] localhost 로컬 DB로 실행: ${cmd}`);
const r = spawnSync(cmd, { stdio: "inherit", shell: true, env: { ...process.env, ...vars } });
process.exit(r.status ?? 1);
