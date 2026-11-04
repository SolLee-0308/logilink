import type { NavCountKey } from "@/config/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import { UnsavedGuardProvider } from "@/components/ui/UnsavedGuard";
import { NavCountsProvider } from "./NavCounts";
import { Sidebar, type Viewer } from "./Sidebar";
import styles from "./AppShell.module.css";

/** 공통 틀: 검정 배경 + 왼쪽 228px 사이드바 + 오른쪽 흰 메인 카드 */
export function AppShell({
  children,
  serverCounts,
  viewer,
}: {
  children: React.ReactNode;
  serverCounts?: Partial<Record<NavCountKey, number>>;
  viewer: Viewer;
}) {
  return (
    <NavCountsProvider>
      <ToastProvider>
        <UnsavedGuardProvider>
          <div className={styles.app}>
            <Sidebar serverCounts={serverCounts} viewer={viewer} />
            <main className={styles.main}>{children}</main>
          </div>
        </UnsavedGuardProvider>
      </ToastProvider>
    </NavCountsProvider>
  );
}
