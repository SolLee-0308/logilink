-- 센터별 정기 휴무 요일 (2026-11-11 Sol 결정) — 0 일 ~ 6 토. 영업일(기한경과 취소 유예) 계산에서 뺀다.
-- 기본은 빈 값: 토·일을 쉬는 날로 가정하지 않는다 (주말 운영 센터가 있음)
ALTER TABLE "tb_center"
  ADD COLUMN "weekly_off_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
