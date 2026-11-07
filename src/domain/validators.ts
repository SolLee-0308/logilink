/**
 * 입력 검증 공통 규칙 — 화면과 서버(서버 액션)가 같은 함수를 쓴다.
 * 근거: 98. 프롬프트/01. 261103 회사정보·센터관리 1-4
 */

export const MSG = {
  bizNo: "올바른 사업자등록번호가 아닙니다",
  bizNoLen: "사업자등록번호 숫자 10자리를 입력하세요",
  bizNoCheck: "검증 숫자가 맞지 않습니다. 사업자등록증의 번호를 다시 확인하세요",
  phone: "전화번호 형식을 확인하세요",
  email: "이메일 형식을 확인하세요",
  addrSearch: "주소를 검색해 선택하세요",
  addrDetail: "상세주소를 입력하세요",
} as const;

const digits = (s: string) => s.replace(/\D/g, "");

/* ───── 사업자등록번호 ───── */

/** 입력 중 하이픈 자동 (3-2-5) */
export function formatBizNo(v: string) {
  const d = digits(v).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** 숫자 10자리 + 국세청 체크섬 */
export function isValidBizNo(v: string) {
  const d = digits(v);
  if (d.length !== 10) return false;
  const n = [...d].map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * w[i];
  sum += Math.floor((n[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}

/** 사업자등록번호 오류 문구 — 자릿수 부족과 검증 숫자 불일치를 나눠 안내. 정상이면 null */
export function bizNoError(v: string): string | null {
  if (digits(v).length !== 10) return MSG.bizNoLen;
  return isValidBizNo(v) ? null : MSG.bizNoCheck;
}

/* ───── 전화번호 ───── */

/** 대표번호 15xx·16xx·18xx (8자리) */
const isRepNumber = (d: string) => /^1[568]\d{6}$/.test(d);

/** 숫자 9~11자리(0으로 시작) 또는 대표번호 8자리 */
export function isValidPhone(v: string) {
  const d = digits(v);
  return isRepNumber(d) || /^0\d{8,10}$/.test(d);
}

/** 입력 중 하이픈 자동: 02-123-4567 / 031-123-4567 / 010-1234-5678 / 1588-1234 */
export function formatPhone(v: string) {
  const d = digits(v).slice(0, 11);
  if (/^1[568]/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `02-${d.slice(2)}`;
    if (d.length <= 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    return `02-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/* ───── 이메일·시각 ───── */

export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** 24시간 HH:mm */
export const isValidTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/* ───── 주소 (우편번호·기본주소는 검색으로만 입력) ───── */

export interface AddressValue {
  zipCode: string;
  addr1: string;
  addr2: string;
}

export function addressErrors(a: AddressValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!/^\d{5}$/.test(a.zipCode) || !a.addr1.trim()) e.addr1 = MSG.addrSearch;
  if (!a.addr2.trim()) e.addr2 = MSG.addrDetail;
  else if (a.addr2.trim().length > 100) e.addr2 = "상세주소는 100자 이내로 입력하세요";
  return e;
}

/* ───── 비밀번호 ───── */

export const PASSWORD_RULE_TEXT = "8자 이상 영문·숫자·특수문자 3종 조합, 또는 10자 이상 2종 조합";

/** 8자 이상 3종(영문·숫자·특수문자) 또는 10자 이상 2종 */
export function isValidPassword(pw: string) {
  if (pw.length > 64 || /\s/.test(pw)) return false;
  const kinds = [/[A-Za-z]/, /\d/, /[^A-Za-z\d]/].filter((r) => r.test(pw)).length;
  return (pw.length >= 8 && kinds === 3) || (pw.length >= 10 && kinds >= 2);
}

/* ───── 텍스트 길이 ───── */

export function textError(v: string, label: string, max: number, required = true) {
  const t = v.trim();
  if (!t) return required ? `${label}을(를) 입력하세요` : null;
  if (t.length > max) return `${label}은(는) ${max}자 이내로 입력하세요`;
  return null;
}
