"use server";

/**
 * 상차등록 서버 액션 (PDA) — 로그인한 PDA 사용자를 처리자로 넘기고, 규칙은 service.ts가 검사한다.
 */
import { revalidatePath } from "next/cache";
import { getPdaActor } from "@/server/session";
import { fail, type ActionResult } from "@/server/action-result";
import * as svc from "@/server/loads/service";
import { getPdaLoad } from "@/server/loads/queries";
import type { LoadView } from "@/features/loads/types";

function refresh<T>(r: ActionResult<T>) {
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function startOrderedLoad(input: { orderNo: string }) {
  return refresh(await svc.startOrderedLoad(await getPdaActor(), input));
}

export async function startUnorderedLoad(input: { centerId: number; vehicleNo: string; force?: boolean }) {
  return refresh(await svc.startUnorderedLoad(await getPdaActor(), input));
}

export async function previewScan(input: { loadId: number; scan: string }) {
  return svc.previewScan(await getPdaActor(), input);
}

export async function addLoadInput(input: svc.AddInput) {
  return refresh(await svc.addLoadInput(await getPdaActor(), input));
}

export async function cancelLoadInput(input: { inputId: number }) {
  return refresh(await svc.cancelLoadInput(await getPdaActor(), input));
}

export async function correctLoadInput(input: { inputId: number; qty: number; confirm?: boolean; deviceId?: string | null }) {
  return refresh(await svc.correctLoadInput(await getPdaActor(), input));
}

export async function reopenLoad(input: svc.ReopenInput) {
  return refresh(await svc.reopenLoad(await getPdaActor(), input));
}

export async function completeLoad(input: svc.CompleteInput) {
  return refresh(await svc.completeLoad(await getPdaActor(), input));
}

/** 다른 작업자 입력을 반영한 최신 합계 — PDA 화면이 몇 초마다 부른다 */
export async function reloadLoad(id: number): Promise<ActionResult<LoadView>> {
  const v = await getPdaLoad(await getPdaActor(), id);
  return v ? { ok: true, message: "", data: v } : fail("NOT_FOUND", "상차 실적을 찾을 수 없습니다.");
}

/** 출차 (2026-11-12 Sol) — 상차완료 화면의 [출차] */
export async function departLoad(input: { loadId: number }) {
  return refresh(await svc.departLoad(await getPdaActor(), input));
}
