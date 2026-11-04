/**
 * 기준정보 코드 ↔ 표시명. DB enum 값과 같은 문자열을 쓴다.
 * 근거: 입고 업무프로세스 정의서 v1.4 (업무 주체·D2·D7·D19)
 */
import type { StatusTone } from "./plan-status";

export const USER_ROLES = ["TPL_ADMIN", "TPL_OPERATOR", "TPL_INSPECTOR", "SHIPPER_STAFF", "SHIPPER_LOADER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_META: Record<UserRole, { label: string; org: "TPL" | "SHIPPER"; channel: "Web" | "PDA" }> = {
  TPL_ADMIN: { label: "3PL 관리자", org: "TPL", channel: "Web" },
  TPL_OPERATOR: { label: "3PL 운영담당", org: "TPL", channel: "Web" },
  TPL_INSPECTOR: { label: "3PL 입고검수자", org: "TPL", channel: "PDA" },
  SHIPPER_STAFF: { label: "화주사 담당자", org: "SHIPPER", channel: "Web" },
  SHIPPER_LOADER: { label: "화주사 상차담당", org: "SHIPPER", channel: "PDA" },
};

export const ORG_LABEL = { TPL: "3PL", SHIPPER: "화주사" } as const;

/** 역할 표시 순서대로 정렬 (USER_ROLES 순) */
export const sortRoles = (roles: readonly UserRole[]) => USER_ROLES.filter((r) => roles.includes(r));

/** 여러 역할 표시: "3PL 운영담당 · 3PL 입고검수자" */
export const rolesLabel = (roles: readonly UserRole[]) => sortRoles(roles).map((r) => ROLE_META[r].label).join(" · ");

/** 3PL 관리자·운영담당 (센터·화주사 담당자 후보) */
export const isManagerCandidate = (roles: readonly UserRole[]) => roles.some((r) => r === "TPL_ADMIN" || r === "TPL_OPERATOR");

export const ITEM_UNITS = ["EA", "BOX", "PLT"] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];

export const ITEM_REQUEST_STATUSES = ["WAITING", "REJECTED", "REGISTERED"] as const;
export type ItemRequestStatus = (typeof ITEM_REQUEST_STATUSES)[number];

export const ITEM_REQUEST_STATUS_META: Record<ItemRequestStatus, { label: string; tone: StatusTone; tab: string }> = {
  WAITING: { label: "등록대기", tone: "wait", tab: "등록대기" },
  REJECTED: { label: "반려", tone: "rej", tab: "반려 · 화주사 수정 중" },
  REGISTERED: { label: "등록완료", tone: "ok", tab: "등록완료" },
};

export const ITEM_REQUEST_SOURCES = ["DIRECT", "EXCEL", "AI", "ITEM_EXCEL"] as const;
export type ItemRequestSource = (typeof ITEM_REQUEST_SOURCES)[number];

export const SOURCE_LABEL: Record<ItemRequestSource, string> = {
  DIRECT: "직접 입력",
  EXCEL: "엑셀 미매칭",
  AI: "이미지 AI 판독 미매칭",
  ITEM_EXCEL: "엑셀 일괄 요청",
};

export const ITEM_REQUEST_ACTION_LABEL = {
  REQUEST: "등록 요청",
  RESUBMIT: "재요청",
  REGISTER: "등록",
  REJECT: "반려",
} as const;

/** 품목 등록 반려 사유 코드 그룹 */
export const ITEM_REQ_REJECT_GROUP = "ITEM_REQ_REJECT";

/** 바코드: 숫자 8~14자리 (EAN-8·EAN-13·ITF-14 등) */
export const BARCODE_PATTERN = /^\d{8,14}$/;

export const STORAGE_TEMPS = ["ROOM", "CHILLED", "FROZEN"] as const;
export type StorageTemp = (typeof STORAGE_TEMPS)[number];
export const STORAGE_TEMP_LABEL: Record<StorageTemp, string> = { ROOM: "상온", CHILLED: "냉장", FROZEN: "냉동" };

export type AliasSource = "MANUAL" | "REQUEST" | "MATCH";
export const ALIAS_SOURCE_LABEL: Record<AliasSource, string> = {
  MANUAL: "직접 등록",
  REQUEST: "등록 요청 품목명",
  MATCH: "판독 매칭",
};

/** 별칭 비교용: 공백 제거 + 소문자 */
export const normalizeAlias = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export type HolidayKind = "PUBLIC" | "CENTER";
export const HOLIDAY_KIND_LABEL: Record<HolidayKind, string> = { PUBLIC: "공휴일", CENTER: "센터 휴무" };


/** 입고예정 반려·취소 사유 코드 그룹 */
export const PLAN_REJECT_GROUP = "PLAN_REJECT";
export const CANCEL_GROUP = "CANCEL";

/** 품목 메뉴·화면 이름 — 3PL은 조회 + 등록·수정(품목 관리), 화주사는 조회만(품목 조회) (2026-11-04 Sol 확정) */
export const itemsTitle = (canEdit: boolean) => (canEdit ? "품목 관리" : "품목 조회");
