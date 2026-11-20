-- 품목 입수 (2026-11-17 Sol): 기준 단위가 BOX인 품목에 BOX 1개에 든 EA 수를 받아 둔다.
-- 기존 BOX 기준 품목은 비어 있음(목록에 '미입력'), 다음 수정 때 필수 입력.
ALTER TABLE "tb_item" ADD COLUMN "inner_qty" INTEGER;
ALTER TABLE "tb_item" ADD CONSTRAINT "tb_item_inner_qty_check"
  CHECK ("inner_qty" IS NULL OR ("base_unit" = 'BOX' AND "inner_qty" BETWEEN 2 AND 100000));
