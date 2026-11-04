import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 개발 표시(N 배지)가 사이드바 사용자 카드를 가리므로 끈다
  devIndicators: false,
  // 개발 서버(npm run dev -- -H 0.0.0.0)를 같은 사내망의 다른 PC에서 볼 때 허용할 주소 (사설망 대역만)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  experimental: {
    // 품목 엑셀 일괄 등록 파일 업로드 (최대 1,000행 — 보통 100KB 안팎)
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
