-- 회사 정보 주소 분리·필수화, 센터 관리 확장(일마감 예정 시각 이관), 로그인(세션·이력·잠금)
-- 근거: 98. 프롬프트/01. 261103 회사정보·센터관리 + 로그인 요청 (2026-11-03)

/* ───── 회사 정보 ───── */
ALTER TABLE "tb_company"
  ADD COLUMN "zip_code" VARCHAR(5),
  ADD COLUMN "addr1" VARCHAR(200),
  ADD COLUMN "addr2" VARCHAR(100);

-- 기존 1건: 비어 있는 필수 값을 가상 값으로 채운 뒤 NOT NULL 적용 (기존 주소는 기본주소로 옮긴다)
UPDATE "tb_company" SET
  "name"     = CASE WHEN "name" = '로지링크' THEN '온길로지스(주)' ELSE LEFT("name", 50) END,
  "biz_no"   = COALESCE("biz_no", '123-45-67891'),
  "ceo_name" = LEFT(COALESCE("ceo_name", '정다온'), 20),
  "zip_code" = '17084',
  "addr1"    = COALESCE("address", '경기도 용인시 기흥구 온길로 128'),
  "addr2"    = '온길타워 7층',
  "phone"    = COALESCE("phone", '031-555-0128'),
  "email"    = COALESCE("email", 'contact@ongil-logis.example');

ALTER TABLE "tb_company"
  DROP COLUMN "address",
  ALTER COLUMN "name" SET DATA TYPE VARCHAR(50),
  ALTER COLUMN "biz_no" SET NOT NULL,
  ALTER COLUMN "ceo_name" SET NOT NULL,
  ALTER COLUMN "ceo_name" SET DATA TYPE VARCHAR(20),
  ALTER COLUMN "zip_code" SET NOT NULL,
  ALTER COLUMN "addr1" SET NOT NULL,
  ALTER COLUMN "addr2" SET NOT NULL,
  ALTER COLUMN "phone" SET DATA TYPE VARCHAR(15);

ALTER TABLE "tb_company" ADD CONSTRAINT "tb_company_version_chk" CHECK ("version" > 0);

/* ───── 센터 ───── */
DROP INDEX "tb_center_code_key";
ALTER TABLE "tb_center" RENAME COLUMN "code" TO "center_cd";
ALTER TABLE "tb_center" RENAME COLUMN "name" TO "center_nm";
ALTER TABLE "tb_center" RENAME COLUMN "is_active" TO "use_yn";

ALTER TABLE "tb_center"
  ADD COLUMN "company_id" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "zip_code" VARCHAR(5),
  ADD COLUMN "addr1" VARCHAR(200),
  ADD COLUMN "addr2" VARCHAR(100),
  ADD COLUMN "inbound_tel" VARCHAR(15),
  ADD COLUMN "manager_user_id" INTEGER,
  ADD COLUMN "daily_close_time" VARCHAR(5),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "created_by" VARCHAR(50),
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_by" VARCHAR(50);

-- 기존 센터: 회사 정보 화면에 있던 센터 데이터 이관 + 운영 설정의 일마감 예정 시각 이관
UPDATE "tb_center" SET
  "zip_code"         = '17030',
  "addr1"            = COALESCE("address", '경기도 용인시 처인구 백암면 물류단지로 45'),
  "addr2"            = 'A동 1층 입고장',
  "inbound_tel"      = '031-555-0300',
  "daily_close_time" = COALESCE((SELECT "value" FROM "tb_setting" WHERE "key" = 'DAILY_CLOSE_TIME'), '18:00'),
  "created_by"       = '시스템',
  "updated_by"       = '시스템';

ALTER TABLE "tb_center"
  DROP COLUMN "address",
  ALTER COLUMN "center_cd" SET DATA TYPE VARCHAR(5),
  ALTER COLUMN "zip_code" SET NOT NULL,
  ALTER COLUMN "addr1" SET NOT NULL,
  ALTER COLUMN "addr2" SET NOT NULL,
  ALTER COLUMN "inbound_tel" SET NOT NULL,
  ALTER COLUMN "daily_close_time" SET NOT NULL,
  ALTER COLUMN "created_by" SET NOT NULL,
  ALTER COLUMN "updated_by" SET NOT NULL;

CREATE UNIQUE INDEX "tb_center_center_cd_key" ON "tb_center"("center_cd");
CREATE UNIQUE INDEX "tb_center_center_nm_key" ON "tb_center"("center_nm");

ALTER TABLE "tb_center" ADD CONSTRAINT "tb_center_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "tb_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tb_center" ADD CONSTRAINT "tb_center_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "tb_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tb_center" ADD CONSTRAINT "tb_center_cd_chk" CHECK ("center_cd" ~ '^[A-Z0-9]{3,5}$');
ALTER TABLE "tb_center" ADD CONSTRAINT "tb_center_close_time_chk" CHECK ("daily_close_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "tb_center" ADD CONSTRAINT "tb_center_version_chk" CHECK ("version" > 0);

-- 일마감 예정 시각은 센터 값으로 옮겼으므로 운영 설정에서 뺀다 (변경 이력은 남겨 둔다)
DELETE FROM "tb_setting" WHERE "key" = 'DAILY_CLOSE_TIME';

/* ───── 사용자: 3PL 관리자 소속 + 로그인 컬럼 ───── */
ALTER TABLE "tb_user" DROP CONSTRAINT "tb_user_scope_chk";
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_scope_chk" CHECK (
  ("role" IN ('SHIPPER_STAFF', 'SHIPPER_LOADER') AND "client_id" IS NOT NULL AND "center_id" IS NULL)
  OR ("role" IN ('TPL_ADMIN', 'TPL_OPERATOR', 'TPL_INSPECTOR') AND "center_id" IS NOT NULL AND "client_id" IS NULL)
);

ALTER TABLE "tb_user"
  ADD COLUMN "password_hash" VARCHAR(200),
  ADD COLUMN "must_change_pw" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fail_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3),
  ADD COLUMN "pw_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3);

ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_fail_count_chk" CHECK ("fail_count" >= 0);

/* ───── 세션·로그인 이력 ───── */
CREATE TABLE "tb_session" (
  "id" VARCHAR(64) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "ip" VARCHAR(64),
  CONSTRAINT "tb_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tb_session_user_id_idx" ON "tb_session"("user_id");
ALTER TABLE "tb_session" ADD CONSTRAINT "tb_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tb_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tb_login_log" (
  "id" BIGSERIAL NOT NULL,
  "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "login_input" VARCHAR(100) NOT NULL,
  "user_id" INTEGER,
  "ip" VARCHAR(64),
  "result" "LoginResult" NOT NULL,
  "reason" VARCHAR(100),
  CONSTRAINT "tb_login_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tb_login_log_at_idx" ON "tb_login_log"("at");
CREATE INDEX "tb_login_log_user_id_idx" ON "tb_login_log"("user_id");
-- 새 테이블 RLS는 이벤트 트리거(logilink_enable_rls_on_new_table)가 자동으로 켠다
