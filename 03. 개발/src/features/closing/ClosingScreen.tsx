"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertStrip } from "@/components/ui/AlertStrip";
import { StatusBadge, Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { MAX_CLOSE_BATCH } from "@/domain/close-rules";
import { daysBetween, isOverdue } from "@/domain/inquiry-rules";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { closeRemainPlans } from "@/server/plans/actions";
import { MasterHeader, useAction } from "@/features/master/shared";
import { RejectModal, type ReasonOption } from "@/features/shared/RejectModal";
import { CLOSING_RULES } from "./rules";
import { DailyCloseTab } from "./DailyCloseTab";
import type { ClosingTab, DailyView, RemainCloseRow } from "./types";
import styles from "./ClosingScreen.module.css";

type Elapsed = "all" | "over";

const qtyText = (byUnit: [string, number][]) => byUnit.map(([u, q]) => `${q.toLocaleString()} ${u}`).join(" · ");

/**
 * 잔량 종결·일마감 (정의서 ⑦, 2026-11-12) — 3PL 관리자·운영담당.
 * 잔량 종결 탭: 미종결 입고예정을 경과일 순으로 보고, 골라서 사유와 함께 종결(건별·일괄, 한 번에 최대 50건).
 * 오는 중인 ASN이 있는 건은 고를 수 없다(임시안). 행의 입고예정번호를 누르면 입고예정 조회 상세로.
 * 일마감 탭(2026-11-12): 센터의 지금 업무일 마감 — DailyCloseTab.
 */
export function ClosingScreen({
  tab,
  rows,
  reasons,
  alertDays,
  today,
  centers,
  daily,
}: {
  /** 일마감 탭일 때만 — 센터의 지금 업무일 기준 */
  daily: DailyView | null;
  tab: ClosingTab;
  rows: RemainCloseRow[];
  reasons: ReasonOption[];
  alertDays: number;
  today: string;
  centers: { id: number; name: string }[];
}) {
  const router = useRouter();
  const act = useAction();
  const [client, setClient] = useState("");
  const [center, setCenter] = useState("");
  const [elapsed, setElapsed] = useState<Elapsed>("all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [closing, setClosing] = useState(false);

  const daysOf = (r: RemainCloseRow) => Math.max(daysBetween(r.planDate, today), 0);
  const overdueCount = rows.filter((r) => isOverdue(daysOf(r), alertDays)).length;
  const clients = useMemo(() => [...new Map(rows.map((r) => [r.clientId, r.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const multiCenter = centers.length > 1 || new Set(rows.map((r) => r.centerId)).size > 1;

  const list = useMemo(
    () =>
      rows
        .filter((r) => !client || String(r.clientId) === client)
        .filter((r) => !center || String(r.centerId) === center)
        .filter((r) => elapsed === "all" || isOverdue(daysOf(r), alertDays))
        .filter((r) => !search.trim() || includesText([r.planNo, r.clientName, ...r.itemTexts], search))
        // 오래된 건이 위 (경과일 많은 순)
        .sort((a, b) => a.planDate.localeCompare(b.planDate) || a.planNo.localeCompare(b.planNo)),
    // eslint 없음 — daysOf는 today·alertDays에만 기대고 rows와 함께 바뀐다
    [rows, client, center, elapsed, search, today, alertDays],
  );

  const selectable = list.filter((r) => r.openAsnCount === 0);
  const chosen = rows.filter((r) => picked.has(r.id));
  const allOn = selectable.length > 0 && selectable.every((r) => picked.has(r.id));
  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(selectable.map((r) => r.id)));

  const columns: Column<RemainCloseRow>[] = [
    {
      key: "pick",
      header: <input type="checkbox" aria-label="고를 수 있는 건 모두 고르기" checked={allOn} onChange={toggleAll} disabled={!selectable.length} />,
      render: (r) =>
        r.openAsnCount > 0 ? (
          <span className={styles.lock} title="오는 중인 ASN이 있어 종결할 수 없습니다">
            –
          </span>
        ) : (
          <input type="checkbox" aria-label={`${r.planNo} 고르기`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
        ),
    },
    {
      key: "no",
      header: "입고예정번호",
      render: (r) => (
        <Link href={`/plans/inquiry/${r.id}`} className={`mono ${styles.planLink}`}>
          {r.planNo}
        </Link>
      ),
    },
    { key: "client", header: "화주사", render: (r) => r.clientName },
    ...(multiCenter ? [{ key: "center", header: "센터", render: (r: RemainCloseRow) => r.centerName }] : []),
    { key: "date", header: "입고예정일", render: (r) => <span className="mono">{r.planDate}</span> },
    {
      key: "elapsed",
      header: "경과",
      align: "right",
      render: (r) => {
        const d = daysOf(r);
        return d > 0 ? <b className={`mono ${isOverdue(d, alertDays) ? styles.over : ""}`}>{d}일</b> : <span className="muted">–</span>;
      },
    },
    { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
    { key: "pct", header: "진행률", align: "right", render: (r) => <span className="mono">{r.pct}%</span> },
    {
      key: "remain",
      header: "잔량",
      wrap: true,
      render: (r) => (
        <>
          <b className="mono">{qtyText(r.remainByUnit) || "0"}</b>
          <span className={styles.sub}>
            {r.remainLineCount}/{r.lineCount}품목
          </span>
        </>
      ),
    },
    {
      key: "asn",
      header: "오는 중",
      render: (r) => (r.openAsnCount > 0 ? <Tag tone="warn">ASN {r.openAsnCount}대</Tag> : <span className="muted">–</span>),
    },
    { key: "last", header: "마지막 입고", render: (r) => (r.lastRcvAt ? <span className="mono">{fmtShortDateTime(r.lastRcvAt)}</span> : <span className="muted">없음</span>) },
    {
      key: "memo",
      header: "종결 요청 메모",
      wrap: true,
      render: (r) => (r.closeReqMemo ? <span className={styles.memo}>{r.closeReqMemo}</span> : <span className="muted">–</span>),
    },
  ];

  const go = (t: ClosingTab) => router.replace(t === "remain" ? "/closing" : `/closing?tab=${t}`, { scroll: false });

  return (
    <>
      <MasterHeader title="잔량 종결·일마감" count={rows.length} rules={CLOSING_RULES} crumbs={["입고 운영", "잔량 종결·일마감"]} />

      <Tabs
        label="잔량 종결·일마감"
        value={tab}
        onChange={go}
        items={[
          { key: "remain", label: "잔량 종결", count: rows.length, alert: overdueCount, alertLabel: `경과 기준(${alertDays}일) 초과` },
          { key: "daily", label: "일마감", alert: daily && !daily.center.closed ? daily.expire.length : 0, alertLabel: "오늘 기한경과 취소 대상" },
        ]}
      />

      {tab === "daily" ? (
        daily ? (
          <DailyCloseTab view={daily} onRemainTab={() => go("remain")} />
        ) : (
          <NoteBox tone="info">일마감할 센터가 없습니다. 기준정보 › 센터를 확인하세요.</NoteBox>
        )
      ) : (
        <>
          <AlertStrip count={overdueCount} unit="건" active={elapsed === "over"} onShow={() => setElapsed("over")} onClear={() => setElapsed("all")}>
            입고예정일에서 {alertDays}일 이상 지난 미종결 입고예정
          </AlertStrip>

          <FilterBar>
            <FilterField label="화주사" htmlFor="cl-client">
              <Select id="cl-client" value={client} onChange={(e) => setClient(e.target.value)}>
                <option value="">전체</option>
                {clients.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </FilterField>
            {multiCenter && (
              <FilterField label="센터" htmlFor="cl-center">
                <Select id="cl-center" value={center} onChange={(e) => setCenter(e.target.value)}>
                  <option value="">전체</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )}
            <FilterField label="경과">
              <ChipGroup
                value={elapsed}
                onChange={setElapsed}
                options={[
                  { value: "all", label: "전체" },
                  { value: "over", label: `기준 초과(${alertDays}일+)` },
                ]}
              />
            </FilterField>
            <SearchInput value={search} onChange={setSearch} placeholder="입고예정번호·화주사·품목코드·품목명" />
          </FilterBar>

          <ListToolbar total={list.length}>
            {picked.size > 0 && (
              <span className={styles.picked}>
                <b className="mono">{picked.size}</b>건 선택
                <button type="button" className={styles.clear} onClick={() => setPicked(new Set())}>
                  선택 해제
                </button>
              </span>
            )}
            <Button variant="danger" size="sm" disabled={!picked.size || picked.size > MAX_CLOSE_BATCH} onClick={() => setClosing(true)}>
              잔량 종결{picked.size ? ` ${picked.size}건` : ""}
            </Button>
          </ListToolbar>

          <DataTable
            caption="잔량 종결 대상 — 미종결 입고예정"
            columns={columns}
            rows={list}
            rowKey={(r) => String(r.id)}
            empty={rows.length ? "조건에 맞는 미종결 입고예정이 없습니다." : "잔량이 남은 미종결 입고예정이 없습니다."}
          />
        </>
      )}

      <RejectModal
        open={closing}
        onClose={() => setClosing(false)}
        title="잔량 종결"
        description="고른 입고예정의 남은 잔량을 종결합니다. 종결은 최종 상태이며 되돌릴 수 없습니다. 다시 입고하려면 새 입고예정을 등록해야 합니다."
        reasonLabel="종결 사유"
        submitLabel={`${chosen.length}건 잔량 종결`}
        closeLabel="닫기"
        placeholder="종결하는 이유를 적어 주세요."
        target={
          <ul className={styles.targets}>
            {chosen.map((r) => (
              <li key={r.id}>
                <span className="mono">{r.planNo}</span> · {r.clientName} · {r.planDate} · 잔량 <b className="mono">{qtyText(r.remainByUnit)}</b>
              </li>
            ))}
          </ul>
        }
        reasons={reasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await closeRemainPlans({ items: chosen.map((c) => ({ id: c.id, version: c.version })), reasonCode, reasonText });
          if (r.ok) {
            act.run(async () => r, () => {
              setPicked(new Set());
              router.refresh();
            });
          } else if (r.code === "CONFLICT" || r.code === "STATE") {
            setClosing(false);
            act.run(async () => r, () => router.refresh());
            return { ok: true, message: "" };
          }
          return r;
        }}
      />
    </>
  );
}
