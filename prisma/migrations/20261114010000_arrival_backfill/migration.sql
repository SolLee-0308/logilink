-- 정의서 v1.9 10장 전환 규칙 — 기존 데이터를 새 단계 기준으로 채운다.

-- 1) 사람이 [출차]를 누른 기존 출차 → 구분 '사람'
UPDATE "tb_load_h" SET "depart_type" = 'MANUAL' WHERE "depart_dt" IS NOT NULL AND "depart_type" IS NULL;

-- 2) 입고검수 전표가 있는 차량 → 입차 시각 = 첫 전표 생성 시각, 처리자 = 그 전표 생성자
UPDATE "tb_load_h" l SET "arrive_dt" = f."created_at", "arrived_by" = f."created_by"
FROM (
  SELECT DISTINCT ON ("load_id") "load_id", "created_at", "created_by"
  FROM "tb_rcv_h" ORDER BY "load_id", "created_at", "id"
) f
WHERE l."id" = f."load_id" AND l."arrive_dt" IS NULL AND l."status" = 'COMPLETED';

-- 3) 검수 시작 시각 = 첫 입력 시각. 입력은 없고 0 확인 또는 확정이 있으면 확정·생성 시각으로 채운다
UPDATE "tb_rcv_h" r SET "start_dt" = i."first_at"
FROM (SELECT "rcv_id", MIN("input_dt") AS "first_at" FROM "tb_rcv_input" GROUP BY "rcv_id") i
WHERE r."id" = i."rcv_id" AND r."start_dt" IS NULL;
UPDATE "tb_rcv_h" SET "start_dt" = COALESCE("confirm_dt", "created_at")
WHERE "start_dt" IS NULL AND ("status" <> 'WORKING' OR "id" IN (SELECT "rcv_id" FROM "tb_rcv_d" WHERE "zero_confirm_yn"));

-- 4) 입차했는데 출차 기록이 없는 차량 → 입차 처리(시스템) 출차 (시각 = 입차 시각)
UPDATE "tb_load_h" SET "depart_dt" = "arrive_dt", "departed_by" = "arrived_by", "depart_type" = 'ARRIVAL'
WHERE "status" = 'COMPLETED' AND "depart_dt" IS NULL AND "arrive_dt" IS NOT NULL;
INSERT INTO "tb_load_his" ("load_id", "action", "revision_no", "actor", "at", "reason_text")
SELECT "id", 'DEPART', "revision_no", "departed_by", "depart_dt", '입차 처리(시스템) — v1.9 전환'
FROM "tb_load_h" WHERE "depart_type" = 'ARRIVAL';

-- 5) v1.6 규칙으로 자동 출차로 보이던 차량(상차완료한 업무일이 지남) → 일마감 처리(시스템) 출차 (시각 = 전환 실행 시각)
--    저장하지 않으면 출차 전으로 돌아가 다시 상차 재개가 가능해진다
UPDATE "tb_load_h" l SET "depart_dt" = now(), "departed_by" = '시스템(전환)', "depart_type" = 'DAILY_CLOSE'
FROM "tb_center" c
WHERE l."center_id" = c."id" AND l."status" = 'COMPLETED' AND l."depart_dt" IS NULL AND l."complete_dt" IS NOT NULL
  AND ((l."complete_dt" AT TIME ZONE 'Asia/Seoul') - c."business_day_start"::interval)::date
    < ((now() AT TIME ZONE 'Asia/Seoul') - c."business_day_start"::interval)::date;
INSERT INTO "tb_load_his" ("load_id", "action", "revision_no", "actor", "at", "reason_text")
SELECT "id", 'DEPART', "revision_no", "departed_by", "depart_dt", '일마감 처리(시스템) — v1.9 전환(기존 자동 출차)'
FROM "tb_load_h" WHERE "depart_type" = 'DAILY_CLOSE';

-- 6) 입차 이력 (전환분)
INSERT INTO "tb_load_his" ("load_id", "action", "revision_no", "actor", "at", "reason_text")
SELECT "id", 'ARRIVE', "revision_no", "arrived_by", "arrive_dt", 'v1.9 전환(기존 검수 전표 생성 시각)'
FROM "tb_load_h" WHERE "arrive_dt" IS NOT NULL;

-- 출차 구분은 출차 시각과 함께만, 입차는 상차완료 상태에서만
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_depart_type_chk" CHECK (("depart_dt" IS NULL) = ("depart_type" IS NULL));
ALTER TABLE "tb_load_h" ADD CONSTRAINT "tb_load_h_arrive_completed_chk" CHECK ("arrive_dt" IS NULL OR "status" = 'COMPLETED');
