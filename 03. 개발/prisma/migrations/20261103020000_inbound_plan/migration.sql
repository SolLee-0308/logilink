-- 입고예정 헤더·라인, 반려본 스냅샷(Append-only), 처리 이력
-- 근거: 01. 프로세스/01-입고 업무프로세스 정의서_v1.4.md (①② · 4-1 · 9장 TB_INB_PLAN_H/D, TB_INB_PLAN_REJ_H/D · D1·D6)
-- RLS는 기존 이벤트 트리거가 새 테이블에 자동으로 켠다.

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('WAITING', 'REJECTED', 'APPROVED', 'PARTIAL', 'COMPLETED', 'CLOSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlanInputMethod" AS ENUM ('DIRECT', 'EXCEL', 'AI_IMAGE');

-- CreateEnum
CREATE TYPE "PlanAction" AS ENUM ('CREATE', 'UPDATE', 'RESUBMIT', 'APPROVE', 'REJECT', 'CANCEL', 'CANCEL_APPROVED', 'EXPIRE_CANCEL', 'CLOSE');

-- CreateTable
CREATE TABLE "tb_inb_plan_h" (
    "id" SERIAL NOT NULL,
    "plan_no" VARCHAR(20) NOT NULL,
    "client_id" INTEGER NOT NULL,
    "center_id" INTEGER NOT NULL,
    "plan_dt" DATE NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'WAITING',
    "input_method" "PlanInputMethod" NOT NULL,
    "memo" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision_no" INTEGER NOT NULL DEFAULT 1,
    "approved_revision_no" INTEGER,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" VARCHAR(50),
    "cancel_reason_cd" VARCHAR(20),
    "cancel_reason_text" VARCHAR(500),
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by" VARCHAR(50),
    "close_reason_cd" VARCHAR(20),
    "close_reason_text" VARCHAR(500),
    "close_dt" TIMESTAMPTZ(3),
    "close_user" VARCHAR(50),
    "close_req_memo" VARCHAR(500),
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saved_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_inb_plan_h_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_inb_plan_d" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "qty" INTEGER NOT NULL,
    "base_qty" INTEGER NOT NULL,
    "expiry_dt" DATE,
    "lot_no" VARCHAR(40),
    "rcv_qty" INTEGER NOT NULL DEFAULT 0,
    "return_qty" INTEGER NOT NULL DEFAULT 0,
    "diff_qty" INTEGER NOT NULL DEFAULT 0,
    "close_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tb_inb_plan_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_inb_plan_rej_h" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "plan_dt" DATE NOT NULL,
    "memo" VARCHAR(500),
    "reason_cd" VARCHAR(20) NOT NULL,
    "reason_nm" VARCHAR(100) NOT NULL,
    "reason_text" VARCHAR(500),
    "rejected_by" VARCHAR(50) NOT NULL,
    "rejected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_inb_plan_rej_h_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_inb_plan_rej_d" (
    "id" SERIAL NOT NULL,
    "reject_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "item_code" VARCHAR(40) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "qty" INTEGER NOT NULL,
    "base_qty" INTEGER NOT NULL,
    "expiry_dt" DATE,
    "lot_no" VARCHAR(40),

    CONSTRAINT "tb_inb_plan_rej_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_inb_plan_his" (
    "id" BIGSERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "action" "PlanAction" NOT NULL,
    "version" INTEGER NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "actor" VARCHAR(50) NOT NULL,
    "actor_id" INTEGER,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_cd" VARCHAR(20),
    "reason_nm" VARCHAR(100),
    "reason_text" VARCHAR(500),

    CONSTRAINT "tb_inb_plan_his_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_inb_plan_h_plan_no_key" ON "tb_inb_plan_h"("plan_no");

-- CreateIndex
CREATE INDEX "tb_inb_plan_h_status_center_id_idx" ON "tb_inb_plan_h"("status", "center_id");

-- CreateIndex
CREATE INDEX "tb_inb_plan_h_client_id_status_idx" ON "tb_inb_plan_h"("client_id", "status");

-- CreateIndex
CREATE INDEX "tb_inb_plan_d_item_id_idx" ON "tb_inb_plan_d"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tb_inb_plan_d_plan_id_line_no_key" ON "tb_inb_plan_d"("plan_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_inb_plan_rej_h_plan_id_revision_no_key" ON "tb_inb_plan_rej_h"("plan_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_inb_plan_rej_d_reject_id_line_no_key" ON "tb_inb_plan_rej_d"("reject_id", "line_no");

-- CreateIndex
CREATE INDEX "tb_inb_plan_his_plan_id_idx" ON "tb_inb_plan_his"("plan_id");

-- CreateIndex
CREATE INDEX "tb_inb_plan_his_actor_id_action_at_idx" ON "tb_inb_plan_his"("actor_id", "action", "at");

-- AddForeignKey
ALTER TABLE "tb_inb_plan_h" ADD CONSTRAINT "tb_inb_plan_h_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_inb_plan_h" ADD CONSTRAINT "tb_inb_plan_h_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "tb_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_inb_plan_d" ADD CONSTRAINT "tb_inb_plan_d_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "tb_inb_plan_h"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_inb_plan_d" ADD CONSTRAINT "tb_inb_plan_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "tb_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_inb_plan_rej_h" ADD CONSTRAINT "tb_inb_plan_rej_h_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "tb_inb_plan_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_inb_plan_rej_d" ADD CONSTRAINT "tb_inb_plan_rej_d_reject_id_fkey" FOREIGN KEY ("reject_id") REFERENCES "tb_inb_plan_rej_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_inb_plan_his" ADD CONSTRAINT "tb_inb_plan_his_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "tb_inb_plan_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


/* ───── 반려본 스냅샷은 추가만 가능 (D6 Append-only) ───── */
CREATE OR REPLACE FUNCTION "fn_block_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% 은(는) 추가만 할 수 있습니다 (수정·삭제 불가)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_inb_plan_rej_h_append_only" BEFORE UPDATE OR DELETE ON "tb_inb_plan_rej_h"
  FOR EACH ROW EXECUTE FUNCTION "fn_block_append_only"();
CREATE TRIGGER "trg_inb_plan_rej_d_append_only" BEFORE UPDATE OR DELETE ON "tb_inb_plan_rej_d"
  FOR EACH ROW EXECUTE FUNCTION "fn_block_append_only"();

/* ───── 수량은 0보다 커야 한다 (C1) ───── */
ALTER TABLE "tb_inb_plan_d" ADD CONSTRAINT "ck_inb_plan_d_qty" CHECK ("qty" > 0 AND "base_qty" > 0);
