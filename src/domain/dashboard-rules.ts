/**
 * 대시보드 규칙 (2026-11-17 Sol 재구성) — 오늘 차량 흐름 단계, 추이 날짜.
 * 화면·서버가 같은 판단을 쓰도록 순수 함수로 둔다.
 */
import { addDays } from "./inquiry-rules";

/** 오늘 차량 흐름 단계 — 상차 대기는 상차 기록이 없는 ASN이라 여기서는 상차가 있는 차량만 나눈다 */
export type FlowStage = "loading" | "onTheWay" | "arrived" | "received";

/**
 * 상차 1건(차량 1대)의 흐름 단계 (정의서 v1.9 입차 반영)
 * 상차중 → 오는 중(상차완료·입차 전) → 도착·검수(입차 후 확정 전) → 입고완료(검수 확정)
 * 입고취소(역전표)한 차량은 다시 검수할 차량이라 도착·검수로, 입차 취소는 입차 기록이 비워져 오는 중으로 돌아간다.
 */
export function flowStage(l: { status: "WORKING" | "COMPLETED"; arrivedAt: Date | string | null; rcvs: { status: string }[] }): FlowStage {
  if (l.status === "WORKING") return "loading";
  if (l.rcvs.some((r) => r.status === "CONFIRMED")) return "received";
  if (l.arrivedAt || l.rcvs.some((r) => r.status === "WORKING")) return "arrived";
  return "onTheWay";
}

/** today를 포함해 거꾸로 n개 업무일 (오래된 날이 앞). 업무일이 아예 없으면 최대 120일만 본다 */
export function lastBusinessDays(today: string, n: number, isBusiness: (ymd: string) => boolean): string[] {
  const out: string[] = [];
  for (let d = today, i = 0; out.length < n && i < 120; d = addDays(d, -1), i++) if (isBusiness(d)) out.unshift(d);
  return out;
}

/** 진행률 % — 분모 0이면 0 */
export const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
