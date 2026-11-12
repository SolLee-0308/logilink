"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { LOAD_TYPE_LABEL } from "@/domain/load-rules";
import { fmtDateTime, fmtShortDateTime } from "@/lib/format";
import { runDailyClose } from "@/server/plans/actions";
import { useAction } from "@/features/master/shared";
import type { DailyExpireRow, DailyHistoryRow, DailyRcvRow, DailyView } from "./types";
import styles from "./ClosingScreen.module.css";

const n = (v: number) => v.toLocaleString();

/**
 * 일마감 탭 (정의서 ⑦·D18·D21, 2026-11-12) — 센터의 지금 업무일을 마감한다(센터·업무일당 1회, 되돌리기 없음).
 * ① 상태(업무일·일마감 예정 시각·마감 여부) ② 확정할 검수 실적 ③ 기한경과 취소 대상 ④ 미종결 입고예정(잔량 종결 탭으로) ⑤ 이력.
 * [일마감 실행]은 확인 창에서 건수를 보고 실행한다. 전표를 닫지 않으므로 승인 이후 건은 계속 입고할 수 있다.
 */
export function DailyCloseTab({ view, onRemainTab }: { view: DailyView; onRemainTab: () => void }) {
  const router = useRouter();
  const act = useAction();
  const [confirm, setConfirm] = useState(false);
  const { center: c, rcvs, expire, history } = view;
  const prevDays = rcvs.filter((r) => r.businessDate < c.businessDate).length;
  const goodSum = rcvs.reduce((s, r) => s + r.goodBaseQty, 0);
  const retSum = rcvs.reduce((s, r) => s + r.returnBaseQty, 0);

  const run = () =>
    act.run(
      async () => {
        const r = await runDailyClose({ centerId: c.id, businessDate: c.businessDate, rcvIds: rcvs.map((r) => r.id), expireIds: expire.map((p) => p.id) });
        // 막히면(이미 마감·업무일 바뀜·대상 바뀜) 창을 닫고 최신 내용으로 다시 그린다
        if (!r.ok) {
          setConfirm(false);
          router.refresh();
        }
        return r;
      },
      () => {
        setConfirm(false);
        router.refresh();
      },
    );

  const rcvColumns: Column<DailyRcvRow>[] = [
    {
      key: "no",
      header: "검수번호",
      render: (r) => (
        <Link href={r.href} className={`mono ${styles.planLink}`}>
          {r.rcvNo}
        </Link>
      ),
    },
    {
      key: "day",
      header: "업무일",
      render: (r) => (
        <>
          <span className="mono">{r.businessDate}</span>
          {r.businessDate < c.businessDate && (
            <span className={styles.sub}>
              <Tag tone="warn">이전 업무일</Tag>
            </span>
          )}
        </>
      ),
    },
    { key: "at", header: "확정", render: (r) => <span className="mono">{fmtShortDateTime(r.confirmedAt)}</span> },
    { key: "vehicle", header: "차량", render: (r) => <span className="mono">{r.vehicleNo}</span> },
    { key: "client", header: "화주사", render: (r) => r.clientName },
    { key: "type", header: "구분", render: (r) => LOAD_TYPE_LABEL[r.loadType] },
    { key: "lines", header: "품목", align: "right", render: (r) => <span className="mono">{r.lineCount}</span> },
    { key: "good", header: "입고", align: "right", render: (r) => <span className="mono">{n(r.goodBaseQty)}</span> },
    { key: "ret", header: "반송", align: "right", render: (r) => (r.returnBaseQty ? <span className="mono">{n(r.returnBaseQty)}</span> : <span className="muted">–</span>) },
    { key: "issue", header: "차이", render: (r) => (r.issueCount ? <Tag tone="warn">{r.issueCount}품목</Tag> : <span className="muted">–</span>) },
    { key: "by", header: "확정자", render: (r) => r.confirmedBy ?? "-" },
  ];

  const expireColumns: Column<DailyExpireRow>[] = [
    {
      key: "no",
      header: "입고예정번호",
      render: (p) => (
        <Link href={`/plans/approval/${p.id}`} className={`mono ${styles.planLink}`}>
          {p.planNo}
        </Link>
      ),
    },
    { key: "client", header: "화주사", render: (p) => p.clientName },
    { key: "date", header: "입고예정일", render: (p) => <span className="mono">{p.planDate}</span> },
    { key: "status", header: "상태", render: (p) => <StatusBadge status={p.status} /> },
    { key: "due", header: "취소 예정일", render: (p) => <span className="mono">{p.dueDate}</span> },
  ];

  const historyColumns: Column<DailyHistoryRow>[] = [
    { key: "day", header: "업무일", render: (h) => <span className="mono">{h.businessDate}</span> },
    { key: "at", header: "마감 시각", render: (h) => <span className="mono">{fmtShortDateTime(h.closedAt)}</span> },
    { key: "by", header: "처리자", render: (h) => h.closedBy },
    { key: "rcv", header: "확정 실적", align: "right", render: (h) => <span className="mono">{h.rcvCount}대 · {h.rcvLineCount}품목</span> },
    { key: "good", header: "입고", align: "right", render: (h) => <span className="mono">{n(h.goodBaseQty)}</span> },
    { key: "ret", header: "반송", align: "right", render: (h) => <span className="mono">{n(h.returnBaseQty)}</span> },
    { key: "expire", header: "기한경과 취소", align: "right", render: (h) => <span className="mono">{h.expireCount}건</span> },
  ];

  return (
    <div className={styles.daily}>
      {/* ① 상태 */}
      <Card
        title={
          <span className={styles.dailyTitle}>
            {c.name} · 업무일 <span className="mono">{c.businessDate}</span>
            {c.closed ? <Tag tone="accent">마감됨</Tag> : <Tag tone="neutral">미마감</Tag>}
          </span>
        }
        description={`업무일 시작 ${c.businessDayStart} · 일마감 예정 ${c.dailyCloseTime} · 기한경과 취소 = 입고예정일 + ${c.expireGraceDays}영업일 이후 일마감. 일마감은 검수 실적을 확정하는 기능이며 전표를 닫지 않습니다.`}
        aside={
          <span className={styles.dailyAside}>
            {view.centerOptions.length > 1 && (
              <Select aria-label="센터" value={c.id} onChange={(e) => router.replace(`/closing?tab=daily&center=${e.target.value}`, { scroll: false })}>
                {view.centerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
            <Button variant="primary" disabled={!!c.closed || act.pending} onClick={() => setConfirm(true)}>
              일마감 실행
            </Button>
          </span>
        }
      >
        {c.closed ? (
          <p className={styles.plain}>
            {fmtDateTime(c.closed.at)} · {c.closed.by}님이 마감했습니다 — 검수 실적 <b className="mono">{c.closed.rcvCount}</b>건 확정, 기한경과 <b className="mono">{c.closed.expireCount}</b>건 취소.
            {rcvs.length > 0 && <> 마감 뒤 확정된 실적 {rcvs.length}건은 다음 업무일 일마감 때 확정됩니다.</>}
          </p>
        ) : (
          <p className={styles.plain}>
            지금 일마감하면 검수 실적 <b className="mono">{rcvs.length}</b>건(입고 {n(goodSum)} · 반송 {n(retSum)}, 기준 단위)을 확정하고 기한경과 <b className="mono">{expire.length}</b>건을 취소합니다.
          </p>
        )}
      </Card>

      {/* ② 확정할 검수 실적 */}
      <Card
        title="확정할 검수 실적"
        count={rcvs.length}
        description={
          prevDays > 0
            ? `아직 일마감되지 않은 검수 확정 건입니다. 이전 업무일 실적 ${prevDays}건이 포함되어 있습니다(그날 일마감을 하지 않았거나 마감 뒤 확정된 건).`
            : "아직 일마감되지 않은 검수 확정 건입니다. 귀속 업무일은 확정 시각으로 정합니다."
        }
      >
        <DataTable compact caption="확정할 검수 실적" columns={rcvColumns} rows={rcvs} rowKey={(r) => String(r.id)} empty="확정할 검수 실적이 없습니다." />
      </Card>

      {/* ③ 기한경과 취소 대상 */}
      <Card title="기한경과 취소 대상" count={expire.length} description="승인 전(승인대기·반려)이고 입고예정일에서 유예 영업일이 지난 건입니다. 일마감을 실행하면 취소됩니다. 살릴 건은 일마감 전에 승인 대기에서 처리하세요.">
        <DataTable compact caption="기한경과 취소 대상" columns={expireColumns} rows={expire} rowKey={(p) => String(p.id)} empty="취소될 건이 없습니다." />
      </Card>

      {/* ④ 미종결 입고예정 — 일마감과 무관 */}
      <Card
        title="미종결 입고예정"
        count={view.unclosedCount}
        description="잔량이 남은 승인·부분입고 건입니다. 일마감은 이 건들을 닫지 않으며, 더 입고되지 않을 건은 잔량 종결 탭에서 종결합니다."
        aside={
          <Button size="sm" onClick={onRemainTab}>
            잔량 종결 탭으로
          </Button>
        }
      >
        <p className={styles.plain}>
          {view.unclosedCount === 0 ? (
            "미종결 입고예정이 없습니다."
          ) : (
            <>
              미종결 <b className="mono">{view.unclosedCount}</b>건
              {view.unclosedOverdue > 0 && (
                <>
                  {" "}
                  · 입고예정일에서 {view.alertDays}일 이상 지난 건 <b className={`mono ${styles.over}`}>{view.unclosedOverdue}</b>건
                </>
              )}
            </>
          )}
        </p>
      </Card>

      {/* ⑤ 이력 */}
      <Card title="일마감 이력" count={history.length} description="최근 14번">
        <DataTable compact caption="일마감 이력" columns={historyColumns} rows={history} rowKey={(h) => String(h.id)} empty="아직 일마감한 적이 없습니다." />
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`${c.name} ${c.businessDate} 일마감`}
        description="일마감은 되돌릴 수 없습니다."
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={act.pending}>
              닫기
            </Button>
            <Button variant="primary" onClick={run} disabled={act.pending}>
              일마감 실행
            </Button>
          </>
        }
      >
        <ul className={styles.targets}>
          <li>
            검수 실적 <b className="mono">{rcvs.length}</b>건 확정 (입고 {n(goodSum)} · 반송 {n(retSum)}, 기준 단위){prevDays > 0 && ` — 이전 업무일 ${prevDays}건 포함`}
          </li>
          <li>
            기한경과 <b className="mono">{expire.length}</b>건 취소 (승인 전 건, 사유 "기한경과(일마감 자동)")
          </li>
          <li>미종결 입고예정 {view.unclosedCount}건은 그대로 둡니다 (승인 이후 건은 계속 입고 가능)</li>
        </ul>
      </Modal>
    </div>
  );
}
