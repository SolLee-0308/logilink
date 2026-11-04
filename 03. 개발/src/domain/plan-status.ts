/**
 * 입고예정 상태 — 근거: 입고 업무프로세스 정의서 v1.4, 4-1 (TB_INB_PLAN_H)
 * 내부 코드와 표시명을 분리해 두어, 공통코드로 바뀌어도 이 파일만 고치면 된다.
 */
export const PLAN_STATUSES = [
  "WAITING",
  "REJECTED",
  "APPROVED",
  "PARTIAL",
  "COMPLETED",
  "CLOSED",
  "CANCELED",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** 배지 색 키 — tokens.css의 --st-{tone}-bg / --st-{tone}-fg */
export type StatusTone = "wait" | "rej" | "ok" | "part" | "done" | "close" | "cancel";

interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** 최종 상태 여부 (입고완료·종결·취소) */
  final: boolean;
}

export const PLAN_STATUS_META: Record<PlanStatus, StatusMeta> = {
  WAITING: { label: "승인대기", tone: "wait", final: false },
  REJECTED: { label: "반려", tone: "rej", final: false },
  APPROVED: { label: "승인", tone: "ok", final: false },
  PARTIAL: { label: "부분입고", tone: "part", final: false },
  COMPLETED: { label: "입고완료", tone: "done", final: true },
  CLOSED: { label: "종결", tone: "close", final: true },
  CANCELED: { label: "취소", tone: "cancel", final: true },
};

export const PLAN_INPUT_METHOD_LABEL = { DIRECT: "직접 입력", EXCEL: "엑셀 업로드", AI_IMAGE: "이미지 AI 판독" } as const;
export type PlanInputMethod = keyof typeof PLAN_INPUT_METHOD_LABEL;

export const PLAN_ACTION_LABEL = {
  CREATE: "최초 저장",
  UPDATE: "수정 저장",
  RESUBMIT: "재저장",
  APPROVE: "승인",
  REJECT: "반려",
  CANCEL: "화주사 취소",
  CANCEL_APPROVED: "승인 건 취소",
  EXPIRE_CANCEL: "기한경과 취소",
  CLOSE: "잔량 종결",
} as const;
export type PlanAction = keyof typeof PLAN_ACTION_LABEL;
