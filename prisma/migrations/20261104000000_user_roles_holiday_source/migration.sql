-- 2026-11-04
-- 1) 사용자 복수 역할: role(단일) → roles(배열). 3PL 역할과 화주사 역할은 섞지 않는다
-- 2) 휴무일 출처(공공데이터/직접 등록)
-- 3) 품목 등록 요청 원본: 품목 엑셀 일괄 요청

/* ───── 1) 사용자 역할 ───── */
ALTER TABLE "tb_user" ADD COLUMN "roles" "UserRole"[] NOT NULL DEFAULT ARRAY[]::"UserRole"[];
UPDATE "tb_user" SET "roles" = ARRAY["role"];
ALTER TABLE "tb_user" ALTER COLUMN "roles" DROP DEFAULT;

ALTER TABLE "tb_user" DROP CONSTRAINT "tb_user_scope_chk";
ALTER TABLE "tb_user" DROP COLUMN "role";
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_scope_chk" CHECK (
  cardinality("roles") >= 1 AND (
    ("roles" <@ ARRAY['SHIPPER_STAFF', 'SHIPPER_LOADER']::"UserRole"[] AND "client_id" IS NOT NULL AND "center_id" IS NULL)
    OR ("roles" <@ ARRAY['TPL_ADMIN', 'TPL_OPERATOR', 'TPL_INSPECTOR']::"UserRole"[] AND "center_id" IS NOT NULL AND "client_id" IS NULL)
  )
);

/* ───── 2) 휴무일 출처 ───── */
CREATE TYPE "HolidaySource" AS ENUM ('API', 'MANUAL');
ALTER TABLE "tb_holiday" ADD COLUMN "source" "HolidaySource" NOT NULL DEFAULT 'MANUAL';

/* ───── 3) 품목 등록 요청 원본 ───── */
ALTER TYPE "ItemRequestSource" ADD VALUE 'ITEM_EXCEL';
