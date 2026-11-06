/**
 * 품목코드 시스템 채번 (2026-11-06 Sol 결정)
 * 형식: {화주사코드}-{순번 5자리} 예) HB01-00001. 화주사마다 1부터, 쓴 적 있는 가장 큰 번호 다음.
 * 화주사 품목코드(화주사 자체 코드)는 따로 두고 엑셀·AI 판독 매칭에 쓴다.
 */
export const ITEM_SERIAL_DIGITS = 5;
export const ITEM_SERIAL_MAX = 10 ** ITEM_SERIAL_DIGITS - 1;

export const composeItemCode = (clientCode: string, serial: number) => `${clientCode}-${String(serial).padStart(ITEM_SERIAL_DIGITS, "0")}`;

/** 이미 쓴 품목코드들 중 이 화주사 형식의 가장 큰 순번 + 1 (형식이 다른 코드는 무시) */
export function nextItemSerial(clientCode: string, used: string[]): number {
  const prefix = `${clientCode}-`;
  const digits = new RegExp(`^\\d{${ITEM_SERIAL_DIGITS}}$`);
  let max = 0;
  for (const c of used) {
    if (!c.startsWith(prefix)) continue;
    const tail = c.slice(prefix.length);
    if (digits.test(tail)) max = Math.max(max, Number(tail));
  }
  return max + 1;
}

/** 화주사 품목코드 입력값 정리 — 앞뒤 공백 제거, 비우면 null */
export const cleanClientCode = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};
