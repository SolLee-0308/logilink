/**
 * 3PL Web 사이드바 메뉴 — 시안 approval-list.html의 3개 그룹.
 * 기준정보는 하위 메뉴를 가진다 (2026-11-02 Sol 결정: 화면 안 탭 대신 하위 메뉴).
 * href가 없는 메뉴는 아직 화면이 없어 이동하지 않는다.
 */
import {
  IconCheck,
  IconClipboard,
  IconClock,
  IconDoc,
  IconList,
  IconPlus,
  IconTruck,
} from "@/components/icons";

/** 사이드바 건수 배지 키 */
export type NavCountKey = "approvalWaiting" | "itemRequestWaiting" | "planRejected";

export interface NavChild {
  label: string;
  /** 화주사 계정에 보일 이름 (역할에 따라 할 수 있는 일이 달라 이름도 다르게) */
  shipperLabel?: string;
  href: string;
  countKey?: NavCountKey;
}

export interface NavItem {
  label: string;
  href?: string;
  icon: React.ReactNode;
  countKey?: NavCountKey;
  /** 하위 메뉴 — 있으면 펼침/접기 */
  children?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const MASTER_MENU: NavChild[] = [
  { label: "회사 정보", href: "/master/company" },
  { label: "센터", href: "/master/centers" },
  { label: "화주사", href: "/master/clients" },
  // 3PL: 조회 + 등록·수정 / 화주사: 조회만 (2026-11-04 Sol 확정)
  { label: "품목 관리", shipperLabel: "품목 조회", href: "/master/items" },
  { label: "품목 등록 요청", href: "/master/item-requests", countKey: "itemRequestWaiting" },
  { label: "사유 코드", href: "/master/codes" },
  { label: "사용자·역할", href: "/master/users" },
  { label: "휴무일", href: "/master/holidays" },
  { label: "운영 설정", href: "/master/settings" },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "입고 계획",
    items: [
      // 화주사: 입고예정 등록(승인 전 건 관리, 건수 = 반려되어 고칠 건) / 3PL: 승인 대기 — 권한에 따라 하나만 보인다
      { label: "입고예정 등록", href: "/plans/entry", icon: <IconPlus />, countKey: "planRejected" },
      { label: "승인 대기", href: "/plans/approval", icon: <IconCheck />, countKey: "approvalWaiting" },
      // 화주사: 승인된 입고예정을 차량에 나눠 담고 상차지시서 발행 (정의서 ③)
      { label: "ASN 등록", href: "/plans/asn", icon: <IconTruck /> },
      { label: "입고예정 조회", icon: <IconDoc /> },
      { label: "ASN·상차 현황", icon: <IconTruck /> },
    ],
  },
  {
    label: "입고 운영",
    items: [
      { label: "입고검수 실적", icon: <IconClipboard /> },
      { label: "잔량 종결·일마감", icon: <IconClock /> },
    ],
  },
  {
    label: "관리",
    items: [{ label: "기준정보", icon: <IconList />, children: MASTER_MENU }],
  },
];
