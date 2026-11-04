"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { Sheet } from "@/components/ui/Overlay";
import { RuleList } from "@/components/ui/RuleList";
import { KeyValue, ListToolbar, PanelFootNote, PanelSection, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { useToast } from "@/components/ui/Toast";
import { PLAN_ACTION_LABEL, PLAN_INPUT_METHOD_LABEL } from "@/domain/plan-status";
import { dday, ddayLabel, diffLines, type LineDiff } from "@/domain/plan-rules";
import { fmtDateTime, fmtShortDateTime, includesText } from "@/lib/format";
import { approvePlan, loadPlanDetail, rejectPlan } from "@/server/plans/actions";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { useAction } from "@/features/master/shared";
import { APPROVAL_RULES } from "./rules";
import type { ApprovalRow, ApprovalTab, PlanDetail, PlanLineView } from "./types";
import styles from "./ApprovalScreen.module.css";

type DateFilter = "all" | "over" | "today" | "tomorrow" | "later";

const TAB_LABEL: Record<ApprovalTab, string> = { wait: "승인대기", rej: "반려 · 화주사 수정 중", done: "오늘 처리" };

/** BOX 245 · PLT 4 */
const qtyText = (q: [string, number][]) => q.map(([u, n]) => `${u} ${n.toLocaleString()}`).join(" · ");

export function ApprovalScreen({ rows, reasons, today }: { rows: ApprovalRow[]; reasons: ReasonOption[]; today: string }) {
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<ApprovalTab>("wait");
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState<DateFilter>("all");
  const [revOnly, setRevOnly] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const clients = useMemo(() => {
    const m = new Map<number, string>();
    rows.forEach((r) => m.set(r.clientId, r.clientName));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<ApprovalTab, number> = { wait: 0, rej: 0, done: 0 };
    rows.forEach((r) => c[r.tab]++);
    return c;
  }, [rows]);

  const list = useMemo(
    () =>
      rows
        .filter((r) => {
          if (r.tab !== tab) return false;
          if (clientId && r.clientId !== Number(clientId)) return false;
          const n = dday(r.planDate, today);
          if (date === "over" && n >= 0) return false;
          if (date === "today" && n !== 0) return false;
          if (date === "tomorrow" && n !== 1) return false;
          if (date === "later" && n < 2) return false;
          if (revOnly && r.revisionNo < 2) return false;
          return includesText([r.planNo, ...r.itemTexts], q);
        })
        .sort((a, b) =>
          tab === "done"
            ? (b.processed?.at ?? "").localeCompare(a.processed?.at ?? "")
            : a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo),
        ),
    [rows, tab, clientId, date, revOnly, q, today],
  );
  // 걸러진 목록에 선택 건이 없으면 첫 건 — 승인·반려 후에는 다음 건이 자동으로 열린다
  const activeId = selected !== null && list.some((r) => r.id === selected) ? selected : (list[0]?.id ?? null);
  const active = rows.find((r) => r.id === activeId) ?? null;

  const columns: Column<ApprovalRow>[] = [
    {
      key: "no",
      header: "입고예정번호",
      render: (r) => (
        <span className="cell-tags">
          <span className="mono">{r.planNo}</span>
          {r.revisionNo > 1 && <Tag tone="accent">재요청</Tag>}
          {r.tab !== "done" && dday(r.planDate, today) < 0 && <Tag tone="warn">기한 지남</Tag>}
        </span>
      ),
    },
    { key: "client", header: "화주사", render: (r) => r.clientName },
    {
      key: "date",
      header: "입고예정일",
      render: (r) => (
        <>
          <span className="mono">{r.planDate}</span>
          <CellSub>{ddayLabel(dday(r.planDate, today))}</CellSub>
        </>
      ),
    },
    {
      key: "qty",
      header: "품목 · 수량",
      align: "right",
      render: (r) => (
        <>
          <span className="mono">{r.lineCount}종</span>
          <CellSub mono>{qtyText(r.qtyByUnit)}</CellSub>
        </>
      ),
    },
    { key: "rev", header: "차수", align: "right", render: (r) => <span className="mono">{r.revisionNo}차</span> },
    tab === "done"
      ? {
          key: "processed",
          header: "내 처리",
          render: (r) => (
            <>
              <span className="mono">{fmtShortDateTime(r.processed?.at)}</span>
              <CellSub>{r.processed?.action === "APPROVE" ? "승인" : "반려"}</CellSub>
            </>
          ),
        }
      : {
          key: "saved",
          header: "최종 저장",
          render: (r) => (
            <>
              <span className="mono">{fmtShortDateTime(r.savedAt)}</span>
              <CellSub>{r.savedBy}</CellSub>
            </>
          ),
        },
    { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader crumbs={["입고 계획", "승인 대기"]} title="승인 대기" count={counts.wait} onHelp={() => setHelp(true)} />
      <Sheet open={help} onClose={() => setHelp(false)} title="이 화면의 업무 규칙">
        <RuleList rules={APPROVAL_RULES} source="입고 업무프로세스 정의서 v1.4" />
      </Sheet>
      <FilterBar>
        <FilterField label="화주사" htmlFor="f-client">
          <Select id="f-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">전체</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="입고예정일">
          <ChipGroup
            value={date}
            onChange={setDate}
            options={[
              { value: "all", label: "전체" },
              { value: "over", label: "기한 지남" },
              { value: "today", label: "오늘" },
              { value: "tomorrow", label: "내일" },
              { value: "later", label: "모레 이후" },
            ]}
          />
        </FilterField>
        <FilterCheckbox id="f-rev" label="재요청 건만" checked={revOnly} onChange={setRevOnly} />
        <SearchInput value={q} onChange={setQ} placeholder="입고예정번호, 품목명, 품목코드 검색" />
      </FilterBar>
      <Tabs
        label="처리 구분"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setSelected(null);
        }}
        panelId="approval-body"
        items={(["wait", "rej", "done"] as const).map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] }))}
      />
      <div id="approval-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <SplitView
          list={
            <>
              <ListToolbar total={list.length} />
              <DataTable
                caption={`${TAB_LABEL[tab]} 입고예정 목록`}
                columns={columns}
                rows={list}
                rowKey={(r) => String(r.id)}
                activeKey={activeId === null ? null : String(activeId)}
                onActivate={(k) => setSelected(Number(k))}
                empty={
                  tab === "wait" && counts.wait === 0
                    ? "승인할 입고예정이 없습니다."
                    : tab === "done" && counts.done === 0
                      ? "오늘 처리한 입고예정이 없습니다."
                      : "조건에 맞는 입고예정이 없습니다. 조회조건을 바꿔 보세요."
                }
              />
            </>
          }
          panel={
            active ? (
              <PlanPanel key={active.id} row={active} reasons={reasons} today={today} />
            ) : (
              <SidePanel label="입고예정 상세">
                <p className="muted">목록에서 입고예정을 선택하면 상세가 보입니다.</p>
              </SidePanel>
            )
          }
        />
      </div>
    </>
  );
}

