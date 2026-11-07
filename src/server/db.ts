import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Supabase Transaction pooler(6543) 주소의 pgbouncer 표시는 Prisma 전용이라 pg 드라이버에는 넘기지 않는다 */
function appConnectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL이 설정되지 않았습니다 (.env).");
  const url = new URL(raw);
  url.searchParams.delete("pgbouncer");
  url.searchParams.delete("connection_limit");
  return url.toString();
}

function create() {
  // 시험용 로컬 DB(prisma dev)는 동시 연결을 견디지 못해 .env.testdb에서 DB_POOL_MAX=1로 낮춘다. 운영은 5.
  // 쉬는 연결을 오래 잡고 있으면 다른 프로그램(점검 스크립트)의 연결과 부딪혀 DB_IDLE_MS로 짧게 놓는다(시험 DB만).
  const adapter = new PrismaPg({
    connectionString: appConnectionString(),
    max: Number(process.env.DB_POOL_MAX) || 5,
    ...(process.env.DB_IDLE_MS ? { idleTimeoutMillis: Number(process.env.DB_IDLE_MS) } : {}),
  });
  return new PrismaClient({ adapter });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };
/** 개발 서버의 핫 리로드마다 연결이 늘지 않도록 하나만 둔다 */
export const db = g.__prisma ?? create();
if (process.env.NODE_ENV !== "production") g.__prisma = db;
