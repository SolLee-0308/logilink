"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Tag } from "@/components/ui/Badges";
import { CreateButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { ClientPicker } from "@/features/plans/ClientFinder";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { ITEM_REQUEST_STATUS_META, SOURCE_LABEL, STORAGE_TEMP_LABEL } from "@/domain/master";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { REQ_LIST_KEY, REQ_TABS, reqListSearch, type ReqListQuery, type ReqTab } from "./item-request-list";
import { MasterHeader } from "./shared";
import { RULES } from "./rules";
import type { ClientOption, ItemKey, ItemRequestRow } from "./types";


/**
 * 탭 — 3PL: 승인 대기 화면과 같은 구성(대기 / 반려·화주사 수정 중 / 오늘 내가 처리)
 *      화주사: 내 요청 현황(등록대기 / 반려·수정 필요 / 등록완료)
 */

const TAB_LABEL: Record<ReqTab, string> = { wait: "등록대기", rej: "반려 · 화주사 수정 중", done: "오늘 처리" };
const SHIPPER_TAB_LABEL: Record<ReqTab, string> = { wait: "등록대기", rej: "반려 · 수정 필요", done: "등록완료" };
const inTab = (r: ItemRequestRow, t: ReqTab, reviewer: boolean) =>
  t === "wait" ? r.status === "WAITING" : t === "rej" ? r.status === "REJECTED" : reviewer ? r.doneByMeToday !== null : r.status === "REGISTERED";

/** 같은 화주사의 기존 품목과 품목코드·바코드가 겹치는지 */
/** 같은 화주사에 이미 있는 화주사 품목코드·바코드 (화주사 품목코드는 넣은 경우만) */
export function findDuplicates(itemKeys: ItemKey[], clientId: number, clientCode: string | null, barcode: string) {
  const same = itemKeys.filter((k) => k.clientId === clientId);
  const cc = (clientCode ?? "").trim();
  return {
    code: cc ? same.find((k) => k.clientCode === cc) : undefined,
    barcode: same.find((k) => k.barcodes.includes(barcode.trim())),
  };
}


/**
 * 품목 등록 요청 목록 — 표를 넓게 쓰고, 행을 누르면 상세 화면(/master/item-requests/[id])으로 이동한다.
 * 등록·반려·재요청은 상세 화면에서 한다 (엑셀로 들어온 요청도 한 건씩 넓은 화면에서 확인).
 */
export function ItemRequestsScreen({
  rows,
  clients,
  itemKeys,
  canReview,
  initial,
}: {
  rows: ItemRequestRow[];
  clients: ClientOption[];
  itemKeys: ItemKey[];
  /** 3PL: 등록·반려 */
  canReview: boolean;
  initial: ReqListQuery;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ReqTab>(initial.tab ?? (!canReview && rows.some((r) => r.status === "REJECTED") ? "rej" : "wait"));
  const tabLabel = canReview ? TAB_LABEL : SHIPPER_TAB_LABEL;
  const [clientId, setClientId] = useState(initial.client);
  // 화주사 선택 목록에서 사용 안 함 화주사는 기본 제외 (조회 필터에서만 포함 가능)
  const [withInactiveClients, setWithInactiveClients] = useState(false);
  // '원본' 조회조건은 뺐다 (2026-11-07 Sol 확정 — 정의서 요구 아님, 업무 판단에 쓰이지 않음). 원본은 3PL 목록 열·상세에만
  const [q, setQ] = useState(initial.q);

  // 조회조건을 주소에 남기고(새로고침·공유), 상세 화면의 [← 목록]이 돌아올 주소로 기억
  useEffect(() => {
    const url = `/master/item-requests${reqListSearch({ tab, client: clientId, source: "all", q })}`;
    window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(REQ_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [tab, clientId, q]);

  const counts = useMemo(() => {
    const c: Record<ReqTab, number> = { wait: 0, rej: 0, done: 0 };
    rows.forEach((r) => REQ_TABS.forEach((t) => inTab(r, t, canReview) && c[t]++));
    return c;
  }, [rows, canReview]);

  const list = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            inTab(r, tab, canReview) &&
            (!clientId || r.clientId === Number(clientId)) &&
            includesText([r.requestNo, r.itemName, r.clientCode ?? "", r.barcode], q),
        )
        // 대기는 오래된 요청부터(상세의 [다음 요청] 순서와 같다), 반려는 최근 반려부터, 오늘 처리는 최근 처리부터
        .sort((a, b) =>
          tab === "wait"
            ? a.requestedAt.localeCompare(b.requestedAt) || a.requestNo.localeCompare(b.requestNo)
            : tab === "done"
              ? (b.doneByMeToday?.at ?? "").localeCompare(a.doneByMeToday?.at ?? "")
              : (b.processedAt ?? "").localeCompare(a.processedAt ?? ""),
        ),
    [rows, tab, clientId, q, canReview],
  );

  const columns: Column<ItemRequestRow>[] = [
    {
      key: "no",
      header: "요청번호",
      render: (r) => {
        const dup = r.status === "WAITING" ? findDuplicates(itemKeys, r.clientId, r.clientCode, r.barcode) : null;
        return (
          <span className="cell-tags">
            <span className="mono">{r.requestNo}</span>
            {r.resubmitCount > 0 && <Tag tone="accent">재요청</Tag>}
            {dup && (dup.code || dup.barcode) && <Tag tone="warn">중복 의심</Tag>}
          </span>
        );
      },
    },
    ...(clients.length > 1 ? [{ key: "client", header: "화주사", render: (r: ItemRequestRow) => r.clientName }] : []),
    { key: "code", header: "화주사 품목코드", render: (r) => (r.clientCode ? <span className="mono">{r.clientCode}</span> : <span className="muted">–</span>) },
    { key: "name", header: "품목명", wrap: true, render: (r) => r.itemName },
    { key: "unit", header: "단위", render: (r) => <span className="mono">{r.unit}</span> },
    // 바코드 열은 목록에서 뺐다(상세에만, 2026-11-07 Sol 피드백). 검색은 바코드로도 된다
    { key: "temp", header: "온도대", render: (r) => (r.storageTemp ? STORAGE_TEMP_LABEL[r.storageTemp] : <span className="muted">모름</span>) },
    // 원본 열은 3PL 목록에만 (화주사는 자기가 고른 입력 방법이라 볼 필요가 없다, 2026-11-07 Sol 확정)
    ...(canReview ? [{ key: "source", header: "원본", render: (r: ItemRequestRow) => SOURCE_LABEL[r.source] }] : []),
    {
      key: "requested",
      header: tab === "wait" ? "요청" : tab === "done" ? (canReview ? "내 처리" : "등록") : "반려",
      render: (r) =>
        tab === "wait" ? (
          <>
            <span className="mono">{fmtShortDateTime(r.requestedAt)}</span>
            <CellSub>{r.requestedBy}</CellSub>
          </>
        ) : (
          <>
            <span className="mono">{fmtShortDateTime(r.processedAt)}</span>
            <CellSub>{r.processedBy}</CellSub>
          </>
        ),
    },
    ...(tab === "rej"
      ? [{ key: "reason", header: "반려 사유", wrap: true, render: (r: ItemRequestRow) => r.rejectReasonName ?? "–" }]
      : []),
    {
      key: "status",
      header: "상태",
      render: (r) => <Badge tone={ITEM_REQUEST_STATUS_META[r.status].tone}>{ITEM_REQUEST_STATUS_META[r.status].label}</Badge>,
    },
  ];

  return (
    <>
      <MasterHeader
        title="품목 등록 요청"
        count={counts.wait}
        rules={RULES.itemRequests}
        // 단건·엑셀 일괄 요청은 등록 요청 화면의 '입력 방법' 스위치에서 고른다
        actions={!canReview ? <CreateButton href="/master/item-requests/new">등록 요청</CreateButton> : undefined}
      />
      <FilterBar>
        {clients.length > 1 && (
          <>
            <FilterField label="화주사" htmlFor="f-client">
              <ClientPicker
                id="f-client"
                value={clientId}
                onChange={setClientId}
                clients={clients.filter((c) => withInactiveClients || c.isActive || String(c.id) === clientId)}
              />
            </FilterField>
            <FilterCheckbox id="f-client-inactive" label="사용 안 함 포함" checked={withInactiveClients} onChange={setWithInactiveClients} />
          </>
        )}
        <SearchInput value={q} onChange={setQ} placeholder="요청번호, 품목명, 품목코드, 바코드 검색" />
      </FilterBar>
      <Tabs label="요청 상태" value={tab} onChange={setTab} panelId="req-body" items={REQ_TABS.map((k) => ({ key: k, label: tabLabel[k], count: counts[k] }))} />
      <div id="req-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <ListToolbar total={list.length} />
        <DataTable
          caption="품목 등록 요청 목록"
          columns={columns}
          rows={list}
          rowKey={(r) => String(r.id)}
          onActivate={(k) => router.push(`/master/item-requests/${k}`)}
          empty={
            tab === "wait"
              ? canReview
                ? "처리할 품목 등록 요청이 없습니다."
                : "3PL 검토를 기다리는 요청이 없습니다."
              : tab === "done"
                ? canReview
                  ? "오늘 처리한 요청이 없습니다."
                  : "등록완료된 요청이 없습니다."
                : "조건에 맞는 요청이 없습니다. 조회조건을 바꿔 보세요."
          }
        />
      </div>
    </>
  );
}
