-- 업무 규칙 제약 + Supabase 공개 API 차단(RLS 잠금)

-- 사용자 소속: 화주사 역할은 화주사만, 3PL 역할은 센터만 가진다
ALTER TABLE "tb_user" ADD CONSTRAINT "tb_user_scope_chk" CHECK (
  ("role" IN ('SHIPPER_STAFF', 'SHIPPER_LOADER') AND "client_id" IS NOT NULL AND "center_id" IS NULL)
  OR ("role" IN ('TPL_OPERATOR', 'TPL_INSPECTOR') AND "center_id" IS NOT NULL AND "client_id" IS NULL)
);

-- 품목 등록 요청: 등록완료면 품목이 연결되고, 반려면 사유가 있어야 한다
ALTER TABLE "tb_item_req" ADD CONSTRAINT "tb_item_req_state_chk" CHECK (
  ("status" <> 'REGISTERED' OR "item_id" IS NOT NULL)
  AND ("status" <> 'REJECTED' OR "reject_reason_cd" IS NOT NULL)
);

-- 수량·버전 등 양수 보장
ALTER TABLE "tb_client" ADD CONSTRAINT "tb_client_version_chk" CHECK ("version" > 0);
ALTER TABLE "tb_item" ADD CONSTRAINT "tb_item_version_chk" CHECK ("version" > 0);
ALTER TABLE "tb_item_req" ADD CONSTRAINT "tb_item_req_version_chk" CHECK ("version" > 0 AND "resubmit_count" >= 0);

-- 앱은 서버에서 postgres 역할로만 접속한다. Supabase 공개 API(anon·authenticated)로는 읽고 쓸 수 없게
-- 모든 public 테이블에 RLS를 켜고 정책은 두지 않는다.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- 이후 새로 만드는 테이블에도 자동으로 RLS를 켠다
CREATE OR REPLACE FUNCTION public.logilink_enable_rls_on_new_table()
RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public' LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
  END LOOP;
END $$;

DROP EVENT TRIGGER IF EXISTS logilink_enable_rls_on_new_table;
CREATE EVENT TRIGGER logilink_enable_rls_on_new_table ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.logilink_enable_rls_on_new_table();
