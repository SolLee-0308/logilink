import "server-only";

/**
 * 공공데이터포털 — 한국천문연구원 특일 정보 (공휴일 정보 조회 getRestDeInfo)
 * https://www.data.go.kr/data/15012690/openapi.do
 * 서비스 키: .env의 DATA_GO_KR_SERVICE_KEY (포털의 "일반 인증키" — Encoding·Decoding 어느 쪽이든 된다)
 */
const ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

export interface PublicHoliday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
}

export type PublicHolidayResult = { ok: true; rows: PublicHoliday[] } | { ok: false; error: string };

interface ApiItem {
  dateName?: string;
  isHoliday?: string;
  locdate?: number | string;
}

/** 키가 이미 URL 인코딩된(Encoding) 키면 그대로, 아니면(Decoding) 인코딩해서 붙인다 */
function encodeKey(key: string) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

export async function fetchPublicHolidays(year: number): Promise<PublicHolidayResult> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!key)
    return {
      ok: false,
      error: "공공데이터 서비스 키가 없습니다. 공공데이터포털에서 '한국천문연구원_특일 정보' 활용 신청 후 .env에 DATA_GO_KR_SERVICE_KEY를 넣어 주세요.",
    };

  const url = `${ENDPOINT}?serviceKey=${encodeKey(key)}&solYear=${year}&numOfRows=100&pageNo=1&_type=json`;
  let text: string;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    text = await res.text();
    if (!res.ok) return { ok: false, error: `공공데이터 서버가 응답하지 않습니다 (HTTP ${res.status}). 잠시 후 다시 시도하세요.` };
  } catch {
    return { ok: false, error: "공공데이터 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요." };
  }

  // 키 오류 등은 JSON이 아니라 XML(OpenAPI_ServiceResponse)로 온다
  if (!text.trimStart().startsWith("{")) {
    const msg = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1] ?? text.match(/<resultMsg>([^<]+)<\/resultMsg>/)?.[1];
    return { ok: false, error: `공공데이터 조회에 실패했습니다${msg ? ` (${msg})` : ""}. 서비스 키와 활용 신청 상태를 확인하세요.` };
  }

  try {
    const body = JSON.parse(text)?.response;
    const code = body?.header?.resultCode;
    if (code !== "00" && code !== "0000") return { ok: false, error: `공공데이터 조회에 실패했습니다 (${body?.header?.resultMsg ?? code}).` };
    const raw = body?.body?.items?.item;
    // 결과가 1건이면 배열이 아닌 객체, 0건이면 빈 문자열로 온다
    const items: ApiItem[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const rows = items
      .filter((i) => i.isHoliday === "Y" && i.locdate && i.dateName)
      .map((i) => {
        const d = String(i.locdate);
        return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: String(i.dateName).trim().slice(0, 100) };
      });
    return { ok: true, rows };
  } catch {
    return { ok: false, error: "공공데이터 응답을 읽지 못했습니다. 잠시 후 다시 시도하세요." };
  }
}
