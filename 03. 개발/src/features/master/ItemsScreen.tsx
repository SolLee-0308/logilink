"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ActiveBadge, Tag } from "@/components/ui/Badges";
import { LinkButton, CreateButton, DownloadButton } from "@/components/ui/Button";
import { itemFilterParams, matchItem } from "@/domain/item-list-filter";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { ClientPicker } from "@/features/plans/ClientFinder";
import { NoteBox } from "@/components/ui/NoteBox";
import { ListToolbar, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { ALIAS_SOURCE_LABEL, STORAGE_TEMP_LABEL, STORAGE_TEMPS, type StorageTemp } from "@/domain/master";
import { itemsTitle } from "@/domain/master";
import { LastChanged } from "./history";
import { ViewSection } from "./record";
import { RULES } from "./rules";
import { ACTIVE_OPTIONS, MasterHeader, type ActiveFilter } from "./shared";
import type { ClientOption, ItemRow, ItemUomRow } from "./types";
import recordStyles from "./ClientsScreen.module.css";
import styles from "./ItemsScreen.module.css";

/** 단위 환산 요약: EA · BOX=20 */
export const uomSummary = (uoms: ItemUomRow[]) => uoms.map((u) => (u.qty === 1 ? u.unit : `${u.unit}=${u.qty.toLocaleString()}`)).join(" · ");


export const LABELS = {
  name: "품목명",
  baseUnit: "기준 단위",
  storageTemp: "보관 온도대",
  expiryManaged: "소비기한 관리",
  lotManaged: "로트 관리",
  isActive: "사용 여부",
  uoms: "단위 환산",
  barcodes: "바코드",
  aliases: "별칭",
};

export const fmtHistory = (k: string, v: unknown) => {
  if (k === "storageTemp") return STORAGE_TEMP_LABEL[v as StorageTemp] ?? String(v);
  if (k === "isActive") return v ? "사용" : "사용 안 함";
  if (typeof v === "boolean") return v ? "관리" : "관리 안 함";
  return v === null || v === undefined || v === "" ? "없음" : String(v);
};

type TempFilter = "all" | StorageTemp;

/** 목록 조회조건·선택 품목 — 주소(?client=&temp=&active=&q=&item=)에 남겨 등록·수정 화면에서 돌아와도 그대로 */
export interface ItemListQuery {
  client: string;
  temp: TempFilter;
  active: ActiveFilter;
  q: string;
  /** 선택(오른쪽 상세에 표시)한 품목 id */
  item: number | null;
}

/** 등록·수정·엑셀 화면에서 [← 목록]·저장 후 돌아갈 주소 */
export const ITEM_LIST_KEY = "logilink:items:list";

export function itemListSearch(f: ItemListQuery) {
  const p = new URLSearchParams();
  if (f.client) p.set("client", f.client);
  if (f.temp !== "all") p.set("temp", f.temp);
  if (f.active !== "on") p.set("active", f.active);
  if (f.q) p.set("q", f.q);
  if (f.item) p.set("item", String(f.item));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** 기억해 둔 목록 주소에서 선택 품목만 바꾼다 (저장 후 그 품목이 선택된 목록으로) */
export function itemListUrl(item?: number) {
  let url = "/master/items";
  try {
    url = sessionStorage.getItem(ITEM_LIST_KEY) ?? url;
  } catch {
    /* 저장소를 못 쓰면 기본 목록 */
  }
  const u = new URL(url, "http://x");
  if (item) u.searchParams.set("item", String(item));
  return u.pathname + u.search;
}

/**
 * 품목 관리(3PL) · 품목 조회(화주사) — 목록 + 오른쪽 상세 조회 패널
 * - 3PL: 목록 위 [+ 등록](등록 화면에서 단건·엑셀 일괄 탭), 상세 패널 [수정] → 별도 화면
 * - 화주사: 조회만. 새 품목은 품목 등록 요청 화면에서 신청한다 (U6)
 */
export function ItemsScreen({
  rows,
  clients,
  initial,
  canEdit,
  canRequest,
  openRequests,
}: {
  rows: ItemRow[];
  clients: ClientOption[];
  initial: ItemListQuery;
  /** 3PL: 등록·수정 */
  canEdit: boolean;
  /** 화주사: 등록 요청 안내 */
  canRequest: boolean;
  /** 화주사: 검토 중(등록대기·반려)인 내 요청 건수 */
  openRequests: number;
}) {
  const initialClient = clients.find((c) => String(c.id) === initial.client);
  const [clientId, setClientId] = useState(initialClient ? initial.client : "");
  // 화주사 선택 목록에서 사용 안 함 화주사는 기본 제외 (조회 필터에서만 포함 가능)
  const [withInactiveClients, setWithInactiveClients] = useState(!!initialClient && !initialClient.isActive);
  const [temp, setTemp] = useState<TempFilter>(initial.temp);
  const [active, setActive] = useState<ActiveFilter>(initial.active);
  const [q, setQ] = useState(initial.q);
  const [selected, setSelected] = useState<number | null>(initial.item);
  const singleClient = clients.length <= 1;
  const title = itemsTitle(canEdit);

  // 엑셀 다운로드와 같은 규칙으로 거른다 (U58)
  const filter = { client: clientId, temp, active, q };
  const list = useMemo(() => rows.filter((r) => matchItem(r, { client: clientId, temp, active, q })), [rows, clientId, temp, active, q]);
  // 걸러진 목록에 선택 품목이 없으면 첫 행을 보여 준다
  const activeId = selected !== null && list.some((r) => r.id === selected) ? selected : (list[0]?.id ?? null);
  const current = activeId === null ? null : (rows.find((r) => r.id === activeId) ?? null);

  // 화주사를 바꾸면 서버에서 그 화주사 품목만 다시 읽는다 (2026-11-14 Sol, 화주사 먼저 선택)
  const router = useRouter();
  const [loading, startLoading] = useTransition();
  const pickClient = (v: string) => {
    setClientId(v);
    setSelected(null);
  };
  const needClient = !singleClient && !clientId;

  // 조회조건·선택을 주소에 반영 + 등록·수정 화면의 [← 목록]용으로 기억.
  // 서버가 읽은 화주사(initial.client)와 다르면 서버에서 다시 읽는다. 이때 history.replaceState를 함께 부르면
  // 진행 중인 다시 읽기가 취소되어 목록이 비는 문제가 있었다 (2026-11-14 Sol 피드백) → 둘 중 하나만 한다
  useEffect(() => {
    const url = `/master/items${itemListSearch({ client: clientId, temp, active, q, item: activeId })}`;
    if (!singleClient && clientId !== initial.client) startLoading(() => router.replace(url, { scroll: false }));
    else window.history.replaceState(null, "", url);
    try {
      sessionStorage.setItem(ITEM_LIST_KEY, url);
    } catch {
      /* 저장소를 못 써도 목록은 동작 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, temp, active, q, activeId, initial.client]);

  const columns: Column<ItemRow>[] = [
    {
      key: "code",
      header: "품목코드",
      align: "center",
      render: (r) => (
        <>
          <span className="mono">{r.code}</span>
          {/* 화주사 품목코드는 더 연하게 (2026-11-07 Sol 피드백) */}
          {r.clientCode && <small className="mono" style={{ display: "block", color: "var(--soft)" }}>{r.clientCode}</small>}
        </>
      ),
    },
    {
      key: "name",
      header: "품목명",
      wrap: true,
      render: (r) => (
        <>
          {r.name}
          <CellSub>
            {singleClient ? "" : `${r.clientName} · `}
            {STORAGE_TEMP_LABEL[r.storageTemp]}
          </CellSub>
        </>
      ),
    },
    // 단위 — 다른 화면 단위 열처럼 좁게, 단위가 여럿이면 한 줄에 하나씩 (2026-11-14 Sol)
    {
      key: "uom",
      header: "단위",
      align: "center",
      width: 56,
      wrap: true,
      render: (r) => (
        <span className="mono">
          {[...r.uoms]
            .sort((a, b) => a.qty - b.qty)
            .map((u) => (
              <span key={u.unit} style={{ display: "block", whiteSpace: "nowrap" }}>
                {u.qty === 1 ? u.unit : `${u.unit}=${u.qty.toLocaleString()}`}
              </span>
            ))}
        </span>
      ),
    },
    {
      key: "barcode",
      header: "대표 바코드",
      align: "center",
      render: (r) => (
        <>
          <span className="mono">{r.barcodes[0]?.barcode}</span>
          {r.barcodes.length > 1 && <CellSub>외 {r.barcodes.length - 1}개</CellSub>}
        </>
      ),
    },
    {
      key: "manage",
      header: "관리",
      align: "center",
      render: (r) => (
        <span className="cell-tags">
          {r.expiryManaged && <Tag tone="neutral">소비기한</Tag>}
          {r.lotManaged && <Tag tone="neutral">로트</Tag>}
          {!r.expiryManaged && !r.lotManaged && <span className="muted">–</span>}
        </span>
      ),
    },
    { key: "active", header: "사용 여부", align: "center", render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  const clientQuery = clientId ? `?client=${clientId}` : "";

  return (
    <>
      <MasterHeader
        title={title}
        count={rows.length}
        rules={RULES.items}
        // 단건·엑셀 일괄 등록은 등록 화면의 '입력 방법' 스위치에서 고른다
        actions={canEdit ? <CreateButton href={`/master/items/new${clientQuery}`}>등록</CreateButton> : undefined}
      />
      <FilterBar>
        {!singleClient && (
          <>
            <FilterField label="화주사" htmlFor="f-client">
              <ClientPicker
                id="f-client"
                value={clientId}
                onChange={pickClient}
                clients={clients.filter((c) => withInactiveClients || c.isActive || String(c.id) === clientId)}
              />
              {/* 화주사 칸에 붙여 둔다 — 따로 한 칸을 차지하면 열 맞춤이 어긋남 (2026-11-14 Sol) */}
              <FilterCheckbox id="f-client-inactive" label="사용 안 함 포함" checked={withInactiveClients} onChange={setWithInactiveClients} />
            </FilterField>
          </>
        )}
        <FilterField label="온도대">
          <ChipGroup
            value={temp}
            onChange={setTemp}
            options={[{ value: "all" as const, label: "전체" }, ...STORAGE_TEMPS.map((t) => ({ value: t, label: STORAGE_TEMP_LABEL[t] }))]}
          />
        </FilterField>
        <FilterField label="사용 여부">
          <ChipGroup options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </FilterField>
        <SearchInput value={q} onChange={setQ} placeholder="품목코드, 품목명, 바코드, 별칭 검색" />
      </FilterBar>

      {canRequest && (
        <NoteBox tone="info">
          찾는 품목이 없으면{" "}
          <Link href="/master/item-requests" className={styles.inlineLink}>
            품목 등록 요청
          </Link>
          에서 신청하세요. 3PL이 확인한 뒤 등록합니다.
          {openRequests > 0 && (
            <>
              {" "}
              지금 검토 중인 요청이 <strong className="mono">{openRequests}</strong>건 있습니다.
            </>
          )}
        </NoteBox>
      )}

      <SplitView
        collapsible
        list={
          <>
            <ListToolbar total={list.length}>
              {/* 조회 결과만 내려받기 — 3PL은 고른 화주사, 화주사는 자기 품목 (U58, 2026-11-15 Sol) */}
              <DownloadButton
                href={`/master/items/export?${itemFilterParams(filter).toString()}`}
                disabled={needClient || loading || list.length === 0}
                title={needClient ? "화주사를 먼저 고르세요." : list.length === 0 ? "내려받을 품목이 없습니다." : "지금 조회된 품목을 엑셀로 내려받습니다."}
              >
                엑셀 다운로드
              </DownloadButton>
            </ListToolbar>
            <DataTable
              caption={`${title} 목록`}
              columns={columns}
              rows={list}
              rowKey={(r) => String(r.id)}
              activeKey={activeId === null ? null : String(activeId)}
              onActivate={(k) => setSelected(Number(k))}
              empty={needClient ? "화주사를 먼저 고르세요. 고른 화주사의 품목만 불러옵니다." : loading ? "불러오는 중입니다." : "조건에 맞는 품목이 없습니다. 조회조건을 바꿔 보세요."}
            />
          </>
        }
        panel={<ItemPanel row={current} canEdit={canEdit} />}
      />
    </>
  );
}

/** 오른쪽 상세 조회 패널 — 3PL에게만 [수정] (수정 화면으로 이동) */
function ItemPanel({ row, canEdit }: { row: ItemRow | null; canEdit: boolean }) {
  if (!row) {
    return (
      <SidePanel label="품목 상세">
        <p className="muted">목록에서 품목을 선택하면 상세가 보입니다.</p>
      </SidePanel>
    );
  }
  const base = row.baseUnit;
  return (
    <SidePanel
      label="품목 상세"
      title={
        <>
          <PanelTitle mono>{row.code}</PanelTitle>
          <ActiveBadge active={row.isActive} />
        </>
      }
      sub={`${row.clientName} · ${row.name}`}
      footer={
        <>
          <LastChanged by={row.updatedBy} at={row.updatedAt} title={row.name} entries={row.history} created={{ at: row.createdAt, by: row.createdBy }} labels={LABELS} format={fmtHistory} />
          {/* 수정은 패널 아래 오른쪽 (2026-11-06 Sol 결정: 위쪽 접기 아이콘과 나눔) */}
          {canEdit && <LinkButton size="sm" variant="editSoft" href={`/master/items/${row.id}/edit`}>수정</LinkButton>}
        </>
      }
    >
      <ViewSection
        title="기본 정보"
        items={[
          ["화주사", row.clientName],
          ["품목코드", <span key="c" className="mono">{row.code}</span>],
          ["화주사 품목코드", row.clientCode ? <span key="cc" className="mono">{row.clientCode}</span> : <span key="cc" className="muted">없음</span>],
          ["품목명", row.name],
          ["보관 온도대", STORAGE_TEMP_LABEL[row.storageTemp]],
          [
            "관리",
            row.expiryManaged || row.lotManaged ? (
              <span key="m" className="cell-tags">
                {row.expiryManaged && <Tag tone="neutral">소비기한</Tag>}
                {row.lotManaged && <Tag tone="neutral">로트</Tag>}
              </span>
            ) : (
              "관리 안 함"
            ),
          ],
        ]}
      />
      <ViewSection
        title="단위 환산"
        items={row.uoms.map((u): [string, React.ReactNode] => [
          `1 ${u.unit}`,
          u.unit === base ? <span key={u.unit} className="muted">기준 단위</span> : <span key={u.unit} className="mono">{`${u.qty.toLocaleString()} ${base}`}</span>,
        ])}
      />
      <ViewSection
        title="바코드"
        items={row.barcodes.map((b, i): [string, React.ReactNode] => [
          b.isPrimary ? `${b.unit} · 대표` : b.unit,
          <span key={i} className="mono">{b.barcode}</span>,
        ])}
      />
      <ViewSection
        title="별칭"
        items={[
          [
            "AI·엑셀 매칭",
            row.aliases.length ? (
              <ul key="a" className={styles.aliases} aria-label="별칭 목록">
                {row.aliases.map((a) => (
                  <li key={a.id} className={styles.alias} title={ALIAS_SOURCE_LABEL[a.source]} style={{ paddingRight: 10 }}>
                    {a.alias}
                  </li>
                ))}
              </ul>
            ) : null,
          ],
        ]}
      />
    </SidePanel>
  );
}
