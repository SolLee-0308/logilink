"use client";

import { useEffect, useState } from "react";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { ITEM_UNITS, STORAGE_TEMP_LABEL, STORAGE_TEMPS, type ItemUnit, type StorageTemp } from "@/domain/master";
import { submitItemRequest } from "@/server/master/actions";
import { EditCard, Full, FormSection } from "./record";
import { useAction } from "./shared";
import type { ItemRequestRow } from "./types";

/** 모름(null) / 관리 / 관리 안 함 */
type Tri = "" | "Y" | "N";
const toTri = (v: boolean | null | undefined): Tri => (v === null || v === undefined ? "" : v ? "Y" : "N");
const fromTri = (v: Tri) => (v === "" ? null : v === "Y");

/**
 * 화주사 — 품목 등록 요청 (단건). 3PL이 검토해 품목으로 등록한다 (U6).
 * row가 있으면 반려된 요청을 고쳐 다시 보낸다.
 */
export function ItemRequestForm({
  clientName,
  row,
  onCancel,
  onSaved,
  onDirtyChange,
}: {
  clientName: string;
  /** 입력한 내용이 있으면 true — 등록 화면이 입력 방법을 바꿀 때 경고한다 */
  onDirtyChange?: (dirty: boolean) => void;
  /** 반려된 요청 (재요청) */
  row?: ItemRequestRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const initial = {
    code: row?.clientCode ?? "",
    name: row?.itemName ?? "",
    unit: (row?.unit ?? "EA") as ItemUnit,
    barcode: row?.barcode ?? "",
    temp: (row?.storageTemp ?? "") as StorageTemp | "",
    expiry: toTri(row?.expiryManaged),
    lot: toTri(row?.lotManaged),
    note: row?.sourceNote ?? "",
  };
  const [f, setF] = useState(initial);
  const act = useAction();
  // 재요청은 고치지 않아도 다시 보낼 수 있다 (사유가 "확인 필요"인 경우)
  const dirty = !!row || (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== initial[k]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  function submit() {
    act.run(
      () =>
        submitItemRequest({
          id: row?.id,
          version: row?.version,
          clientCode: f.code.trim() || null,
          itemName: f.name,
          unit: f.unit,
          barcode: f.barcode,
          storageTemp: f.temp || null,
          expiryManaged: fromTri(f.expiry),
          lotManaged: fromTri(f.lot),
          note: f.note,
        }),
      () => onSaved(),
    );
  }

  return (
    <EditCard
      title={row ? `품목 등록 재요청 · ${row.requestNo}` : "품목 등록 요청"}
      description={`${clientName} · 3PL이 검토한 뒤 품목으로 등록합니다. 여러 품목은 화면 오른쪽 위 [엑셀로 여러 품목]으로 한 번에 보낼 수 있습니다.`}
      dirty={dirty}
      pending={act.pending}
      error={act.error}
      submitLabel={row ? "다시 요청" : "요청"}
      onCancel={onCancel}
      onSubmit={submit}
    >
      {row?.status === "REJECTED" && (
        <NoteBox tone="warn">
          반려 사유: <strong>{row.rejectReasonName}</strong>
          {row.rejectReasonText ? ` · ${row.rejectReasonText}` : ""}
        </NoteBox>
      )}
      <FormSection title="요청 품목">
        <FormField label="화주사 품목코드" htmlFor="q-code" hint="화주사가 자기 시스템에서 쓰는 코드(선택). 품목코드는 3PL이 등록할 때 시스템이 매깁니다" error={act.fieldErrors.clientCode}>
          <Input id="q-code" className="mono" value={f.code} onChange={(e) => set("code", e.target.value)} maxLength={40} autoComplete="off" autoFocus />
        </FormField>
        <FormField label="품목명" htmlFor="q-name" required error={act.fieldErrors.itemName}>
          <Input id="q-name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={200} />
        </FormField>
        <FormField label="단위" htmlFor="q-unit" required error={act.fieldErrors.unit}>
          <Select id="q-unit" value={f.unit} onChange={(e) => set("unit", e.target.value as ItemUnit)}>
            {ITEM_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="바코드" htmlFor="q-barcode" required hint="숫자 8~14자리" error={act.fieldErrors.barcode}>
          <Input
            id="q-barcode"
            className="mono"
            inputMode="numeric"
            value={f.barcode}
            onChange={(e) => set("barcode", e.target.value.replace(/\s/g, ""))}
            maxLength={14}
            autoComplete="off"
          />
        </FormField>
      </FormSection>
      <FormSection title="보관·관리 (아는 경우만)">
        <FormField label="보관 온도대" htmlFor="q-temp" error={act.fieldErrors.storageTemp}>
          <Select id="q-temp" value={f.temp} onChange={(e) => set("temp", e.target.value as StorageTemp | "")}>
            <option value="">모름 (3PL이 정함)</option>
            {STORAGE_TEMPS.map((t) => (
              <option key={t} value={t}>
                {STORAGE_TEMP_LABEL[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="소비기한 관리" htmlFor="q-expiry">
          <Select id="q-expiry" value={f.expiry} onChange={(e) => set("expiry", e.target.value as Tri)}>
            <option value="">모름 (3PL이 정함)</option>
            <option value="Y">관리</option>
            <option value="N">관리 안 함</option>
          </Select>
        </FormField>
        <FormField label="로트 관리" htmlFor="q-lot">
          <Select id="q-lot" value={f.lot} onChange={(e) => set("lot", e.target.value as Tri)}>
            <option value="">모름 (3PL이 정함)</option>
            <option value="Y">관리</option>
            <option value="N">관리 안 함</option>
          </Select>
        </FormField>
        <Full>
          <FormField label="메모" htmlFor="q-note" hint="3PL에 전달할 내용 (500자 이내)" error={act.fieldErrors.note}>
            <Textarea id="q-note" value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={500} rows={3} />
          </FormField>
        </Full>
      </FormSection>
      <p className="muted">단위 환산(BOX·PLT 입수)과 추가 바코드는 3PL이 등록한 뒤 품목 정보에서 보완합니다.</p>
    </EditCard>
  );
}
