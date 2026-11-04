/** 16px 선 아이콘 (시안 approval-list.html 기준) */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </Base>
);

export const IconDoc = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5 6h6M5 9h4" />
  </Base>
);

export const IconTruck = (p: IconProps) => (
  <Base {...p}>
    <path d="M1.5 5h8v6h-8zM9.5 7h3l2 2v2h-5" />
    <circle cx="4" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
  </Base>
);

export const IconClipboard = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="2" width="10" height="12" rx="1.5" />
    <path d="M5.5 6h5M5.5 9h3" />
  </Base>
);

export const IconClock = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </Base>
);

export const IconList = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Base>
);

export const IconSearch = (p: IconProps) => (
  <Base strokeWidth={1.6} {...p}>
    <circle cx="7" cy="7" r="4.8" />
    <path d="m10.5 10.5 3 3" />
  </Base>
);
