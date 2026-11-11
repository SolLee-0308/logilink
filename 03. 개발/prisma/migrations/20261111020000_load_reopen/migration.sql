-- 상차 재개 (정의서 v1.5 D20, 2026-11-11 Sol) — 상차확인서 차수, 상차 처리 이력, ASN 이력 행위, 재개 사유 코드(임시안)

-- CreateEnum
CREATE TYPE "LoadAction" AS ENUM ('COMPLETE', 'REOPEN');

-- AlterEnum
ALTER TYPE "AsnAction" ADD VALUE 'LOAD_REOPEN';

-- AlterTable
ALTER TABLE "tb_load_h" ADD COLUMN     "revision_no" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "tb_load_his" (
    "id" SERIAL NOT NULL,
    "load_id" INTEGER NOT NULL,
    "action" "LoadAction" NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "actor" VARCHAR(50) NOT NULL,
    "actor_id" INTEGER,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_cd" VARCHAR(20),
    "reason_nm" VARCHAR(100),
    "reason_text" VARCHAR(500),

    CONSTRAINT "tb_load_his_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tb_load_his_load_id_idx" ON "tb_load_his"("load_id");

-- AddForeignKey
ALTER TABLE "tb_load_his" ADD CONSTRAINT "tb_load_his_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "tb_load_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 재개 사유 코드 그룹 — 임시안(confirmed=false): 스캔 누락·타 차량 이관·추가 적재·기타. 확정 전 (2026-11-11 Sol: 추후 다시 검토)
INSERT INTO "tb_code_group" ("code", "name", "description", "confirmed", "sort_order")
SELECT 'LOAD_REOPEN', '상차 재개', '상차완료 후 검수 시작 전 상차 재개 시 필수 (정의서 v1.5 ④·D20, 임시안)', false, COALESCE(MAX("sort_order"), 0) + 1
FROM "tb_code_group"
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "tb_common_code" ("group_code", "code", "name", "sort_order", "requires_text", "created_by", "updated_by")
VALUES
  ('LOAD_REOPEN', 'R01', '스캔 누락', 10, false, '시스템', '시스템'),
  ('LOAD_REOPEN', 'R02', '타 차량 이관', 20, false, '시스템', '시스템'),
  ('LOAD_REOPEN', 'R03', '추가 적재', 30, false, '시스템', '시스템'),
  ('LOAD_REOPEN', 'R99', '기타', 40, true, '시스템', '시스템')
ON CONFLICT ("group_code", "code") DO NOTHING;
