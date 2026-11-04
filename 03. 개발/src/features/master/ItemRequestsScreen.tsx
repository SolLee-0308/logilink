"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { FormCheck, FormField, Input, Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { KeyValue, ListToolbar, PanelFootNote, PanelSection, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { Tabs } from "@/components/ui/Tabs";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import {
  ITEM_REQUEST_ACTION_LABEL,
  ITEM_REQUEST_STATUS_META,
  ITEM_UNITS,
  SOURCE_LABEL,
  STORAGE_TEMP_LABEL,
  STORAGE_TEMPS,
  normalizeAlias,
  type StorageTemp,
  type ItemRequestSource,
  type ItemUnit,
} from "@/domain/master";
import { fmtDateTime, fmtShortDateTime, includesText } from "@/lib/format";
import { registerItemRequest, rejectItemRequest } from "@/server/master/actions";
import { RejectModal } from "@/features/shared/RejectModal";
import { MasterHeader, useAction, useSelection } from "./shared";
import { RULES } from "./rules";
import type { ClientOption, CodeOption, ItemKey, ItemRequestRow } from "./types";

type SourceFilter = "all" | ItemRequestSource;

/** 탭 — 승인 대기 화면과 같은 구성: 대기 / 반려·화주사 수정 중 / 오늘 내가 처리 */
type ReqTab = "wait" | "rej" | "done";
const TAB_LABEL: Record<ReqTab, string> = { wait: "등록대기", rej: "반려 · 화주사 수정 중", done: "오늘 처리" };
const inTab = (r: ItemRequestRow, t: ReqTab) =>
  t === "wait" ? r.status === "WAITING" : t === "rej" ? r.status === "REJECTED" : r.doneByMeToday !== null;

/** 같은 화주사의 기존 품목과 품목코드·바코드가 겹치는지 */
function findDuplicates(itemKeys: ItemKey[], clientId: number, code: string, barcode: string) {
  const same = itemKeys.filter((k) => k.clientId === clientId);
  return {
    code: same.find((k) => k.code === code.trim()),
    barcode: same.find((k) => k.barcodes.includes(barcode.trim())),
  };
}

