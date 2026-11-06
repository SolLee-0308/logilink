import "server-only";
/**
 * 입고예정 이미지 AI 판독 — 카카오톡·이메일로 받은 입고 지시 이미지를 읽어 라인 초안을 만든다.
 * 정의서 ① · D2: 판독 결과는 저장 전까지 초안. 품목은 마스터와 매칭되어야 저장된다.
 *
 * - ANTHROPIC_API_KEY가 있으면 Claude가 판독한다.
 * - 없으면 이 화주사의 품목으로 만든 "예시 판독"을 돌려준다 (화면 검수용, 결과에 예시라고 표시).
 *   API 키는 개발 단계를 모두 마친 뒤 발급한다 (대화 기록 01·05).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { CatalogItem } from "@/domain/plan-entry";
import { todayKst } from "@/lib/format";

export const AI_MODEL = "claude-opus-5-5";
export const EXAMPLE_MODEL = "example";

/** AI가 돌려주는 형식 — 원문을 그대로 남기고, 품목코드는 확실할 때만 */
const ReadSchema = z.object({
  lines: z.array(
    z.object({
      text: z.string().describe("이미지에 적힌 품목 표기 그대로 (품목명·규격·코드 등)"),
      itemCode: z.string().nullable().describe("아래 품목 목록에서 확실히 같은 품목일 때만 그 품목코드, 아니면 null"),
      qty: z.number().nullable().describe("수량 (정수). 읽을 수 없으면 null"),
      unit: z.string().nullable().describe("EA / BOX / PLT 중 하나. 표기가 없으면 null"),
      expiryDate: z.string().nullable().describe("소비기한 YYYY-MM-DD. 없으면 null"),
      lotNo: z.string().nullable().describe("로트 번호. 없으면 null"),
      confidence: z.number().describe("이 줄의 품목과 수량을 정확히 읽었다는 확신 0~1"),
    }),
  ),
  planDate: z.string().nullable().describe("이미지에 입고 예정일이 있으면 YYYY-MM-DD, 없으면 null"),
  note: z.string().nullable().describe("판독하면서 사람이 확인해야 할 점 (한국어 한두 문장), 없으면 null"),
});
export type AiReadResult = z.infer<typeof ReadSchema>;

export interface AiImage {
  name: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64: string;
}

const SYSTEM = [
  "당신은 3PL 물류센터의 입고예정 등록을 돕는 판독기입니다.",
  "화주사가 카카오톡·이메일로 보낸 입고 지시 이미지(거래명세서, 발주서, 메신저 캡처, 손글씨 메모 등)에서 입고할 품목과 수량을 줄 단위로 읽습니다.",
  "이미지에 실제로 적힌 줄만 돌려주고, 합계·소계·배송비 같은 줄은 빼세요. 없는 줄을 만들지 마세요.",
  "품목코드는 함께 주는 화주사 품목 목록(품목코드\t화주사 품목코드\t품목명\t단위)에서 확실히 같은 품목일 때만 첫 칸의 품목코드로 채우고, 조금이라도 애매하면 null로 두세요. 이미지에 적힌 코드가 화주사 품목코드와 같으면 그 줄의 품목코드를 쓰세요. 사람이 화면에서 직접 매칭합니다.",
  "글씨가 흐리거나 숫자가 겹쳐 수량을 확신하기 어려우면 confidence를 낮게 주세요.",
].join("\n");

function catalogText(items: CatalogItem[]) {
  // 품목이 아주 많으면 앞쪽 800개만 (나머지는 사람이 매칭)
  return items
    .slice(0, 800)
    .map((i) => `${i.code}\t${i.clientCode ?? ""}\t${i.name}\t${i.uoms.map((u) => u.unit).join("/")}`)
    .join("\n");
}

