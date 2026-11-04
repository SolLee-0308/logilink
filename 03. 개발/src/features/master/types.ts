/** 서버 → 화면으로 넘기는 기준정보 데이터 (날짜는 ISO 문자열) */
import type { UnclosedCounts } from "@/domain/unclosed";
import type { AliasSource, HolidayKind, ItemRequestSource, ItemRequestStatus, ItemUnit, StorageTemp, UserRole } from "@/domain/master";

export interface Audit {
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ChangeEntry {
  id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  at: string;
}

export interface ClientRow extends Audit {
  id: number;
  code: string;
  name: string;
  bizNo: string;
  ceoName: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  tel: string | null;
  email: string | null;
  contactName: string;
  contactTel: string;
  contactEmail: string | null;
  managerUserId: number;
  managerName: string;
  /** YYYY-MM-DD */
  contractStartDt: string;
  contractEndDt: string | null;
  /** 이용 센터 (센터 코드 순) */
  centers: { code: string; name: string }[];
  isActive: boolean;
  itemCount: number;
  userCount: number;
  /** 미종결 전표 유형별 건수 */
  unclosed: UnclosedCounts;
  history: ChangeEntry[];
}

/** 화주사 이용 센터 선택지 */
export interface CenterPick {
  code: string;
  name: string;
  isActive: boolean;
}

export interface ClientOption {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ItemUomRow {
  unit: ItemUnit;
  qty: number;
}

export interface ItemBarcodeRow {
  unit: ItemUnit;
  barcode: string;
  isPrimary: boolean;
}

export interface ItemAliasRow {
  id: number;
  alias: string;
  source: AliasSource;
  createdAt: string;
  createdBy: string;
}

export interface ItemRow extends Audit {
  id: number;
  clientId: number;
  clientName: string;
  code: string;
  name: string;
  baseUnit: ItemUnit;
  storageTemp: StorageTemp;
  expiryManaged: boolean;
  lotManaged: boolean;
  isActive: boolean;
  uoms: ItemUomRow[];
  barcodes: ItemBarcodeRow[];
  aliases: ItemAliasRow[];
  history: ChangeEntry[];
}

/** 중복 확인용 기존 품목 */
export interface ItemKey {
  id: number;
  clientId: number;
  code: string;
  name: string;
  isActive: boolean;
  barcodes: string[];
  aliases: string[];
}

export interface ItemRequestHistoryRow {
  id: number;
  action: "REQUEST" | "RESUBMIT" | "REGISTER" | "REJECT";
  actor: string;
  at: string;
  reasonCode: string | null;
  reasonName: string | null;
  reasonText: string | null;
  memo: string | null;
}

export interface ItemRequestRow {
  id: number;
  requestNo: string;
  clientId: number;
  clientName: string;
  itemCode: string;
  itemName: string;
  unit: ItemUnit;
  barcode: string;
  source: ItemRequestSource;
  sourceNote: string | null;
  storageTemp: StorageTemp | null;
  expiryManaged: boolean | null;
  lotManaged: boolean | null;
  status: ItemRequestStatus;
  version: number;
  resubmitCount: number;
  requestedBy: string;
  requestedAt: string;
  processedBy: string | null;
  processedAt: string | null;
  rejectReasonCode: string | null;
  rejectReasonName: string | null;
  rejectReasonText: string | null;
  registeredItemCode: string | null;
  /** 오늘 내가 등록·반려했으면 그 처리 ("오늘 처리" 탭) */
  doneByMeToday: { action: "REGISTER" | "REJECT"; at: string } | null;
  histories: ItemRequestHistoryRow[];
}

export interface CodeOption {
  code: string;
  name: string;
  requiresText: boolean;
}

export interface CodeGroupRow {
  code: string;
  name: string;
  description: string | null;
  confirmed: boolean;
}

export interface CommonCodeRow extends Audit {
  id: number;
  groupCode: string;
  code: string;
  name: string;
  sortOrder: number;
  requiresText: boolean;
  isActive: boolean;
  history: ChangeEntry[];
}

export interface UserRow extends Audit {
  id: number;
  loginId: string;
  name: string;
  role: UserRole;
  clientId: number | null;
  clientName: string | null;
  centerId: number | null;
  centerName: string | null;
  isActive: boolean;
  /** 로그인 잠금 (5회 연속 실패) */
  locked: boolean;
  lockedAt: string | null;
  /** 비밀번호 초기화 후 변경 대기 */
  mustChangePw: boolean;
  lastLoginAt: string | null;
  history: ChangeEntry[];
}

export interface CenterOption {
  id: number;
  name: string;
}

export interface SettingRow {
  key: string;
  label: string;
  value: string;
  valueType: "INT" | "TIME";
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string;
  history: ChangeEntry[];
}

export interface CompanyRow {
  name: string;
  bizNo: string;
  ceoName: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  phone: string | null;
  email: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string;
  history: ChangeEntry[];
}

export interface CenterRow extends Audit {
  id: number;
  code: string;
  name: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  inboundTel: string;
  managerUserId: number | null;
  managerName: string | null;
  dailyCloseTime: string;
  isActive: boolean;
  /** 이 센터 소속 사용 중 사용자 수 (사용 안 함 전환 경고용) */
  activeUserCount: number;
  history: ChangeEntry[];
}

/** 센터 담당자 후보 — 해당 센터 소속 · 사용 중 · 3PL 관리자/운영담당 */
export interface ManagerCandidate {
  id: number;
  centerId: number;
  centerCode: string;
  name: string;
  roleLabel: string;
}

export interface HolidayRow {
  id: number;
  centerId: number;
  centerName: string;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  kind: HolidayKind;
  createdAt: string;
  createdBy: string;
}
