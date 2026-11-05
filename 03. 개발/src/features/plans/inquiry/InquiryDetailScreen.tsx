"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AsnStatusBadge, StatusBadge, Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { NoteBox } from "@/components/ui/NoteBox";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { qtyInUnit } from "@/domain/load-rules";
import { daysBetween, elapsedDays, isOverdue, progressPct } from "@/domain/inquiry-rules";
import { PLAN_ACTION_LABEL, PLAN_INPUT_METHOD_LABEL } from "@/domain/plan-status";
import { fmtDateTime, fmtShortDateTime } from "@/lib/format";
import { cancelApprovedPlan } from "@/server/plans/actions";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { SubHeader, useAction } from "@/features/master/shared";
import { ViewSection } from "@/features/master/record";
import type { PlanLineView } from "../types";
import { INQUIRY_LIST_KEY } from "./inquiry-list";
import { INQUIRY_RULES } from "./rules";
import type { InquiryDetail } from "./types";
import styles from "./InquiryDetailScreen.module.css";

type Alloc = InquiryDetail["allocs"][number];
type Vehicle = InquiryDetail["vehicles"][number];

const STEP_LABEL: Record<number, string> = { 1: "1단계 · 원 ASN", 2: "2단계 · 같은 화주사 미종결", 3: "3단계 · 초과" };

