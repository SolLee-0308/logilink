-- 정의서 v1.9 (2026-11-14 Sol 확정) — 자동 출차 폐지·출차 구분, 입차, 검수 시작 = 첫 입력, 입차 취소.
-- 새 enum 값은 같은 트랜잭션에서 쓸 수 없으므로 기존 데이터 전환은 다음 마이그레이션(arrival_backfill)에서 한다.

-- CreateEnum
CREATE TYPE "DepartType" AS ENUM ('MANUAL', 'ARRIVAL', 'DAILY_CLOSE');

-- AlterEnum
ALTER TYPE "AsnAction" ADD VALUE 'ARRIVE';
ALTER TYPE "AsnAction" ADD VALUE 'ARRIVE_CANCEL';
ALTER TYPE "LoadAction" ADD VALUE 'ARRIVE';
ALTER TYPE "LoadAction" ADD VALUE 'ARRIVE_CANCEL';
ALTER TYPE "RcvStatus" ADD VALUE 'VOIDED';

-- AlterTable: 상차 실적 — 출차 구분, 입차
ALTER TABLE "tb_load_h" ADD COLUMN "depart_type" "DepartType",
ADD COLUMN "arrive_dt" TIMESTAMPTZ(3),
ADD COLUMN "arrived_by" VARCHAR(50),
ADD COLUMN "arrive_user_id" INTEGER;

-- AlterTable: 입고검수 — 검수 시작 시각, 입차 취소
ALTER TABLE "tb_rcv_h" ADD COLUMN "start_dt" TIMESTAMPTZ(3),
ADD COLUMN "void_dt" TIMESTAMPTZ(3),
ADD COLUMN "voided_by" VARCHAR(50),
ADD COLUMN "void_user_id" INTEGER,
ADD COLUMN "void_reason_cd" VARCHAR(20),
ADD COLUMN "void_reason_nm" VARCHAR(100),
ADD COLUMN "void_reason_text" VARCHAR(500);

-- AlterTable: 일마감 — 일마감 처리(시스템) 출차 수
ALTER TABLE "tb_daily_close" ADD COLUMN "depart_cnt" INTEGER NOT NULL DEFAULT 0;

-- 입차 취소 사유 코드 그룹 — 임시안(confirmed=false): 차량 오인 스캔·기타
INSERT INTO "tb_code_group" ("code", "name", "description", "confirmed", "sort_order")
SELECT 'ARRIVE_CANCEL', '입차 취소', '입차 후 첫 입력 전 입차 취소 시 필수 (정의서 v1.9 ⑥·C11, 임시안)', false, COALESCE(MAX("sort_order"), 0) + 1
FROM "tb_code_group"
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "tb_common_code" ("group_code", "code", "name", "sort_order", "requires_text", "created_by", "updated_by")
VALUES
  ('ARRIVE_CANCEL', 'A01', '차량 오인 스캔', 10, false, '시스템', '시스템'),
  ('ARRIVE_CANCEL', 'A99', '기타', 20, true, '시스템', '시스템')
ON CONFLICT ("group_code", "code") DO NOTHING;
