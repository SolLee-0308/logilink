import type { PlanStatus } from "@/domain/plan-status";

/**
 * 대시보드 재구성 (2026-11-17 Sol, 시안 v0.1) — 처리할 일 → 오늘 차량 흐름 → 주의할 건 → 추이(14업무일).
 * 빠진 것: 부분입고 칸, 입고예정 승인 전·이후 건수, 검수 품목 줄 수, 센터 기준 보기, 센터별 일마감 표, 이용 센터 표.
 */

/** 대시보드 센터 — 업무일은 센터마다 시작 시각이 달라 따로 센다 */
export interface DashCenter {
  id: number;
  name: string;
  /** 지금 시각이 속한 업무일 */
  businessDate: string;
  businessDayStart: string;
  dailyCloseTime: string;
  /** 오늘 업무일 일마감 — 안 했으면 null */
  closed: { at: string; by: string } | null;
  /** 오늘 일마감 때 기한경과 취소 대상 */
  expireTargets: number;
}

/** 화주사 이름 칸 — 긴 이름은 줄이고, 누르면 전체 이름·코드를 보여 준다 (2026-11-17 Sol 시안 댓글) */
export interface DashClient {
  clientName: string;
  clientCode: string;
}

export interface DashPlanRow extends DashClient {
  id: number;
  planNo: string;
  centerName: string;
  planDate: string;
  status: PlanStatus;
  /** 기한경과 취소 예정 업무일 */
  dueDate: string;
}

export interface DashAsnRow extends DashClient {
  id: number;
  asnNo: string;
  centerName: string;
  vehicleNo: string;
  shipDate: string;
}

export interface DashRcvRow extends DashClient {
  rcvId: number;
  rcvNo: string;
  /** 웹에서 검수 결과를 보는 곳 — 지시 상차: ASN 상세 / 무지시: 상차 상세 */
  href: string;
  centerName: string;
  vehicleNo: string;
  confirmedAt: string;
  issueCount: number;
}

/**
 * 오늘 차량 흐름 — 5단계 (정의서 v1.9 입차 반영). 오늘 출고일 ASN + 오늘 상차한 무지시 차량.
 * 상차 대기(ASN 등록) → 상차중 → 오는 중(상차완료·입차 전) → 도착·검수(입차 후 확정 전) → 입고완료(검수 확정)
 */
export interface DashFlow {
  waiting: number;
  loading: number;
  onTheWay: number;
  arrived: number;
  received: number;
}

/** 추이 하루치 — 센터 업무일 기준 (2026-11-17 Sol: 14업무일) */
export interface DashTrendDay {
  date: string;
  /** 검수 확정 차량 */
  vehicles: number;
  /** 그중 차이 있는 차량 */
  issueVehicles: number;
  /** 확정 수량 (기준 단위) — 정상 입고 / 반송(훼손·품목 불일치) */
  goodQty: number;
  returnQty: number;
  /** 입차 → 검수 확정 평균 분 (입차 기록이 있는 차량만, 없으면 null) */
  leadMinutes: number | null;
  /** 그날 입고예정일인 승인 이후 건의 수량 (기준 단위, 취소 제외) — 화주사 입고율 */
  planQty: number;
  /** 그 수량 중 입고된 수량 */
  planRcvQty: number;
}

export interface DashWatch {
  expire: DashPlanRow[];
  expireCount: number;
  overdueAsn: DashAsnRow[];
  overdueAsnCount: number;
  issueRcv: DashRcvRow[];
  issueCount: number;
  unclosedOverdue: number;
  alertDays: number;
}

interface DashBase {
  /** 조회 시각 (ISO) */
  now: string;
  centers: DashCenter[];
  /** 고를 수 있는 센터 — 2곳 이상일 때만 고르기 */
  centerOptions: { id: number; name: string }[];
  selectedCenter: string;
  flow: DashFlow;
  trend: DashTrendDay[];
}

export interface TplDashboard extends DashBase {
  todo: {
    approvalWaiting: number;
    itemRequests: number;
    /** 입차했고 검수 첫 입력 전 (입고취소 뒤 재검수 전 포함) */
    arrivedWaiting: number;
    /** 상차완료·입차 전 — 칸 보조 글 */
    onTheWay: number;
    inspecting: number;
    expireTargets: number;
  };
  watch: DashWatch;
}

/** 화주사 대시보드 — 자기 화주사 건, 이용 센터 기준 */
export interface ShipperDashboard extends DashBase {
  clientName: string;
  todo: {
    /** 반려된 입고예정 — 고쳐서 다시 요청 */
    rejected: number;
    /** 오늘 일마감 때 기한경과로 취소될 승인 전 건 */
    expireTargets: number;
    /** ASN에 나눠 담을 잔량이 남은 승인·부분입고 건 */
    toAsn: number;
    /** 반려된 품목 등록 요청 (센터 무관) */
    itemRejected: number;
  };
  /** 기한경과 목록은 오늘 취소 대상(target)과 유예 중을 함께 */
  watch: Omit<DashWatch, "expire"> & { expire: (DashPlanRow & { target: boolean })[] };
}
