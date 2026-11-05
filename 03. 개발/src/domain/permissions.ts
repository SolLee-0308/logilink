/**
 * 역할별 권한 — 화면 숨김과 서버 검사가 이 표 하나를 같이 본다.
 * 적용 범위(2026-11-03): 회사 정보·센터·화주사·사용자·역할·계정 관리(잠금 해제·비밀번호 초기화).
 * 2026-11-04: 품목·품목 등록 요청·휴무일 추가. 같은 날 ASN 등록 추가. 2026-11-05: 상차등록(PDA) 추가. 사용자는 역할을 여러 개 가질 수 있다(roles 배열).
 * 나머지 기준정보 메뉴는 Sol이 권한 매트릭스를 정한 뒤 반영한다 (지금은 Web 역할 모두 기존처럼 사용).
 */
import { ROLE_META, type UserRole } from "./master";

export type Resource =
  | "company"
  | "centers"
  | "clients"
  | "users"
  | "accounts"
  | "items"
  | "itemRequests"
  | "holidays"
  | "master"
  | "approval"
  | "planEntry"
  | "asn"
  | "asnStatus"
  | "loading";
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
  // 품목: 등록·수정은 3PL만. 화주사는 자기 품목 조회 + 등록 요청(itemRequests) (2026-11-04 Sol: U6 요청 → 3PL 검토)
  items: { view: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"], edit: ["TPL_ADMIN", "TPL_OPERATOR"] },
  // 품목 등록 요청: 화주사 담당자가 요청(edit), 3PL이 검토·등록·반려(itemReview)
  itemRequests: { view: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"], edit: ["SHIPPER_STAFF"] },
  // 휴무일: 센터 운영 정보라 3PL만 등록·삭제
  holidays: { view: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"], edit: ["TPL_ADMIN", "TPL_OPERATOR"] },
  // 승인 대기: 3PL 관리자·운영담당만 (화주사 메뉴 비노출). 승인·반려는 상세를 보고 단건만
  approval: { view: ["TPL_ADMIN", "TPL_OPERATOR"], edit: ["TPL_ADMIN", "TPL_OPERATOR"] },
  // 입고예정 등록·수정·취소: 화주사 담당자 (승인 전 상태만 — plan-rules.ts)
  planEntry: { view: ["SHIPPER_STAFF"], edit: ["SHIPPER_STAFF"] },
  // ASN 등록·취소, 상차지시서 인쇄: 화주사 담당자 (정의서 ③). 3PL은 ASN·상차 현황(추후)에서 조회
  asn: { view: ["SHIPPER_STAFF"], edit: ["SHIPPER_STAFF"] },
  // ASN·상차 현황: 3PL 조회 전용 (소속 센터 ASN만, 센터가 없는 계정은 전체)
  asnStatus: { view: ["TPL_ADMIN", "TPL_OPERATOR"], edit: [] },
  // 상차등록(PDA): 화주사 상차담당 (정의서 ④). 결과 조회·상차확인서 인쇄는 ASN(화주사)·ASN·상차 현황(3PL) 권한으로 한다
  loading: { view: ["SHIPPER_LOADER"], edit: ["SHIPPER_LOADER"] },
  // 그 외 기준정보 — 기존 유지 (매트릭스 확정 전)
  master: { view: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"], edit: ["TPL_ADMIN", "TPL_OPERATOR", "SHIPPER_STAFF"] },
};

/** 역할을 여러 개 가진 사용자는 그중 하나라도 허용되면 할 수 있다 */
export function can(roles: readonly UserRole[], resource: Resource, op: Op) {
  return roles.some((r) => MATRIX[resource][op].includes(r));
}

/** 3PL 검토(품목 등록 요청 등록·반려) */
export const canReviewItemRequests = (roles: readonly UserRole[]) => roles.some((r) => r === "TPL_ADMIN" || r === "TPL_OPERATOR");

/** Web 로그인 가능 — Web 역할이 하나라도 있으면 (PDA 역할만 있는 계정은 차단) */
export const isWebRole = (roles: readonly UserRole[]) => roles.some((r) => ROLE_META[r].channel === "Web");

/** PDA 로그인 가능 — PDA 역할이 하나라도 있으면 */
export const isPdaRole = (roles: readonly UserRole[]) => roles.some((r) => ROLE_META[r].channel === "PDA");

/** 화주사 소속 계정 — 역할은 한쪽 소속끼리만 섞이므로 하나만 봐도 된다 (DB 체크 제약) */
export const isShipperRole = (roles: readonly UserRole[]) => roles.some((r) => ROLE_META[r].org === "SHIPPER");

/** 역할 소속 — 여러 역할이 다른 소속이면 null */
export function orgOfRoles(roles: readonly UserRole[]): "TPL" | "SHIPPER" | null {
  const orgs = new Set(roles.map((r) => ROLE_META[r].org));
  return orgs.size === 1 ? [...orgs][0] : null;
}

/** 메뉴 경로 → 권한 대상 */
export function resourceOfPath(href: string): Resource {
  if (href.startsWith("/master/company")) return "company";
  if (href.startsWith("/master/centers")) return "centers";
  if (href.startsWith("/master/clients")) return "clients";
  if (href.startsWith("/master/users")) return "users";
  if (href.startsWith("/master/items")) return "items";
  if (href.startsWith("/master/item-requests")) return "itemRequests";
  if (href.startsWith("/master/holidays")) return "holidays";
  if (href.startsWith("/plans/approval")) return "approval";
  if (href.startsWith("/plans/entry")) return "planEntry";
  if (href.startsWith("/plans/asn-status")) return "asnStatus";
  if (href.startsWith("/plans/asn")) return "asn";
  return "master";
}

/**
 * 로그인 후 첫 화면.
 * 화주사: 품목 조회 (임시 — 화주사 대시보드를 만들면 대시보드로 바꾼다) / 3PL: 승인 대기
 */
export function homePathOf(roles: readonly UserRole[]): string {
  return isShipperRole(roles) ? "/master/items" : "/plans/approval";
}
