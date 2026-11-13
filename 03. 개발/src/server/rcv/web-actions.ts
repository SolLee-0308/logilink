"use server";

/**
 * 입고검수 웹 서버 액션 (3PL Web) — 로그인한 웹 사용자를 처리자로 넘기고, 규칙은 service.ts가 검사한다.
 * PDA 검수 액션(actions.ts)과 세션이 달라 따로 둔다.
 */
import { revalidatePath } from "next/cache";
import { getActor } from "@/server/session";
import type { ActionResult } from "@/server/action-result";
import * as svc from "@/server/rcv/service";

function refresh<T>(r: ActionResult<T>) {
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** 입고취소 역전표 (2026-11-12) — 3PL 관리자, 일마감 전 확정 실적 */
export async function reverseRcv(input: { rcvId: number; version: number; reasonCode: string; reasonText?: string }) {
  return refresh(await svc.reverseRcv(await getActor(), input));
}
