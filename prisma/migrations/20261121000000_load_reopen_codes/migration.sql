-- 상차 재개 사유 코드 확정 (2026-11-21 Sol, 정의서 v2.2)
-- 재개 기간이 '지시 상차만, 출차 전'으로 좁아진 것(v1.6)에 맞춘다.
-- 기존 코드 R01~R03·R99는 이력에 남아 있으므로 번호와 이름을 그대로 두고, 재개 후 잘못 넣은 수량을 바로잡는 R04를 더한다.

UPDATE "tb_code_group"
SET "description" = '지시 상차를 상차완료 후 출차 전에 다시 열 때 필수 (정의서 v2.2 ④·D20)',
    "confirmed" = true
WHERE "code" = 'LOAD_REOPEN';

INSERT INTO "tb_common_code" ("group_code", "code", "name", "sort_order", "requires_text", "created_by", "updated_by")
VALUES ('LOAD_REOPEN', 'R04', '수량 오입력 정정', 40, false, '시스템', '시스템')
ON CONFLICT ("group_code", "code") DO NOTHING;

-- 기타는 맨 아래
UPDATE "tb_common_code" SET "sort_order" = 50 WHERE "group_code" = 'LOAD_REOPEN' AND "code" = 'R99' AND "sort_order" < 50;
