import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// 마이그레이션은 Direct/Session 연결(5432)을 쓴다. 앱 실행은 src/server/db.ts에서 DATABASE_URL(6543) 사용.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
