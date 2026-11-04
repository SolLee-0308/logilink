-- 2026-11-04 입고예정 AI 판독 작업 (정의서 ①: AI 원본 결과와 사용자 수정 내용 보존)
-- RLS는 이벤트 트리거(logilink_enable_rls_on_new_table)가 자동으로 켠다

CREATE TABLE "tb_inb_plan_ai_read" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "plan_id" INTEGER,
    "file_names" TEXT[],
    "model" VARCHAR(40) NOT NULL,
    "is_example" BOOLEAN NOT NULL DEFAULT false,
    "raw_result" JSONB NOT NULL,
    "final_lines" JSONB,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saved_at" TIMESTAMPTZ(3),

    CONSTRAINT "tb_inb_plan_ai_read_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tb_inb_plan_ai_read_client_id_created_at_idx" ON "tb_inb_plan_ai_read"("client_id", "created_at");
CREATE INDEX "tb_inb_plan_ai_read_plan_id_idx" ON "tb_inb_plan_ai_read"("plan_id");

ALTER TABLE "tb_inb_plan_ai_read" ADD CONSTRAINT "tb_inb_plan_ai_read_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tb_inb_plan_ai_read" ADD CONSTRAINT "tb_inb_plan_ai_read_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "tb_inb_plan_h"("id") ON DELETE SET NULL ON UPDATE CASCADE;
