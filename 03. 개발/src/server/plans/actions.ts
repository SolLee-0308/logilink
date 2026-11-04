"use server";

/**
 * 입고예정 서버 액션 — 로그인 사용자를 처리자로 넘기고, 규칙은 service.ts가 검사한다.
 * 3PL 승인·반려는 상세를 열어 본 건만 단건으로 처리한다 (일괄 처리 액션은 두지 않는다).
 */
import { revalidatePath } from "next/cache";
import { getActor } from "@/server/session";
import { db } from "@/server/db";
import { fail, type ActionResult } from "@/server/action-result";
import { getPlanDetail, searchClients, type ClientPick } from "@/server/plans/queries";
import { catalogOf, findExactItem, previewPlanExcel as previewExcel, referencedItems, searchCatalog } from "@/server/plans/entry";
import { readPlanImages as readImages, type AiImage } from "@/server/plans/ai-read";
import * as svc from "@/server/plans/service";
import { can } from "@/domain/permissions";
import { AI_MAX_IMAGES, buildIndex, toDraftLine, type CatalogItem, type DraftLine } from "@/domain/plan-entry";
import { STORAGE_TEMPS, type ItemUnit, type StorageTemp } from "@/domain/master";
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

/** 승인 대기 조회조건 — 화주사 찾기 (50개씩) */
export async function searchApprovalClients(input: { q: string; offset?: number }): Promise<ActionResult<{ items: ClientPick[]; total: number }>> {
  const me = await getActor();
  if (!can(me.roles, "approval", "view")) return fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");
  return { ok: true, message: "", data: await searchClients(me, { q: String(input.q ?? ""), offset: Number(input.offset) || 0 }) };
}

export async function approvePlan(input: { id: number; version: number }) {
  return refresh(await svc.approvePlan(await getActor(), input));
}

export async function rejectPlan(input: { id: number; version: number; reasonCode: string; reasonText?: string }) {
  return refresh(await svc.rejectPlan(await getActor(), input));
}

/* ═════════ 화주사 — 입고예정 등록 (승인 전(승인대기·반려)만 수정·취소) ═════════ */

async function entryActor() {
  const me = await getActor();
  return can(me.roles, "planEntry", "edit") && me.clientId ? me : null;
}
const noEntry = () => fail("FORBIDDEN", "이 작업을 할 권한이 없습니다.");

/**
 * 저장 — AI 판독으로 만든 초안이면 판독 작업에 저장한 입고예정과 최종 라인을 남긴다
 * (정의서 ①: AI 원본 결과와 사용자 수정 내용 보존)
 */
export async function savePlan(input: svc.SavePlanInput, aiReadId?: number) {
  const me = await getActor();
  const r = await svc.savePlan(me, input);
  if (r.ok && r.data && aiReadId && me.clientId) {
    await db.planAiRead.updateMany({
      where: { id: aiReadId, clientId: me.clientId, planId: null },
      data: { planId: r.data.id, finalLines: input.lines, savedAt: new Date() },
    });
  }
  return refresh(r);
}

const XLSX_TYPES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", ""];

/** 엑셀 업로드 → 초안 라인 (저장하지 않음) */
/** 품목 찾기 — 품목코드·품목명·바코드·별칭 검색, 온도대·최근 입고 품목, 한 쪽 50개 */
export async function searchPlanItems(input: { q: string; temp?: string | null; recent?: boolean; offset?: number }): Promise<ActionResult<{ items: CatalogItem[]; total: number }>> {
  const me = await entryActor();
  if (!me) return noEntry();
  const temp = (STORAGE_TEMPS as readonly string[]).includes(input.temp ?? "") ? (input.temp as StorageTemp) : null;
  const r = await searchCatalog(me.clientId!, { q: String(input.q ?? ""), temp, recent: !!input.recent, offset: Number(input.offset) || 0 });
  return { ok: true, message: "", data: r };
}

/** 빠른 입력 — 품목코드·바코드가 정확히 같은 품목 (바코드 스캐너 입력 포함) */
export async function findPlanItem(text: string): Promise<ActionResult<{ item: CatalogItem; unit: ItemUnit | null } | null>> {
  const me = await entryActor();
  if (!me) return noEntry();
  return { ok: true, message: "", data: await findExactItem(me.clientId!, String(text ?? "").slice(0, 60)) };
}

