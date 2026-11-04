"use client";

import { useMemo, useState } from "react";
import { ActiveBadge, Tag } from "@/components/ui/Badges";
import { Button, CreateButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { FormCheck, FormField, FormStatic, Input, Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { Modal } from "@/components/ui/Overlay";
import { KeyValue, ListToolbar, PanelSection, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { ORG_LABEL, ROLE_META, USER_ROLES, rolesLabel, sortRoles, type UserRole } from "@/domain/master";
import { fmtDateTime, fmtShortDateTime, includesText } from "@/lib/format";
import { resetUserPassword, saveUser, unlockUser } from "@/server/master/actions";
import { loadUser } from "@/server/master/loaders";
import { EditModal, Full, FormSection, ViewSection, useEditTarget, type ViewItem } from "./record";
import { LastChanged } from "./history";
import { ACTIVE_OPTIONS, MasterHeader, matchActive, useAction, useSelection, type ActiveFilter } from "./shared";
import { RULES } from "./rules";
import type { CenterOption, ClientOption, UserRow } from "./types";
import styles from "./UsersScreen.module.css";

const LABELS = { loginId: "아이디", name: "이름", role: "역할", roles: "역할", clientId: "화주사", centerId: "센터", defaultCenterId: "기본 센터", isActive: "사용 여부", locked: "잠금", password: "비밀번호" };

/** 화면을 보는 사람이 고를 수 있는 역할 — 3PL 관리자 역할은 3PL 관리자만, 화주사 계정은 화주사 역할만 */
function assignableRoles(viewerRoles: readonly UserRole[]): readonly UserRole[] {
  if (viewerRoles.some((r) => ROLE_META[r].org === "SHIPPER")) return USER_ROLES.filter((r) => ROLE_META[r].org === "SHIPPER");
  return USER_ROLES.filter((r) => r !== "TPL_ADMIN" || viewerRoles.includes("TPL_ADMIN"));
}

/** 역할 소속 (한 사용자의 역할은 같은 소속끼리만) */
const orgOf = (roles: readonly UserRole[]) => (roles.length ? ROLE_META[roles[0]].org : null);
const channelsOf = (roles: readonly UserRole[]) => [...new Set(sortRoles(roles).map((r) => ROLE_META[r].channel))].join(" · ");

export function UsersScreen({
  rows,
  clients,
  centers,
  viewerRoles,
  canEdit,
  canManageAccounts,
  initialClientId,
}: {
  rows: UserRow[];
  clients: ClientOption[];
  centers: CenterOption[];
  viewerRoles: UserRole[];
  /** 등록·수정 (3PL 관리자) */
  canEdit: boolean;
  /** 잠금 해제·비밀번호 초기화 (3PL 관리자) */
  canManageAccounts: boolean;
  /** 화주사 화면 요약에서 넘어온 화주사 필터 */
  initialClientId?: number;
}) {
  const initialClient = initialClientId ? clients.find((c) => c.id === initialClientId) : undefined;
  const [org, setOrg] = useState<"all" | "TPL" | "SHIPPER">(initialClient ? "SHIPPER" : "all");
  const [role, setRole] = useState("");
  const [clientId, setClientId] = useState(initialClient ? String(initialClient.id) : "");
  const [withInactiveClients, setWithInactiveClients] = useState(!!initialClient && !initialClient.isActive);
  const [active, setActive] = useState<ActiveFilter>("all");
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      rows.filter(
        (r) =>
          (org === "all" || orgOf(r.roles) === org) &&
          (!role || r.roles.includes(role as UserRole)) &&
          (!clientId || r.clientId === Number(clientId)) &&
          matchActive(active, r.isActive) &&
          includesText([r.loginId, r.name], q),
      ),
    [rows, org, role, clientId, active, q],
  );
  const sel = useSelection(list.map((r) => r.id));
  const current = sel.active === "new" ? null : (rows.find((r) => r.id === sel.active) ?? null);
  const edit = useEditTarget(loadUser);
  const clientChoices = clients.filter((c) => withInactiveClients || c.isActive || String(c.id) === clientId);

  const columns: Column<UserRow>[] = [
    { key: "login", header: "아이디", render: (r) => <span className="mono">{r.loginId}</span> },
    { key: "name", header: "이름", render: (r) => r.name },
    {
      key: "role",
      header: "역할",
      render: (r) => (
        <>
          {rolesLabel(r.roles)}
          <CellSub>{channelsOf(r.roles)}</CellSub>
        </>
      ),
    },
    {
      key: "scope",
      header: "소속",
      render: (r) => (
        <>
          {r.clientName ?? r.centerName}
          <CellSub>{ORG_LABEL[orgOf(r.roles) ?? "TPL"]}</CellSub>
        </>
      ),
    },
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
    {
      key: "active",
      header: "사용 여부",
      render: (r) => (
        <>
          <ActiveBadge active={r.isActive} />
          {r.locked && (
            <>
              {" "}
              <Tag tone="danger">잠김</Tag>
            </>
          )}
        </>
      ),
    },
  ];

  const fmt = (k: string, v: unknown) => {
    if (k === "role") return ROLE_META[v as UserRole]?.label ?? String(v);
    if (k === "roles") return typeof v === "string" && v ? rolesLabel(v.split(",") as UserRole[]) : "없음";
    if (k === "clientId") return clients.find((c) => c.id === v)?.name ?? "없음";
    if (k === "centerId" || k === "defaultCenterId") return centers.find((c) => c.id === v)?.name ?? "없음";
    if (k === "isActive") return v ? "사용" : "사용 안 함";
    if (k === "locked") return v ? "잠김" : "해제";
    return v === null || v === undefined ? "없음" : String(v);
  };

  return (
    <>
      <MasterHeader
        title="사용자·역할"
        count={rows.length}
        rules={RULES.users}
        actions={canEdit ? <CreateButton onClick={edit.openNew}>등록</CreateButton> : undefined}
      />
      <FilterBar>
        <FilterField label="소속">
          <ChipGroup
            value={org}
            onChange={(v) => {
              setOrg(v);
              setRole("");
              if (v === "TPL") setClientId("");
            }}
            options={[
              { value: "all", label: "전체" },
              { value: "TPL", label: "3PL" },
              { value: "SHIPPER", label: "화주사" },
            ]}
          />
        </FilterField>
        <FilterField label="역할" htmlFor="f-role">
          <Select id="f-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">전체</option>
            {USER_ROLES.filter((r) => org === "all" || ROLE_META[r].org === org).map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
              </option>
            ))}
          </Select>
        </FilterField>
        {org !== "TPL" && (
          <>
          <FilterField label="화주사" htmlFor="f-client">
            <Select id="f-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">전체</option>
              {clientChoices.map((c) => (
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
        <FilterField label="사용 여부">
          <ChipGroup options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </FilterField>
        <SearchInput value={q} onChange={setQ} placeholder="아이디, 이름 검색" />
      </FilterBar>
      <SplitView
        list={
          <>
            <ListToolbar total={list.length} />
            <DataTable
              caption="사용자 목록"
              columns={columns}
              rows={list}
              rowKey={(r) => String(r.id)}
              activeKey={sel.active === "new" ? null : String(sel.active)}
              onActivate={(k) => sel.select(Number(k))}
              empty="조건에 맞는 사용자가 없습니다. 조회조건을 바꿔 보세요."
            />
          </>
        }
        panel={
          current ? (
            <SidePanel
              key={`${current.id}-${current.version}`}
              label="사용자 상세"
              title={
                <>
                  <PanelTitle>{current.name}</PanelTitle>
                  <ActiveBadge active={current.isActive} />
                  {canEdit && (
                    <span className={styles.headAction}>
                      <Button size="sm" onClick={() => edit.openEdit(current.id)} disabled={edit.loading}>
                        수정
                      </Button>
                    </span>
                  )}
                </>
              }
              sub={`${current.loginId} · ${rolesLabel(current.roles)}`}
              footer={
                <LastChanged
                  by={current.updatedBy}
                  at={current.updatedAt}
                  title={current.name}
                  entries={current.history}
                  created={{ at: current.createdAt, by: current.createdBy }}
                  labels={LABELS}
                  format={fmt}
                />
              }
            >
              <ViewSection
                title="기본 정보"
                items={[
                  ["아이디", <span key="l" className="mono">{current.loginId}</span>],
                  ["이름", current.name],
                  [
                    "역할",
                    <span key="r" className="cell-tags">
                      {current.roles.map((r) => (
                        <Tag key={r} tone="neutral">
                          {ROLE_META[r].label} ({ROLE_META[r].channel})
                        </Tag>
                      ))}
                    </span>,
                  ],
                  [orgOf(current.roles) === "SHIPPER" ? "소속 화주사" : "소속 센터", current.clientName ?? current.centerName],
                  ...(orgOf(current.roles) === "SHIPPER" ? [["기본 센터", current.defaultCenterName ?? "지정 안 함"] as ViewItem] : []),
                  ["사용 여부", current.isActive ? "사용" : "사용 안 함"],
                ]}
              />
              <AccountSection row={current} canManage={canManageAccounts} />
            </SidePanel>
          ) : (
            <SidePanel label="사용자 상세">
              <p className="muted">목록에서 사용자를 선택하면 상세가 보입니다.</p>
            </SidePanel>
          )
        }
      />
      {edit.target && (
        <UserEditModal
          key={edit.nonce}
          row={edit.target === "new" ? null : edit.target}
          clients={clients}
          centers={centers}
          roles={assignableRoles(viewerRoles)}
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

function UserEditModal({
  row,
  clients,
  centers,
  roles,
  onClose,
  onSaved,
  onConflict,
}: {
  row: UserRow | null;
  clients: ClientOption[];
  centers: CenterOption[];
  roles: readonly UserRole[];
  onClose: () => void;
  onSaved: (id: number) => void;
  onConflict: (id: number) => void;
}) {
  const [loginId, setLoginId] = useState(row?.loginId ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [picked, setPicked] = useState<UserRole[]>(row?.roles ?? []);
  const [clientId, setClientId] = useState(row?.clientId ? String(row.clientId) : "");
  const [centerId, setCenterId] = useState(row?.centerId ? String(row.centerId) : centers.length === 1 ? String(centers[0].id) : "");
  const [defaultCenterId, setDefaultCenterId] = useState(row?.defaultCenterId ? String(row.defaultCenterId) : "");
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const act = useAction();
  // 기본 센터 후보: 고른 화주사가 이용하는 센터
  const clientCenters = centers.filter((c) => clients.find((x) => String(x.id) === clientId)?.centerIds?.includes(c.id));

  const org = orgOf(picked);
  const dirty = row
    ? name !== row.name ||
      sortRoles(picked).join() !== sortRoles(row.roles).join() ||
      isActive !== row.isActive ||
      (org === "SHIPPER" && Number(clientId) !== row.clientId) ||
      (org === "SHIPPER" && (Number(defaultCenterId) || null) !== row.defaultCenterId) ||
      (org === "TPL" && Number(centerId) !== row.centerId)
    : !!(loginId || name || picked.length || clientId || !isActive);

  function toggleRole(r: UserRole, on: boolean) {
    setPicked((prev) => sortRoles(on ? [...prev, r] : prev.filter((x) => x !== r)));
  }

  function submit() {
    act.run(
      () =>
        saveUser({
          id: row?.id,
          version: row?.version,
          loginId,
          name,
          roles: picked,
          clientId: org === "SHIPPER" && clientId ? Number(clientId) : null,
          centerId: org === "TPL" && centerId ? Number(centerId) : null,
          defaultCenterId: org === "SHIPPER" && defaultCenterId && clientCenters.some((c) => String(c.id) === defaultCenterId) ? Number(defaultCenterId) : null,
          isActive,
        }),
      (d) => d && onSaved(d.id),
      row ? () => onConflict(row.id) : undefined,
    );
  }

  return (
    <EditModal
      open
      title={row ? `사용자 수정 · ${row.name}` : "사용자 등록"}
      description={row ? undefined : "아이디는 등록 후 바꿀 수 없습니다. 초기 비밀번호는 등록 후 [비밀번호 초기화]로 발급합니다."}
      dirty={dirty}
      pending={act.pending}
      error={act.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormSection title="기본 정보">
        {row ? (
          <FormStatic label="아이디">
            <span className="mono">{row.loginId}</span> <span className="muted">(등록 후 수정 불가)</span>
          </FormStatic>
        ) : (
          <FormField label="아이디" htmlFor="u-login" required hint="영문 소문자·숫자·점(.)·밑줄·하이픈 3~50자" error={act.fieldErrors.loginId}>
            <Input id="u-login" className="mono" value={loginId} onChange={(e) => setLoginId(e.target.value.toLowerCase())} maxLength={50} autoComplete="off" data-autofocus />
          </FormField>
        )}
        <FormField label="이름" htmlFor="u-name" required error={act.fieldErrors.name}>
          <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="off" {...(row ? { "data-autofocus": true } : {})} />
        </FormField>
        <Full>
          <fieldset className={styles.roles} data-invalid={act.fieldErrors.roles ? "" : undefined}>
            <legend>
              역할 <span className={styles.req}>*</span> <span className="muted">여러 개 고를 수 있습니다. 3PL 역할과 화주사 역할은 함께 줄 수 없습니다.</span>
            </legend>
            {(["TPL", "SHIPPER"] as const).map((o) => {
              const options = USER_ROLES.filter((r) => ROLE_META[r].org === o && (roles.includes(r) || row?.roles.includes(r)));
              if (!options.length) return null;
              return (
                <div key={o} className={styles.roleGroup}>
                  <span className={styles.roleOrg}>{ORG_LABEL[o]}</span>
                  {options.map((r) => (
                    <FormCheck
                      key={r}
                      id={`u-role-${r}`}
                      label={`${ROLE_META[r].label} (${ROLE_META[r].channel})`}
                      checked={picked.includes(r)}
                      // 다른 소속 역할을 이미 골랐거나, 이 사람이 줄 수 없는 역할(3PL 관리자)은 바꿀 수 없다
                      disabled={(org !== null && org !== o) || !roles.includes(r)}
                      onChange={(on) => toggleRole(r, on)}
                    />
                  ))}
                </div>
              );
            })}
            {act.fieldErrors.roles && <p className={styles.err}>{act.fieldErrors.roles}</p>}
          </fieldset>
        </Full>
        {org === "SHIPPER" && (
          <FormField label="소속 화주사" htmlFor="u-client" required error={act.fieldErrors.clientId}>
            <Select
              id="u-client"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setDefaultCenterId("");
              }}
            >
              <option value="">화주사를 선택하세요</option>
              {clients
                .filter((c) => c.isActive || c.id === row?.clientId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? "" : " (사용 안 함)"}
                  </option>
                ))}
            </Select>
          </FormField>
        )}
        {org === "SHIPPER" && (
          <FormField
            label="기본 센터"
            htmlFor="u-default-center"
            hint={clientId ? "입고예정 등록에서 처음 선택되는 센터입니다. 비우면 이용 센터가 1곳일 때만 자동으로 고릅니다." : "소속 화주사를 먼저 고르세요."}
            error={act.fieldErrors.defaultCenterId}
          >
            <Select id="u-default-center" value={defaultCenterId} onChange={(e) => setDefaultCenterId(e.target.value)} disabled={!clientId}>
              <option value="">지정 안 함</option>
              {clientCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {org === "TPL" && (
          <FormField label="소속 센터" htmlFor="u-center" required error={act.fieldErrors.centerId}>
            <Select id="u-center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
              <option value="">센터를 선택하세요</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <Full>
          <FormCheck id="u-active" label="사용" checked={isActive} onChange={setIsActive} />
        </Full>
      </FormSection>
    </EditModal>
  );
}

/** 로그인 계정 상태 + 잠금 해제·비밀번호 초기화 (3PL 관리자만) */
function AccountSection({ row, canManage }: { row: UserRow; canManage: boolean }) {
  const act = useAction();
  const [confirmReset, setConfirmReset] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  // PDA 역할만 있는 계정은 Web에 로그인할 수 없다
  const pda = row.roles.every((r) => ROLE_META[r].channel === "PDA");

  return (
    <PanelSection title="로그인 계정">
      <KeyValue
        items={[
          [
            "상태",
            row.locked ? (
              <>
                <Tag tone="danger">잠김</Tag> <span className="muted">{fmtDateTime(row.lockedAt)} · 5회 연속 실패</span>
              </>
            ) : row.mustChangePw ? (
              <Tag tone="warn">비밀번호 변경 대기</Tag>
            ) : (
              "정상"
            ),
          ],
          ["최근 로그인", <span key="l" className="mono">{row.lastLoginAt ? fmtDateTime(row.lastLoginAt) : "없음"}</span>],
          ...(pda ? ([["Web 로그인", "PDA 전용 역할이라 Web에는 로그인할 수 없습니다"]] as [string, React.ReactNode][]) : []),
        ]}
      />
      {canManage && (
        <div className={styles.actions}>
          {row.locked && (
            <Button size="sm" disabled={act.pending} onClick={() => act.run(() => unlockUser({ id: row.id }))}>
              잠금 해제
            </Button>
          )}
          <Button size="sm" variant="dangerSoft" disabled={act.pending} onClick={() => setConfirmReset(true)}>
            비밀번호 초기화
          </Button>
        </div>
      )}
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="비밀번호를 초기화할까요?"
        description={`${row.name}(${row.loginId}) 계정`}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>취소</Button>
            <Button
              variant="primary"
              disabled={act.pending}
              onClick={() =>
                act.run(
                  () => resetUserPassword({ id: row.id }),
                  (d) => {
                    setConfirmReset(false);
                    if (d) setTemp(d.tempPassword);
                  },
                )
              }
            >
              초기화
            </Button>
          </>
        }
      >
        <p>임시 비밀번호를 새로 만들고 잠금도 함께 풉니다. 이 사용자는 다음 로그인 때 비밀번호를 바꿔야 하고, 지금 로그인 중인 화면은 로그아웃됩니다.</p>
      </Modal>

      <Modal
        open={temp !== null}
        onClose={() => setTemp(null)}
        title="임시 비밀번호"
        description="이 창을 닫으면 다시 볼 수 없습니다. 사용자에게 안전한 방법으로 전달하세요."
        footer={
          <Button variant="primary" onClick={() => setTemp(null)}>
            확인
          </Button>
        }
      >
        <p className={`mono ${styles.temp}`} data-testid="temp-password">
          {temp}
        </p>
      </Modal>
    </PanelSection>
  );
}
