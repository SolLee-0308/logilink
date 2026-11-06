import { forwardRef } from "react";
import styles from "./Form.module.css";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  // 날짜 칸이 비어 있으면 "연도. 월. 일." 안내 글자를 placeholder처럼 연하게 (globals.css)
  const emptyDate = rest.type === "date" && !rest.value;
  // 날짜·시각 칸은 칸 아무 곳이나 누르면 선택 창을 연다 (2026-11-06 Sol 피드백 — 아이콘만 눌러야 열리던 문제)
  const picker = rest.type === "date" || rest.type === "time";
  const onClick: React.MouseEventHandler<HTMLInputElement> | undefined = picker
    ? (e) => {
        rest.onClick?.(e);
        const el = e.currentTarget;
        if (e.defaultPrevented || el.disabled || el.readOnly) return;
        try {
          el.showPicker?.();
        } catch {
          // 지원하지 않는 브라우저는 기존처럼 직접 입력
        }
      }
    : rest.onClick;
  return <input ref={ref} className={`${styles.control} ${className ?? ""}`} data-empty={emptyDate || undefined} {...rest} onClick={onClick} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return <select ref={ref} className={`${styles.control} ${className ?? ""}`} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={`${styles.control} ${styles.textarea} ${className ?? ""}`} {...rest} />;
  },
);

/** 세로 배치 폼 필드: 라벨(+필수 표시) → 컨트롤 → 안내 / 오류 */
export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.field} ${error ? styles.invalid : ""}`} data-invalid={error ? "" : undefined}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {required ? (
          <span className={styles.req}>
            {" "}
            *<span className="sr-only">필수</span>
          </span>
        ) : (
          <span className={styles.opt}> (선택)</span>
        )}
      </label>
      {children}
      {hint && !error && <p className={styles.hint}>{hint}</p>}
      {error && (
        <p className={styles.error} id={`${htmlFor}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** 체크 한 개 (사용 여부 등) */
export function FormCheck({
  id,
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.check}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

/** 읽기 전용 값 (수정할 수 없는 키 등) */
export function FormStatic({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.static}>{children}</div>
    </div>
  );
}

/** 폼 오류 문장 */
export function FormError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className={styles.error} role="alert">
      {children}
    </p>
  );
}
