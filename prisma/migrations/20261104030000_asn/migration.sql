-- 2026-11-04 ASN 등록 (정의서 ③ · 4-2 · C4). 헤더 = 차량 1대, 라인 = 입고예정 라인 참조, 상차지시서 ASN 1:1
-- 차량 기준정보는 두지 않고 차량번호를 직접 적는다 (Sol 결정, 미확정 항목 H1). RLS는 이벤트 트리거가 자동으로 켠다

-- CreateEnum
CREATE TYPE "AsnStatus" AS ENUM ('REGISTERED', 'LOADING', 'LOADED', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "LoadOrderStatus" AS ENUM ('ISSUED', 'LOADED', 'INSPECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AsnAction" AS ENUM ('CREATE', 'CANCEL');

-- CreateTable
CREATE TABLE "tb_asn_h" (
    "id" SERIAL NOT NULL,
    "asn_no" VARCHAR(20) NOT NULL,
    "client_id" INTEGER NOT NULL,
    "center_id" INTEGER NOT NULL,
    "ship_dt" DATE NOT NULL,
    "vehicle_no" VARCHAR(20) NOT NULL,
    "driver_nm" VARCHAR(20),
    "driver_tel" VARCHAR(15),
    "memo" VARCHAR(500),
    "status" "AsnStatus" NOT NULL DEFAULT 'REGISTERED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancel_reason_cd" VARCHAR(20),
    "cancel_reason_text" VARCHAR(500),
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by" VARCHAR(50),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_asn_h_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_asn_d" (
    "id" SERIAL NOT NULL,
    "asn_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "plan_line_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "qty" INTEGER NOT NULL,
    "base_qty" INTEGER NOT NULL,

    CONSTRAINT "tb_asn_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_load_order" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(20) NOT NULL,
    "asn_id" INTEGER NOT NULL,
    "status" "LoadOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_load_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_asn_his" (
    "id" SERIAL NOT NULL,
    "asn_id" INTEGER NOT NULL,
    "action" "AsnAction" NOT NULL,
    "version" INTEGER NOT NULL,
    "actor" VARCHAR(50) NOT NULL,
    "actor_id" INTEGER,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_cd" VARCHAR(20),
    "reason_nm" VARCHAR(100),
    "reason_text" VARCHAR(500),

    CONSTRAINT "tb_asn_his_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_asn_h_asn_no_key" ON "tb_asn_h"("asn_no");

-- CreateIndex
CREATE INDEX "tb_asn_h_client_id_status_idx" ON "tb_asn_h"("client_id", "status");

-- CreateIndex
CREATE INDEX "tb_asn_h_center_id_ship_dt_idx" ON "tb_asn_h"("center_id", "ship_dt");

-- CreateIndex
CREATE INDEX "tb_asn_h_vehicle_no_idx" ON "tb_asn_h"("vehicle_no");

-- CreateIndex
CREATE INDEX "tb_asn_d_plan_line_id_idx" ON "tb_asn_d"("plan_line_id");

-- CreateIndex
CREATE INDEX "tb_asn_d_plan_id_idx" ON "tb_asn_d"("plan_id");

-- CreateIndex
CREATE INDEX "tb_asn_d_item_id_idx" ON "tb_asn_d"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tb_asn_d_asn_id_line_no_key" ON "tb_asn_d"("asn_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_load_order_order_no_key" ON "tb_load_order"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_load_order_asn_id_key" ON "tb_load_order"("asn_id");

-- CreateIndex
CREATE INDEX "tb_asn_his_asn_id_idx" ON "tb_asn_his"("asn_id");

-- AddForeignKey
ALTER TABLE "tb_asn_h" ADD CONSTRAINT "tb_asn_h_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_asn_h" ADD CONSTRAINT "tb_asn_h_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_asn_d" ADD CONSTRAINT "tb_asn_d_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "tb_asn_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_asn_d" ADD CONSTRAINT "tb_asn_d_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "tb_inb_plan_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_asn_d" ADD CONSTRAINT "tb_asn_d_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "tb_inb_plan_d"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_asn_d" ADD CONSTRAINT "tb_asn_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_load_order" ADD CONSTRAINT "tb_load_order_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "tb_asn_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_asn_his" ADD CONSTRAINT "tb_asn_his_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "tb_asn_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 지시수량은 1 이상
ALTER TABLE "tb_asn_d" ADD CONSTRAINT "tb_asn_d_qty_chk" CHECK ("qty" > 0 AND "base_qty" > 0);
