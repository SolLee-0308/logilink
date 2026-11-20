"use client";

import { useEffect, type RefObject } from "react";

/**
 * 그리드 열 제목 고정 (2026-11-14 Sol) — 목록을 내려도 열 제목이 조회조건 바 바로 아래에 붙어 있다.
 * 표는 가로 스크롤 상자(overflow-x) 안에 있어 CSS sticky가 먹지 않으므로, 화면을 내린 만큼 thead를 아래로 옮긴다.
 * 기준선 = 위치 고정된 조회조건 바(--filterbar-h) + 바 둘레 흰 띠(8px). 조회조건이 없는 화면은 화면 맨 위.
 */
export function useStickyHead(tableRef: RefObject<HTMLTableElement | null>, enabled = true) {
  useEffect(() => {
    const table = tableRef.current;
    const head = table?.tHead;
    if (!enabled || !table || !head) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--filterbar-h")) || 0;
      const line = bar ? bar + 8 : 0;
      const t = table.getBoundingClientRect();
      const max = t.height - head.offsetHeight - (table.tBodies[0]?.rows[0]?.offsetHeight ?? 0);
      const y = Math.min(Math.max(line - t.top, 0), Math.max(max, 0));
      head.style.transform = y ? `translateY(${y}px)` : "";
      head.dataset.stuck = y ? "true" : "";
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    const ro = new ResizeObserver(queue);
    ro.observe(table);
    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      head.style.transform = "";
    };
  }, [tableRef, enabled]);
}