export async function previewPlanExcel(form: FormData): Promise<ActionResult<{ lines: DraftLine[]; items: CatalogItem[]; fileName: string }>> {
  const me = await entryActor();
  if (!me) return noEntry();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return fail("VALIDATION", "엑셀 파일을 고르세요.", { file: "엑셀 파일을 고르세요." });
  if (!/\.xlsx$/i.test(file.name) || !XLSX_TYPES.includes(file.type)) return fail("VALIDATION", ".xlsx 엑셀 파일만 올릴 수 있습니다.", { file: ".xlsx 엑셀 파일만 올릴 수 있습니다." });
  if (file.size > 5 * 1024 * 1024) return fail("VALIDATION", "파일이 너무 큽니다 (최대 5MB).", { file: "파일이 너무 큽니다 (최대 5MB)." });
  const r = await previewExcel(me.clientId!, await file.arrayBuffer());
  if (!r.ok) return fail("VALIDATION", r.error);
  return { ok: true, message: `${r.lines.length}행을 읽었습니다. 확인 필요 표시가 있는 행을 고친 뒤 저장하세요.`, data: { lines: r.lines, items: r.items, fileName: file.name } };
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** 이미지 AI 판독 → 판독 작업 기록 + 초안 라인 (입고예정은 아직 저장하지 않음) */
export async function readPlanImages(form: FormData): Promise<
  ActionResult<{ aiReadId: number; lines: DraftLine[]; items: CatalogItem[]; isExample: boolean; note: string | null; planDate: string | null }>
> {
  const me = await entryActor();
  if (!me) return noEntry();
  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return fail("VALIDATION", "판독할 이미지를 올리세요.", { images: "판독할 이미지를 올리세요." });
  if (files.length > AI_MAX_IMAGES) return fail("VALIDATION", `이미지는 한 번에 ${AI_MAX_IMAGES}장까지 올릴 수 있습니다.`, { images: `이미지는 한 번에 ${AI_MAX_IMAGES}장까지 올릴 수 있습니다.` });
  const images: AiImage[] = [];
  for (const f of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return fail("VALIDATION", "JPG·PNG·WEBP 이미지만 올릴 수 있습니다.", { images: "JPG·PNG·WEBP 이미지만 올릴 수 있습니다." });
    if (f.size > 4 * 1024 * 1024) return fail("VALIDATION", `${f.name}이(가) 너무 큽니다 (최대 4MB).`, { images: `${f.name}이(가) 너무 큽니다 (최대 4MB).` });
    images.push({ name: f.name, mediaType: f.type as AiImage["mediaType"], base64: Buffer.from(await f.arrayBuffer()).toString("base64") });
  }
  const items = await catalogOf(me.clientId!);
  const r = await readImages(images, items);
  if (!r.ok) return fail("ERROR", r.error);
  const job = await db.planAiRead.create({
    data: { clientId: me.clientId!, fileNames: images.map((i) => i.name), model: r.model, isExample: r.isExample, rawResult: r.result, createdBy: me.name },
  });
  const idx = buildIndex(items);
  const lines = r.result.lines.map((l, i) =>
    toDraftLine(idx, {
      origin: `판독 ${i + 1}번째 줄`,
      name: l.text,
      aiCode: l.itemCode,
      unit: l.unit,
      qty: l.qty,
      expiry: l.expiryDate,
      lot: l.lotNo,
      confidence: l.confidence,
    }),
  );
  return {
    ok: true,
    message: `${lines.length}줄을 판독했습니다. 원본 이미지와 대조해 확인 필요 줄을 고친 뒤 저장하세요.`,
    data: { aiReadId: job.id, lines, items: referencedItems(idx, lines), isExample: r.isExample, note: r.result.note, planDate: r.result.planDate },
  };
}

export async function cancelPlan(input: { id: number; version: number; reasonCode: string; reasonText?: string }) {
  return refresh(await svc.cancelPlanByShipper(await getActor(), input));
}
