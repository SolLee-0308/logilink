"use server";

/**
 * ASN 서버 액션 — 로그인 사용자를 처리자로 넘기고, 규칙은 service.ts가 검사한다.
 */
import { revalidatePath } from "next/cache";
import { getActor } from "@/server/session";
import { fail, type ActionResult } from "@/server/action-result";
import * as svc from "@/server/asn/service";
import { asnOptions } from "@/server/asn/queries";
import type { AsnOptions } from "@/features/asn/types";

function refresh<T>(r: ActionResult<T>) {
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function createAsn(input: svc.CreateAsnInput) {
  return refresh(await svc.createAsn(await getActor(), input));
}

export async function cancelAsn(input: { id: number; version: number; reasonCode: string; reasonText?: string }) {
  return refresh(await svc.cancelAsn(await getActor(), input));
}

/** 남은 수량 다시 불러오기 — 저장 중 다른 ASN과 겹쳤을 때 */
export async function reloadAsnOptions(): Promise<ActionResult<AsnOptions>> {
  const o = await asnOptions(await getActor());
  return o ? { ok: true, message: "", data: o } : fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
}
