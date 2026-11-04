"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AsnStatusBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { NoteBox } from "@/components/ui/NoteBox";
import { Sheet } from "@/components/ui/Overlay";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { ASN_ACTION_LABEL, canCancelAsn } from "@/domain/asn-rules";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { fmtDateTime } from "@/lib/format";
import { cancelAsn } from "@/server/asn/actions";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { SubHeader, useAction } from "@/features/master/shared";
import { ViewSection } from "@/features/master/record";
import { ASN_RULES } from "./rules";
import type { AsnDetail, AsnLineView } from "./types";
import { ASN_LIST_KEY, asnListUrl } from "./asn-list";
import styles from "./AsnDetailScreen.module.css";

function historyEntries(d: AsnDetail): TimelineEntry[] {
  return d.histories.map((h) => ({
    key: h.id,
    tone: h.action === "CANCEL" ? "reject" : "save",
    title: (
      <span>
        {h.actor} · {ASN_ACTION_LABEL[h.action]}
        {h.reasonName ? ` · ${h.reasonName}` : ""}
      </span>
    ),
    quote: h.reasonText ?? undefined,
    at: fmtDateTime(h.at),
  }));
}

/**
 * ASN 상세 (화주사, /plans/asn/[id]) — [상차지시서 인쇄], 상차 시작 전(등록)이면 [취소].
 * ASN은 고치지 않는다. 바뀌면 취소하고 새로 등록한다 (정의서 4-2).
 */
