-- 입차 취소(VOIDED) 전표는 확정한 적이 없으므로 확정 시각·처리자 없이 둔다 (정의서 v1.9 ⑥·C11)
ALTER TABLE "tb_rcv_h" DROP CONSTRAINT "tb_rcv_h_confirm_chk";
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_confirm_chk" CHECK ("status" IN ('WORKING', 'VOIDED') OR ("confirm_dt" IS NOT NULL AND "confirmed_by" IS NOT NULL));
-- 입차 취소는 처리 시각·처리자·사유와 함께, 검수 시작 전에만
ALTER TABLE "tb_rcv_h" ADD CONSTRAINT "tb_rcv_h_void_chk" CHECK (
  ("status" = 'VOIDED') = ("void_dt" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason_cd" IS NOT NULL)
  AND ("status" <> 'VOIDED' OR "start_dt" IS NULL)
);
