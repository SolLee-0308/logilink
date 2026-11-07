"use client";

import { useState } from "react";
import { Sidebar, type Viewer } from "./Sidebar";
import type { NavCountKey } from "@/config/navigation";
import { NAV_COOKIE } from "./nav-cookie";
import styles from "./AppShell.module.css";


/**
 * 틀 안쪽: 사이드바 + 접기 손잡이 + 메인 (2026-11-06 Sol 결정)
 * 접기는 사이드바 로고 줄 오른쪽 끝 아이콘, 펼치기는 화면 왼쪽 가장자리 손잡이.
 */
export function ShellFrame({
  children,
  serverCounts,
  viewer,
  initialCollapsed,
}: {
  children: React.ReactNode;
  serverCounts?: Partial<Record<NavCountKey, number>>;
  viewer: Viewer;
  initialCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${NAV_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <div className={styles.app} data-nav={collapsed ? "collapsed" : "open"}>
      <Sidebar serverCounts={serverCounts} viewer={viewer} onCollapse={toggle} />
      {collapsed && (
        <button
          type="button"
          className={styles.navToggle}
          onClick={toggle}
          aria-expanded={false}
          aria-controls="app-sidebar"
          aria-label="메뉴 펼치기"
          title="메뉴 펼치기"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
