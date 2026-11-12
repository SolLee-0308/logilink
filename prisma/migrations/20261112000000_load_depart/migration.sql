-- 출차 (2026-11-12 Sol) — PDA 상차담당이 상차완료 화면에서 [출차]를 누른 시각·처리자.
-- 출차 후에는 상차 재개 불가. 누르지 않았으면 상차완료한 업무일이 지나면 출차로 본다(값은 비워 두고 조회 때 판단).

-- AlterEnum
ALTER TYPE "AsnAction" ADD VALUE 'LOAD_DEPART';

-- AlterEnum
ALTER TYPE "LoadAction" ADD VALUE 'DEPART';

-- AlterTable
ALTER TABLE "tb_load_h" ADD COLUMN     "depart_dt" TIMESTAMPTZ(3),
ADD COLUMN     "depart_user_id" INTEGER,
ADD COLUMN     "departed_by" VARCHAR(50);

-- 출차는 상차완료 상태에서만 (재개는 출차 전에만 되므로 작업중 + 출차 시각은 생기지 않는다)
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_depart_completed_chk" CHECK ("depart_dt" IS NULL OR "status" = 'COMPLETED');
