"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_GROUPS, type NavCountKey, type NavItem } from "@/config/navigation";
import { can, isShipperRole, resourceOfPath } from "@/domain/permissions";
import type { UserRole } from "@/domain/master";
import { logout } from "@/server/auth/actions";
import { useNavCounts } from "./NavCounts";
import styles from "./Sidebar.module.css";

type Counts = Partial<Record<NavCountKey, number>>;

/** 로그인 사용자 표시 정보 */
export interface Viewer {
  name: string;
  roles: UserRole[];
  roleLabel: string;
  /** 3PL · 용인1센터 / 화주사 · 한빛식품 */
  orgLabel: string;
}

const isOn = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** serverCounts: 서버가 매 요청마다 계산한 건수. 화면이 직접 갱신한 값(NavCounts)이 있으면 그것을 쓴다 */
export function Sidebar({ serverCounts = {}, viewer, onCollapse }: { serverCounts?: Counts; viewer: Viewer; onCollapse?: () => void }) {
  const pathname = usePathname();
  // 권한이 없는 하위 메뉴는 숨긴다 (서버에서도 다시 검사)
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((it) => !it.href || can(viewer.roles, resourceOfPath(it.href), "view"))
      .map((it) =>
        it.children
          ? {
              ...it,
              children: it.children
                .filter((c) => can(viewer.roles, resourceOfPath(c.href), "view"))
                .map((c) => (c.shipperLabel && isShipperRole(viewer.roles) ? { ...c, label: c.shipperLabel } : c)),
            }
          : it,
      ),
  })).filter((g) => g.items.length > 0);
  const { counts: clientCounts } = useNavCounts();
  const counts: Counts = { ...serverCounts, ...clientCounts };

  return (
    <aside id="app-sidebar" className={styles.side} aria-label="메뉴">
      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logilink-symbol.svg" width={34} height={34} alt="" />
        <div>
          <div className={styles.word}>
            Logi<b>Link</b>
          </div>
          <small className={styles.brandSub}>
            {viewer.orgLabel}
          </small>
        </div>
        {onCollapse && (
          /* 메뉴 접기 — 로고 줄 오른쪽 끝 (2026-11-06 Sol 결정). 펼치기는 화면 왼쪽 가장자리 손잡이 */
          <button type="button" className={styles.collapse} onClick={onCollapse} aria-expanded aria-controls="app-sidebar" aria-label="메뉴 접기" title="메뉴 접기">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M5.5 3 2.5 6 5.5 9M9.5 3 6.5 6 9.5 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        )}
      </div>

      <nav className={styles.nav}>
        {groups.map((group) => (
          <div key={group.label} className={styles.group} role="group" aria-labelledby={`nav-${group.label}`}>
            <div className={styles.groupLabel} id={`nav-${group.label}`}>
              {group.label}
            </div>
            {group.items.map((item) =>
              item.children ? (
                <NavParent key={item.label} item={item} pathname={pathname} counts={counts} />
              ) : (
                <NavLink
                  key={item.label}
                  item={item}
                  active={!!item.href && isOn(pathname, item.href)}
                  count={item.countKey ? counts[item.countKey] : undefined}
                />
              ),
            )}
          </div>
        ))}
      </nav>

      <div className={styles.user}>
        <span className={styles.avatar} aria-hidden="true">
          {viewer.name.slice(0, 1)}
        </span>
        <div className={styles.userText}>
          {viewer.name}
          <small>{viewer.roleLabel}</small>
        </div>
        <form action={logout}>
          <button type="submit" className={styles.logout}>
            로그아웃
          </button>
        </form>
      </div>
    </aside>
  );
}

function Count({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span className={styles.cnt}>
      {value}
      <span className="sr-only">건</span>
    </span>
  );
}

function NavLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const inner = (
    <>
      {item.icon}
      <span className={styles.navLabel}>{item.label}</span>
      {count !== undefined && <Count value={count} />}
    </>
  );

  if (!item.href) {
    return (
      <span className={`${styles.item} ${styles.pending}`} aria-disabled="true" title="화면 준비 중">
        {inner}
      </span>
    );
  }
  return (
    <Link href={item.href} className={`${styles.item} ${active ? styles.on : ""}`} aria-current={active ? "page" : undefined}>
      {inner}
    </Link>
  );
}

/** 하위 메뉴가 있는 메뉴 — 현재 위치가 안에 있으면 처음부터 펼친다 */
function NavParent({ item, pathname, counts }: { item: NavItem; pathname: string; counts: Counts }) {
  const children = item.children ?? [];
  const inside = children.some((c) => isOn(pathname, c.href));
  const [open, setOpen] = useState(inside);
  const expanded = open || inside;
  const id = `sub-${item.label}`;
  const total = children.reduce((n, c) => n + (c.countKey ? counts[c.countKey] ?? 0 : 0), 0);

  return (
    <>
      <button
        type="button"
        className={`${styles.item} ${styles.parent} ${inside ? styles.parentOn : ""}`}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setOpen(!expanded)}
      >
        {item.icon}
        <span className={styles.navLabel}>{item.label}</span>
        {!expanded && <Count value={total} />}
        <svg className={styles.chev} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {expanded && (
        <ul id={id} className={styles.sub}>
          {children.map((c) => {
            const on = isOn(pathname, c.href);
            return (
              <li key={c.href}>
                <Link href={c.href} className={`${styles.subItem} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
                  <span className={styles.navLabel}>{c.label}</span>
                  {c.countKey && <Count value={counts[c.countKey]} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
