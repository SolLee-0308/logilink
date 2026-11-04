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
  const adapter = new PrismaPg({ connectionString: appConnectionString(), max: 5 });
  return new PrismaClient({ adapter });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };
/** 개발 서버의 핫 리로드마다 연결이 늘지 않도록 하나만 둔다 */
export const db = g.__prisma ?? create();
if (process.env.NODE_ENV !== "production") g.__prisma = db;
