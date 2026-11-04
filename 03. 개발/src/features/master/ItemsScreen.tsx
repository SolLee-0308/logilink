"use client";

import { useMemo, useState } from "react";
import { ActiveBadge, Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { FormCheck, FormError, FormField, FormStatic, Input, Select } from "@/components/ui/Form";
import { ListToolbar, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import {
  ALIAS_SOURCE_LABEL,
  ITEM_UNITS,
  STORAGE_TEMP_LABEL,
  STORAGE_TEMPS,
  normalizeAlias,
  type AliasSource,
  type ItemUnit,
  type StorageTemp,
} from "@/domain/master";
import { includesText } from "@/lib/format";
import { saveItem } from "@/server/master/actions";
import { loadItem } from "@/server/master/loaders";
import { EditModal, Full, FormSection, ViewSection, useEditTarget } from "./record";
import { ACTIVE_OPTIONS, MasterHeader, matchActive, useAction, useSelection, type ActiveFilter } from "./shared";
import { LastChanged } from "./history";
import { RULES } from "./rules";
import type { ClientOption, ItemBarcodeRow, ItemRow, ItemUomRow } from "./types";
import recordStyles from "./ClientsScreen.module.css";
import styles from "./ItemsScreen.module.css";

const LABELS = {
  name: "품목명",
  baseUnit: "기준 단위",
  storageTemp: "보관 온도대",
  expiryManaged: "유통기한 관리",
  lotManaged: "로트 관리",
  isActive: "사용 여부",
  uoms: "단위 환산",
  barcodes: "바코드",
  aliases: "별칭",
};

const fmtHistory = (k: string, v: unknown) => {
  if (k === "storageTemp") return STORAGE_TEMP_LABEL[v as StorageTemp] ?? String(v);
  if (k === "isActive") return v ? "사용" : "사용 안 함";
  if (typeof v === "boolean") return v ? "관리" : "관리 안 함";
  return v === null || v === undefined || v === "" ? "없음" : String(v);
};

/** 단위 환산 요약: EA · BOX=20 */
export const uomSummary = (uoms: ItemUomRow[]) => uoms.map((u) => (u.qty === 1 ? u.unit : `${u.unit}=${u.qty}`)).join(" · ");

type TempFilter = "all" | StorageTemp;

export function ItemsScreen({
  rows,
  clients,
  initialClientId,
}: {
  rows: ItemRow[];
  clients: ClientOption[];
  /** 화주사 화면 요약에서 넘어온 화주사 필터 */
  initialClientId?: number;
}) {
  const initialClient = initialClientId ? clients.find((c) => c.id === initialClientId) : undefined;
  const [clientId, setClientId] = useState(initialClient ? String(initialClient.id) : "");
  // 화주사 선택 목록에서 사용 안 함 화주사는 기본 제외 (조회 필터에서만 포함 가능)
  const [withInactiveClients, setWithInactiveClients] = useState(!!initialClient && !initialClient.isActive);
  const [temp, setTemp] = useState<TempFilter>("all");
  const [active, setActive] = useState<ActiveFilter>("all");
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!clientId || r.clientId === Number(clientId)) &&
          (temp === "all" || r.storageTemp === temp) &&
          matchActive(active, r.isActive) &&
          includesText([r.code, r.name, ...r.barcodes.map((b) => b.barcode), ...r.aliases.map((a) => a.alias)], q),
      ),
    [rows, clientId, temp, active, q],
  );
  const sel = useSelection(list.map((r) => r.id));
  const current = sel.active === "new" ? null : rows.find((r) => r.id === sel.active) ?? null;
  const edit = useEditTarget(loadItem);

  const columns: Column<ItemRow>[] = [
    { key: "code", header: "품목코드", render: (r) => <span className="mono">{r.code}</span> },
    {
      key: "name",
      header: "품목명",
      wrap: true,
      render: (r) => (
        <>
          {r.name}
          <CellSub>
            {r.clientName} · {STORAGE_TEMP_LABEL[r.storageTemp]}
          </CellSub>
        </>
      ),
    },
    { key: "uom", header: "단위", render: (r) => <span className="mono">{uomSummary(r.uoms)}</span> },
    {
      key: "barcode",
      header: "대표 바코드",
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
      render: (r) => (
        <span className="cell-tags">
          {r.expiryManaged && <Tag tone="neutral">유통기한</Tag>}
          {r.lotManaged && <Tag tone="neutral">로트</Tag>}
          {!r.expiryManaged && !r.lotManaged && <span className="muted">–</span>}
        </span>
      ),
    },
    { key: "active", header: "사용 여부", render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <>
      <MasterHeader title="품목" count={rows.length} rules={RULES.items} />
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
      <SplitView
        list={
          <>
            <ListToolbar total={list.length}>
              <Button variant="primary" size="sm" onClick={edit.openNew}>
                + 등록
              </Button>
            </ListToolbar>
            <DataTable
              caption="품목 목록"
              columns={columns}
              rows={list}
              rowKey={(r) => String(r.id)}
              activeKey={sel.active === "new" ? null : String(sel.active)}
              onActivate={(k) => sel.select(Number(k))}
              empty="조건에 맞는 품목이 없습니다. 조회조건을 바꿔 보세요."
            />
          </>
        }
        panel={<ItemView row={current} onEdit={() => current && edit.openEdit(current.id)} opening={edit.loading} />}
      />
      {edit.target && (
        <ItemEditModal
          key={edit.nonce}
          row={edit.target === "new" ? null : edit.target}
          clients={clients}
          defaultClientId={clientId}
          onClose={edit.close}
          onSaved={(id) => {
            edit.close();
            sel.select(id);
          }}
          onConflict={(id) => edit.reload(id)}
        />
      )}
    </>
  );
}

