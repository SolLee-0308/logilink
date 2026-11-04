"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Sheet } from "@/components/ui/Overlay";
import { RuleList, type Rule } from "@/components/ui/RuleList";
import { useToast } from "@/components/ui/Toast";
import type { ActionResult } from "@/server/action-result";
import styles from "./shared.module.css";

const RULE_SOURCE = "입고 업무프로세스 정의서 v1.4";

/** 기준정보 화면 공통 머리: 경로 → 제목·건수·도움말 (하위 화면 이동은 사이드바 하위 메뉴) */
export function MasterHeader({ title, count, rules }: { title: string; count?: number; rules: Rule[] }) {
  const [help, setHelp] = useState(false);
  return (
    <>
      <PageHeader crumbs={["관리", "기준정보", title]} title={title} count={count} onHelp={() => setHelp(true)} />
      <Sheet open={help} onClose={() => setHelp(false)} title="이 화면의 업무 규칙">
        <RuleList rules={rules} source={RULE_SOURCE} />
      </Sheet>
    </>
  );
}

/**
 * 기준정보 하위 화면 머리(상세·등록·엑셀 일괄 등록): 경로에 목록 화면을 넣고, 제목 왼쪽에 [← 목록]
 * backHref는 기본 주소이고, 목록이 기억해 둔 조회조건 주소(storageKey)가 있으면 그쪽으로 돌아간다.
 */
export function SubHeader({
  section,
  title,
  backHref,
  storageKey,
  rules,
  actions,
}: {
  /** 목록 화면 이름 (예: 품목) */
  section: string;
  title: string;
  backHref: string;
  storageKey?: string;
  rules?: Rule[];
  actions?: React.ReactNode;
}) {
  const [help, setHelp] = useState(false);
  const [href, setHref] = useState(backHref);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved?.startsWith(backHref)) setHref(saved);
    } catch {
      /* 저장소를 못 쓰면 기본 주소 */
    }
  }, [backHref, storageKey]);
  return (
    <>
      <Link href={href} className={styles.back}>
        ← {section} 목록
      </Link>
      <PageHeader crumbs={["관리", "기준정보", section, title]} title={title} onHelp={rules ? () => setHelp(true) : undefined} actions={actions} />
      {rules && (
        <Sheet open={help} onClose={() => setHelp(false)} title="이 화면의 업무 규칙">
          <RuleList rules={rules} source={RULE_SOURCE} />
        </Sheet>
      )}
    </>
  );
}

/** 첫 번째 오류 필드로 포커스 이동 — FormField가 오류일 때 data-invalid를 단다 */
export function focusFirstError(root: ParentNode = document) {
  requestAnimationFrame(() => {
    const el = root.querySelector<HTMLElement>(
      "[data-invalid] input:not([type=hidden]):not([readonly]), [data-invalid] select, [data-invalid] textarea, [data-invalid] button",
    );
    el?.focus();
  });
}

/**
 * 서버 액션 실행 — 결과를 토스트로 알리고, 실패하면 필드 오류를 돌려준다.
 * 다른 사용자가 먼저 수정했으면(CONFLICT) 안내한 뒤 최신 데이터를 자동으로 다시 불러온다.
 * 성공 시 서버가 경로를 다시 그려 목록이 최신으로 바뀐다.
 */
export function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  /** onConflict가 있으면(편집 모달) 그쪽에서 최신 내용을 다시 불러오고, 없으면 화면 전체를 새로 그린다 */
  function run<T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T | undefined) => void, onConflict?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setFieldErrors({});
        setError(null);
        toast.show(r.message);
        onOk?.(r.data);
        return;
      }
      if (r.code === "CONFLICT") {
        setFieldErrors({});
        setError(null);
        toast.show(r.error);
        if (onConflict) onConflict();
        else router.refresh();
        return;
      }
      setFieldErrors(r.fieldErrors ?? {});
      setError(r.fieldErrors ? null : r.error);
      toast.show(r.error);
      if (r.fieldErrors) focusFirstError();
    });
  }

  /** 화면에서 먼저 확인한 오류 (서버 호출 전) */
  function invalid(errors: Record<string, string>) {
    setFieldErrors(errors);
    setError(null);
    focusFirstError();
  }

  function reset() {
    setFieldErrors({});
    setError(null);
  }

  return { run, invalid, pending, fieldErrors, error, reset };
}

/** 선택 상태 — 걸러진 목록에 선택 건이 없으면 첫 행을 보여 준다. "new"는 등록 패널 */
export function useSelection<K extends string | number>(keys: K[]) {
  const [selected, setSelected] = useState<K | "new" | null>(null);
  const active: K | "new" | null =
    selected === "new" ? "new" : selected !== null && keys.includes(selected) ? selected : (keys[0] ?? null);
  return { active, select: setSelected };
}

/* 사용 여부 조회조건 */
export type ActiveFilter = "all" | "on" | "off";
export const ACTIVE_OPTIONS = [
  { value: "all" as const, label: "전체" },
  { value: "on" as const, label: "사용" },
  { value: "off" as const, label: "사용 안 함" },
];
export const matchActive = (f: ActiveFilter, active: boolean) => f === "all" || (f === "on") === active;
