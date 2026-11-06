"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormCheck, FormError, FormField, FormStatic, Input, Select } from "@/components/ui/Form";
import { ClientPicker } from "@/features/plans/ClientFinder";
import { ALIAS_SOURCE_LABEL, ITEM_UNITS, STORAGE_TEMP_LABEL, STORAGE_TEMPS, normalizeAlias, type AliasSource, type ItemUnit, type StorageTemp } from "@/domain/master";
import { saveItem } from "@/server/master/actions";
import { EditCard, Full, FormSection } from "./record";
import { useAction } from "./shared";
import type { ClientOption, ItemBarcodeRow, ItemRow } from "./types";
import styles from "./ItemsScreen.module.css";

interface AliasDraft {
  alias: string;
  source: AliasSource;
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

/**
 * 품목 등록·수정 폼 (3PL) — 등록 화면(/master/items/new), 수정 화면(/master/items/[id]/edit)에서 쓴다.
 * 수정 화면은 열 때 서버에서 다시 읽은 최신 데이터·version으로 연다.
 */
export function ItemForm({
  row,
  clients,
  defaultClientId = "",
  onCancel,
  onSaved,
  onConflict,
}: {
  row: ItemRow | null;
  clients: ClientOption[];
  defaultClientId?: string;
  onCancel: () => void;
  onSaved: (id: number) => void;
  onConflict?: (id: number) => void;
}) {
  const defaultActiveClient = clients.find((c) => String(c.id) === defaultClientId && c.isActive);
  const [clientId, setClientId] = useState(row ? String(row.clientId) : defaultActiveClient ? defaultClientId : "");
  const pickedClient = clients.find((c) => String(c.id) === clientId);
  const [clientCode, setClientCode] = useState(row?.clientCode ?? "");
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

  // 처음 열었을 때의 값 — 달라진 것이 있어야 [저장]이 켜지고, 나갈 때 확인창을 띄운다
  const [initialSig] = useState(() =>
    sig({ name, storageTemp, expiryManaged, lotManaged, isActive, baseUnit, uoms, barcodes, aliases }) + `|${clientCode.trim()}` + (row ? "" : `|${clientId}`),
  );
  const currentSig = sig({ name, storageTemp, expiryManaged, lotManaged, isActive, baseUnit, uoms, barcodes, aliases }) + `|${clientCode.trim()}` + (row ? "" : `|${clientId}`);
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
          clientCode: clientCode.trim() || null,
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
      row && onConflict ? () => onConflict(row.id) : undefined,
    );
  }

  return (
    <EditCard
      title={row ? `품목 수정 · ${row.code} ${row.name}` : "품목 등록"}
      description={row ? undefined : "화주사와 품목코드는 등록 후 바꿀 수 없습니다. 여러 품목은 [엑셀 일괄 등록]으로 한 번에 넣을 수 있습니다."}
      dirty={dirty}
      pending={act.pending}
      error={act.error}
      submitLabel={row ? "저장" : "등록"}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <FormSection title="기본 정보">
        {row ? (
          <>
            <FormStatic label="화주사">{row.clientName}</FormStatic>
            <FormStatic label="품목코드">
              <span className="mono">{row.code}</span> <span className="muted">(시스템 채번 · 수정 불가)</span>
            </FormStatic>
          </>
        ) : (
          <>
            <FormField label="화주사" htmlFor="i-client" required error={act.fieldErrors.clientId}>
              <ClientPicker
                id="i-client"
                value={clientId}
                onChange={setClientId}
                clients={clients.filter((c) => c.isActive)}
                placeholder="화주사를 선택하세요"
                block
                clearable={false}
                autoFocus
              />
            </FormField>
            <FormStatic label="품목코드">
              {/* 품목코드는 저장할 때 시스템이 채번 (2026-11-06 Sol 결정) */}
              <span className="muted">
                저장하면 자동으로 매깁니다{pickedClient ? <> (<span className="mono">{pickedClient.code}-00001</span> 형식)</> : ""}
              </span>
            </FormStatic>
          </>
        )}
        <FormField
          label="화주사 품목코드"
          htmlFor="i-client-code"
          error={act.fieldErrors.clientCode}
          hint="화주사가 자기 시스템에서 쓰는 코드가 있으면 넣으세요. 입고예정 엑셀·AI 판독에서 품목을 찾을 때 씁니다."
        >
          <Input id="i-client-code" className="mono" value={clientCode} onChange={(e) => setClientCode(e.target.value)} maxLength={40} autoComplete="off" />
        </FormField>
        <FormField label="품목명" htmlFor="i-name" required error={act.fieldErrors.name}>
          <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus={!!row} />
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
            <FormCheck id="i-expiry" label="소비기한 관리" checked={expiryManaged} onChange={setExpiryManaged} />
            <FormCheck id="i-lot" label="로트 관리" checked={lotManaged} onChange={setLotManaged} />
            <FormCheck id="i-active" label="사용" checked={isActive} onChange={setIsActive} />
          </div>
          {(expiryManaged || lotManaged) && <p className="muted">소비기한·로트 관리 품목은 입고예정에 입력이 필수이고, 검수 때 실물과 다르면 현장에서 입력합니다.</p>}
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
    </EditCard>
  );
}
