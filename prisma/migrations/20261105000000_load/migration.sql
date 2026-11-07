-- CreateEnum
CREATE TYPE "LoadType" AS ENUM ('ORDERED', 'UNORDERED');

-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('WORKING', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AsnAction" ADD VALUE 'LOAD_START';
ALTER TYPE "AsnAction" ADD VALUE 'LOAD_COMPLETE';

-- CreateTable
CREATE TABLE "tb_load_h" (
    "id" SERIAL NOT NULL,
    "load_no" VARCHAR(20) NOT NULL,
    "load_type" "LoadType" NOT NULL,
    "load_order_id" INTEGER,
    "asn_id" INTEGER,
    "client_id" INTEGER NOT NULL,
    "center_id" INTEGER NOT NULL,
    "vehicle_no" VARCHAR(20) NOT NULL,
    "load_dt" DATE NOT NULL,
    "status" "LoadStatus" NOT NULL DEFAULT 'WORKING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "diff_reason_cd" VARCHAR(20),
    "diff_reason_nm" VARCHAR(100),
    "diff_reason_text" VARCHAR(500),
    "complete_user_id" INTEGER,
    "completed_by" VARCHAR(50),
    "complete_dt" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_load_h_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_load_d" (
    "id" SERIAL NOT NULL,
    "load_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "order_base_qty" INTEGER NOT NULL DEFAULT 0,
    "load_base_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tb_load_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_load_input" (
    "id" SERIAL NOT NULL,
    "load_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "add_qty" INTEGER NOT NULL,
    "base_qty" INTEGER NOT NULL,
    "scanned" VARCHAR(40),
    "worker_id" INTEGER NOT NULL,
    "worker_nm" VARCHAR(50) NOT NULL,
    "device_id" VARCHAR(64),
    "input_dt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "over_confirm" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "corrects_id" INTEGER,

    CONSTRAINT "tb_load_input_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_load_h_load_no_key" ON "tb_load_h"("load_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_load_h_load_order_id_key" ON "tb_load_h"("load_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "tb_load_h_asn_id_key" ON "tb_load_h"("asn_id");

-- CreateIndex
CREATE INDEX "tb_load_h_client_id_status_idx" ON "tb_load_h"("client_id", "status");

-- CreateIndex
CREATE INDEX "tb_load_h_center_id_load_dt_idx" ON "tb_load_h"("center_id", "load_dt");

-- CreateIndex
CREATE INDEX "tb_load_h_vehicle_no_idx" ON "tb_load_h"("vehicle_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_load_d_load_id_item_id_key" ON "tb_load_d"("load_id", "item_id");

-- CreateIndex
CREATE INDEX "tb_load_input_load_id_input_dt_idx" ON "tb_load_input"("load_id", "input_dt");

-- CreateIndex
CREATE INDEX "tb_load_input_worker_id_idx" ON "tb_load_input"("worker_id");

-- AddForeignKey
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_load_order_id_fkey" FOREIGN KEY ("load_order_id") REFERENCES "tb_load_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "tb_asn_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_d" ADD CONSTRAINT "tb_load_d_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "tb_load_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_d" ADD CONSTRAINT "tb_load_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_input" ADD CONSTRAINT "tb_load_input_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "tb_load_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_input" ADD CONSTRAINT "tb_load_input_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- 입력 1건 = 추가로 실은 수량 (1 이상)
ALTER TABLE "tb_load_input" ADD CONSTRAINT "tb_load_input_qty_chk" CHECK ("add_qty" > 0 AND "base_qty" > 0);

-- 합계는 0 이상
ALTER TABLE "tb_load_d" ADD CONSTRAINT "tb_load_d_qty_chk" CHECK ("order_base_qty" >= 0 AND "load_base_qty" >= 0);

-- 지시 상차는 상차지시서·ASN을 함께 참조하고, 무지시 상차는 둘 다 비운다 (D12)
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_type_chk" CHECK (
  ("load_type" = 'ORDERED' AND "load_order_id" IS NOT NULL AND "asn_id" IS NOT NULL)
  OR ("load_type" = 'UNORDERED' AND "load_order_id" IS NULL AND "asn_id" IS NULL)
);

-- 상차완료면 완료자·완료 시각이 있다 (C6)
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_complete_chk" CHECK ("status" = 'WORKING' OR ("complete_dt" IS NOT NULL AND "completed_by" IS NOT NULL));
