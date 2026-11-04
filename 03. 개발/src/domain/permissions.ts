/**
 * 역할별 권한 — 화면 숨김과 서버 검사가 이 표 하나를 같이 본다.
 * 적용 범위(2026-11-03): 회사 정보·센터·화주사·사용자·역할·계정 관리(잠금 해제·비밀번호 초기화).
 * 나머지 기준정보 메뉴는 Sol이 권한 매트릭스를 정한 뒤 반영한다 (지금은 Web 역할 모두 기존처럼 사용).
 */
import { ROLE_META, type UserRole } from "./master";

export type Resource = "company" | "centers" | "clients" | "users" | "accounts" | "master" | "approval" | "planEntry";
export type Op = "view" | "edit";

/** 3PL 관리자는 3PL 운영담당 권한을 모두 포함한다 */
const MATRIX: Record<Resource, Record<Op, readonly UserRole[]>> = {
  company: { view: ["TPL_ADMIN", "TPL_OPERATOR"], edit: ["TPL_ADMIN"] },
  centers: { view: ["TPL_ADMIN", "TPL_OPERATOR"], edit: ["TPL_ADMIN"] },
  // 화주사: 화주사 계정에는 메뉴 비노출, 등록·수정은 3PL 관리자만 (화주사 개편 5장)
  clients: { view: ["TPL_ADMIN", "TPL_OPERATOR"], edit: ["TPL_ADMIN"] },
  // 사용자·역할: 등록·수정 버튼은 3PL 관리자만 (같은 기준). 화주사 계정은 자기 화주사 사용자 조회만
  users: { view: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"], edit: ["TPL_ADMIN"] },
  accounts: { view: ["TPL_ADMIN"], edit: ["TPL_ADMIN"] },
  // 승인 대기: 3PL 관리자·운영담당만 (화주사 메뉴 비노출). 승인·반려는 상세를 보고 단건만
  approval: { view: ["TPL_ADMIN", "TPL_OPERATOR"], edit: ["TPL_ADMIN", "TPL_OPERATOR"] },
  // 입고예정 등록·수정·취소: 화주사 담당자 (승인 전 상태만 — plan-rules.ts)
  planEntry: { view: ["SHIPPER_STAFF"], edit: ["SHIPPER_STAFF"] },
  // 그 외 기준정보 — 기존 유지 (매트릭스 확정 전)
  master: { view: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"], edit: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"] },
};

export function can(role: UserRole, resource: Resource, op: Op) {
  return MATRIX[resource][op].includes(role);
}

/** Web 로그인 가능한 역할 (PDA 전용 역할은 차단) */
export const isWebRole = (role: UserRole) => ROLE_META[role].channel === "Web";

export const isShipperRole = (role: UserRole) => ROLE_META[role].org === "SHIPPER";

/** 메뉴 경로 → 권한 대상 */
export function resourceOfPath(href: string): Resource {
  if (href.startsWith("/master/company")) return "company";
  if (href.startsWith("/master/centers")) return "centers";
  if (href.startsWith("/master/clients")) return "clients";
  if (href.startsWith("/master/users")) return "users";
  if (href.startsWith("/plans/approval")) return "approval";
  return "master";
}
