-- 화주사 법인·담당자·계약 정보, 이용 센터(N:M), 화주사 코드 4자 형식(영문 2 + 순번 2)
-- 근거: 98. 프롬프트/02. VS코드_프롬프트_화주사.md (2026-11-03)
-- 화주사를 참조하는 테이블(tb_item, tb_item_barcode, tb_item_alias, tb_item_req, tb_user)은 모두 숫자 id(client_id)로 참조하므로
-- 코드 변경은 tb_client.code 한 곳만 바꾸면 된다.

/* ───── 화주사 코드 이관: DO → DO01 ───── */
UPDATE "tb_client" SET "code" = "code" || '01' WHERE "code" ~ '^[A-Z]{2}$';

/* ───── 화주사 컬럼 추가 (기존 행은 가상 값으로 채운 뒤 필수화) ───── */
ALTER TABLE "tb_client"
  ADD COLUMN "biz_no" VARCHAR(12),
  ADD COLUMN "ceo_nm" VARCHAR(20),
  ADD COLUMN "zip_code" VARCHAR(5),
  ADD COLUMN "addr1" VARCHAR(200),
  ADD COLUMN "addr2" VARCHAR(100),
  ADD COLUMN "tel" VARCHAR(15),
  ADD COLUMN "email" VARCHAR(100),
  ADD COLUMN "contact_nm" VARCHAR(20),
  ADD COLUMN "contact_tel" VARCHAR(15),
  ADD COLUMN "contact_email" VARCHAR(100),
  ADD COLUMN "manager_user_id" INTEGER,
  ADD COLUMN "contract_start_dt" DATE,
  ADD COLUMN "contract_end_dt" DATE;

UPDATE "tb_client" SET
  "name"              = LEFT("name", 50),
  "biz_no"            = '123-45-67891',
  "ceo_nm"            = '미입력',
  "zip_code"          = '00000',
  "addr1"             = '주소 미입력',
  "addr2"             = '-',
  "contact_nm"        = '미입력',
  "contact_tel"       = '031-000-0000',
  "manager_user_id"   = (SELECT "id" FROM "tb_user" WHERE "role" IN ('TPL_ADMIN', 'TPL_OPERATOR') AND "is_active" ORDER BY "role", "id" LIMIT 1),
  "contract_start_dt" = ("created_at" AT TIME ZONE 'Asia/Seoul')::date;

ALTER TABLE "tb_client"
  ALTER COLUMN "code" SET DATA TYPE VARCHAR(4),
  ALTER COLUMN "name" SET DATA TYPE VARCHAR(50),
  ALTER COLUMN "biz_no" SET NOT NULL,
  ALTER COLUMN "ceo_nm" SET NOT NULL,
  ALTER COLUMN "zip_code" SET NOT NULL,
  ALTER COLUMN "addr1" SET NOT NULL,
  ALTER COLUMN "addr2" SET NOT NULL,
  ALTER COLUMN "contact_nm" SET NOT NULL,
  ALTER COLUMN "contact_tel" SET NOT NULL,
  ALTER COLUMN "manager_user_id" SET NOT NULL,
  ALTER COLUMN "contract_start_dt" SET NOT NULL;

ALTER TABLE "tb_client" ADD CONSTRAINT "tb_client_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "tb_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tb_client" ADD CONSTRAINT "tb_client_code_chk" CHECK ("code" ~ '^[A-Z]{2}(0[1-9]|[1-9][0-9])$');
ALTER TABLE "tb_client" ADD CONSTRAINT "tb_client_contract_chk" CHECK ("contract_end_dt" IS NULL OR "contract_end_dt" >= "contract_start_dt");

/* ───── 이용 센터 (N:M) ───── */
CREATE TABLE "tb_client_center" (
  "id" SERIAL NOT NULL,
  "client_id" INTEGER NOT NULL,
  "center_cd" VARCHAR(5) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" VARCHAR(50) NOT NULL,
  CONSTRAINT "tb_client_center_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tb_client_center_center_cd_idx" ON "tb_client_center"("center_cd");
CREATE UNIQUE INDEX "tb_client_center_client_id_center_cd_key" ON "tb_client_center"("client_id", "center_cd");
ALTER TABLE "tb_client_center" ADD CONSTRAINT "tb_client_center_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tb_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_client_center" ADD CONSTRAINT "tb_client_center_center_cd_fkey" FOREIGN KEY ("center_cd") REFERENCES "tb_center"("center_cd") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 기존 화주사는 모두 첫 센터를 이용하는 것으로 둔다
INSERT INTO "tb_client_center" ("client_id", "center_cd", "created_by")
SELECT c."id", (SELECT "center_cd" FROM "tb_center" ORDER BY "id" LIMIT 1), '시스템' FROM "tb_client" c
WHERE EXISTS (SELECT 1 FROM "tb_center");
-- 새 테이블 RLS는 이벤트 트리거가 자동으로 켠다
