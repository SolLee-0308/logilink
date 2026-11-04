import { CountBadge } from "@/components/ui/Badges";
import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  /** 메뉴 경로 (마지막 항목이 현재 화면) */
  crumbs: string[];
  title: string;
  /** 제목 바로 옆 상태 배지·태그 */
  badges?: React.ReactNode;
  count?: number;
  /** 도움말(?) 버튼을 누를 때 */
  onHelp?: () => void;
  helpLabel?: string;
  /** 화면 단위 행위 (오른쪽) */
  actions?: React.ReactNode;
}

export function PageHeader({ crumbs, title, badges, count, onHelp, helpLabel = "화면 규칙 보기", actions }: PageHeaderProps) {
  return (
    <header className={styles.wrap}>
      <nav className={styles.crumb} aria-label="현재 위치">
        <ol>
          {crumbs.map((c, i) => (
            <li key={c} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
              {c}
            </li>
          ))}
        </ol>
      </nav>
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
