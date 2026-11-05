import type { Metadata, Viewport } from "next";
import { PdaFrame } from "@/features/pda/PdaFrame";

export const metadata: Metadata = { title: { default: "PDA", template: "%s · LogiLink PDA" } };
/** PDA·휴대폰 화면 — 확대 없이 기기 폭에 맞춘다 */
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#161616" };

/** PDA 화면 틀 — Web 메뉴·사이드바 없이 한 손으로 쓰는 세로 화면. 넓은 화면(시연)에서는 PDA 테두리 안에 보인다 (로그인 포함) */
export default function PdaLayout({ children }: { children: React.ReactNode }) {
  return <PdaFrame>{children}</PdaFrame>;
}
