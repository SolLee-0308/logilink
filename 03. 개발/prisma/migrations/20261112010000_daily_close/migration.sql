-- 일마감 (정의서 ⑦·D18·D21, 2026-11-12) — 센터·업무일당 1회. 아직 일마감되지 않은 검수 확정 실적을 확정(tb_rcv_h.daily_close_id)하고 기한경과 승인 전 입고예정을 취소한다.
-- 새 테이블의 RLS는 이벤트 트리거가 자동으로 켠다.

-- AlterTable
ALTER TABLE "tb_rcv_h" ADD COLUMN     "daily_close_id" INTEGER;

-- CreateTable
CREATE TABLE "tb_daily_close" (
    "id" SERIAL NOT NULL,
    "center_id" INTEGER NOT NULL,
    "business_dt" DATE NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" VARCHAR(50) NOT NULL,
    "close_user_id" INTEGER NOT NULL,
    "rcv_cnt" INTEGER NOT NULL,
    "rcv_line_cnt" INTEGER NOT NULL,
    "good_base_qty" INTEGER NOT NULL,
    "return_base_qty" INTEGER NOT NULL,
    "expire_cnt" INTEGER NOT NULL,

    CONSTRAINT "tb_daily_close_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_daily_close_center_id_business_dt_key" ON "tb_daily_close"("center_id", "business_dt");

-- CreateIndex
CREATE INDEX "tb_rcv_h_center_id_daily_close_id_idx" ON "tb_rcv_h"("center_id", "daily_close_id");

-- AddForeignKey
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_daily_close_id_fkey" FOREIGN KEY ("daily_close_id") REFERENCES "tb_daily_close"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_daily_close" ADD CONSTRAINT "tb_daily_close_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

