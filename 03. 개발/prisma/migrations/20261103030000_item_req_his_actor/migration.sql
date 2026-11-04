-- 품목 등록 요청 처리 이력에 처리자 id — "오늘 처리"(오늘 내가 등록·반려한 건) 탭용. 승인 대기와 같은 기준
ALTER TABLE "tb_item_req_his" ADD COLUMN "actor_id" INTEGER;

CREATE INDEX "tb_item_req_his_actor_id_action_at_idx" ON "tb_item_req_his"("actor_id", "action", "at");
