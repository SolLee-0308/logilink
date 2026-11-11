-- 센터별 업무일 시작 시각·기한경과 취소 유예 영업일 (2026-11-11 Sol 결정)
-- 업무일: 이 시각부터 다음 날 이 시각 전까지를 하루로 센다 (새벽 입고 실적을 그날 업무일로 묶기 위함, 정의서 O3)
-- 유예: 승인 전(승인대기·반려) 입고예정은 입고예정일 + N영업일이 지난 날의 일마감 때 기한경과 취소 대상
ALTER TABLE "tb_center"
  ADD COLUMN "business_day_start" VARCHAR(5) NOT NULL DEFAULT '06:00',
  ADD COLUMN "expire_grace_days" INTEGER NOT NULL DEFAULT 1;