/* ───────── 상세 패널 ───────── */

/** 처리 시점 version 충돌 후 다시 불러온 내용과 비교하기 위한 이전 라인 */
type ChangeMarks = { diffs: LineDiff[]; removed: PlanLineView[]; fromVersion: number };

function PlanPanel({ row, reasons, today }: { row: ApprovalRow; reasons: ReasonOption[]; today: string }) {
  const toast = useToast();
  const router = useRouter();
  const act = useAction();
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [marks, setMarks] = useState<ChangeMarks | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reloading, setReloading] = useState(false);

  // 상세를 여는 순간 서버에서 최신 내용과 version을 읽는다 (이 version으로 승인·반려)
  const load = useCallback(async () => {
    const r = await loadPlanDetail(row.id);
    if (!r.ok) {
      setLoadError(r.error);
      return null;
    }
    setLoadError(null);
    setDetail(r.data!);
    return r.data!;
  }, [row.id]);

  useEffect(() => {
    let alive = true;
    loadPlanDetail(row.id).then((r) => {
      if (!alive) return;
      if (r.ok) setDetail(r.data!);
      else setLoadError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [row.id]);

  /** 충돌 후 [변경 내용 불러오기] — 바뀐 품목을 표시한다 */
  async function reload() {
    if (!detail) return;
    setReloading(true);
    const before = detail;
    const next = await load();
    setReloading(false);
    router.refresh();
    if (!next) return;
    const { diffs, removed } = diffLines(next.lines, before.lines);
    setMarks({ diffs, removed, fromVersion: before.version });
    setConflict(null);
    act.reset();
    toast.show("최신 내용을 불러왔습니다. 변경된 품목을 확인하세요.");
  }

  function approve() {
    if (!detail) return;
    act.run(
      async () => {
        const r = await approvePlan({ id: detail.id, version: detail.version });
        if (!r.ok && (r.code === "CONFLICT" || r.code === "STATE")) setConflict(r.error);
        return r.ok || r.code !== "CONFLICT" ? r : { ...r, code: "STATE" as const };
      },
    );
  }

  if (loadError) {
    return (
      <SidePanel label="입고예정 상세">
        <NoteBox tone="error">{loadError}</NoteBox>
      </SidePanel>
    );
  }
  if (!detail) {
    return (
      <SidePanel label="입고예정 상세" title={<PanelTitle mono>{row.planNo}</PanelTitle>}>
        <p className="muted">상세를 불러오는 중…</p>
      </SidePanel>
    );
  }

  const d = detail;
  const n = dday(d.planDate, today);
  const waiting = d.status === "WAITING";
  // 재요청 건: 직전 반려본과 비교 (승인대기일 때만 — 반려 상태면 반려본 = 현재 내용)
  const compare = waiting && d.revisionNo > 1 && d.lastReject ? diffLines(d.lines, d.lastReject.lines) : null;
  const managed = d.lines.some((l) => l.expiryManaged || l.lotManaged);

  return (
    <SidePanel
      label="입고예정 상세"
      title={
        <>
          <PanelTitle mono>{d.planNo}</PanelTitle>
          <StatusBadge status={d.status} />
          {d.revisionNo > 1 && <Tag tone="accent">재요청 {d.revisionNo}차</Tag>}
        </>
      }
      sub={`${d.clientName} · ${d.centerName} · ${PLAN_INPUT_METHOD_LABEL[d.inputMethod]}`}
      footer={
        waiting && row.tab === "wait" ? (
          <>
            <Button variant="danger" onClick={() => setRejecting(true)} disabled={act.pending || !!conflict}>
              반려
            </Button>
            <Button variant="primary" onClick={approve} disabled={act.pending || !!conflict}>
              승인
            </Button>
          </>
        ) : d.status === "APPROVED" ? (
          <PanelFootNote>승인 차수 {d.approvedRevisionNo} · 수정 잠금</PanelFootNote>
        ) : d.status === "REJECTED" ? (
          <PanelFootNote>화주사 재저장 대기</PanelFootNote>
        ) : (
          <PanelFootNote>
            현재 상태: <StatusBadge status={d.status} />
          </PanelFootNote>
        )
      }
    >
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
      {marks && (
        <NoteBox tone="info">
          화주사가 수정한 최신 내용입니다. 바뀐 품목에 표시가 있으니 확인한 뒤 처리하세요.
        </NoteBox>
      )}
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

      <KeyValue
        items={[
          ["입고예정일", <span key="d" className="mono">{`${d.planDate} (${ddayLabel(n)})`}</span>],
          ["품목 · 수량", <span key="q" className="mono">{`${d.lineCount}종 · ${qtyText(d.qtyByUnit)}`}</span>],
          ["차수", <span key="r" className="mono">{d.revisionNo}차</span>],
          ["최종 저장", `${fmtDateTime(d.savedAt)} · ${d.savedBy}`],
          ...(d.memo ? [["메모", d.memo] as [string, string]] : []),
        ]}
      />

      <PanelSection title="품목" aside={compare ? <Tag tone="accent">직전 반려본({d.lastReject!.revisionNo}차) 대비</Tag> : undefined}>
        <div className={styles.linesWrap}>
          <table className={styles.lines}>
            <thead>
              <tr>
                <th>품목</th>
                <th>단위</th>
                {managed && <th>유통기한 · 로트</th>}
                {compare && <th className={styles.num}>직전</th>}
                <th className={styles.num}>수량</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => {
                const c = compare?.diffs[i];
                const m = marks?.diffs[i];
                return (
                  <tr key={l.lineNo}>
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
                      {l.unit !== l.baseUnit && <span className={styles.sub}>= {l.baseQty.toLocaleString()} {l.baseUnit}</span>}
                    </td>
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
      </PanelSection>

      <PanelSection title="처리 이력">
        <Timeline entries={historyEntries(d)} />
      </PanelSection>

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
          if (r.ok) act.run(async () => r);
          else if (r.code === "CONFLICT" || r.code === "STATE") {
            setConflict(r.error);
            setRejecting(false);
            return { ok: true, message: "" };
          }
          return r;
        }}
      />
    </SidePanel>
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