interface AliasDraft {
  alias: string;
  source: AliasSource;
}

/** 조회 전용 패널 + [수정] */
function ItemView({ row, onEdit, opening }: { row: ItemRow | null; onEdit: () => void; opening: boolean }) {
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
          <span className={recordStyles.headAction}>
            <Button size="sm" onClick={onEdit} disabled={opening}>
              수정
            </Button>
          </span>
        </>
      }
      sub={`${row.clientName} · ${row.name}`}
      footer={
        <LastChanged by={row.updatedBy} at={row.updatedAt} title={row.name} entries={row.history} created={{ at: row.createdAt, by: row.createdBy }} labels={LABELS} format={fmtHistory} />
      }
    >
      <ViewSection
        title="기본 정보"
        items={[
          ["화주사", row.clientName],
          ["품목코드", <span key="c" className="mono">{row.code}</span>],
          ["품목명", row.name],
          ["보관 온도대", STORAGE_TEMP_LABEL[row.storageTemp]],
          [
            "관리",
            row.expiryManaged || row.lotManaged ? (
              <span key="m" className="cell-tags">
                {row.expiryManaged && <Tag tone="neutral">유통기한</Tag>}
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
          u.unit === base ? <span key={u.unit} className="muted">기준 단위</span> : <span key={u.unit} className="mono">{`${u.qty} ${base}`}</span>,
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

const sig = (p: {
  name: string;
  storageTemp: string;
  expiryManaged: boolean;
  lotManaged: boolean;
  isActive: boolean;
  baseUnit: string;
  uoms: { unit: string; qty: string | number }[];
  barcodes: ItemBarcodeRow[];
  aliases: { alias: string }[];
}) =>
  JSON.stringify({
    ...p,
    uoms: p.uoms.map((u) => `${u.unit}:${u.qty}`).sort().join(","),
    barcodes: p.barcodes.map((b) => `${b.unit}:${b.barcode}:${b.isPrimary}`).sort().join(","),
    aliases: p.aliases.map((a) => normalizeAlias(a.alias)).sort().join(","),
  });

/** [+ 등록]·[수정] 공용 넓은 편집 모달 — 열 때 최신 데이터·version을 다시 읽어 온다(useEditTarget) */
function ItemEditModal({
  row,
  clients,
  defaultClientId,
  onClose,
  onSaved,
  onConflict,
}: {
  row: ItemRow | null;
  clients: ClientOption[];
  defaultClientId: string;
  onClose: () => void;
  onSaved: (id: number) => void;
  onConflict: (id: number) => void;
}) {
  const defaultActiveClient = clients.find((c) => String(c.id) === defaultClientId && c.isActive);
  const [clientId, setClientId] = useState(row ? String(row.clientId) : defaultActiveClient ? defaultClientId : "");
  const [code, setCode] = useState(row?.code ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [storageTemp, setStorageTemp] = useState<StorageTemp | "">(row?.storageTemp ?? "");
  const [expiryManaged, setExpiryManaged] = useState(row?.expiryManaged ?? false);
  const [lotManaged, setLotManaged] = useState(row?.lotManaged ?? false);
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [baseUnit, setBaseUnit] = useState<ItemUnit>(row?.baseUnit ?? "EA");
  // 환산 수량은 입력 중 빈 값을 허용하려고 문자열로 둔다
  const [uoms, setUoms] = useState<{ unit: ItemUnit; qty: string }[]>(
    row?.uoms.map((u) => ({ unit: u.unit, qty: String(u.qty) })) ?? [{ unit: "EA", qty: "1" }],
  );
  const [barcodes, setBarcodes] = useState<ItemBarcodeRow[]>(row?.barcodes ?? [{ unit: "EA", barcode: "", isPrimary: true }]);
  const [aliases, setAliases] = useState<AliasDraft[]>(row?.aliases.map((a) => ({ alias: a.alias, source: a.source })) ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [aliasError, setAliasError] = useState("");
  const act = useAction();

  // 처음 열었을 때의 값 — 달라진 것이 있어야 [저장]이 켜지고, 닫을 때 확인창을 띄운다
  const [initialSig] = useState(() =>
    sig({ name, storageTemp, expiryManaged, lotManaged, isActive, baseUnit, uoms, barcodes, aliases }) + (row ? "" : `|${clientId}|${code}`),
  );
  const currentSig = sig({ name, storageTemp, expiryManaged, lotManaged, isActive, baseUnit, uoms, barcodes, aliases }) + (row ? "" : `|${clientId}|${code}`);
  const dirty = currentSig !== initialSig || aliasInput.trim() !== "";

  const usedUnits = new Set(uoms.map((u) => u.unit));
  const freeUnits = ITEM_UNITS.filter((u) => !usedUnits.has(u));

  /** 기준 단위를 바꾸면 그 단위의 환산을 1로 맞춘다 */
  function changeBase(u: ItemUnit) {
    setBaseUnit(u);
    setUoms((prev) => {
      const rest = prev.filter((x) => x.unit !== u).map((x) => (x.qty === "1" ? { ...x, qty: "" } : x));
      return [{ unit: u, qty: "1" }, ...rest];
    });
  }

  function addAlias() {
    const a = aliasInput.trim();
    if (!a) return;
    if (aliases.some((x) => normalizeAlias(x.alias) === normalizeAlias(a))) return setAliasError("이미 추가한 별칭입니다.");
    if (normalizeAlias(a) === normalizeAlias(name)) return setAliasError("품목명과 같은 별칭은 넣지 않아도 됩니다.");
    setAliases([...aliases, { alias: a, source: "MANUAL" }]);
    setAliasInput("");
    setAliasError("");
  }

  function submit() {
    act.run(
      () =>
        saveItem({
          id: row?.id,
          version: row?.version,
          clientId: Number(clientId) || 0,
          code,
          name,
          baseUnit,
          storageTemp: storageTemp as StorageTemp,
          expiryManaged,
          lotManaged,
          isActive,
          uoms: uoms.map((u) => ({ unit: u.unit, qty: u.qty === "" ? NaN : Number(u.qty) })),
          barcodes: barcodes.map((b) => ({ ...b, barcode: b.barcode.trim() })),
          aliases: aliases.map((a) => a.alias),
        }),
      (d) => d && onSaved(d.id),
      row ? () => onConflict(row.id) : undefined,
    );
  }

  return (
    <EditModal
      open
      title={row ? `품목 수정 · ${row.code} ${row.name}` : "품목 등록"}
      description={row ? undefined : "화주사와 품목코드는 등록 후 바꿀 수 없습니다."}
      dirty={dirty}
      pending={act.pending}
      error={act.error}
      submitLabel={row ? "저장" : "등록"}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormSection title="기본 정보">
        {row ? (
          <>
            <FormStatic label="화주사">{row.clientName}</FormStatic>
            <FormStatic label="품목코드">
              <span className="mono">{row.code}</span> <span className="muted">(등록 후 수정 불가)</span>
            </FormStatic>
          </>
        ) : (
          <>
            <FormField label="화주사" htmlFor="i-client" required error={act.fieldErrors.clientId}>
              <Select id="i-client" value={clientId} onChange={(e) => setClientId(e.target.value)} data-autofocus>
                <option value="">화주사를 선택하세요</option>
                {clients
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="품목코드" htmlFor="i-code" required error={act.fieldErrors.code}>
              <Input id="i-code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" />
            </FormField>
          </>
        )}
        <FormField label="품목명" htmlFor="i-name" required error={act.fieldErrors.name}>
          <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} {...(row ? { "data-autofocus": true } : {})} />
        </FormField>
        <FormField label="보관 온도대" htmlFor="i-temp" required error={act.fieldErrors.storageTemp}>
          <Select id="i-temp" value={storageTemp} onChange={(e) => setStorageTemp(e.target.value as StorageTemp)}>
            <option value="">온도대를 선택하세요</option>
            {STORAGE_TEMPS.map((t) => (
              <option key={t} value={t}>
                {STORAGE_TEMP_LABEL[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <Full>
          <div className={styles.checks}>
            <FormCheck id="i-expiry" label="유통기한 관리" checked={expiryManaged} onChange={setExpiryManaged} />
            <FormCheck id="i-lot" label="로트 관리" checked={lotManaged} onChange={setLotManaged} />
            <FormCheck id="i-active" label="사용" checked={isActive} onChange={setIsActive} />
          </div>
          {(expiryManaged || lotManaged) && <p className="muted">유통기한·로트 관리 품목은 입고예정에 입력이 필수이고, 검수 때 실물과 다르면 현장에서 입력합니다.</p>}
        </Full>
      </FormSection>

      <FormSection title="단위 · 바코드">
        <div className={styles.block}>
          <FormField label="기준 단위" htmlFor="i-base" required hint="수량 계산의 기준이 되는 가장 작은 단위입니다.">
            <Select id="i-base" value={baseUnit} onChange={(e) => changeBase(e.target.value as ItemUnit)}>
              {ITEM_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </FormField>
          <ul className={styles.rows} aria-label="단위 환산 목록">
            {uoms.map((u, i) => (
              <li key={u.unit} className={styles.uomRow}>
                <span className="mono">1 {u.unit}</span>
                {u.unit === baseUnit ? (
                  <span className="muted">기준 단위</span>
                ) : (
                  <>
                    <span aria-hidden="true">=</span>
                    <Input
                      className={`mono ${styles.qty}`}
                      inputMode="numeric"
                      aria-label={`${u.unit} 환산 수량`}
                      value={u.qty}
                      onChange={(e) => {
                        const qty = e.target.value.replace(/[^\d]/g, "");
                        setUoms(uoms.map((x, j) => (j === i ? { ...x, qty } : x)));
                      }}
                      maxLength={6}
                    />
                    <span className="mono">{baseUnit}</span>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`${u.unit} 단위 빼기`}
                      disabled={barcodes.some((b) => b.unit === u.unit)}
                      title={barcodes.some((b) => b.unit === u.unit) ? "이 단위를 쓰는 바코드를 먼저 빼세요." : undefined}
                      onClick={() => setUoms(uoms.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {freeUnits.length > 0 && (
            <div className={styles.addRow}>
              {freeUnits.map((u) => (
                <Button key={u} size="sm" onClick={() => setUoms([...uoms, { unit: u, qty: "" }])}>
                  + {u} 추가
                </Button>
              ))}
            </div>
          )}
          <FormError>{act.fieldErrors.uoms}</FormError>
        </div>

        <div className={styles.block}>
          <span className={styles.blockLabel}>바코드</span>
          <ul className={styles.rows} aria-label="바코드 목록">
            {barcodes.map((b, i) => (
              <li key={i} className={styles.barcodeRow}>
                <label className={styles.primary} title="대표 바코드">
                  <input
                    type="radio"
                    name="primary-barcode"
                    checked={b.isPrimary}
                    onChange={() => setBarcodes(barcodes.map((x, j) => ({ ...x, isPrimary: j === i })))}
                  />
                  <span className="sr-only">대표 바코드로 지정</span>
                </label>
                <Input
                  className="mono"
                  inputMode="numeric"
                  aria-label={`바코드 ${i + 1}`}
                  value={b.barcode}
                  onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, barcode: e.target.value.replace(/\s/g, "") } : x)))}
                  maxLength={14}
                  autoComplete="off"
                />
                <Select
                  aria-label={`바코드 ${i + 1} 단위`}
                  value={b.unit}
                  onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, unit: e.target.value as ItemUnit } : x)))}
                >
                  {uoms.map((u) => (
                    <option key={u.unit} value={u.unit}>
                      {u.unit}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`바코드 ${i + 1} 빼기`}
                  disabled={barcodes.length === 1}
                  onClick={() => {
                    const next = barcodes.filter((_, j) => j !== i);
                    if (b.isPrimary && next[0]) next[0] = { ...next[0], isPrimary: true };
                    setBarcodes(next);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.addRow}>
            <Button size="sm" onClick={() => setBarcodes([...barcodes, { unit: baseUnit, barcode: "", isPrimary: barcodes.length === 0 }])}>
              + 바코드 추가
            </Button>
            <span className="muted">● 대표 · 숫자 8~14자리</span>
          </div>
          <FormError>{act.fieldErrors.barcodes}</FormError>
        </div>
      </FormSection>

      <FormSection title="별칭 (AI 판독·엑셀 자동 매칭용)">
        <Full>
          {aliases.length > 0 ? (
            <ul className={styles.aliases} aria-label="별칭 목록">
              {aliases.map((a) => (
                <li key={a.alias} className={styles.alias} title={ALIAS_SOURCE_LABEL[a.source]}>
                  {a.alias}
                  <button type="button" aria-label={`별칭 ${a.alias} 빼기`} onClick={() => setAliases(aliases.filter((x) => x !== a))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">등록된 별칭이 없습니다.</p>
          )}
        </Full>
        <Full>
          <div className={styles.aliasAdd}>
            <Input
              aria-label="새 별칭"
              placeholder="예: 국산콩두부 300"
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAlias();
                }
              }}
              maxLength={200}
            />
            <Button size="sm" onClick={addAlias}>
              추가
            </Button>
          </div>
          <FormError>{aliasError || act.fieldErrors.aliases}</FormError>
        </Full>
      </FormSection>
    </EditModal>
  );
}
