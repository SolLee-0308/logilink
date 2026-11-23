"use client";

import { useEffect, useState } from "react";
import styles from "./ScrollTopButton.module.css";

/** 이만큼 내려가면 버튼을 보인다 (px) */
const SHOW_AFTER = 240;
const GAP = 12;

/**
 * 맨 위로 — 모든 Web 화면 오른쪽 아래, 원 + 위쪽 화살표만 (2026-11-23 Sol)
 * 화면 아래에 붙는 저장·처리 줄(data-stick-bottom)이 보이면 그 위로 올라가 버튼을 가리지 않는다.
 */
export function ScrollTopButton() {
  const [shown, setShown] = useState(false);
  const [lift, setLift] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      setShown(window.scrollY > SHOW_AFTER);
      let top = vh;
      for (const el of document.querySelectorAll<HTMLElement>("[data-stick-bottom]")) {
        const r = el.getBoundingClientRect();
        if (r.height && r.top < vh && r.bottom > vh - 40) top = Math.min(top, r.top);
      }
      setLift(top < vh ? vh - top : 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 화면 내용이 바뀌어 저장 줄이 생기거나 사라질 때
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
    };
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      className={styles.btn}
      data-shown={shown || undefined}
      style={lift ? { bottom: `calc(${lift + GAP}px + env(safe-area-inset-bottom, 0px))` } : undefined}
      onClick={toTop}
      aria-label="맨 위로"
      title="맨 위로"
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M9 14V4M4.5 8.5 9 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
