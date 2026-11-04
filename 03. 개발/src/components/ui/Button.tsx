import { forwardRef } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "danger";
type Size = "md" | "sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: 화면의 주 행위 1개(검정). secondary: 보조. danger: 보조 모양 + 빨간 글자(반려 등) */
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  const cls = [styles.btn, styles[variant], size === "sm" ? styles.sm : "", className ?? ""].join(" ");
  return <button ref={ref} type={type} className={cls} {...rest} />;
});
