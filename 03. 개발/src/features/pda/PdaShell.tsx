import Link from "next/link";
import type { UserRole } from "@/domain/master";
import { pdaLogout } from "@/server/auth/actions";
import { pdaTabs, type PdaTabKey } from "./menu";
import { Icon } from "./PdaParts";
import styles from "./Pda.module.css";

/**
 * PDA 화면 틀 — 흰 바탕 + 위 머리 + (메뉴 화면이면) 아래 메뉴 띠
 * - 메뉴 화면: 이름 첫 글자 원 + 이름·소속, 오른쪽 둥근 로그아웃 / 아래 역할별 메뉴 (menu.ts)
 * - 작업 화면(back): ← 둥근 버튼 + 가운데 화면명 + 둥근 로그아웃, 아래 메뉴 없음(작업 화면 아래에는 [상차완료])
 */
export function PdaShell({
  user,
  org,
  roles,
  tab,
  back,
  title,
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
  children: React.ReactNode;
}) {
  const logout = (
    <form action={pdaLogout}>
      <button type="submit" className={styles.roundBtn} aria-label="로그아웃" title="로그아웃">
        <Icon name="logout" size={17} />
      </button>
    </form>
  );
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
            {logout}
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
            {logout}
          </>
        )}
      </header>
      <main className={styles.main}>{children}</main>
      {tabs.length > 0 && (
        <nav className={styles.tabbar} aria-label="PDA 메뉴">
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} className={t.key === tab ? styles.tabOn : styles.tab} aria-current={t.key === tab ? "page" : undefined}>
              <Icon name={t.icon} size={18} />
              <span>{t.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
