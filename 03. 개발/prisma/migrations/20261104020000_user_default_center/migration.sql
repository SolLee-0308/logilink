-- 2026-11-04 화주사 사용자의 기본 센터 (입고예정 등록 센터 기본값, Sol 결정)
-- 3PL 소속 센터(center_id)와 별개 칸 — 화주사 사용자는 center_id가 비어 있어야 하는 제약(tb_user_scope_chk)을 그대로 둔다
ALTER TABLE "tb_user" ADD COLUMN "default_center_id" INTEGER;
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_default_center_id_fkey" FOREIGN KEY ("default_center_id") REFERENCES "tb_center"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- 3PL 사용자는 기본 센터를 쓰지 않는다
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_default_center_chk" CHECK ("default_center_id" IS NULL OR "client_id" IS NOT NULL);
