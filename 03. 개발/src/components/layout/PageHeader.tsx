import { CountBadge } from "@/components/ui/Badges";
import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  /** 메뉴 경로 (마지막 항목이 현재 화면) */
  crumbs: string[];
  title: string;
  /** 하위 화면의 [← 목록] — 경로 줄 왼쪽에 둔다 */
  back?: React.ReactNode;
  /** 제목 바로 옆 상태 배지·태그 */
  badges?: React.ReactNode;
  count?: number;
  /** 도움말(?) 버튼을 누를 때 */
  onHelp?: () => void;
  helpLabel?: string;
  /** 화면 단위 행위 (오른쪽) */
  actions?: React.ReactNode;
  /** 머리 아래 구분선 — 하위 화면에서 머리와 내용을 나눈다 */
  divided?: boolean;
}

/**
 * 화면 머리 — 첫 줄: 왼쪽 [← 목록](하위 화면만) · 오른쪽 끝 메뉴 경로, 둘째 줄: 제목 + 행위.
 * 경로를 오른쪽 끝으로 보내 돌아가기 버튼과 한 줄에 두어 내용 영역을 넓게 쓴다 (2026-11-06 Sol 결정).
 */
export function PageHeader({ crumbs, title, back, badges, count, onHelp, helpLabel = "화면 규칙 보기", actions, divided }: PageHeaderProps) {
  return (
    <header className={`${styles.wrap} ${divided ? styles.divided : ""}`}>
      <div className={styles.top}>
        {back}
        <nav className={styles.crumb} aria-label="현재 위치">
          <ol>
            {crumbs.map((c, i) => (
              <li key={`${i}-${c}`} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c}
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <div className={styles.head}>
        <h1>{title}</h1>
        {badges}
        {count !== undefined && <CountBadge value={count} label={`${title} 건수`} />}
        {onHelp && (
          <button type="button" className={styles.help} onClick={onHelp} aria-label={helpLabel}>
            ?
          </button>
        )}
        {actions && <div className={styles.right}>{actions}</div>}
      </div>
    </header>
  );
}
