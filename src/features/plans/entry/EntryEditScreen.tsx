"use client";

import { useRouter } from "next/navigation";
import { SubHeader } from "@/features/master/shared";
import { ENTRY_RULES } from "../rules";
import type { EntryOptions, PlanDetail } from "../types";
import { ENTRY_LIST_KEY } from "./entry-list";
import { PlanEditor, fromSaved } from "./PlanEditor";

/**
 * 입고예정 수정·재요청 (/plans/entry/[id]/edit) — 화면을 열 때 서버에서 최신 내용·version을 읽는다.
 * 반려 건을 저장하면 차수가 1 올라가 다시 승인대기가 된다 (서버 규칙).
 */
export function EntryEditScreen({ detail: d, options }: { detail: PlanDetail; options: EntryOptions }) {
  const router = useRouter();
  const resubmit = d.status === "REJECTED";
  return (
    <>
      <SubHeader
        group={["입고 계획"]}
        section="입고예정 등록"
        title={`${resubmit ? "수정해서 다시 요청" : "수정"} · ${d.planNo}`}
        backHref="/plans/entry"
        storageKey={ENTRY_LIST_KEY}
        rules={ENTRY_RULES}
      />
      <PlanEditor
        key={d.version}
        options={options}
        method={d.inputMethod}
        plan={{ id: d.id, version: d.version, planNo: d.planNo, status: d.status }}
        initial={{ centerId: String(d.centerId), planDate: d.planDate < options.today ? "" : d.planDate, memo: d.memo ?? "", lines: d.lines.map(fromSaved) }}
        submitLabel={resubmit ? `${d.revisionNo + 1}차로 다시 요청` : "수정 저장"}
        onCancel={() => router.push(`/plans/entry/${d.id}`)}
        onSaved={(id) => router.push(`/plans/entry/${id}`)}
      />
    </>
  );
}
