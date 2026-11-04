/**
 * 목업 — 로그인 사용자·센터 (인증 연동 전 임시 값)
 * 인증을 붙이면 세션에서 읽도록 이 파일만 교체한다.
 */
export interface MockSession {
  userName: string;
  roleLabel: string;
  centerName: string;
  orgType: string;
}

export const mockSession: MockSession = {
  userName: "김하늘",
  roleLabel: "3PL 운영담당",
  centerName: "용인1센터",
  orgType: "3PL",
};
