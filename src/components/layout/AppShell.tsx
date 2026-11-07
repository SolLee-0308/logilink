import type { NavCountKey } from "@/config/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import { UnsavedGuardProvider } from "@/components/ui/UnsavedGuard";
import { NavCountsProvider } from "./NavCounts";
import { ShellFrame } from "./ShellFrame";
import type { Viewer } from "./Sidebar";

/** 공통 틀: 검정 배경 + 왼쪽 228px 사이드바(접기 가능) + 오른쪽 흰 메인 카드 */
export function AppShell({
  children,
  serverCounts,
  viewer,
  navCollapsed = false,
}: {
  children: React.ReactNode;
  serverCounts?: Partial<Record<NavCountKey, number>>;
  viewer: Viewer;
  /** 메뉴를 접어 둔 상태로 시작 (쿠키) */
  navCollapsed?: boolean;
}) {
  return (
    <NavCountsProvider>
      <ToastProvider>
        <UnsavedGuardProvider>
          <ShellFrame serverCounts={serverCounts} viewer={viewer} initialCollapsed={navCollapsed}>
            {children}
          </ShellFrame>
        </UnsavedGuardProvider>
      </ToastProvider>
    </NavCountsProvider>
  );
}
