/**
 * 화주사 코드 — 영문 대문자 2자 + 순번 2자 (예: DO01)
 * 근거: 98. 프롬프트/02. VS코드_프롬프트_화주사.md 3장
 * 화면(자동 추천)과 서버(검증·순번 확정)가 함께 쓰는 순수 함수만 둔다.
 */

export const CLIENT_CODE_PATTERN = /^[A-Z]{2}(0[1-9]|[1-9]\d)$/;
export const CLIENT_PREFIX_PATTERN = /^[A-Z]{2}$/;
export const MAX_CLIENT_SERIAL = 99;
export const PREFIX_EXHAUSTED_MSG = "이 약어는 더 이상 쓸 수 없습니다. 다른 약어를 입력하세요.";

/** 법인 표기 제거 대상 */
const CORP_MARKS = [/\(주\)/g, /㈜/g, /주식회사/g, /\(유\)/g, /유한회사/g];

/** 초성 → 로마자 첫 글자 (ㅇ은 중성으로 결정) */
const CHO = ["G", "K", "N", "D", "T", "R", "M", "B", "P", "S", "S", "", "J", "J", "C", "K", "T", "P", "H"];
/** 중성(초성 ㅇ일 때): ㅏㅐ A / ㅓㅔㅡㅢ E / ㅗㅚ O / ㅜ U / ㅣ I / ㅑㅒㅕㅖㅛㅠ Y / ㅘㅙㅝㅞㅟ W */
const JUNG = ["A", "A", "Y", "Y", "E", "E", "Y", "Y", "O", "W", "W", "O", "Y", "U", "W", "W", "W", "Y", "E", "E", "I"];

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 한글 음절 1자 → 영문 1자 */
export function hangulInitial(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return "";
  const idx = code - HANGUL_START;
  const cho = Math.floor(idx / 588);
  const jung = Math.floor((idx % 588) / 28);
  return CHO[cho] || JUNG[jung];
}

/** 법인 표기 제거 (공백은 단어 구분에 쓰므로 여기서는 남긴다) */
export function stripCorpMarks(name: string) {
  return CORP_MARKS.reduce((s, re) => s.replace(re, " "), name).trim();
}

/**
 * 화주사명 → 영문 2자 추천
 * 1) 법인 표기·공백 제거
 * 2) 영문 단어 여러 개로 된 이름이면 각 단어의 첫 글자
 * 3) 그 밖에는 앞에서부터 글자마다: 한글 → 초성(ㅇ이면 중성) 로마자, 영문 → 대문자, 숫자·기호 → 건너뜀
 * 2자를 만들지 못하면 만든 만큼만 돌려준다 (화면에서 직접 입력)
 */
export function suggestClientPrefix(name: string): string {
  const words = stripCorpMarks(name).split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => /^[A-Za-z][A-Za-z0-9&.'-]*$/.test(w))) {
    return words
      .map((w) => w[0].toUpperCase())
      .join("")
      .slice(0, 2);
  }
  let out = "";
  for (const ch of words.join("")) {
    if (out.length === 2) break;
    if (/[A-Za-z]/.test(ch)) out += ch.toUpperCase();
    else out += hangulInitial(ch);
  }
  return out;
}

/** 약어 + 순번 → 코드 (DO + 2 → DO02) */
export const composeClientCode = (prefix: string, serial: number) => `${prefix}${String(serial).padStart(2, "0")}`;

/** 같은 약어로 이미 쓴 코드들 → 다음 순번 (사용 안 함 포함, 한 번 쓴 번호는 재사용하지 않으므로 최댓값 + 1). 99를 넘으면 null */
export function nextClientSerial(prefix: string, usedCodes: string[]): number | null {
  let max = 0;
  for (const c of usedCodes) {
    if (c.startsWith(prefix) && CLIENT_CODE_PATTERN.test(c)) max = Math.max(max, Number(c.slice(2)));
  }
  return max >= MAX_CLIENT_SERIAL ? null : max + 1;
}
