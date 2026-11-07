"use server";

/**
 * 입고검수 서버 액션 (PDA) — 로그인한 PDA 사용자를 처리자로 넘기고, 규칙은 service.ts가 검사한다.
 */
import { revalidatePath } from "next/cache";
import { getPdaActor } from "@/server/session";
import { fail, type ActionResult } from "@/server/action-result";
import * as svc from "@/server/rcv/service";
import { getPdaRcv } from "@/server/rcv/queries";
import type { RcvView } from "@/features/rcv/types";

function refresh<T>(r: ActionResult<T>) {
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function startRcv(input: { code?: string; loadId?: number }) {
  return refresh(await svc.startRcv(await getPdaActor(), input));
}

export async function previewRcvScan(input: { rcvId: number; scan: string }) {
  return svc.previewRcvScan(await getPdaActor(), input);
}

export async function addRcvInput(input: svc.RcvAddInput) {
  return svc.addRcvInput(await getPdaActor(), input);
}

export async function cancelRcvInput(input: { inputId: number }) {
  return svc.cancelRcvInput(await getPdaActor(), input);
}

export async function correctRcvInput(input: { inputId: number; qty: number; deviceId?: string | null }) {
  return svc.correctRcvInput(await getPdaActor(), input);
}

export async function setRcvZero(input: { rcvId: number; itemId: number; on: boolean }) {
  return svc.setRcvZero(await getPdaActor(), input);
}

export async function setRcvLineInfo(input: Parameters<typeof svc.setRcvLineInfo>[1]) {
  return svc.setRcvLineInfo(await getPdaActor(), input);
}

export async function addRcvImage(input: { rcvId: number; itemId: number; mime: string; base64: string }) {
  return svc.addRcvImage(await getPdaActor(), input);
}

export async function deleteRcvImage(input: { imageId: number }) {
  return svc.deleteRcvImage(await getPdaActor(), input);
}

export async function confirmRcv(input: svc.ConfirmRcvInput) {
  return refresh(await svc.confirmRcv(await getPdaActor(), input));
}

/** 다른 검수자 입력 반영 — 화면이 몇 초마다 부른다 */
export async function reloadRcv(id: number): Promise<ActionResult<RcvView>> {
  const v = await getPdaRcv(await getPdaActor(), id);
  return v ? { ok: true, message: "", data: v } : fail("NOT_FOUND", "검수 건을 찾을 수 없습니다.");
}