/** Claude 판독 — 실패하면 사용자에게 보여 줄 문장으로 돌려준다 */
async function readWithClaude(images: AiImage[], items: CatalogItem[]): Promise<{ ok: true; result: AiReadResult } | { ok: false; error: string }> {
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.parse(
      {
        model: AI_MODEL,
        max_tokens: 16000,
        // 안전 분류기가 판독을 거절하면 서버에서 다른 모델로 이어서 처리한다
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(ReadSchema) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
              {
                type: "text" as const,
                text: `오늘 날짜: ${todayKst()}\n\n화주사 품목 목록 (품목코드\\t품목명\\t단위):\n${catalogText(items)}\n\n위 이미지의 입고 품목과 수량을 읽어 주세요.`,
              },
            ],
          },
        ],
      },
      { timeout: 120_000 },
    );
    if (res.stop_reason === "refusal") return { ok: false, error: "이미지를 판독하지 못했습니다. 다른 이미지로 다시 시도하거나 직접 입력하세요." };
    if (res.stop_reason === "max_tokens" || !res.parsed_output) return { ok: false, error: "판독 결과가 너무 길거나 형식이 맞지 않습니다. 이미지를 나눠서 올려 보세요." };
    return { ok: true, result: res.parsed_output };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "AI 판독 API 키가 올바르지 않습니다. 관리자에게 문의하세요." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "AI 판독 요청이 많습니다. 잠시 후 다시 시도하세요." };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, error: "이미지를 읽을 수 없습니다. 파일 형식(JPG·PNG·WEBP)과 크기를 확인하세요." };
    if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.APIError) return { ok: false, error: "AI 판독 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요." };
    console.error(e);
    return { ok: false, error: "판독하지 못했습니다. 잠시 후 다시 시도하세요." };
  }
}

/**
 * 예시 판독 — API 키가 없을 때 화면 흐름을 확인하도록, 이 화주사의 품목으로 판독 결과처럼 만든다.
 * 정확히 매칭되는 줄·별칭/표기가 달라 직접 매칭할 줄·수량 신뢰도가 낮은 줄·마스터에 없는 신규 품목 줄을 섞는다.
 */
function exampleRead(items: CatalogItem[]): AiReadResult {
  const pick = items.slice(0, 4);
  const exp = new Date(`${todayKst()}T00:00:00Z`);
  exp.setUTCDate(exp.getUTCDate() + 180);
  const expiry = exp.toISOString().slice(0, 10);
  const unitOf = (i: CatalogItem) => (i.uoms.find((u) => u.unit !== i.baseUnit) ?? i.uoms[0])?.unit ?? null;
  const lines: AiReadResult["lines"] = pick.map((i, n) => ({
    // 두 번째 줄은 띄어쓰기·표기를 바꿔 이름으로는 매칭되지 않게 (후보에서 고르는 흐름)
    text: n === 1 ? `${i.name.replace(/\s+/g, "").slice(0, Math.max(2, i.name.length - 3))}(특)` : i.name,
    itemCode: n === 0 ? i.code : null,
    qty: [20, 12, 8, 30][n] ?? 10,
    unit: unitOf(i),
    expiryDate: i.expiryManaged ? expiry : null,
    lotNo: i.lotManaged ? `L${todayKst().replaceAll("-", "").slice(2)}-${n + 1}` : null,
    // 세 번째 줄은 수량을 흐리게 읽은 것으로
    confidence: n === 2 ? 0.55 : 0.95,
  }));
  lines.push({ text: "신상품 곤약젤리 사과맛 150ml", itemCode: null, qty: 40, unit: "BOX", expiryDate: null, lotNo: null, confidence: 0.9 });
  return {
    lines,
    planDate: null,
    note: "예시 판독 결과입니다. AI 판독 API 키가 설정되면 올린 이미지를 실제로 읽습니다.",
  };
}

export async function readPlanImages(images: AiImage[], items: CatalogItem[]) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true as const, result: exampleRead(items), model: EXAMPLE_MODEL, isExample: true };
  const r = await readWithClaude(images, items);
  return r.ok ? { ok: true as const, result: r.result, model: AI_MODEL, isExample: false } : r;
}
