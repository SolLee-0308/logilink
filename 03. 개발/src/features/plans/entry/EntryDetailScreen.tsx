"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { NoteBox } from "@/components/ui/NoteBox";
import { Sheet } from "@/components/ui/Overlay";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { canShipperEdit, dday, ddayLabel } from "@/domain/plan-rules";
import { PLAN_ACTION_LABEL, PLAN_INPUT_METHOD_LABEL } from "@/domain/plan-status";
import { fmtDateTime } from "@/lib/format";
import { cancelPlan } from "@/server/plans/actions";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { SubHeader, useAction } from "@/features/master/shared";
import { ViewSection } from "@/features/master/record";
import { ENTRY_RULES } from "../rules";
import type { PlanDetail, PlanLineView } from "../types";
import { qtyInUnit } from "@/domain/load-rules";
import { planLineRemain } from "@/domain/rcv-rules";
import { ENTRY_LIST_KEY, entryListUrl } from "./entry-list";
import styles from "./EntryDetailScreen.module.css";

function historyEntries(d: PlanDetail): TimelineEntry[] {
  return d.histories.map((h) => ({
    key: h.id,
    tone: h.action === "REJECT" || h.action.startsWith("CANCEL") || h.action === "EXPIRE_CANCEL" ? "reject" : h.action === "APPROVE" ? "ok" : "save",
    title: (
      <span>
        {h.actor} · {PLAN_ACTION_LABEL[h.action]}
        {h.revisionNo > 1 ? ` (${h.revisionNo}차)` : ""}
        {h.reasonName ? ` · ${h.reasonName}` : ""}
      </span>
    ),
    quote: h.reasonText ?? undefined,
    at: fmtDateTime(h.at),
  }));
}

/**
 * 입고예정 상세 (화주사, /plans/entry/[id]) — 승인 전(승인대기·반려)이면 [수정]·[취소],
 * 반려면 사유를 보고 [수정해서 다시 요청]. 승인 후에는 조회만.
 */
