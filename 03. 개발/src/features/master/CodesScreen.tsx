"use client";

import { useMemo, useState } from "react";
import { ActiveBadge, Tag } from "@/components/ui/Badges";
import { Button, CreateButton } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField } from "@/components/ui/FilterBar";
import { FormCheck, FormField, FormStatic, Input, Select } from "@/components/ui/Form";
import { ListToolbar, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { saveCommonCode } from "@/server/master/actions";
import { loadCommonCode } from "@/server/master/loaders";
import { EditModal, Full, FormSection, ViewSection, useEditTarget } from "./record";
import recordStyles from "./ClientsScreen.module.css";
import guide from "./CodesScreen.module.css";
import { ACTIVE_OPTIONS, MasterHeader, matchActive, useAction, useSelection, type ActiveFilter } from "./shared";
import { LastChanged } from "./history";
import { RULES } from "./rules";
import type { CodeGroupRow, CommonCodeRow } from "./types";
import { DIFF_STATES, LINE_STATE_LABEL, type DiffState } from "@/domain/load-rules";
import { LOAD_DIFF_GROUP } from "@/domain/master";

const LABELS = { name: "코드명", sortOrder: "순서", requiresText: "상세 내용 필수", appliesTo: "적용 상태", isActive: "사용 여부" };

/** 상차 차이 사유의 적용 상태 표시 (정의서 v2.0 D28) — 비어 있으면 드롭다운에 보이지 않음(무지시 전용 등) */
const appliesText = (v: readonly string[]) =>
  v.length ? DIFF_STATES.filter((s) => v.includes(s)).map((s) => LINE_STATE_LABEL[s]).join(" · ") : "없음 (드롭다운에 안 보임)";

const historyFormat = (k: string, v: unknown) => {
  if (k === "appliesTo") return appliesText(Array.isArray(v) ? (v as string[]) : []);
  if (typeof v === "boolean") return k === "isActive" ? (v ? "사용" : "사용 안 함") : v ? "예" : "아니오";
  if (v === null || v === undefined || v === "") return "없음";
  return String(v);
};

export function CodesScreen({
  groups,
  rows,
  canEdit,
}: {
  groups: CodeGroupRow[];
  rows: CommonCodeRow[];
  canEdit: boolean;
}) {
  const [groupCode, setGroupCode] = useState(groups[0]?.code ?? "");
  const [active, setActive] = useState<ActiveFilter>("on") // 사용 여부 기본 = 사용 (2026-11-14 Sol);
  const group = groups.find((g) => g.code === groupCode);
  const list = useMemo(
    () => rows.filter((r) => r.groupCode === groupCode && matchActive(active, r.isActive)),
    [rows, groupCode, active],
  );
  const sel = useSelection(list.map((r) => r.id));
  const current = sel.active === "new" ? null : rows.find((r) => r.id === sel.active) ?? null;
  const edit = useEditTarget(loadCommonCode);
  const nextOrder = (list.reduce((m, r) => Math.max(m, r.sortOrder), 0) || 0) + 10;

  const columns: Column<CommonCodeRow>[] = [
    { key: "code", header: "코드", align: "center", render: (r) => <span className="mono">{r.code}</span> },
    { key: "name", header: "코드명", wrap: true, render: (r) => r.name },
    { key: "order", header: "순서", align: "center", render: (r) => <span className="mono">{r.sortOrder}</span> },
    { key: "text", header: "상세 내용", render: (r) => (r.requiresText ? "필수" : "선택") },
    // 상차 차이 사유만 — 이 사유를 고를 수 있는 품목 상태 (v2.0 D28)
    ...(groupCode === LOAD_DIFF_GROUP ? [{ key: "applies", header: "적용 상태", render: (r: CommonCodeRow) => appliesText(r.appliesTo) }] : []),
    { key: "active", header: "사용 여부", align: "center", render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <>
      <MasterHeader
        title="사유 코드"
        count={rows.length}
        rules={RULES.codes}
        actions={canEdit ? <CreateButton onClick={edit.openNew} disabled={!group}>등록</CreateButton> : undefined}
      />
      <FilterBar>
        {/* 코드 그룹은 드롭다운 (2026-11-14 Sol) — 그룹이 늘어도 한 칸 */}
        <FilterField label="코드 그룹" htmlFor="f-group">
          <Select
            id="f-group"
            value={groupCode}
            onChange={(e) => {
              setGroupCode(e.target.value);
              sel.select(null);
            }}
          >
            {groups.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="사용 여부">
          <ChipGroup options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </FilterField>
      </FilterBar>
      <SplitView
        collapsible
        list={
          <>
            <ListToolbar total={list.length} />
            <DataTable
              caption={`${group?.name ?? ""} 코드 목록`}
              columns={columns}
              rows={list}
              rowKey={(r) => String(r.id)}
              activeKey={sel.active === "new" ? null : String(sel.active)}
              onActivate={(k) => sel.select(Number(k))}
              empty="조건에 맞는 코드가 없습니다."
            />
          </>
        }
        panel={<CodeView row={current} group={group} canEdit={canEdit} onEdit={() => current && edit.openEdit(current.id)} opening={edit.loading} />}
      />
      {canEdit && edit.target && group && (
        <CodeEditModal
          key={edit.nonce}
          row={edit.target === "new" ? null : edit.target}
          group={group}
          nextOrder={nextOrder}
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

/** 조회 전용 패널 + [수정] */
function CodeView({
  row,
  group,
  canEdit,
  onEdit,
  opening,
}: {
  row: CommonCodeRow | null;
  group: CodeGroupRow | undefined;
  canEdit: boolean;
  onEdit: () => void;
  opening: boolean;
}) {
  if (!row || !group) {
    return (
      <SidePanel label="사유 코드 상세">
        {group && <GroupGuide key={`${group.code}-open`} group={group} defaultOpen />}
        <p className="muted">목록에서 코드를 선택하면 상세가 보입니다.</p>
      </SidePanel>
    );
  }
  return (
    <SidePanel
      label="사유 코드 상세"
      title={
        <>
          <PanelTitle mono>{row.code}</PanelTitle>
          <ActiveBadge active={row.isActive} />
        </>
      }
      sub={`${group.name} 그룹 · ${row.name}`}
      footer={
        <>
          <LastChanged by={row.updatedBy} at={row.updatedAt} title={row.name} entries={row.history} created={{ at: row.createdAt, by: row.createdBy }} labels={LABELS} format={historyFormat} />
          {/* 수정은 패널 아래 오른쪽 (2026-11-06 Sol 결정: 위쪽 접기 아이콘과 나눔) */}
          {canEdit && <Button size="sm" variant="editSoft" onClick={onEdit} disabled={opening}>수정</Button>}
        </>
      }
    >
      <GroupGuide key={`${group.code}-${row.id}`} group={group} defaultOpen={false} />
      <ViewSection
        title="기본 정보"
        items={[
          ["코드 그룹", <span key="g">{group.name} <span className="mono muted">({group.code})</span></span>],
          ["코드", <span key="c" className="mono">{row.code}</span>],
          ["코드명", row.name],
          ["순서", <span key="o" className="mono">{row.sortOrder}</span>],
        ]}
      />
      <ViewSection
        title="사용"
        items={[
          ["상세 내용", row.requiresText ? "필수 (이 코드를 고르면 글로 입력)" : "선택"],
          ...(group.code === LOAD_DIFF_GROUP ? ([["적용 상태", appliesText(row.appliesTo)]] as [string, React.ReactNode][]) : []),
          ["사용 여부", row.isActive ? "사용 (드롭다운에 보임)" : "사용 안 함 (드롭다운에서 빠짐)"],
        ]}
      />
    </SidePanel>
  );
}

type Form = { code: string; name: string; order: string; requiresText: boolean; appliesTo: string; isActive: boolean };

/** [+ 등록]·[수정] 공용 편집 모달 — 열 때 최신 데이터·version을 다시 읽는다(useEditTarget) */
function CodeEditModal({
  row,
  group,
  nextOrder,
  onClose,
  onSaved,
  onConflict,
}: {
  row: CommonCodeRow | null;
  group: CodeGroupRow;
  nextOrder: number;
  onClose: () => void;
  onSaved: (id: number) => void;
  onConflict: (id: number) => void;
}) {
  const initial: Form = useMemo(
    () => ({
      code: row?.code ?? "",
      name: row?.name ?? "",
      order: String(row?.sortOrder ?? nextOrder),
      requiresText: row?.requiresText ?? false,
      // 비교하기 쉽게 정렬한 문자열로 둔다 (dirty 확인)
      appliesTo: DIFF_STATES.filter((s) => (row?.appliesTo ?? (group.code === LOAD_DIFF_GROUP ? [...DIFF_STATES] : [])).includes(s)).join(","),
      isActive: row?.isActive ?? true,
    }),
    [row, nextOrder, group.code],
  );
  const [f, setF] = useState<Form>(initial);
  const applies = f.appliesTo ? (f.appliesTo.split(",") as DiffState[]) : [];
  const toggleApplies = (s: DiffState, on: boolean) =>
    setF({ ...f, appliesTo: DIFF_STATES.filter((x) => (x === s ? on : applies.includes(x))).join(",") });
  const act = useAction();
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== initial[k]);

  function submit() {
    const sortOrder = f.order.trim() === "" ? NaN : Number(f.order);
    act.run(
      () =>
        saveCommonCode({
          id: row?.id,
          version: row?.version,
          groupCode: group.code,
          code: f.code,
          name: f.name,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : (undefined as unknown as number),
          requiresText: f.requiresText,
          appliesTo: applies,
          isActive: f.isActive,
        }),
      (d) => d && onSaved(d.id),
      row ? () => onConflict(row.id) : undefined,
    );
  }

  return (
    <EditModal
      open
      title={row ? `사유 코드 수정 · ${row.code} ${row.name}` : `사유 코드 등록 · ${group.name}`}
      dirty={dirty}
      pending={act.pending}
      error={act.error}
      submitLabel={row ? "저장" : "등록"}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormSection title="기본 정보">
        <FormStatic label="코드 그룹">
          {group.name} <span className="mono muted">({group.code})</span>
        </FormStatic>
        {row ? (
          <FormStatic label="코드">
            <span className="mono">{row.code}</span> <span className="muted">(등록 후 수정 불가)</span>
          </FormStatic>
        ) : (
          <FormField label="코드" htmlFor="k-code" required hint="영문 대문자·숫자·밑줄. 등록 후 바꿀 수 없습니다." error={act.fieldErrors.code}>
            <Input id="k-code" className="mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} autoComplete="off" data-autofocus />
          </FormField>
        )}
        <FormField label="코드명" htmlFor="k-name" required hint="드롭다운에 보이는 이름입니다." error={act.fieldErrors.name}>
          <Input id="k-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} {...(row ? { "data-autofocus": true } : {})} />
        </FormField>
        <FormField label="순서" htmlFor="k-order" required hint="작은 값이 드롭다운 위쪽에 보입니다." error={act.fieldErrors.sortOrder}>
          <Input id="k-order" className="mono" inputMode="numeric" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value.replace(/[^d]/g, "") })} maxLength={4} />
        </FormField>
      </FormSection>
      <FormSection title="사용">
        <Full>
          <FormCheck
            id="k-text"
            label="이 코드를 고르면 상세 내용 입력 필수"
            checked={f.requiresText}
            onChange={(v) => setF({ ...f, requiresText: v })}
            hint="'기타'처럼 사유를 글로 적어야 하는 코드에 켭니다 (D19)."
          />
        </Full>
        {/* 상차 차이 사유만 — PDA 상차완료에서 이 상태의 품목에만 보인다 (정의서 v2.0 D28) */}
        {group.code === LOAD_DIFF_GROUP && (
          <Full>
            <FormStatic label="적용 상태">
              {DIFF_STATES.map((s) => (
                <FormCheck key={s} id={`k-applies-${s}`} label={LINE_STATE_LABEL[s]} checked={applies.includes(s)} onChange={(v) => toggleApplies(s, v)} />
              ))}
              <span className="muted">
                {applies.length ? "PDA 상차완료에서 고른 상태의 차이 품목에만 이 사유가 보입니다." : "아무것도 고르지 않으면 드롭다운에 보이지 않습니다 (예: 무지시 상차 전용 코드)."}
              </span>
            </FormStatic>
          </Full>
        )}
        <Full>
          <FormCheck
            id="k-active"
            label="사용"
            checked={f.isActive}
            onChange={(v) => setF({ ...f, isActive: v })}
            hint={row && row.isActive && !f.isActive ? "사용 안 함으로 바꾸면 드롭다운에서 빠집니다. 이미 기록된 사유는 그대로 보입니다." : "코드는 삭제하지 않습니다. 더 쓰지 않으면 '사용 안 함'으로 바꿉니다."}
          />
        </Full>
      </FormSection>
    </EditModal>
  );
}

/**
 * 그룹 안내 (2026-11-14 Sol) — 목록 위 안내 박스 대신 상세 패널 맨 위.
 * 코드를 고르기 전에는 펼쳐 두고, 코드를 고르면 한 줄(그룹 이름·확정 태그 + ▸)로 접는다. 누르면 다시 펼친다.
 */
function GroupGuide({ group, defaultOpen }: { group: CodeGroupRow; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={guide.box} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={guide.sum}>
        <span className={guide.chev} aria-hidden="true">
          ▸
        </span>
        <span className={guide.label}>그룹 안내</span>
        <b>{group.name}</b>
        {group.confirmed ? <Tag tone="accent">정의서 확정</Tag> : <Tag tone="neutral">미확정 · 임시안</Tag>}
        {!open && <span className={guide.hint}>펼치기</span>}
      </summary>
      <p className={guide.body}>
        <span className="mono muted">({group.code})</span> {group.description}
      </p>
    </details>
  );
}