function historyEntries(d: InquiryDetail): TimelineEntry[] {
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
 * 입고예정 조회 상세 (/plans/inquiry/[id]) — 라인별 입고·반송·잔량 + 실린 차량 + 배분 이력 + 처리 이력.
 * 3PL은 승인 상태이고 후행 전표가 없을 때 [승인 건 취소]를 할 수 있다 (C3).
 */
export function InquiryDetailScreen({ detail: d, cancelReasons, today }: { detail: InquiryDetail; cancelReasons: ReasonOption[]; today: string }) {
  const router = useRouter();
  const act = useAction();
  const [canceling, setCanceling] = useState(false);

  const factor = (l: PlanLineView) => Math.max(Math.round(l.baseQty / Math.max(l.qty, 1)), 1);
  const qf = (l: PlanLineView, base: number) => qtyInUnit(base, l.unit, factor(l), l.baseUnit);
  const remain = (l: PlanLineView) => Math.max(l.baseQty - l.rcvQty - l.returnQty - l.closeQty, 0);
  const elapsed = elapsedDays(d.status, d.planDate, today);
  const over = isOverdue(elapsed, d.alertDays);
  const pct = progressPct(d.lines);
  const showCancel = d.canCancel && d.status === "APPROVED";

  const lineColumns: Column<PlanLineView>[] = [
    { key: "no", header: "#", align: "right", render: (l) => <span className="mono">{l.lineNo}</span> },
    { key: "code", header: "품목코드", render: (l) => <span className="mono">{l.itemCode}</span> },
    { key: "name", header: "품목명", wrap: true, render: (l) => l.itemName },
    { key: "exp", header: "유통기한·로트", render: (l) => (l.expiryDate || l.lotNo ? <span className="mono">{[l.expiryDate, l.lotNo].filter(Boolean).join(" · ")}</span> : <span className="muted">–</span>) },
    { key: "qty", header: "승인", align: "right", render: (l) => <span className="mono">{qf(l, l.baseQty)}</span> },
    {
      key: "incoming",
      header: "오는 중",
      align: "right",
      render: (l) => (d.incoming[l.lineNo] ? <b className={`${styles.incoming} mono`}>{qf(l, d.incoming[l.lineNo])}</b> : <span className="muted">–</span>),
    },
    { key: "rcv", header: "입고", align: "right", render: (l) => (l.rcvQty ? <span className="mono">{qf(l, l.rcvQty)}</span> : <span className="muted">–</span>) },
    { key: "ret", header: "반송", align: "right", render: (l) => (l.returnQty ? <span className="mono">{qf(l, l.returnQty)}</span> : <span className="muted">–</span>) },
    { key: "close", header: "종결", align: "right", render: (l) => (l.closeQty ? <span className="mono">{qf(l, l.closeQty)}</span> : <span className="muted">–</span>) },
    { key: "remain", header: "잔량", align: "right", render: (l) => (remain(l) ? <b className="mono">{qf(l, remain(l))}</b> : <span className="muted">0</span>) },
    { key: "pct", header: "진행률", align: "right", render: (l) => <span className="mono">{progressPct([l])}%</span> },
  ];

  const vehicleColumns: Column<Vehicle>[] = [
    { key: "date", header: "출고일", render: (v) => <span className="mono">{v.shipDate}</span> },
    { key: "vehicle", header: "차량", render: (v) => <b className="mono">{v.vehicleNo}</b> },
    { key: "asn", header: "ASN번호", render: (v) => <span className="mono">{v.asnNo}</span> },
    { key: "qty", header: "이 입고예정에서 담은 수량", render: (v) => <span className="mono">{`${v.lineCount}줄 · ${v.qtyByUnit.map(([u, n]) => `${u} ${n.toLocaleString()}`).join(" · ")}`}</span> },
    { key: "status", header: "상태", render: (v) => <AsnStatusBadge status={v.status} /> },
  ];

  const allocColumns: Column<Alloc>[] = [
    { key: "at", header: "검수 확정", render: (a) => <span className="mono">{fmtShortDateTime(a.confirmedAt)}</span> },
    { key: "rcv", header: "검수번호", render: (a) => <span className="mono">{a.rcvNo}</span> },
    { key: "vehicle", header: "차량", render: (a) => <span className="mono">{a.vehicleNo}</span> },
    { key: "asn", header: "ASN번호", render: (a) => (a.asnNo ? <span className="mono">{a.asnNo}</span> : <span className="muted">–</span>) },
    { key: "step", header: "배분 단계", render: (a) => STEP_LABEL[a.step] ?? `${a.step}단계` },
    { key: "item", header: "품목", wrap: true, render: (a) => <span>{`#${a.lineNo} ${a.itemName}`}</span> },
    { key: "kind", header: "구분", render: (a) => (a.kind === "GOOD" ? "입고" : <span className={styles.ret}>반송</span>) },
    { key: "qty", header: "수량", align: "right", render: (a) => <span className="mono">{qtyInUnit(a.qty, a.unit, a.factor, a.baseUnit)}</span> },
  ];

  return (
    <>
      <SubHeader
        group={["입고 계획"]}
        section="입고예정 조회"
        title={d.planNo}
        backHref="/plans/inquiry"
        storageKey={INQUIRY_LIST_KEY}
        rules={INQUIRY_RULES}
        badges={
          <>
            <StatusBadge status={d.status} />
            {over && <Tag tone="danger">{elapsed}일 경과</Tag>}
          </>
        }
        actions={
          showCancel ? (
            <Button variant="danger" onClick={() => setCanceling(true)} disabled={act.pending || !!d.cancelBlock} title={d.cancelBlock ?? undefined}>
              승인 건 취소
            </Button>
          ) : undefined
        }
      />

      {showCancel && d.cancelBlock && <NoteBox tone="info">{d.cancelBlock}</NoteBox>}
      {over && (
        <NoteBox tone="warn">
          입고예정일 후 <strong>{elapsed}일</strong>이 지났지만 잔량이 남아 있습니다 (기준 {d.alertDays}일). 더 입고되지 않으면 잔량 종결 대상입니다.
        </NoteBox>
      )}
      {d.status === "CANCELED" && (
        <NoteBox tone="warn">
          <strong>승인 건 취소 · {d.cancelReasonName}</strong>
          {d.cancelReasonText ? ` — "${d.cancelReasonText}"` : ""}
          <br />
          {d.canceledBy} · {fmtDateTime(d.canceledAt)}. 취소는 최종 상태입니다. 다시 입고하려면 새 입고예정을 등록합니다.
        </NoteBox>
      )}
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}

      <Card title="입고예정 정보">
        <div className={styles.infoGrid}>
          <ViewSection
            items={[
              ["입고예정번호", <span key="n" className="mono">{d.planNo}</span>],
              ["화주사", d.clientName],
              ["센터", d.centerName],
              [
                "입고예정일",
                <span key="d">
                  <span className="mono">{d.planDate}</span> · {elapsed > 0 ? <span className={over ? styles.over : undefined}>{elapsed}일 경과</span> : ddayLabel(dday(d.planDate, today))}
                </span>,
              ],
              ["등록 방식", PLAN_INPUT_METHOD_LABEL[d.inputMethod]],
            ]}
          />
          <ViewSection
            items={[
              ["승인", d.approvedAt ? `${fmtDateTime(d.approvedAt)} · ${d.approvedBy} (${d.approvedRevisionNo}차) · 승인 후 ${daysBetween(d.approvedAt.slice(0, 10), today)}일` : null],
              [
                "진행률",
                <span key="p" className={styles.progress}>
                  <span className={styles.bar} aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="mono">{pct}%</span>
                </span>,
              ],
              ["차량", d.vehicles.filter((v) => v.status !== "CANCELED").length ? `${d.vehicles.filter((v) => v.status !== "CANCELED").length}대` : "ASN 없음"],
              ["메모", d.memo],
            ]}
          />
        </div>
      </Card>

      <Card title="품목별 입고현황" count={d.lineCount} description="수량은 입고예정 단위로 보여 줍니다. 잔량 = 승인 − 입고 − 반송 − 종결">
        <DataTable caption="품목별 입고현황" columns={lineColumns} rows={d.lines} rowKey={(l) => String(l.lineNo)} compact />
      </Card>

      <Card title="실린 차량 (ASN)" count={d.vehicles.length}>
        <DataTable caption="실린 차량" columns={vehicleColumns} rows={d.vehicles} rowKey={(v) => String(v.id)} compact empty="아직 이 입고예정을 담은 ASN이 없습니다." />
      </Card>

      <Card title="배분 이력" count={d.allocs.length} description="입고검수 확정 때 자동 배분(5-2)으로 이 입고예정에 들어온 입고·반송">
        <DataTable caption="배분 이력" columns={allocColumns} rows={d.allocs} rowKey={(a) => String(a.id)} compact empty="아직 검수 확정으로 배분된 수량이 없습니다." />
      </Card>

      <Card title="처리 이력" count={d.histories.length}>
        <Timeline entries={historyEntries(d)} />
      </Card>

      <RejectModal
        open={canceling}
        onClose={() => setCanceling(false)}
        title="승인 건 취소"
        description="취소는 최종 상태이며 되돌릴 수 없습니다. 다시 입고하려면 화주사가 새 입고예정을 등록해야 합니다."
        reasonLabel="취소 사유"
        submitLabel="승인 건 취소"
        closeLabel="닫기"
        placeholder="취소하는 이유를 적어 주세요."
        target={
          <span>
            <span className="mono">{d.planNo}</span> · {d.clientName} · {d.centerName} · {d.planDate} · {d.lineCount}품목
          </span>
        }
        reasons={cancelReasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await cancelApprovedPlan({ id: d.id, version: d.version, reasonCode, reasonText });
          if (r.ok) act.run(async () => r, () => router.refresh());
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
