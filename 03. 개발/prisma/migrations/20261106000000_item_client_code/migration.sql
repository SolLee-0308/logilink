-- 품목코드 시스템 채번 + 화주사 품목코드 (2026-11-06 Sol 결정)
-- 1) 품목: 화주사 품목코드 칸 추가 → 기존 품목코드를 옮김 → 품목코드를 {화주사코드}-{순번 5자리}로 다시 매김
ALTER TABLE "tb_item" ADD COLUMN "client_item_code" VARCHAR(40);
UPDATE "tb_item" SET "client_item_code" = "code";
UPDATE "tb_item" AS i
SET "code" = c."code" || '-' || lpad(x.rn::text, 5, '0')
FROM (SELECT "id", row_number() OVER (PARTITION BY "client_id" ORDER BY "id") AS rn FROM "tb_item") AS x,
     "tb_client" AS c
WHERE x."id" = i."id" AND c."id" = i."client_id";
CREATE UNIQUE INDEX "tb_item_client_id_client_item_code_key" ON "tb_item"("client_id", "client_item_code");

-- 2) 품목 등록 요청: 요청 때 적던 품목코드는 화주사 품목코드(선택)로
ALTER TABLE "tb_item_req" RENAME COLUMN "item_code" TO "client_item_code";
ALTER TABLE "tb_item_req" ALTER COLUMN "client_item_code" DROP NOT NULL;