export function ItemRequestsScreen({
  rows,
  clients,
  itemKeys,
  reasons,
}: {
  rows: ItemRequestRow[];
  clients: ClientOption[];
  itemKeys: ItemKey[];
  reasons: CodeOption[];
}) {
  const [tab, setTab] = useState<ReqTab>("wait");
  const [clientId, setClientId] = useState("");
  // 화주사 선택 목록에서 사용 안 함 화주사는 기본 제외 (조회 필터에서만 포함 가능)
  const [withInactiveClients, setWithInactiveClients] = useState(false);
  const [source, setSource] = useState<SourceFilter>("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<ReqTab, number> = { wait: 0, rej: 0, done: 0 };
    rows.forEach((r) => (["wait", "rej", "done"] as const).forEach((t) => inTab(r, t) && c[t]++));
    return c;
  }, [rows]);

  const list = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            inTab(r, tab) &&
            (!clientId || r.clientId === Number(clientId)) &&
            (source === "all" || r.source === source) &&
            includesText([r.requestNo, r.itemName, r.itemCode, r.barcode], q),
        )
        // 대기는 오래된 요청부터, 반려는 최근 반려부터, 오늘 처리는 최근 처리부터
        .sort((a, b) =>
          tab === "wait"
            ? a.requestedAt.localeCompare(b.requestedAt)
            : tab === "done"
              ? (b.doneByMeToday?.at ?? "").localeCompare(a.doneByMeToday?.at ?? "")
              : (b.processedAt ?? "").localeCompare(a.processedAt ?? ""),
        ),
    [rows, tab, clientId, source, q],
  );
  const sel = useSelection(list.map((r) => r.id));
  const current = rows.find((r) => r.id === sel.active) ?? null;

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
    { key: "client", header: "화주사", render: (r) => r.clientName },
    {
      key: "item",
      header: "요청 품목",
      wrap: true,
      render: (r) => (
        <>
          {r.itemName}
          <CellSub mono>
            {r.itemCode} · {r.unit}
          </CellSub>
        </>
      ),
    },
    { key: "barcode", header: "바코드", render: (r) => <span className="mono">{r.barcode}</span> },
    {
      key: "requested",
      header: tab === "wait" ? "요청" : tab === "done" ? "내 처리" : "반려",
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
    {
      key: "status",
      header: "상태",
      render: (r) => <Badge tone={ITEM_REQUEST_STATUS_META[r.status].tone}>{ITEM_REQUEST_STATUS_META[r.status].label}</Badge>,
    },
  ];

  return (
    <>
      <MasterHeader title="품목 등록 요청" count={counts.wait} rules={RULES.itemRequests} />
      <FilterBar>
        <FilterField label="화주사" htmlFor="f-client">
          <Select id="f-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">전체</option>
            {clients.filter((c) => withInactiveClients || c.isActive || String(c.id) === clientId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isActive ? "" : " (사용 안 함)"}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterCheckbox id="f-client-inactive" label="사용 안 함 포함" checked={withInactiveClients} onChange={setWithInactiveClients} />
        <FilterField label="원본">
          <ChipGroup
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: "전체" },
              { value: "AI", label: "AI 판독" },
              { value: "EXCEL", label: "엑셀" },
              { value: "DIRECT", label: "직접 입력" },
            ]}
          />
        </FilterField>
        <SearchInput value={q} onChange={setQ} placeholder="요청번호, 품목명, 품목코드, 바코드 검색" />
      </FilterBar>
      <Tabs
        label="요청 상태"
        value={tab}
        onChange={setTab}
        panelId="req-body"
        items={(["wait", "rej", "done"] as const).map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] }))}
      />
      <div id="req-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <SplitView
          list={
            <>
              <ListToolbar total={list.length} />
              <DataTable
                caption="품목 등록 요청 목록"
                columns={columns}
                rows={list}
                rowKey={(r) => String(r.id)}
                activeKey={sel.active === null ? null : String(sel.active)}
                onActivate={(k) => sel.select(Number(k))}
                empty={tab === "wait" ? "처리할 품목 등록 요청이 없습니다." : tab === "done" ? "오늘 처리한 요청이 없습니다." : "조건에 맞는 요청이 없습니다. 조회조건을 바꿔 보세요."}
              />
            </>
          }
          panel={
            <RequestPanel
              key={current ? `${current.id}-${current.version}` : "none"}
              row={current}
              itemKeys={itemKeys}
              reasons={reasons}
            />
          }
        />
      </div>
    </>
  );
}

function historyEntries(row: ItemRequestRow): TimelineEntry[] {
  return row.histories.map((h) => ({
    key: String(h.id),
    tone: h.action === "REJECT" ? "reject" : h.action === "REGISTER" ? "ok" : "save",
    title: (
      <span>
        {h.actor} · {ITEM_REQUEST_ACTION_LABEL[h.action]}
        {h.reasonName ? ` · ${h.reasonName}` : ""}
      </span>
    ),
    detail: h.memo ?? undefined,
    quote: h.reasonText ?? undefined,
    at: fmtDateTime(h.at),
  }));
}

