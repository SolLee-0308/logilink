-- CreateEnum
CREATE TYPE "StorageTemp" AS ENUM ('ROOM', 'CHILLED', 'FROZEN');

-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('MANUAL', 'REQUEST', 'MATCH');

-- CreateEnum
CREATE TYPE "HolidayKind" AS ENUM ('PUBLIC', 'CENTER');

-- DropIndex
DROP INDEX "tb_item_client_id_barcode_key";

-- AlterTable
ALTER TABLE "tb_center" ADD COLUMN     "address" VARCHAR(200);

-- AlterTable
ALTER TABLE "tb_item" DROP COLUMN "barcode",
DROP COLUMN "unit",
ADD COLUMN     "base_unit" "ItemUnit" NOT NULL,
ADD COLUMN     "expiry_managed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lot_managed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storage_temp" "StorageTemp" NOT NULL;

-- AlterTable
ALTER TABLE "tb_item_req" ADD COLUMN     "expiry_managed" BOOLEAN,
ADD COLUMN     "lot_managed" BOOLEAN,
ADD COLUMN     "storage_temp" "StorageTemp";

-- AlterTable
ALTER TABLE "tb_setting" ADD COLUMN     "value_type" VARCHAR(10) NOT NULL DEFAULT 'INT';

-- CreateTable
CREATE TABLE "tb_item_uom" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "tb_item_uom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_item_barcode" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "barcode" VARCHAR(40) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tb_item_barcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_item_alias" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "alias" VARCHAR(200) NOT NULL,
    "normalized" VARCHAR(200) NOT NULL,
    "source" "AliasSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_item_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_company" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(100) NOT NULL,
    "biz_no" VARCHAR(12),
    "ceo_name" VARCHAR(50),
    "address" VARCHAR(200),
    "phone" VARCHAR(20),
    "email" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_holiday" (
    "id" SERIAL NOT NULL,
    "center_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "HolidayKind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_uom_item_id_unit_key" ON "tb_item_uom"("item_id", "unit");

-- CreateIndex
CREATE INDEX "tb_item_barcode_item_id_idx" ON "tb_item_barcode"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_barcode_client_id_barcode_key" ON "tb_item_barcode"("client_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_alias_client_id_normalized_key" ON "tb_item_alias"("client_id", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "tb_holiday_center_id_date_key" ON "tb_holiday"("center_id", "date");

-- AddForeignKey
ALTER TABLE "tb_item_uom" ADD CONSTRAINT "tb_item_uom_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_item_barcode" ADD CONSTRAINT "tb_item_barcode_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_item_barcode" ADD CONSTRAINT "tb_item_barcode_item_id_unit_fkey" FOREIGN KEY ("item_id", "unit") REFERENCES "tb_item_uom"("item_id", "unit") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_item_alias" ADD CONSTRAINT "tb_item_alias_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_holiday" ADD CONSTRAINT "tb_holiday_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 업무 규칙 제약
ALTER TABLE "tb_item_uom" ADD CONSTRAINT "tb_item_uom_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "tb_company" ADD CONSTRAINT "tb_company_single_chk" CHECK ("id" = 1);
-- 대표 바코드는 품목당 1개
CREATE UNIQUE INDEX "tb_item_barcode_primary_uq" ON "tb_item_barcode" ("item_id") WHERE "is_primary";
