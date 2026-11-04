"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { NoteBox } from "@/components/ui/NoteBox";
import { Sheet } from "@/components/ui/Overlay";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { useToast } from "@/components/ui/Toast";
import { PLAN_ACTION_LABEL, PLAN_INPUT_METHOD_LABEL } from "@/domain/plan-status";
import { dday, ddayLabel, diffLines, type LineDiff } from "@/domain/plan-rules";
import { fmtDateTime } from "@/lib/format";
import { approvePlan, loadPlanDetail, rejectPlan } from "@/server/plans/actions";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { SubHeader, useAction } from "@/features/master/shared";
import { ViewSection } from "@/features/master/record";
import { APPROVAL_LIST_KEY, approvalListUrl } from "./approval-list";
import { qtyText } from "./ApprovalScreen";
import { APPROVAL_RULES } from "./rules";
import type { ApprovalQueue, PlanDetail, PlanLineView } from "./types";
import styles from "./ApprovalScreen.module.css";
import page from "./ApprovalDetailScreen.module.css";

/** 처리 시점 version 충돌 후 다시 불러온 내용과 비교하기 위한 이전 라인 */
type ChangeMarks = { diffs: LineDiff[]; removed: PlanLineView[]; fromVersion: number };

/**
 * 승인 상세 (/plans/approval/[id]) — 화면을 열 때 서버에서 최신 내용과 version을 읽고, 그 version으로 승인·반려한다 (D1).
 * 품목을 직접 확인한 뒤 한 건씩만 처리하고, 처리하면 다음 승인대기 건이 열린다.
 */
