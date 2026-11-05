import Link from "next/link";
import { pdaLogout } from "@/server/auth/actions";
import styles from "./Pda.module.css";

/** PDA 화면 틀 — 위 검정 띠(로고·화면명·사용자·로그아웃) + 본문. back이면 [← 처음] */
export function PdaShell({ user, org, back = false, children }: { user: string; org: string | null; back?: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        {back ? (
          <Link href="/pda" className={styles.back}>
            ← 처음
          </Link>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.logo} src="/brand/logilink-logo-dark.svg" alt="LogiLink" height={22} />
        )}
        <span className={styles.barTitle}>상차등록</span>
        <span className={styles.user}>
          {user}
          {org ? <small>{org}</small> : null}
        </span>
        <form action={pdaLogout}>
          <button type="submit" className={styles.logout}>
            로그아웃
          </button>
        </form>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
