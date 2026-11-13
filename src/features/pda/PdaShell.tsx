import Link from "next/link";
import type { UserRole } from "@/domain/master";
import { pdaLogout } from "@/server/auth/actions";
import { pdaTabs, type PdaTabKey } from "./menu";
import { Icon } from "./PdaParts";
import { dashboardReady } from "@/lib/demo";
import styles from "./Pda.module.css";

/**
 * PDA 화면 틀 — 흰 바탕 + 위 머리 + (메뉴 화면이면) 아래 메뉴 띠
 * - 메뉴 화면: 이름 첫 글자 원 + 이름·소속, 오른쪽은 화면별 행위(action, 예: 상차등록의 [무지시 상차]) / 아래 역할별 메뉴 + 로그아웃
 * - 작업 화면(back): ← 둥근 버튼 + 가운데 화면명, 아래 메뉴 없음(작업 화면 아래에는 [상차완료])
 * 2026-11-06 Sol: 로그아웃을 머리에서 메뉴 띠 맨 오른쪽으로
 */
export function PdaShell({
  user,
  org,
  roles,
  tab,
  back,
  title,
  action,
  children,
}: {
  user: string;
  org: string | null;
  roles: readonly UserRole[];
  /** 지금 메뉴 — 메뉴 화면에서만 */
  tab?: PdaTabKey;
  /** 작업 화면: 돌아갈 곳 */
  back?: string;
  title?: string;
  /** 메뉴 화면 머리 오른쪽 행위 */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tabs = back ? [] : pdaTabs(roles);
  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        {back ? (
          <>
            <Link href={back} className={styles.roundBtn} aria-label="뒤로" title="뒤로">
              <Icon name="back" size={18} />
            </Link>
            <span className={styles.barTitle}>{title}</span>
            <span className={styles.barSpacer} aria-hidden="true" />
          </>
        ) : (
          <>
            <span className={styles.avatar} aria-hidden="true">
              {user.slice(0, 1)}
            </span>
            <span className={styles.hello}>
              <b>{user}님</b>
              <small>{org ?? "3PL"}</small>
            </span>
            {action && <span className={styles.barAction}>{action}</span>}
          </>
        )}
      </header>
      <main className={styles.main}>{children}</main>
      {tabs.length > 0 && (
        <nav className={styles.tabbar} aria-label="PDA 메뉴">
          {tabs.map((t) =>
            // 시연 링크에서는 대시보드 탭을 누를 수 없게 (2026-11-13 Sol)
            t.key === "dashboard" && !dashboardReady() ? (
              <span key={t.key} className={`${styles.tab} ${styles.tabSoon}`} aria-disabled="true" title="준비 중">
                <Icon name={t.icon} size={18} />
                <span>준비 중</span>
              </span>
            ) : (
              <Link key={t.key} href={t.href} className={t.key === tab ? styles.tabOn : styles.tab} aria-current={t.key === tab ? "page" : undefined}>
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
              </Link>
            ),
          )}
          <form action={pdaLogout} className={styles.tabForm}>
            <button type="submit" className={styles.tab}>
              <Icon name="logout" size={18} />
              <span>로그아웃</span>
            </button>
          </form>
        </nav>
      )}
    </div>
  );
}
