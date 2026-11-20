-- 상차 차이 사유 품목별 선택 (정의서 v2.0 ④·C6·D28, 2026-11-19 Sol 결정 A안)
-- 1) 품목(라인)마다 사유를 저장한다. 헤더(tb_load_h)의 사유 칼럼은 v2.0 이전 차량 조회용으로 남긴다(옮기지 않음, 11장).
ALTER TABLE "tb_load_d" ADD COLUMN "diff_reason_cd" VARCHAR(20);
ALTER TABLE "tb_load_d" ADD COLUMN "diff_reason_nm" VARCHAR(100);
ALTER TABLE "tb_load_d" ADD COLUMN "diff_reason_text" VARCHAR(500);

-- 2) 사유 코드의 적용 상태(short 부족·over 초과·extra 지시 외) — 드롭다운을 품목 상태로 거른다
ALTER TABLE "tb_common_code" ADD COLUMN "applies_to" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "tb_common_code" SET "applies_to" = ARRAY['short']::TEXT[]
  WHERE "group_code" = 'LOAD_DIFF' AND "code" IN ('L01', 'L02', 'L05');
UPDATE "tb_common_code" SET "applies_to" = ARRAY['short', 'over', 'extra']::TEXT[]
  WHERE "group_code" = 'LOAD_DIFF' AND "code" IN ('L03', 'L99');
-- L04 예정 외 차량(무지시)은 시스템 지정 전용 → 빈 배열(드롭다운에 보이지 않음)

-- 3) 초과·지시 외 원인 코드 추가 (정의서 v2.0 O6, 안)
INSERT INTO "tb_common_code" ("group_code", "code", "name", "sort_order", "requires_text", "applies_to", "is_active", "created_by", "updated_by")
VALUES
  ('LOAD_DIFF', 'L06', '화주사 추가 출고 요청', 55, false, ARRAY['over', 'extra']::TEXT[], true, '시스템', '시스템'),
  ('LOAD_DIFF', 'L07', 'ASN 수량·품목 입력 오류', 57, false, ARRAY['short', 'over', 'extra']::TEXT[], true, '시스템', '시스템')
ON CONFLICT ("group_code", "code") DO NOTHING;

UPDATE "tb_code_group" SET "description" = '상차완료 시 ASN 대비 차이가 있는 품목마다 필수 선택, 품목 상태(부족·초과·지시 외)에 맞는 코드만 보임 (정의서 v2.0 ④, C6·D28)' WHERE "code" = 'LOAD_DIFF';