export function EntryDetailScreen({ detail: d, cancelReasons, today }: { detail: PlanDetail; cancelReasons: ReasonOption[]; today: string }) {
  const router = useRouter();
  const act = useAction();
  const [canceling, setCanceling] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editable = canShipperEdit(d.status);
  const n = dday(d.planDate, today);

  const received = d.lines.some((l) => l.rcvQty > 0 || l.returnQty > 0);
  const qf = (l: PlanLineView, base: number) => qtyInUnit(base, l.unit, Math.max(Math.round(l.baseQty / Math.max(l.qty, 1)), 1), l.baseUnit);
  const columns: Column<PlanLineView>[] = [
    { key: "no", header: "#", align: "right", render: (l) => <span className="mono">{l.lineNo}</span> },
    { key: "code", header: "품목코드", render: (l) => <span className="mono">{l.itemCode}</span> },
    { key: "name", header: "품목명", wrap: true, render: (l) => l.itemName },
    { key: "unit", header: "단위", render: (l) => <span className="mono">{l.unit}</span> },
    { key: "qty", header: "수량", align: "right", render: (l) => <span className="mono">{l.qty.toLocaleString()}</span> },
    {
      key: "base",
      header: "기준 환산",
      align: "right",
      render: (l) => (l.unit === l.baseUnit ? <span className="muted">–</span> : <span className="mono">{`${l.baseQty.toLocaleString()} ${l.baseUnit}`}</span>),
    },
    { key: "exp", header: "유통기한", render: (l) => (l.expiryDate ? <span className="mono">{l.expiryDate}</span> : <span className="muted">{l.expiryManaged ? "없음" : "–"}</span>) },
    { key: "lot", header: "로트", render: (l) => (l.lotNo ? <span className="mono">{l.lotNo}</span> : <span className="muted">–</span>) },
    // 입고검수 확정 뒤 — 입고·반송·잔량 (입고예정 라인 단위로 묶어 표시, 기준 단위 누계)
    ...(received
      ? ([
          { key: "rcv", header: "입고", align: "right", render: (l) => <b className="mono">{qf(l, l.rcvQty)}</b> },
          { key: "ret", header: "반송", align: "right", render: (l) => (l.returnQty ? <span className="mono">{qf(l, l.returnQty)}</span> : <span className="muted">–</span>) },
          { key: "remain", header: "잔량", align: "right", render: (l) => <span className="mono">{qf(l, Math.max(planLineRemain(l), 0))}</span> },
        ] as Column<PlanLineView>[])
      : []),
  ];

  return (
    <>
      <SubHeader
        group={["입고 계획"]}
        section="입고예정 등록"
        title={d.planNo}
        backHref="/plans/entry"
        storageKey={ENTRY_LIST_KEY}
        rules={ENTRY_RULES}
        badges={
          <>
            <StatusBadge status={d.status} />
            {d.revisionNo > 1 && <Tag tone="accent">{d.revisionNo}차</Tag>}
          </>
        }
        actions={
          editable ? (
            <div className={styles.actions}>
              <Button variant="danger" onClick={() => setCanceling(true)} disabled={act.pending}>
                취소
              </Button>
              <LinkButton variant="primary" href={`/plans/entry/${d.id}/edit`}>
                {d.status === "REJECTED" ? "수정해서 다시 요청" : "수정"}
              </LinkButton>
            </div>
          ) : undefined
        }
      />

      {d.status === "REJECTED" && d.lastReject && (
        <NoteBox tone="warn">
          <strong>
            {d.lastReject.revisionNo}차 반려 · {d.lastReject.reasonName}
          </strong>
          {d.lastReject.reasonText ? ` — "${d.lastReject.reasonText}"` : ""}
          <br />
          {d.lastReject.rejectedBy} · {fmtDateTime(d.lastReject.rejectedAt)}. 내용을 고쳐 [수정해서 다시 요청]을 누르면 {d.revisionNo + 1}차로 다시 승인대기가 됩니다.
        </NoteBox>
      )}
      {editable && n < 0 && <NoteBox tone="warn">입고예정일이 지났습니다. 승인 전 상태로 남아 있으면 일마감 때 기한경과 취소됩니다. 날짜를 고쳐 다시 저장하거나 취소하세요.</NoteBox>}
      {d.status === "WAITING" && <NoteBox tone="info">3PL 승인을 기다리고 있습니다. 승인 전까지는 수정하거나 취소할 수 있습니다.</NoteBox>}
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}

      {/* 입고예정 정보 2단 — 왼쪽 번호·센터·입고예정일·등록 방식 / 오른쪽 차수·승인·메모·처리 이력 (승인 상세와 같은 구성) */}
      <Card title="입고예정 정보">
        <div className={styles.infoGrid}>
          <ViewSection
            items={[
              ["입고예정번호", <span key="n" className="mono">{d.planNo}</span>],
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
                  <button type="button" className={styles.link} onClick={() => setHistoryOpen(true)}>
                    이력 보기
                  </button>
                </span>,
              ],
            ]}
          />
        </div>
      </Card>

      <Card title="품목" count={d.lineCount} aside={<span className={`${styles.qty} mono`}>{d.qtyByUnit.map(([u, q]) => `${u} ${q.toLocaleString()}`).join(" · ")}</span>}>
        <DataTable caption="입고예정 품목" columns={columns} rows={d.lines} rowKey={(l) => String(l.lineNo)} compact />
      </Card>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title={`처리 이력 · ${d.planNo}`}>
        <Timeline entries={historyEntries(d)} />
      </Sheet>

      <RejectModal
        open={canceling}
        onClose={() => setCanceling(false)}
        title="입고예정 취소"
        description="취소하면 되돌릴 수 없습니다. 다시 입고하려면 새로 등록하세요."
        reasonLabel="취소 사유"
        submitLabel="입고예정 취소"
        closeLabel="닫기"
        placeholder="취소하는 이유를 적어 주세요."
        target={
          <span>
            <span className="mono">{d.planNo}</span> · {d.centerName} · {d.planDate} · {d.lineCount}품목
          </span>
        }
        reasons={cancelReasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await cancelPlan({ id: d.id, version: d.version, reasonCode, reasonText });
          if (r.ok) act.run(async () => r, () => router.push(entryListUrl("canceled")));
          else if (r.code === "CONFLICT" || r.code === "STATE") {
            setCanceling(false);
            act.run(async () => r);
            return { ok: true, message: "" };
          }
          return r;
        }}
      />
    </>
  );
}
