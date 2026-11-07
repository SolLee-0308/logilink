import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 개발 표시(N 배지)가 사이드바 사용자 카드를 가리므로 끈다
  devIndicators: false,
  // 개발 서버(npm run dev -- -H 0.0.0.0)를 같은 사내망의 다른 PC에서 볼 때 허용할 주소 (사설망 대역만)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // 배포 파일 추적 기준을 이 폴더로 고정한다. Vercel이 저장소 최상위를 기준으로 잡으면 서버 함수 이름에
  // 폴더명 '03. 개발/'(공백 포함)이 붙어 배포가 거부된다 (2026-11-07)
  outputFileTracingRoot: process.cwd(),
  experimental: {
    // 품목 엑셀 일괄 등록 파일 업로드 (최대 1,000행 — 보통 100KB 안팎)
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
