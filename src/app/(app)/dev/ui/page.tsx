import type { Metadata } from "next";
import { UiCatalog } from "./UiCatalog";

export const metadata: Metadata = { title: "공통 컴포넌트", robots: { index: false } };

/** 개발용 — 공통 컴포넌트 확인 페이지 (메뉴에 넣지 않음) */
export default function DevUiPage() {
  return <UiCatalog />;
}
