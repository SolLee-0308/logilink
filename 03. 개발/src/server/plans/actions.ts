"use server";

/**
 * 입고예정 서버 액션 — 로그인 사용자를 처리자로 넘기고, 규칙은 service.ts가 검사한다.
 * 3PL 승인·반려는 상세를 열어 본 건만 단건으로 처리한다 (일괄 처리 액션은 두지 않는다).
 */
import { revalidatePath } from "next/cache";
import { getActor } from "@/server/session";
import { fail, type ActionResult } from "@/server/action-result";
import { getPlanDetail } from "@/server/plans/queries";
import * as svc from "@/server/plans/service";
import type { PlanDetail } from "@/features/plans/types";

function refresh<T>(r: ActionResult<T>) {
  // 사이드바 건수(승인 대기)도 함께 바뀌므로 앱 전체 레이아웃을 다시 그린다
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** 상세 패널을 여는 순간 최신 내용과 version을 읽는다 */
export async function loadPlanDetail(id: number): Promise<ActionResult<PlanDetail>> {
  const d = await getPlanDetail(await getActor(), id);
  return d ? { ok: true, message: "", data: d } : fail("NOT_FOUND", "입고예정을 찾을 수 없습니다. 목록을 새로 고쳐 보세요.");
}

export async function approvePlan(input: { id: number; version: number }) {
  return refresh(await svc.approvePlan(await getActor(), input));
}

export async function rejectPlan(input: { id: number; version: number; reasonCode: string; reasonText?: string }) {
  return refresh(await svc.rejectPlan(await getActor(), input));
}

/* 화주사 — 승인 전(승인대기·반려)만 수정·취소. 화면은 입고예정 등록 단계에서 붙인다 */

export async function savePlan(input: svc.SavePlanInput) {
  return refresh(await svc.savePlan(await getActor(), input));
}

export async function cancelPlan(input: { id: number; version: number; reasonCode: string; reasonText?: string }) {
  return refresh(await svc.cancelPlanByShipper(await getActor(), input));
}
