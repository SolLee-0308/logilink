/** 날짜·시간 표시 — 서버·브라우저 모두 한국 시간으로 같은 결과가 나오게 시간대를 고정한다 */
const TZ = "Asia/Seoul";

const dtFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 2026-11-02 09:12 */
export function fmtDateTime(iso: string | Date | null | undefined) {
  if (!iso) return "";
  return dtFmt.format(typeof iso === "string" ? new Date(iso) : iso).replace("T", " ");
}

/** 11-02 09:12 (목록용 짧은 표기) */
export function fmtShortDateTime(iso: string | Date | null | undefined) {
  return fmtDateTime(iso).slice(5);
}

/** 대소문자·공백 무시 검색 */
export function includesText(haystack: (string | null | undefined)[], q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return haystack.some((h) => h?.toLowerCase().includes(n));
}

/** 한국 시간 기준 오늘 (YYYY-MM-DD) */
export const todayKst = (now: Date = new Date()) => fmtDateTime(now).slice(0, 10);

/** 한국 시간 하루의 시작·끝 (UTC Date) — "오늘 처리" 조회용 */
export function kstDayRange(ymd: string) {
  const start = new Date(`${ymd}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
