"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { PanelTitle, SidePanel } from "@/components/ui/SplitView";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedChanges, useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { saveSetting } from "@/server/master/actions";
import { loadSetting } from "@/server/master/loaders";
import { LastChanged } from "./history";
import { ViewSection } from "./record";
import { MasterHeader, useAction } from "./shared";
import { RULES } from "./rules";
import type { SettingRow } from "./types";
import styles from "./CompanyScreen.module.css";

/**
 * 운영 설정 — 회사 전체 정책값. 항목이 적어 목록 대신 설정마다 단건 카드로 보여 준다.
 * 카드는 회사 정보와 같은 방식: 기본 조회, [수정]을 누르면 최신 값을 다시 읽어 같은 자리에서 편집.
 */
export function SettingsScreen({ rows }: { rows: SettingRow[] }) {
  return (
    <>
      <MasterHeader title="운영 설정" rules={RULES.settings} />
      <div className={styles.grid}>
        {rows.length === 0 && <NoteBox tone="error">운영 설정이 없습니다. 초기 데이터(시드)를 확인하세요.</NoteBox>}
        {rows.map((r) => (
          <SettingCard key={`${r.key}-${r.version}`} row={r} />
        ))}
      </div>
    </>
  );
}

const fmtValue = (r: SettingRow, v: string) => (
  <>
    <span className="mono">{v}</span>
    {r.unit}
  </>
);

function SettingCard({ row }: { row: SettingRow }) {
  const toast = useToast();
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [opening, setOpening] = useState(false);

  async function startEdit() {
    setOpening(true);
    const r = await loadSetting(row.key);
    setOpening(false);
    if (!r.ok) return toast.show(r.error);
    setEditing(r.data!);
  }

  if (editing) return <SettingForm key={editing.version + editing.updatedAt} base={editing} onDone={() => setEditing(null)} onReload={startEdit} />;

  const range = row.valueType !== "TIME" && row.minValue !== null && row.maxValue !== null ? `${row.minValue}~${row.maxValue}${row.unit ?? ""}` : null;

  return (
    <SidePanel
      label={row.label}
      title={
        <>
          <PanelTitle>{row.label}</PanelTitle>
          <span className={styles.headAction}>
            <Button size="sm" variant="editSoft" onClick={startEdit} disabled={opening}>
              수정
            </Button>
          </span>
        </>
      }
      sub={row.description ?? undefined}
      footer={<LastChanged by={row.updatedBy} at={row.updatedAt} title={row.label} entries={row.history} labels={{ value: "값" }} />}
    >
      <ViewSection
        title="설정값"
        items={[
          ["현재 값", fmtValue(row, row.value)],
          ["입력 범위", range],
          ["설정 키", <span key="k" className="mono">{row.key}</span>],
        ]}
      />
    </SidePanel>
  );
}

function SettingForm({ base, onDone, onReload }: { base: SettingRow; onDone: () => void; onReload: () => void }) {
  const [value, setValue] = useState(base.value);
  const act = useAction();
  const guard = useUnsavedGuard();
  const time = base.valueType === "TIME";
  const numeric = !time && (base.minValue !== null || base.maxValue !== null);
  const dirty = value !== base.value;
  useUnsavedChanges(dirty);

  async function cancel() {
    if (dirty && !(await guard.confirmLeave())) return;
    onDone();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    act.run(() => saveSetting({ key: base.key, version: base.version, value }), onDone, onReload);
  }

  return (
    <SidePanel
      label={`${base.label} 수정`}
      onSubmit={submit}
      title={<PanelTitle>{base.label} 수정</PanelTitle>}
      sub={base.description ?? undefined}
      footer={
        <>
          <Button onClick={cancel} disabled={act.pending}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={act.pending || !dirty}>
            저장
          </Button>
        </>
      }
    >
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}
      <FormField
        label={`값${base.unit ? ` (${base.unit})` : ""}`}
        htmlFor="s-value"
        required
        hint={time ? "24시간 형식 (예: 18:00)" : numeric ? `${base.minValue}~${base.maxValue} 사이의 정수` : undefined}
        error={act.fieldErrors.value}
      >
        <Input
          id="s-value"
          className="mono"
          type={time ? "time" : "text"}
          inputMode={numeric ? "numeric" : undefined}
          value={value}
          onChange={(e) => setValue(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)}
          maxLength={numeric ? 4 : time ? 5 : 200}
          autoFocus
        />
      </FormField>
    </SidePanel>
  );
}
