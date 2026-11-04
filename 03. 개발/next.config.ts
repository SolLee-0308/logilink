import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 개발 표시(N 배지)가 사이드바 사용자 카드를 가리므로 끈다
  devIndicators: false,
};

export default nextConfig;
