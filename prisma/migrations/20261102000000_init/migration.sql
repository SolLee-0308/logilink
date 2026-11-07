-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SHIPPER_STAFF', 'SHIPPER_LOADER', 'TPL_OPERATOR', 'TPL_INSPECTOR');

-- CreateEnum
CREATE TYPE "ItemUnit" AS ENUM ('EA', 'BOX', 'PLT');

-- CreateEnum
CREATE TYPE "ItemRequestStatus" AS ENUM ('WAITING', 'REJECTED', 'REGISTERED');

-- CreateEnum
CREATE TYPE "ItemRequestSource" AS ENUM ('DIRECT', 'EXCEL', 'AI');

-- CreateEnum
CREATE TYPE "ItemRequestAction" AS ENUM ('REQUEST', 'RESUBMIT', 'REGISTER', 'REJECT');

-- CreateTable
CREATE TABLE "tb_center" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_center_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_client" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_item" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "barcode" VARCHAR(40) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_item_req" (
    "id" SERIAL NOT NULL,
    "request_no" VARCHAR(20) NOT NULL,
    "client_id" INTEGER NOT NULL,
    "item_code" VARCHAR(40) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "barcode" VARCHAR(40) NOT NULL,
    "source" "ItemRequestSource" NOT NULL,
    "source_note" VARCHAR(500),
    "status" "ItemRequestStatus" NOT NULL DEFAULT 'WAITING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "resubmit_count" INTEGER NOT NULL DEFAULT 0,
    "requested_by" VARCHAR(50) NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_by" VARCHAR(50),
    "processed_at" TIMESTAMPTZ(3),
    "reject_reason_cd" VARCHAR(20),
    "reject_reason_text" VARCHAR(500),
    "item_id" INTEGER,

    CONSTRAINT "tb_item_req_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_item_req_his" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "action" "ItemRequestAction" NOT NULL,
    "actor" VARCHAR(50) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_cd" VARCHAR(20),
    "reason_text" VARCHAR(500),
    "memo" VARCHAR(500),

    CONSTRAINT "tb_item_req_his_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_code_group" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tb_code_group_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "tb_common_code" (
    "id" SERIAL NOT NULL,
    "group_code" VARCHAR(30) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "requires_text" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_common_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_user" (
    "id" SERIAL NOT NULL,
    "login_id" VARCHAR(50) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "role" "UserRole" NOT NULL,
    "client_id" INTEGER,
    "center_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_setting" (
    "key" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(20),
    "min_value" INTEGER,
    "max_value" INTEGER,
    "description" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tb_change_log" (
    "id" BIGSERIAL NOT NULL,
    "table_name" VARCHAR(40) NOT NULL,
    "record_key" VARCHAR(60) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor" VARCHAR(50) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_center_code_key" ON "tb_center"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tb_client_code_key" ON "tb_client"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_client_id_code_key" ON "tb_item"("client_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_client_id_barcode_key" ON "tb_item"("client_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_req_request_no_key" ON "tb_item_req"("request_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_item_req_item_id_key" ON "tb_item_req"("item_id");

-- CreateIndex
CREATE INDEX "tb_item_req_status_idx" ON "tb_item_req"("status");

-- CreateIndex
CREATE INDEX "tb_item_req_his_request_id_idx" ON "tb_item_req_his"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "tb_common_code_group_code_code_key" ON "tb_common_code"("group_code", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tb_user_login_id_key" ON "tb_user"("login_id");

-- CreateIndex
CREATE INDEX "tb_change_log_table_name_record_key_idx" ON "tb_change_log"("table_name", "record_key");

-- AddForeignKey
ALTER TABLE "tb_item" ADD CONSTRAINT "tb_item_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_item_req" ADD CONSTRAINT "tb_item_req_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_item_req" ADD CONSTRAINT "tb_item_req_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_item_req_his" ADD CONSTRAINT "tb_item_req_his_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "tb_item_req"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_common_code" ADD CONSTRAINT "tb_common_code_group_code_fkey" FOREIGN KEY ("group_code") REFERENCES "tb_code_group"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

