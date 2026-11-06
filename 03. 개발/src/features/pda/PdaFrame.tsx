"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./PdaFrame.module.css";

/** 실제 PDA 화면 크기 (5~6인치 안드로이드 PDA의 웹 화면 기준, 2026-11-05 Sol 승인) */
const SCREEN_W = 360;
const SCREEN_H = 720;
/** 몸체 위·아래·옆 두께 + 아래 안내 글 자리 */
const DEVICE_H = SCREEN_H + 36 + 44;
const STAGE_PAD = 64;
const SPLASH_MS = 2500; // 2026-11-06 Sol: 2~3초

/**
 * 시연용 PDA 테두리 (2026-11-05 Sol 요청)
 * - 넓은 화면(PC·시연): 산업용 PDA 몸체 안에 실제 PDA 크기(360 × 720) 화면을 넣고, 모니터 높이에 맞게 통째로 확대·축소한다.
 *   배치는 실제 단말과 같고 크기만 커진다.
 * - 실제 PDA·휴대폰(좁은 화면): 테두리 없이 화면 전체 — CSS 미디어 쿼리로만 나눈다.
 * - SPLASH: 로그인 화면을 열 때마다 2.5초 보여 주고, 누르면 바로 넘어간다.
 */
export function PdaFrame({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const fit = () => setZoom(Math.max(0.6, Math.min(1.5, (window.innerHeight - STAGE_PAD) / DEVICE_H)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div className={styles.stage} style={{ "--pda-zoom": zoom, "--pda-w": `${SCREEN_W}px`, "--pda-h": `${SCREEN_H}px` } as React.CSSProperties}>
      <div className={styles.device}>
        <span className={`${styles.key} ${styles.keyL}`} aria-hidden="true" />
        <span className={`${styles.key} ${styles.keyR}`} aria-hidden="true" />
        <div className={styles.top} aria-hidden="true">
          <span className={styles.brand}>LogiLink PDA</span>
          <span className={styles.lens} />
        </div>
        <div className={styles.screen}>
          <StatusBar />
          <div className={styles.view}>{children}</div>
          <Splash />
        </div>
        <div className={styles.bottom} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <p className={styles.caption}>PDA 화면 360 × 720 · 시연용 테두리 (실제 단말에서는 전체 화면)</p>
    </div>
  );
}

/**
 * SPLASH — 로그인 화면(/pda/login)을 열 때마다 2.5초 보여 주고, 누르면 바로 넘어간다 (2026-11-06 Sol 결정: B안).
 * 예전에는 브라우저 세션당 1번(sessionStorage)이었는데, 개발 서버의 엄격 모드가 효과를 두 번 실행하면서
 * 두 번째 실행이 "이미 봤음"으로 판단해 곧바로 지워지던 문제가 있어 저장소 기록을 없앴다.
 */
function Splash() {
  const onLogin = usePathname() === "/pda/login";
  const [state, setState] = useState<"show" | "fade" | "gone">(onLogin ? "show" : "gone");
  useEffect(() => {
    if (!onLogin) {
      setState("gone");
      return;
    }
    setState("show");
    const a = setTimeout(() => setState("fade"), SPLASH_MS);
    const b = setTimeout(() => setState("gone"), SPLASH_MS + 350);
    return () => (clearTimeout(a), clearTimeout(b));
  }, [onLogin]);
  if (state === "gone") return null;
  return (
    <div className={`${styles.splash} ${state === "fade" ? styles.splashFade : ""}`} onClick={() => setState("gone")} role="presentation" data-testid="pda-splash">
      <div className={styles.splashBrand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logilink-logo-dark.svg" alt="LogiLink" height={30} />
        <span>PDA · 상차 · 입고검수</span>
      </div>
    </div>
  );
}

/** 단말 상태 표시줄 — 시각·신호·배터리 (시각은 브라우저에서만 그린다) */
function StatusBar() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={styles.status} aria-hidden="true">
      <span>{now}</span>
      <span className={styles.statusIcons}>
        <svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="4.3" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="8.6" y="3" width="3" height="9" rx="1" />
          <rect x="12.9" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="20" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor">
          <rect x="0.5" y="0.5" width="20" height="11" rx="3" />
          <rect x="2.5" y="2.5" width="14" height="7" rx="1.5" fill="currentColor" stroke="none" />
          <path d="M22.5 4v4" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}