export function AsnDetailScreen({ detail: d, cancelReasons, today, issued }: { detail: AsnDetail; cancelReasons: ReasonOption[]; today: string; issued: boolean }) {
  const router = useRouter();
  const act = useAction();
  const [canceling, setCanceling] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const cancelable = canCancelAsn(d.status);
  const printHref = `/print/load-order/${d.id}`;
  const n = dday(d.shipDate, today);

  const columns: Column<AsnLineView>[] = [
    { key: "no", header: "#", align: "right", render: (l) => <span className="mono">{l.lineNo}</span> },
    { key: "plan", header: "입고예정번호", render: (l) => <span className="mono">{l.planNo}</span> },
    { key: "code", header: "품목코드", render: (l) => <span className="mono">{l.itemCode}</span> },
    { key: "name", header: "품목명", wrap: true, render: (l) => l.itemName },
    { key: "unit", header: "단위", render: (l) => <span className="mono">{l.unit}</span> },
    { key: "qty", header: "지시수량", align: "right", render: (l) => <span className="mono">{l.qty.toLocaleString()}</span> },
    {
      key: "base",
      header: "기준 환산",
      align: "right",
      render: (l) => (l.unit === l.baseUnit ? <span className="muted">–</span> : <span className="mono">{`${l.baseQty.toLocaleString()} ${l.baseUnit}`}</span>),
    },
    { key: "exp", header: "유통기한", render: (l) => (l.expiryDate ? <span className="mono">{l.expiryDate}</span> : <span className="muted">–</span>) },
    { key: "lot", header: "로트", render: (l) => (l.lotNo ? <span className="mono">{l.lotNo}</span> : <span className="muted">–</span>) },
  ];

  const openPrint = () => window.open(printHref, "_blank", "noopener");

  return (
    <>
      <SubHeader
        group={["입고 계획"]}
        section="ASN 등록"
        title={d.asnNo}
        backHref="/plans/asn"
        storageKey={ASN_LIST_KEY}
        rules={ASN_RULES}
        badges={<AsnStatusBadge status={d.status} />}
        actions={
          <div className={styles.actions}>
            {cancelable && (
              <Button variant="danger" onClick={() => setCanceling(true)} disabled={act.pending}>
                취소
              </Button>
            )}
            {d.loadOrder && d.status !== "CANCELED" && (
              <Button variant="primary" onClick={openPrint}>
                상차지시서 인쇄
              </Button>
            )}
          </div>
        }
      />

      {issued && d.loadOrder && d.status === "REGISTERED" && (
        <NoteBox
          tone="info"
          action={
            <Button size="sm" variant="primary" onClick={openPrint}>
              상차지시서 인쇄
            </Button>
          }
        >
          <strong>상차지시서 {d.loadOrder.orderNo}을(를) 발행했습니다.</strong> 인쇄해 차량 기사·상차담당에게 전달하세요. 상차담당이 PDA로 바코드를 스캔해 상차를 시작합니다.
        </NoteBox>
      )}
      {d.status === "REGISTERED" && !issued && <NoteBox tone="info">상차를 기다리고 있습니다. 상차를 시작하기 전까지는 취소할 수 있습니다. 내용이 바뀌면 취소하고 새로 등록하세요.</NoteBox>}
      {d.status === "REGISTERED" && n < 0 && <NoteBox tone="warn">출고일이 지났습니다. 이 차량이 오지 않으면 ASN을 취소하고, 다른 날 보낼 물량은 새 ASN에 담으세요.</NoteBox>}
      {d.status === "CANCELED" && (
        <NoteBox tone="warn">
          <strong>취소된 ASN입니다{d.cancelReasonName ? ` · ${d.cancelReasonName}` : ""}</strong>
          {d.cancelReasonText ? ` — "${d.cancelReasonText}"` : ""}
          <br />
          {d.canceledBy} · {fmtDateTime(d.canceledAt)}. 상차지시서도 함께 취소되었고, 담았던 수량은 다른 ASN에 다시 담을 수 있습니다.
        </NoteBox>
      )}
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}

      <Card title="ASN 정보">
        <div className={styles.infoGrid}>
          <ViewSection
            items={[
              ["ASN번호", <span key="n" className="mono">{d.asnNo}</span>],
              ["상차지시서", d.loadOrder ? <span key="o" className="mono">{d.loadOrder.orderNo}</span> : null],
              ["센터", d.centerName],
              ["출고일", <span key="d"><span className="mono">{d.shipDate}</span> · {ddayLabel(n)}</span>],
            ]}
          />
          <ViewSection
            items={[
              ["차량", <span key="v"><span className="mono">{d.vehicleNo}</span>{d.driverName ? ` · ${d.driverName}` : ""}{d.driverTel ? <span className="mono"> · {d.driverTel}</span> : ""}</span>],
              ["등록", `${fmtDateTime(d.createdAt)} · ${d.createdBy}`],
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

      <Card
        title="품목"
        count={d.lineCount}
        description={`입고예정 ${d.planNos.length}건: ${d.planNos.join(", ")}`}
        aside={<span className={`${styles.qty} mono`}>{d.qtyByUnit.map(([u, q]) => `${u} ${q.toLocaleString()}`).join(" · ")}</span>}
      >
        <DataTable caption="ASN 품목" columns={columns} rows={d.lines} rowKey={(l) => String(l.lineNo)} compact />
      </Card>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title={`처리 이력 · ${d.asnNo}`}>
        <Timeline entries={historyEntries(d)} />
      </Sheet>

      <RejectModal
        open={canceling}
        onClose={() => setCanceling(false)}
        title="ASN 취소"
        description="취소하면 상차지시서도 함께 취소되고 되돌릴 수 없습니다. 담았던 수량은 다른 ASN에 다시 담을 수 있습니다."
        reasonLabel="취소 사유"
        submitLabel="ASN 취소"
        closeLabel="닫기"
        placeholder="취소하는 이유를 적어 주세요."
        target={
          <span>
            <span className="mono">{d.asnNo}</span> · <span className="mono">{d.vehicleNo}</span> · {d.shipDate} · {d.lineCount}줄
          </span>
        }
        reasons={cancelReasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await cancelAsn({ id: d.id, version: d.version, reasonCode, reasonText });
          if (r.ok) act.run(async () => r, () => router.push(asnListUrl("canceled")));
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
