import { Badge } from "@/components/ui/Badges";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { qtyInUnit } from "@/domain/load-rules";
import type { StatusTone } from "@/domain/plan-status";
import { RCV_LINE_STATE_LABEL, RCV_STATUS_META, type RcvLineState } from "@/domain/rcv-rules";
import { fmtDateTime } from "@/lib/format";
import { ViewSection } from "@/features/master/record";
import type { RcvAllocView, RcvLineView, RcvView } from "./types";
import styles from "@/features/loads/LoadSection.module.css";

const STATE_TONE: Record<RcvLineState, StatusTone> = { todo: "cancel", short: "rej", match: "done", over: "wait", zero: "close", mismatch: "rej" };
const STEP_LABEL: Record<number, string> = { 1: "1단계 · 원 ASN", 2: "2단계 · 미종결 입고예정", 3: "3단계 · 초과" };

/**
 * 입고검수 결과 카드 — 화주사 담당자·3PL이 웹(ASN 상세·무지시 상차 상세)에서 검수 진행·결과·자동 배분을 본다 (입력은 PDA에서만).
 * 근거: 정의서 v1.4 ⑥ · 5-2 (배분 결과 = 검수 라인, 입고예정, 배분수량, 배분 단계)
 */
export function RcvSection({ rcv }: { rcv: RcvView }) {
  const done = rcv.status === "CONFIRMED";
  const meta = RCV_STATUS_META[rcv.status];
  const f = (l: RcvLineView, n: number) => qtyInUnit(n, l.showUnit, l.showFactor, l.baseUnit);
  const columns: Column<RcvLineView>[] = [
    { key: "code", header: "품목코드", render: (l) => <span className="mono">{l.itemCode}</span> },
    { key: "name", header: "품목명", wrap: true, render: (l) => l.itemName },
    { key: "expect", header: "상차", align: "right", render: (l) => <span className="mono">{l.mismatch ? "–" : f(l, l.expect)}</span> },
    { key: "good", header: "정상", align: "right", render: (l) => <b className="mono">{l.mismatch ? "–" : f(l, l.good)}</b> },
    { key: "ret", header: "반송", align: "right", render: (l) => <span className="mono">{l.damaged || l.mismatchQty ? f(l, l.damaged + l.mismatchQty) : "–"}</span> },
    {
      key: "diff",
      header: "차이",
      align: "right",
      render: (l) =>
        l.mismatch || l.diff === 0 ? (
          <span className="muted">0</span>
        ) : (
          <span className={`mono ${l.diff < 0 ? styles.minus : styles.plus}`}>
            {l.diff > 0 ? "+" : "−"}
            {f(l, Math.abs(l.diff))}
          </span>
        ),
    },
    { key: "state", header: "결과", render: (l) => <Badge tone={STATE_TONE[l.state]}>{RCV_LINE_STATE_LABEL[l.state]}</Badge> },
    {
      key: "reason",
      header: "사유 · 사진",
      wrap: true,
      render: (l) => (
        <span>
          {l.reasonName ?? ""}
          {l.reasonText ? ` — "${l.reasonText}"` : ""}
          {l.imageIds.map((id, i) => (
            <a key={id} href={`/rcv-image/${id}`} target="_blank" rel="noopener" className="mono">
              {" "}
              [사진{i + 1}]
            </a>
          ))}
        </span>
      ),
    },
  ];
  const allocColumns: Column<RcvAllocView & { i: number }>[] = [
    { key: "item", header: "품목", wrap: true, render: (a) => a.itemName },
    { key: "plan", header: "입고예정", render: (a) => (a.planNo ? <span className="mono">{a.planNo}</span> : <span className="muted">입고예정 없음</span>) },
    { key: "kind", header: "구분", render: (a) => (a.kind === "GOOD" ? "입고" : "반송") },
    { key: "step", header: "배분 단계", render: (a) => (a.step === 3 ? <Badge tone="wait">{STEP_LABEL[3]}</Badge> : STEP_LABEL[a.step]) },
    { key: "qty", header: "수량", align: "right", render: (a) => <b className="mono">{a.qty}</b> },
  ];
  return (
    <Card title="입고검수" description={`PDA 입력 ${rcv.inputs.filter((i) => !i.canceled).length}건 · 검수자 ${rcv.workers.length}명`}>
      <div className={styles.info}>
        <ViewSection
          items={[
            ["검수 상태", <Badge key="s" tone={meta.tone}>{meta.label}</Badge>],
            ["검수 번호", <span key="n" className="mono">{rcv.rcvNo}</span>],
            ["검수 시작", `${fmtDateTime(rcv.createdAt)} · ${rcv.createdBy}`],
            ["검수 확정", done ? `${fmtDateTime(rcv.confirmedAt)} · ${rcv.confirmedBy}` : null],
          ]}
        />
        <ViewSection items={[["검수자", rcv.workers.length ? rcv.workers.map((w) => `${w.name} ${w.count}건`).join(", ") : null]]} />
      </div>
      <DataTable caption="검수 품목" columns={columns} rows={rcv.lines} rowKey={(l) => String(l.itemId)} compact empty="검수 품목이 없습니다." />
      {done && (
        <div style={{ marginTop: 12 }}>
          <DataTable caption="자동 배분 결과" columns={allocColumns} rows={rcv.allocs.map((a, i) => ({ ...a, i }))} rowKey={(a) => String(a.i)} compact empty="배분한 수량이 없습니다 (0 확인·품목 불일치만)." />
        </div>
      )}
    </Card>
  );
}
