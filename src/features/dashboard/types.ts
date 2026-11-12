import type { PlanStatus } from "@/domain/plan-status";

/** 대시보드 센터 — 업무일은 센터마다 시작 시각이 달라 따로 센다 */
export interface DashCenter {
  id: number;
  name: string;
  /** 지금 시각이 속한 업무일 */
  businessDate: string;
  businessDayStart: string;
  dailyCloseTime: string;
  expireGraceDays: number;
  /** 정기 휴무 요일 (0 일 ~ 6 토) */
  weeklyOffDays: number[];
  /** 오늘 업무일 검수 확정 차량 수 */
  confirmedVehicles: number;
  /** 오늘 일마감 때 기한경과 취소 대상 */
  expireTargets: number;
  /** 승인 전인데 입고예정일이 지났고 아직 유예 중인 건 */
  expireGrace: number;
}

export interface DashPlanRow {
  id: number;
  planNo: string;
  clientName: string;
  centerName: string;
  planDate: string;
  status: PlanStatus;
  /** 기한경과 취소 예정 업무일 */
  dueDate: string;
}

export interface DashAsnRow {
  id: number;
  asnNo: string;
  clientName: string;
  centerName: string;
  vehicleNo: string;
  shipDate: string;
}

export interface DashRcvRow {
  rcvId: number;
  rcvNo: string;
  /** 웹에서 검수 결과를 보는 곳 — 지시 상차: ASN 상세 / 무지시: 상차 상세 */
  href: string;
  clientName: string;
  centerName: string;
  vehicleNo: string;
  confirmedAt: string;
  issueCount: number;
}

export interface TplDashboard {
  /** 조회 시각 (ISO) */
  now: string;
  centers: DashCenter[];
  /** 소속 센터가 없는 계정만 — 센터 고르기 */
  centerOptions: { id: number; name: string }[];
  selectedCenter: string;
  todo: {
    approvalWaiting: number;
    inspectWaiting: number;
    inspecting: number;
    partial: number;
    expireTargets: number;
  };
  flow: DashFlow;
  watch: {
    expire: DashPlanRow[];
    expireCount: number;
    overdueAsn: DashAsnRow[];
    overdueAsnCount: number;
    issueRcv: DashRcvRow[];
    unclosedOverdue: number;
    alertDays: number;
  };
}

/** 오늘 흐름 — 3PL·화주사 공통 */
export interface DashFlow {
  /** 오늘 입고예정일 건 — 승인 전·승인 이후로 나눈다 (취소 제외) */
  planPre: number;
  planApproved: number;
  /** 오늘 출고일 ASN 상태별 (취소 제외) */
  asnRegistered: number;
  asnLoading: number;
  asnLoaded: number;
  asnReceived: number;
  /** 오늘 업무일 검수 확정 */
  rcvVehicles: number;
  rcvLines: number;
  rcvIssueVehicles: number;
}

/** 화주사 대시보드 (2026-11-11) — 자기 화주사 건, 이용 센터 기준 */
export interface ShipperDashboard {
  now: string;
  centers: DashCenter[];
  /** 이용 센터 — 2곳 이상이면 고르기 */
  centerOptions: { id: number; name: string }[];
  selectedCenter: string;
  todo: {
    /** 반려된 입고예정 — 고쳐서 다시 요청 */
    rejected: number;
    /** 승인대기 — 3PL 검토 중 */
    waiting: number;
    /** ASN에 나눠 담을 잔량이 남은 승인·부분입고 건 */
    toAsn: number;
    /** 반려된 품목 등록 요청 (센터 무관) */
    itemRejected: number;
    /** 오늘 일마감 때 기한경과로 취소될 승인 전 건 */
    expireTargets: number;
    /** 3PL이 검수 중인 내 차량 */
    inspecting: number;
  };
  flow: DashFlow;
  watch: {
    /** 승인 전 + 입고예정일 지남 — 오늘 취소 대상(target)과 유예 중 */
    expire: (DashPlanRow & { target: boolean })[];
    expireCount: number;
    expireTargetCount: number;
    overdueAsn: DashAsnRow[];
    overdueAsnCount: number;
    issueRcv: DashRcvRow[];
    unclosedOverdue: number;
    alertDays: number;
  };
}
