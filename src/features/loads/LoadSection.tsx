"use client";

import { Badge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { LINE_STATE_LABEL, LOAD_STATUS_META, LOAD_TYPE_LABEL, qtyInUnit, type LineState } from "@/domain/load-rules";
import type { StatusTone } from "@/domain/plan-status";
import { fmtDateTime, fmtShortDateTime } from "@/lib/format";
import { ViewSection } from "@/features/master/record";
import type { LoadLineView, LoadView } from "./types";
import styles from "./LoadSection.module.css";

const STATE_TONE: Record<LineState, StatusTone> = { match: "done", short: "rej", over: "wait", extra: "wait" };

/** 품목별 지시·상차·차이 — 웹(ASN 상세·무지시 상차 상세)에서 같이 쓴다 */
export function LoadLinesTable({ load }: { load: LoadView }) {
  const ordered = load.type === "ORDERED";
  const f = (l: LoadLineView, n: number) => qtyInUnit(n, l.showUnit, l.showFactor, l.baseUnit);
  const columns: Column<LoadLineView>[] = [
    { key: "code", header: "품목코드", render: (l) => <span className="mono">{l.itemCode}</span> },
    { key: "name", header: "품목명", wrap: true, render: (l) => l.itemName },
    ...(ordered ? [{ key: "order", header: "지시", align: "right" as const, render: (l: LoadLineView) => <span className="mono">{l.orderBase ? f(l, l.orderBase) : "–"}</span> }] : []),
    {
      key: "load",
      header: "상차",
      align: "right",
      render: (l) => (
        <span className="mono">
          <b>{f(l, l.loadBase)}</b>
          {l.showUnit !== l.baseUnit && l.loadBase > 0 && <span className="muted"> ({l.loadBase.toLocaleString()} {l.baseUnit})</span>}
        </span>
      ),
    },
    ...(ordered
      ? [
          {
            key: "diff",
            header: "차이",
            align: "right" as const,
            render: (l: LoadLineView) => {
              const d = l.loadBase - l.orderBase;
              return d === 0 ? <span className="muted">0</span> : <span className={`mono ${d < 0 ? styles.minus : styles.plus}`}>{d > 0 ? "+" : "−"}{qtyInUnit(Math.abs(d), l.showUnit, l.showFactor, l.baseUnit)}</span>;
            },
          },
          { key: "state", header: "비교", render: (l: LoadLineView) => <Badge tone={STATE_TONE[l.state]}>{LINE_STATE_LABEL[l.state]}</Badge> },
        ]
      : []),
  ];
  return <DataTable caption="상차 품목" columns={columns} rows={load.lines} rowKey={(l) => String(l.itemId)} compact empty="아직 실은 품목이 없습니다." />;
}

/**
 * 상차 실적 카드 — 화주사 담당자·3PL이 웹에서 상차 진행·결과를 본다 (입력은 PDA에서만).
 * 상차완료면 [상차확인서 인쇄].
 */
export function LoadSection({ load }: { load: LoadView }) {
  const done = load.status === "COMPLETED";
  const meta = LOAD_STATUS_META[load.status];
  const printHref = `/print/load-confirm/${load.id}`;
  return (
    <Card
      title="상차 실적"
      description={`${LOAD_TYPE_LABEL[load.type]} · PDA 입력 ${load.inputs.filter((i) => !i.canceled).length}건`}
      aside={
        done ? (
          <Button size="sm" variant="primary" onClick={() => window.open(printHref, "_blank", "noopener")}>
            상차확인서 인쇄
          </Button>
        ) : undefined
      }
    >
      <div className={styles.info}>
        <ViewSection
          items={[
            ["상차 상태", <Badge key="s" tone={meta.tone}>{meta.label}</Badge>],
            [done ? "상차확인서" : "상차 실적", <span key="n" className="mono">{load.loadNo}</span>],
            ["상차 시작", `${fmtDateTime(load.createdAt)} · ${load.createdBy}`],
            ["상차완료", done ? `${fmtDateTime(load.completedAt)} · ${load.completedBy}` : null],
          ]}
        />
        <ViewSection
          items={[
            [
              "작업자",
              load.workers.length ? (
                <span key="w">
                  {load.workers.map((w, i) => (
                    <span key={w.workerId}>
                      {i > 0 && ", "}
                      {w.name} <span className="muted mono">{w.count}건 · {fmtShortDateTime(w.lastAt)}</span>
                    </span>
                  ))}
                </span>
              ) : null,
            ],
            [
              "차이 사유",
              load.diffReasonName ? (
                <span key="r">
                  {load.diffReasonName}
                  {load.diffReasonText ? ` — "${load.diffReasonText}"` : ""}
                </span>
              ) : done ? (
                "차이 없음"
              ) : null,
            ],
          ]}
        />
      </div>
      <LoadLinesTable load={load} />
    </Card>
  );
}
