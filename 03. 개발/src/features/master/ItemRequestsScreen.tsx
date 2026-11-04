"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Tag } from "@/components/ui/Badges";
import { CreateButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Form";
import { ListToolbar } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { ITEM_REQUEST_STATUS_META, SOURCE_LABEL, STORAGE_TEMP_LABEL } from "@/domain/master";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { REQ_LIST_KEY, REQ_TABS, reqListSearch, type ReqListQuery, type ReqTab, type SourceFilter } from "./item-request-list";
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
export function findDuplicates(itemKeys: ItemKey[], clientId: number, code: string, barcode: string) {
  const same = itemKeys.filter((k) => k.clientId === clientId);
  return {
    code: same.find((k) => k.code === code.trim()),
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
  // 화주사는 이 화면에서 직접 입력·엑셀 일괄 요청만 한다. AI 판독·엑셀 미매칭 요청은 입고예정 등록 화면에서 생기므로
  // 원본 필터에서 빼고, 그 요청을 검토하는 3PL에게만 보인다
  const sourceOptions: { value: SourceFilter; label: string }[] = [
    { value: "all", label: "전체" },
    ...(canReview
      ? [
          { value: "AI" as const, label: "AI 판독" },
          { value: "EXCEL" as const, label: "엑셀 미매칭" },
        ]
      : []),
    { value: "ITEM_EXCEL", label: "엑셀 일괄 요청" },
    { value: "DIRECT", label: "직접 입력" },
  ];
  const [source, setSource] = useState<SourceFilter>(sourceOptions.some((o) => o.value === initial.source) ? initial.source : "all");
  const [q, setQ] = useState(initial.q);

  // 조회조건을 주소에 남기고(새로고침·공유), 상세 화면의 [← 목록]이 돌아올 주소로 기억
  useEffect(() => {
    const url = `/master/item-requests${reqListSearch({ tab, client: clientId, source, q })}`;
    window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(REQ_LIST_KEY, url);
    } catch {
      /* 저장소를 못 쓰면 기본 목록으로 돌아간다 */
    }
  }, [tab, clientId, source, q]);

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
            (source === "all" || r.source === source) &&
            includesText([r.requestNo, r.itemName, r.itemCode, r.barcode], q),
        )
        // 대기는 오래된 요청부터(상세의 [다음 요청] 순서와 같다), 반려는 최근 반려부터, 오늘 처리는 최근 처리부터
        .sort((a, b) =>
          tab === "wait"
            ? a.requestedAt.localeCompare(b.requestedAt) || a.requestNo.localeCompare(b.requestNo)
            : tab === "done"
              ? (b.doneByMeToday?.at ?? "").localeCompare(a.doneByMeToday?.at ?? "")
              : (b.processedAt ?? "").localeCompare(a.processedAt ?? ""),
        ),
    [rows, tab, clientId, source, q, canReview],
  );

  const columns: Column<ItemRequestRow>[] = [
    {
      key: "no",
      header: "요청번호",
      render: (r) => {
        const dup = r.status === "WAITING" ? findDuplicates(itemKeys, r.clientId, r.itemCode, r.barcode) : null;
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
    { key: "code", header: "품목코드", render: (r) => <span className="mono">{r.itemCode}</span> },
    { key: "name", header: "품목명", wrap: true, render: (r) => r.itemName },
    { key: "unit", header: "단위", render: (r) => <span className="mono">{r.unit}</span> },
    { key: "barcode", header: "바코드", render: (r) => <span className="mono">{r.barcode}</span> },
    { key: "temp", header: "온도대", render: (r) => (r.storageTemp ? STORAGE_TEMP_LABEL[r.storageTemp] : <span className="muted">모름</span>) },
    { key: "source", header: "원본", render: (r) => SOURCE_LABEL[r.source] },
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
        // 단건·엑셀 일괄 요청은 등록 요청 화면의 탭에서 고른다
        actions={!canReview ? <CreateButton href="/master/item-requests/new">등록 요청</CreateButton> : undefined}
      />
      <FilterBar>
        {clients.length > 1 && (
          <>
            <FilterField label="화주사" htmlFor="f-client">
              <Select id="f-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">전체</option>
                {clients
                  .filter((c) => withInactiveClients || c.isActive || String(c.id) === clientId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isActive ? "" : " (사용 안 함)"}
                    </option>
                  ))}
              </Select>
            </FilterField>
            <FilterCheckbox id="f-client-inactive" label="사용 안 함 포함" checked={withInactiveClients} onChange={setWithInactiveClients} />
          </>
        )}
        <FilterField label="원본">
          <ChipGroup value={source} onChange={setSource} options={sourceOptions} />
        </FilterField>
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