function RequestPanel({ row, itemKeys, reasons }: { row: ItemRequestRow | null; itemKeys: ItemKey[]; reasons: CodeOption[] }) {
  const [code, setCode] = useState(row?.itemCode ?? "");
  const [name, setName] = useState(row?.itemName ?? "");
  const [unit, setUnit] = useState<ItemUnit>(row?.unit ?? "EA");
  const [barcode, setBarcode] = useState(row?.barcode ?? "");
  const [storageTemp, setStorageTemp] = useState<StorageTemp | "">(row?.storageTemp ?? "");
  const [expiryManaged, setExpiryManaged] = useState(row?.expiryManaged ?? false);
  const [lotManaged, setLotManaged] = useState(row?.lotManaged ?? false);
  const [keepAlias, setKeepAlias] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  /** 처리 시점 version 충돌·이미 처리됨 — 승인 대기와 같은 안내 + [변경 내용 불러오기] */
  const [conflict, setConflict] = useState<string | null>(null);
  const router = useRouter();
  const act = useAction();

  if (!row) {
    return (
      <SidePanel label="품목 등록 요청 상세">
        <p className="muted">목록에서 요청을 선택하면 상세가 보입니다.</p>
      </SidePanel>
    );
  }

  const waiting = row.status === "WAITING";
  const dup = findDuplicates(itemKeys, row.clientId, code, barcode);
  const hasDup = !!(dup.code || dup.barcode);
  const edited = code !== row.itemCode || name !== row.itemName || unit !== row.unit || barcode !== row.barcode;
  const orig = (v: string, now: string) => (v !== now ? `요청값: ${v}` : undefined);
  const nameChanged = normalizeAlias(name) !== normalizeAlias(row.itemName);
  const fromShipper = "화주사 입력값";

  function register(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    act.run(async () => {
      const r = await registerItemRequest({
        id: row.id,
        version: row.version,
        itemCode: code,
        itemName: name,
        unit,
        barcode,
        storageTemp: storageTemp as StorageTemp,
        expiryManaged,
        lotManaged,
        keepRequestNameAsAlias: keepAlias,
      });
      if (!r.ok && (r.code === "CONFLICT" || r.code === "STATE")) {
        setConflict(r.error);
        return { ...r, code: "STATE" as const };
      }
      return r;
    });
  }

  return (
    <SidePanel
      label="품목 등록 요청 상세"
      onSubmit={waiting ? register : undefined}
      title={
        <>
          <PanelTitle mono>{row.requestNo}</PanelTitle>
          <Badge tone={ITEM_REQUEST_STATUS_META[row.status].tone}>{ITEM_REQUEST_STATUS_META[row.status].label}</Badge>
          {row.resubmitCount > 0 && <Tag tone="accent">재요청 {row.resubmitCount}회</Tag>}
        </>
      }
      sub={`${row.clientName} · ${SOURCE_LABEL[row.source]}`}
      footer={
        waiting ? (
          <>
            <Button variant="danger" onClick={() => setRejecting(true)} disabled={act.pending || !!conflict}>
              반려
            </Button>
            <Button type="submit" variant="primary" disabled={act.pending || hasDup || !!conflict}>
              {edited ? "수정해서 등록" : "등록"}
            </Button>
          </>
        ) : row.status === "REJECTED" ? (
          <PanelFootNote>화주사 재요청 대기</PanelFootNote>
        ) : (
          <PanelFootNote>
            등록 품목 <span className="mono">{row.registeredItemCode}</span>
          </PanelFootNote>
        )
      }
    >
      {conflict && (
        <NoteBox
          tone="error"
          action={
            <Button size="sm" onClick={() => router.refresh()}>
              변경 내용 불러오기
            </Button>
          }
        >
          <strong>{conflict}</strong>
        </NoteBox>
      )}
      {act.error && !conflict && <NoteBox tone="error">{act.error}</NoteBox>}
      {waiting && hasDup && (
        <NoteBox tone="warn">
          <strong>이미 등록된 품목과 겹칩니다.</strong>
          {dup.code && <> 품목코드는 {dup.code.code} {dup.code.name}이(가) 쓰고 있습니다.</>}
          {dup.barcode && <> 바코드는 {dup.barcode.code} {dup.barcode.name}이(가) 쓰고 있습니다.</>} 값을 고치거나 반려하세요.
        </NoteBox>
      )}
      {row.status === "REJECTED" && (
        <NoteBox tone="info">
          반려 사유: <strong>{row.rejectReasonName}</strong>
          {row.rejectReasonText ? ` · ${row.rejectReasonText}` : ""}
          <br />
          화주사가 수정해 다시 요청하면 등록대기로 돌아옵니다.
        </NoteBox>
      )}

      <KeyValue
        items={[
          ["화주사", row.clientName],
          ["요청", `${fmtDateTime(row.requestedAt)} · ${row.requestedBy}`],
          ["원본", SOURCE_LABEL[row.source]],
          ...(row.processedAt ? [["처리", `${fmtDateTime(row.processedAt)} · ${row.processedBy}`] as [string, string]] : []),
        ]}
      />
      {row.sourceNote && (
        <PanelSection title="원본 내용">
          <p className="note-quote">{row.sourceNote}</p>
        </PanelSection>
      )}

      <PanelSection title={waiting ? "등록할 품목" : "요청 품목"} aside={waiting && edited ? <Tag tone="accent">요청값 수정함</Tag> : undefined}>
        {waiting ? (
          <>
            <FormField label="품목코드" htmlFor="r-code" required hint={orig(row.itemCode, code)} error={act.fieldErrors.itemCode ?? (dup.code ? "이미 등록된 품목코드입니다." : undefined)}>
              <Input id="r-code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" />
            </FormField>
            <FormField label="품목명" htmlFor="r-name" required hint={orig(row.itemName, name)} error={act.fieldErrors.itemName}>
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </FormField>
            <FormField label="단위" htmlFor="r-unit" required hint={orig(row.unit, unit)} error={act.fieldErrors.unit}>
              <Select id="r-unit" value={unit} onChange={(e) => setUnit(e.target.value as ItemUnit)}>
                {ITEM_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="바코드"
              htmlFor="r-barcode"
              required
              hint={orig(row.barcode, barcode) ?? "숫자 8~14자리"}
              error={act.fieldErrors.barcode ?? (dup.barcode ? "같은 화주사의 다른 품목이 쓰는 바코드입니다." : undefined)}
            >
              <Input id="r-barcode" className="mono" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ""))} maxLength={14} autoComplete="off" />
            </FormField>
            <FormField
              label="보관 온도대"
              htmlFor="r-temp"
              required
              hint={row.storageTemp ? fromShipper : "화주사가 보내지 않아 직접 정합니다."}
              error={act.fieldErrors.storageTemp}
            >
              <Select id="r-temp" value={storageTemp} onChange={(e) => setStorageTemp(e.target.value as StorageTemp)}>
                <option value="">온도대를 선택하세요</option>
                {STORAGE_TEMPS.map((t) => (
                  <option key={t} value={t}>
                    {STORAGE_TEMP_LABEL[t]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormCheck id="r-expiry" label="유통기한 관리" checked={expiryManaged} onChange={setExpiryManaged} />
            <FormCheck
              id="r-lot"
              label="로트 관리"
              checked={lotManaged}
              onChange={setLotManaged}
              hint={row.expiryManaged !== null || row.lotManaged !== null ? fromShipper : undefined}
            />
            {nameChanged && (
              <FormCheck
                id="r-alias"
                label={`요청 품목명 '${row.itemName}'을(를) 별칭으로 등록`}
                checked={keepAlias}
                onChange={setKeepAlias}
                hint="다음 AI 판독·엑셀에서 같은 표기가 오면 이 품목으로 자동 매칭합니다."
              />
            )}
          </>
        ) : (
          <KeyValue
            items={[
              ["품목코드", <span key="c" className="mono">{row.itemCode}</span>],
              ["품목명", row.itemName],
              ["단위", <span key="u" className="mono">{row.unit}</span>],
              ["바코드", <span key="b" className="mono">{row.barcode}</span>],
              ["보관 온도대", row.storageTemp ? STORAGE_TEMP_LABEL[row.storageTemp] : "화주사 미입력"],
            ]}
          />
        )}
      </PanelSection>

      <PanelSection title="처리 이력">
        <Timeline entries={historyEntries(row)} />
      </PanelSection>

      <RejectModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="품목 등록 요청 반려"
        description="반려하면 화주사가 사유를 확인하고 수정해 다시 요청할 수 있습니다."
        target={
          <span>
            <span className="mono">{row.requestNo}</span> · {row.clientName} · {row.itemName}
          </span>
        }
        reasons={reasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await rejectItemRequest({ id: row.id, version: row.version, reasonCode, reasonText });
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
