/**
 * 단말 구분값 — 상차 입력 행에 device_id로 남긴다 (단말 목록·차단은 보류, 미확정 H2).
 * 브라우저마다 한 번 만들어 저장해 두고, 저장소를 못 쓰면 화면을 여는 동안만 쓰는 값을 만든다.
 */
const KEY = "logilink:pda:device";
let memo: string | null = null;

export function deviceId(): string {
  if (memo) return memo;
  const make = () => `PDA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    memo = localStorage.getItem(KEY) ?? make();
    localStorage.setItem(KEY, memo);
  } catch {
    memo = make();
  }
  return memo;
}

/** 첫 화면 → 작업 화면으로 넘길 안내 문장 (출고일이 오늘이 아님 등) */
export const NOTICE_KEY = "logilink:pda:notice";
export function passNotice(text?: string) {
  try {
    if (text) sessionStorage.setItem(NOTICE_KEY, text);
    else sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    /* 안내를 못 넘기면 생략 */
  }
}
export function takeNotice(): string | null {
  try {
    const t = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return t;
  } catch {
    return null;
  }
}
