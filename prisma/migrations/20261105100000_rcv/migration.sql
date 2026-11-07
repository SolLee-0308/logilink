-- CreateEnum
CREATE TYPE "RcvStatus" AS ENUM ('WORKING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "RcvKind" AS ENUM ('GOOD', 'DAMAGED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "RcvAllocKind" AS ENUM ('GOOD', 'RETURN');

-- AlterEnum
ALTER TYPE "AsnAction" ADD VALUE 'RECEIVE';

-- AlterEnum
ALTER TYPE "PlanAction" ADD VALUE 'RECEIVE';

-- CreateTable
CREATE TABLE "tb_rcv_h" (
    "id" SERIAL NOT NULL,
    "rcv_no" VARCHAR(20) NOT NULL,
    "load_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "center_id" INTEGER NOT NULL,
    "vehicle_no" VARCHAR(20) NOT NULL,
    "rcv_dt" DATE NOT NULL,
    "status" "RcvStatus" NOT NULL DEFAULT 'WORKING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirm_user_id" INTEGER,
    "confirmed_by" VARCHAR(50),
    "confirm_dt" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_rcv_h_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_rcv_d" (
    "id" SERIAL NOT NULL,
    "rcv_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "expect_base_qty" INTEGER NOT NULL DEFAULT 0,
    "good_base_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_base_qty" INTEGER NOT NULL DEFAULT 0,
    "mismatch_base_qty" INTEGER NOT NULL DEFAULT 0,
    "mismatch" BOOLEAN NOT NULL DEFAULT false,
    "zero_confirm_yn" BOOLEAN NOT NULL DEFAULT false,
    "reason_cd" VARCHAR(20),
    "reason_nm" VARCHAR(100),
    "reason_text" VARCHAR(500),
    "expiry_dt" DATE,
    "lot_no" VARCHAR(40),

    CONSTRAINT "tb_rcv_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_rcv_input" (
    "id" SERIAL NOT NULL,
    "rcv_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "kind" "RcvKind" NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "add_qty" INTEGER NOT NULL,
    "base_qty" INTEGER NOT NULL,
    "scanned" VARCHAR(40),
    "worker_id" INTEGER NOT NULL,
    "worker_nm" VARCHAR(50) NOT NULL,
    "device_id" VARCHAR(64),
    "input_dt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMPTZ(3),
    "corrects_id" INTEGER,

    CONSTRAINT "tb_rcv_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_rcv_image" (
    "id" SERIAL NOT NULL,
    "rcv_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "mime" VARCHAR(40) NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by" VARCHAR(50) NOT NULL,
    "creator_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_rcv_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_rcv_alloc" (
    "id" SERIAL NOT NULL,
    "rcv_id" INTEGER NOT NULL,
    "rcv_line_id" INTEGER NOT NULL,
    "kind" "RcvAllocKind" NOT NULL,
    "step" INTEGER NOT NULL,
    "plan_line_id" INTEGER,
    "asn_line_id" INTEGER,
    "alloc_qty" INTEGER NOT NULL,
    "reverse_yn" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_rcv_alloc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_rcv_h_rcv_no_key" ON "tb_rcv_h"("rcv_no");

-- CreateIndex
CREATE INDEX "tb_rcv_h_load_id_idx" ON "tb_rcv_h"("load_id");

-- CreateIndex
CREATE INDEX "tb_rcv_h_center_id_rcv_dt_idx" ON "tb_rcv_h"("center_id", "rcv_dt");

-- CreateIndex
CREATE INDEX "tb_rcv_h_client_id_status_idx" ON "tb_rcv_h"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tb_rcv_d_rcv_id_item_id_key" ON "tb_rcv_d"("rcv_id", "item_id");

-- CreateIndex
CREATE INDEX "tb_rcv_input_rcv_id_input_dt_idx" ON "tb_rcv_input"("rcv_id", "input_dt");

-- CreateIndex
CREATE INDEX "tb_rcv_input_worker_id_input_dt_idx" ON "tb_rcv_input"("worker_id", "input_dt");

-- CreateIndex
CREATE INDEX "tb_rcv_image_rcv_id_item_id_idx" ON "tb_rcv_image"("rcv_id", "item_id");

-- CreateIndex
CREATE INDEX "tb_rcv_alloc_rcv_id_idx" ON "tb_rcv_alloc"("rcv_id");

-- CreateIndex
CREATE INDEX "tb_rcv_alloc_plan_line_id_idx" ON "tb_rcv_alloc"("plan_line_id");

-- CreateIndex
CREATE INDEX "tb_rcv_alloc_asn_line_id_idx" ON "tb_rcv_alloc"("asn_line_id");

-- AddForeignKey
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "tb_load_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_d" ADD CONSTRAINT "tb_rcv_d_rcv_id_fkey" FOREIGN KEY ("rcv_id") REFERENCES "tb_rcv_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_d" ADD CONSTRAINT "tb_rcv_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_input" ADD CONSTRAINT "tb_rcv_input_rcv_id_fkey" FOREIGN KEY ("rcv_id") REFERENCES "tb_rcv_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_input" ADD CONSTRAINT "tb_rcv_input_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_image" ADD CONSTRAINT "tb_rcv_image_rcv_id_fkey" FOREIGN KEY ("rcv_id") REFERENCES "tb_rcv_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_rcv_id_fkey" FOREIGN KEY ("rcv_id") REFERENCES "tb_rcv_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_rcv_line_id_fkey" FOREIGN KEY ("rcv_line_id") REFERENCES "tb_rcv_d"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "tb_inb_plan_d"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_asn_line_id_fkey" FOREIGN KEY ("asn_line_id") REFERENCES "tb_asn_d"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═════ 입고검수 수량 규칙 (C7) — 앱 검사와 같은 값을 DB에서도 지킨다 ═════
ALTER TABLE "tb_rcv_input" ADD CONSTRAINT "tb_rcv_input_qty_chk" CHECK ("add_qty" > 0 AND "base_qty" > 0);
ALTER TABLE "tb_rcv_d" ADD CONSTRAINT "tb_rcv_d_qty_chk" CHECK ("expect_base_qty" >= 0 AND "good_base_qty" >= 0 AND "damaged_base_qty" >= 0 AND "mismatch_base_qty" >= 0);
-- 품목 불일치 라인은 기대수량 0, 정상·훼손 없이 불일치 반송만
ALTER TABLE "tb_rcv_d" ADD CONSTRAINT "tb_rcv_d_mismatch_chk" CHECK (NOT "mismatch" OR ("expect_base_qty" = 0 AND "good_base_qty" = 0 AND "damaged_base_qty" = 0));
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_confirm_chk" CHECK ("status" = 'WORKING' OR ("confirm_dt" IS NOT NULL AND "confirmed_by" IS NOT NULL));
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_chk" CHECK ("alloc_qty" > 0 AND "step" IN (1, 2, 3) AND (("step" = 3) = ("plan_line_id" IS NULL)) AND ("step" <> 1 OR "asn_line_id" IS NOT NULL));
-- 사진 한 장 1MB 이하 (PDA에서 압축해 올린다)
ALTER TABLE "tb_rcv_image" ADD CONSTRAINT "tb_rcv_image_size_chk" CHECK ("size" > 0 AND "size" <= 1048576);
-- 진행·확정 검수는 상차 실적당 1건 (입고취소 뒤 재검수는 4단계에서 상태를 늘려 허용)
CREATE UNIQUE INDEX "tb_rcv_h_load_active_key" ON "tb_rcv_h" ("load_id") WHERE "status" IN ('WORKING', 'CONFIRMED');
