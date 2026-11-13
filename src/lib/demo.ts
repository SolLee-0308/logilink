import type { UserRole } from "@/domain/master";
import { isShipperRole } from "@/domain/permissions";

/**
 * 시연 사이트인지 — 시연 사이트는 Vercel에만 배포하므로 Vercel이 넣어 주는 VERCEL=1로 판단한다.
 * 다른 곳에서 시연 모드로 띄우려면 DEMO_SITE=1. 서버에서만 부른다(브라우저에는 이 값이 없다).
 */
export const isDemoSite = () => process.env.DEMO_SITE === "1" || process.env.VERCEL === "1";

/**
 * 대시보드를 열 수 있는지 (2026-11-13 Sol: 시연 링크에서는 대시보드를 막고 "준비 중입니다."를 보여 준다).
 * 대시보드 작업은 모든 메뉴가 나온 뒤에 하기로 했다 — 그때 이 값을 true로 돌린다.
 */
export const dashboardReady = () => !isDemoSite();

/** 대시보드를 못 열 때 웹 로그인 후 첫 화면 — 화주사: 입고예정 등록 / 3PL: 승인 대기 */
export const webWorkHome = (roles: readonly UserRole[]) => (isShipperRole(roles) ? "/plans/entry" : "/plans/approval");

/** 대시보드를 못 열 때 PDA 로그인 후 첫 화면 — 상차담당: 상차등록 / 입고검수자: 입고검수 */
export const pdaWorkHome = (roles: readonly UserRole[]) => (roles.includes("SHIPPER_LOADER") ? "/pda" : "/pda/inspect");
