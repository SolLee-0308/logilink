import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: { default: "PDA", template: "%s · LogiLink PDA" } };
/** PDA·휴대폰 화면 — 확대 없이 기기 폭에 맞춘다 */
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#161616" };

/** PDA 화면 틀 — Web 메뉴·사이드바 없이 한 손으로 쓰는 세로 화면 */
export default function PdaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
