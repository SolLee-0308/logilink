"use client";

import { useMemo, useState } from "react";
import { ActiveBadge, Tag } from "@/components/ui/Badges";
import { Button, CreateButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField } from "@/components/ui/FilterBar";
import { FormCheck, FormField, FormStatic, Input } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { ListToolbar, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { fmtShortDateTime } from "@/lib/format";
import { saveCommonCode } from "@/server/master/actions";
import { loadCommonCode } from "@/server/master/loaders";
import { EditModal, Full, FormSection, ViewSection, useEditTarget } from "./record";
import recordStyles from "./ClientsScreen.module.css";
import { ACTIVE_OPTIONS, MasterHeader, matchActive, useAction, useSelection, type ActiveFilter } from "./shared";
import { LastChanged } from "./history";
import { RULES } from "./rules";
import type { CodeGroupRow, CommonCodeRow } from "./types";

const LABELS = { name: "코드명", sortOrder: "순서", requiresText: "상세 내용 필수", isActive: "사용 여부" };

export function CodesScreen({
  groups,
  rows,
}: {
  groups: CodeGroupRow[];
  rows: CommonCodeRow[];
}) {
  const [groupCode, setGroupCode] = useState(groups[0]?.code ?? "");
  const [active, setActive] = useState<ActiveFilter>("all");
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
    { key: "code", header: "코드", render: (r) => <span className="mono">{r.code}</span> },
    { key: "name", header: "코드명", wrap: true, render: (r) => r.name },
    { key: "order", header: "순서", align: "right", render: (r) => <span className="mono">{r.sortOrder}</span> },
    { key: "text", header: "상세 내용", render: (r) => (r.requiresText ? "필수" : "선택") },
    {
      key: "updated",
      header: "최종 변경",
      render: (r) => (
        <>
          <span className="mono">{fmtShortDateTime(r.updatedAt)}</span>
          <CellSub>{r.updatedBy}</CellSub>
        </>
      ),
    },
    { key: "active", header: "사용 여부", render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <>
      <MasterHeader
        title="사유 코드"
        count={rows.length}
        rules={RULES.codes}
        actions={
          <CreateButton onClick={edit.openNew} disabled={!group}>
            등록
          </CreateButton>
        }
      />
      <FilterBar>
        <FilterField label="코드 그룹">
          <ChipGroup
            value={groupCode}
            onChange={(v) => {
              setGroupCode(v);
              sel.select(null);
            }}
            options={groups.map((g) => ({ value: g.code, label: g.name }))}
          />
        </FilterField>
        <FilterField label="사용 여부">
          <ChipGroup options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </FilterField>
      </FilterBar>
      {group && (
        <NoteBox tone={group.confirmed ? "info" : "warn"}>
          <strong>{group.name}</strong> <span className="mono">({group.code})</span>{" "}
          {group.confirmed ? <Tag tone="accent">정의서 확정</Tag> : <Tag tone="neutral">미확정 · 임시안</Tag>}
          <br />
          {group.description}
        </NoteBox>
      )}
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
        panel={<CodeView row={current} group={group} onEdit={() => current && edit.openEdit(current.id)} opening={edit.loading} />}
      />
      {edit.target && group && (
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
function CodeView({ row, group, onEdit, opening }: { row: CommonCodeRow | null; group: CodeGroupRow | undefined; onEdit: () => void; opening: boolean }) {
  if (!row || !group) {
    return (
      <SidePanel label="사유 코드 상세">
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
          <LastChanged by={row.updatedBy} at={row.updatedAt} title={row.name} entries={row.history} created={{ at: row.createdAt, by: row.createdBy }} labels={LABELS} />
          {/* 수정은 패널 아래 오른쪽 (2026-11-06 Sol 결정: 위쪽 접기 아이콘과 나눔) */}
          <Button size="sm" variant="editSoft" onClick={onEdit} disabled={opening}>수정</Button>
        </>
      }
    >
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
          ["사용 여부", row.isActive ? "사용 (드롭다운에 보임)" : "사용 안 함 (드롭다운에서 빠짐)"],
        ]}
      />
    </SidePanel>
  );
}

type Form = { code: string; name: string; order: string; requiresText: boolean; isActive: boolean };

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
      isActive: row?.isActive ?? true,
    }),
    [row, nextOrder],
  );
  const [f, setF] = useState<Form>(initial);
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
