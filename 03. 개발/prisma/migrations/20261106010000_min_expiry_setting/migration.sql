-- 최소 잔여 소비기한(일) 운영 설정 — 입고예정일 + 이 일수보다 이른 소비기한은 입력 불가 (2026-11-06 Sol 결정, 기본 7일 임시안)
INSERT INTO "tb_setting" ("key", "label", "value", "value_type", "unit", "min_value", "max_value", "description", "updated_by")
VALUES (
  'MIN_EXPIRY_DAYS',
  '최소 잔여 소비기한',
  '7',
  'INT',
  '일',
  0,
  365,
  '입고예정에 넣는 소비기한은 입고예정일 + 이 일수 이후여야 합니다. 유통할 기간을 남겨 두기 위한 기준입니다.',
  '시스템'
)
ON CONFLICT ("key") DO NOTHING;
