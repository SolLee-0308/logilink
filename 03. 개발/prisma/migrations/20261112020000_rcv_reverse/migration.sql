-- 입고취소 역전표 (정의서 ⑥ "입고취소 역전표 후 재검수", 2026-11-12)
-- 원래 배분은 지우지 않고 reverse_yn = true + reverse_id(역전표)로 표시한다. 검수 상태 CANCELED, 입고예정·ASN 이력 행위 RECEIVE_CANCEL.
-- 임시안: 3PL 관리자만, 일마감 전 확정 실적만(적치 모듈 전까지 '적치 시작 전'을 대신함), 사유 필수(RCV_CANCEL).
-- 새 테이블의 RLS는 이벤트 트리거가 자동으로 켠다.

-- AlterEnum
ALTER TYPE "AsnAction" ADD VALUE 'RECEIVE_CANCEL';

-- AlterEnum
ALTER TYPE "PlanAction" ADD VALUE 'RECEIVE_CANCEL';

-- AlterEnum
ALTER TYPE "RcvStatus" ADD VALUE 'CANCELED';

-- AlterTable
ALTER TABLE "tb_rcv_alloc" ADD COLUMN     "reverse_id" INTEGER;

-- CreateTable
CREATE TABLE "tb_rcv_reverse" (
    "id" SERIAL NOT NULL,
    "reverse_no" VARCHAR(20) NOT NULL,
    "rcv_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "center_id" INTEGER NOT NULL,
    "reason_cd" VARCHAR(20) NOT NULL,
    "reason_nm" VARCHAR(100) NOT NULL,
    "reason_text" VARCHAR(500),
    "good_base_qty" INTEGER NOT NULL,
    "return_base_qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(50) NOT NULL,
    "create_user_id" INTEGER NOT NULL,

    CONSTRAINT "tb_rcv_reverse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_rcv_reverse_reverse_no_key" ON "tb_rcv_reverse"("reverse_no");

-- CreateIndex
CREATE UNIQUE INDEX "tb_rcv_reverse_rcv_id_key" ON "tb_rcv_reverse"("rcv_id");

-- CreateIndex
CREATE INDEX "tb_rcv_reverse_center_id_created_at_idx" ON "tb_rcv_reverse"("center_id", "created_at");

-- AddForeignKey
ALTER TABLE "tb_rcv_reverse" ADD CONSTRAINT "tb_rcv_reverse_rcv_id_fkey" FOREIGN KEY ("rcv_id") REFERENCES "tb_rcv_h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_reverse_id_fkey" FOREIGN KEY ("reverse_id") REFERENCES "tb_rcv_reverse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 되돌린 배분은 역전표에 연결되어 있어야 한다
ALTER TABLE "tb_rcv_alloc" ADD CONSTRAINT "tb_rcv_alloc_reverse_chk" CHECK ("reverse_yn" = ("reverse_id" IS NOT NULL));

-- 입고취소 사유 코드 그룹 — 임시안(confirmed=false): 수량 오입력·품목 오입력·화주사·차량 오선택·기타 (2026-11-12, 확정 전)
INSERT INTO "tb_code_group" ("code", "name", "description", "confirmed", "sort_order")
SELECT 'RCV_CANCEL', '입고취소', '검수 확정 실적 입고취소(역전표) 시 필수 (정의서 ⑥, 임시안)', false, COALESCE(MAX("sort_order"), 0) + 1
FROM "tb_code_group"
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "tb_common_code" ("group_code", "code", "name", "sort_order", "requires_text", "created_by", "updated_by")
VALUES
  ('RCV_CANCEL', 'V01', '수량 오입력', 10, false, '시스템', '시스템'),
  ('RCV_CANCEL', 'V02', '품목 오입력', 20, false, '시스템', '시스템'),
  ('RCV_CANCEL', 'V03', '화주사·차량 오선택', 30, false, '시스템', '시스템'),
  ('RCV_CANCEL', 'V99', '기타', 40, true, '시스템', '시스템')
ON CONFLICT ("group_code", "code") DO NOTHING;
