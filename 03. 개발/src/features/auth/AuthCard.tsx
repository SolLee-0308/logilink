import styles from "./Auth.module.css";

/** 로그인 계열 화면의 공통 카드: 로고 → 제목·설명 → 본문 */
export function AuthCard({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <main className={styles.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.logo} src="/brand/logilink-logo-light.svg" alt="LogiLink" width={151} height={36} />
        <div className={styles.head}>
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