export function ApprovalDetailScreen({
  detail: initial,
  queue,
  reasons,
  today,
}: {
  detail: PlanDetail;
  queue: ApprovalQueue;
  reasons: ReasonOption[];
  today: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const act = useAction();
  const [detail, setDetail] = useState(initial);
  const [conflict, setConflict] = useState<string | null>(null);
  const [marks, setMarks] = useState<ChangeMarks | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const d = detail;
  const n = dday(d.planDate, today);
  const waiting = d.status === "WAITING";
  // 재요청 건: 직전 반려본과 비교 (승인대기일 때만 — 반려 상태면 반려본 = 현재 내용)
  const compare = waiting && d.revisionNo > 1 && d.lastReject ? diffLines(d.lines, d.lastReject.lines) : null;
  const managed = d.lines.some((l) => l.expiryManaged || l.lotManaged);

  /** 처리 후: 다음 승인대기 건, 없으면 목록 */
  function goNext() {
    router.push(queue.afterId ? `/plans/approval/${queue.afterId}` : approvalListUrl());
  }

  /** 충돌 후 [변경 내용 불러오기] — 바뀐 품목을 표시한다 */
  async function reload() {
    setReloading(true);
    const r = await loadPlanDetail(d.id);
    setReloading(false);
    if (!r.ok) return toast.show(r.error);
    const next = r.data!;
    const { diffs, removed } = diffLines(next.lines, d.lines);
    setMarks({ diffs, removed, fromVersion: d.version });
    setDetail(next);
    setConflict(null);
    act.reset();
    router.refresh();
    toast.show("최신 내용을 불러왔습니다. 변경된 품목을 확인하세요.");
  }

  function approve() {
    act.run(
      async () => {
        const r = await approvePlan({ id: d.id, version: d.version });
        if (!r.ok && (r.code === "CONFLICT" || r.code === "STATE")) setConflict(r.error);
        return r.ok || r.code !== "CONFLICT" ? r : { ...r, code: "STATE" as const };
      },
      () => goNext(),
    );
  }

  return (
    <>
      <SubHeader
        group={["입고 계획"]}
        section="승인 대기"
        title={d.planNo}
        backHref="/plans/approval"
        storageKey={APPROVAL_LIST_KEY}
        rules={APPROVAL_RULES}
        badges={
          <>
            <StatusBadge status={d.status} />
            {d.revisionNo > 1 && <Tag tone="accent">재요청 {d.revisionNo}차</Tag>}
          </>
        }
        actions={
          waiting && queue.position !== null ? (
            <div className={page.queue}>
              <span className="muted">
                승인대기{" "}
                <strong className="mono">
                  {queue.position} / {queue.total}
                </strong>
              </span>
              <QueueLink id={queue.prevId} label="‹ 이전" />
              <QueueLink id={queue.nextId} label="다음 ›" />
            </div>
          ) : undefined
        }
      />

      {conflict && (
        <NoteBox
          tone="error"
          action={
            <Button size="sm" onClick={reload} disabled={reloading}>
              변경 내용 불러오기
            </Button>
          }
        >
          <strong>{conflict}</strong>
        </NoteBox>
      )}
      {marks && <NoteBox tone="info">화주사가 수정한 최신 내용입니다. 바뀐 품목에 표시가 있으니 확인한 뒤 처리하세요.</NoteBox>}
      {act.error && !conflict && <NoteBox tone="error">{act.error}</NoteBox>}
      {(d.status === "WAITING" || d.status === "REJECTED") && n < 0 && (
        <NoteBox tone="warn">
          입고예정일이 지났습니다. 오늘 일마감까지 {waiting ? "승인·반려하지 않으면" : "화주사가 다시 저장해 승인되지 않으면"} <strong>기한경과 취소</strong>로 자동
          정리됩니다.
        </NoteBox>
      )}
      {d.status === "REJECTED" && d.lastReject && (
        <NoteBox tone="info">
          반려 사유: <strong>{d.lastReject.reasonName}</strong>
          {d.lastReject.reasonText ? ` · ${d.lastReject.reasonText}` : ""}
          <br />
          화주사가 수정 후 다시 저장하면 차수가 {d.revisionNo + 1}차로 올라가고 승인대기로 돌아옵니다.
        </NoteBox>
      )}

      <Card title="입고예정 정보">
        <div className={page.infoGrid}>
          <ViewSection
            items={[
              ["화주사", d.clientName],
              ["센터", d.centerName],
              ["입고예정일", <span key="d"><span className="mono">{d.planDate}</span> · {ddayLabel(n)}</span>],
              ["등록 방식", PLAN_INPUT_METHOD_LABEL[d.inputMethod]],
            ]}
          />
          <ViewSection
            items={[
              ["차수", `${d.revisionNo}차 · 최종 저장 ${fmtDateTime(d.savedAt)} ${d.savedBy}`],
              ["승인", d.approvedAt ? `${fmtDateTime(d.approvedAt)} · ${d.approvedBy} (${d.approvedRevisionNo}차)` : null],
              ["메모", d.memo],
              [
                "처리 이력",
                <span key="h">
                  {d.histories.length}건 ·{" "}
                  <button type="button" className={page.link} onClick={() => setHistoryOpen(true)}>
                    이력 보기
                  </button>
                </span>,
              ],
            ]}
          />
        </div>
      </Card>

      <Card
        title="품목"
        count={d.lineCount}
        aside={
          <>
            {compare && <Tag tone="accent">직전 반려본({d.lastReject!.revisionNo}차) 대비</Tag>}
            <span className={`${page.qty} mono`}>{qtyText(d.qtyByUnit)}</span>
          </>
        }
      >
          <div className={styles.linesWrap}>
            <table className={styles.lines}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>품목</th>
                  <th>단위</th>
                  {managed && <th>유통기한 · 로트</th>}
                  {compare && <th className={styles.num}>직전</th>}
                  <th className={styles.num}>수량</th>
                  <th className={styles.num}>기준 환산</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => {
                  const c = compare?.diffs[i];
                  const m = marks?.diffs[i];
                  return (
                    <tr key={l.lineNo}>
                      <td className="mono muted">{l.lineNo}</td>
                      <td>
                        {l.itemName}
                        <span className={`${styles.sub} mono`}>{l.itemCode}</span>
                      </td>
                      <td className="mono">{l.unit}</td>
                      {managed && (
                        <td className="mono">
                          {l.expiryManaged ? l.expiryDate : "–"}
                          <span className={styles.sub}>{l.lotManaged ? l.lotNo : ""}</span>
                        </td>
                      )}
                      {compare && <td className={`${styles.num} mono`}>{c?.kind === "new" ? "–" : c?.kind === "changed" ? c.prev.toLocaleString() : l.qty.toLocaleString()}</td>}
                      <td className={`${styles.num} mono`}>
                        {l.qty.toLocaleString()}
                        {c && <DiffMark diff={c} qty={l.qty} />}
                        {m && <DiffMark diff={m} qty={l.qty} reload />}
                      </td>
                      <td className={`${styles.num} mono`}>{l.unit === l.baseUnit ? <span className="muted">–</span> : `${l.baseQty.toLocaleString()} ${l.baseUnit}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {compare && compare.removed.length > 0 && (
            <p className={styles.removed}>
              직전 반려본에서 빠진 품목: {compare.removed.map((r) => `${r.itemName} ${r.unit} ${r.qty.toLocaleString()}`).join(", ")}
            </p>
          )}
          {marks && marks.removed.length > 0 && (
            <p className={styles.removed}>이번 수정에서 빠진 품목: {marks.removed.map((r) => `${r.itemName} ${r.unit} ${r.qty.toLocaleString()}`).join(", ")}</p>
          )}
      </Card>

      {waiting && (
        <div className={page.foot}>
          <span className="muted">품목과 수량을 확인한 뒤 처리하세요. 처리하면 {queue.afterId ? "다음 승인대기 건이 열립니다." : "목록으로 돌아갑니다."}</span>
          <Button variant="danger" onClick={() => setRejecting(true)} disabled={act.pending || !!conflict}>
            반려
          </Button>
          <Button variant="primary" onClick={approve} disabled={act.pending || !!conflict}>
            {act.pending ? "처리 중…" : "승인"}
          </Button>
        </div>
      )}

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title={`처리 이력 · ${d.planNo}`}>
        <Timeline entries={historyEntries(d)} />
      </Sheet>

      <RejectModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="입고예정 반려"
        description="반려하면 지금 내용이 반려본으로 보관되고, 화주사가 사유를 확인해 수정 후 다시 요청합니다."
        target={
          <span>
            <span className="mono">{d.planNo}</span> · {d.clientName} · {d.lineCount}종
          </span>
        }
        reasons={reasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await rejectPlan({ id: d.id, version: d.version, reasonCode, reasonText });
          if (r.ok) act.run(async () => r, () => goNext());
          else if (r.code === "CONFLICT" || r.code === "STATE") {
            setConflict(r.error);
            setRejecting(false);
            return { ok: true, message: "" };
          }
          return r;
        }}
      />
    </>
  );
}

function QueueLink({ id, label }: { id: number | null; label: string }) {
  return id ? (
    <LinkButton size="sm" href={`/plans/approval/${id}`}>
      {label}
    </LinkButton>
  ) : (
    <Button size="sm" disabled>
      {label}
    </Button>
  );
}

function DiffMark({ diff, qty, reload }: { diff: LineDiff; qty: number; reload?: boolean }) {
  if (diff.kind === "same") return null;
  if (diff.kind === "new") return <small className={styles.new}>{reload ? "추가됨" : "신규"}</small>;
  const delta = qty - diff.prev;
  if (reload)
    return (
      <small className={delta > 0 ? styles.up : styles.down}>
        {diff.prev.toLocaleString()}→{qty.toLocaleString()}
      </small>
    );
  return (
    <small className={delta > 0 ? styles.up : styles.down}>
      {delta > 0 ? "+" : ""}
      {delta.toLocaleString()}
    </small>
  );
}

function historyEntries(d: PlanDetail): TimelineEntry[] {
  return d.histories.map((h) => ({
    key: h.id,
    tone: h.action === "REJECT" ? "reject" : h.action === "APPROVE" ? "ok" : ["CREATE", "UPDATE", "RESUBMIT"].includes(h.action) ? "save" : "neutral",
    title: (
      <span>
        {h.actor} · {PLAN_ACTION_LABEL[h.action]} ({h.revisionNo}차){h.reasonName ? ` · ${h.reasonName}` : ""}
      </span>
    ),
    quote: h.reasonText ?? undefined,
    at: fmtDateTime(h.at),
  }));
}
