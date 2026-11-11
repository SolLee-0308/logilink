"use client";

import { useMemo, useState } from "react";
import { AddressInput } from "@/components/ui/AddressInput";
import { ActiveBadge } from "@/components/ui/Badges";
import { Button, CreateButton } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField } from "@/components/ui/FilterBar";
import { FormCheck, FormField, FormStatic, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ListToolbar, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { MSG, addressErrors, formatPhone, isValidPhone, isValidTime, textError } from "@/domain/validators";
import {
  DEFAULT_BUSINESS_DAY_START,
  DEFAULT_EXPIRE_GRACE_DAYS,
  EXPIRE_GRACE_MAX,
  WEEKDAYS,
  WEEKDAY_LABEL,
  isValidGraceDays,
  isValidWeeklyOff,
  normalizeWeeklyOff,
  weeklyOffLabel,
} from "@/domain/business-day";
import { saveCenter } from "@/server/master/actions";
import { loadCenter } from "@/server/master/loaders";
import { LastChanged } from "./history";
import { EditModal, Full, FormSection, ViewSection, useEditTarget } from "./record";
import { ACTIVE_OPTIONS, MasterHeader, matchActive, useAction, useSelection, type ActiveFilter } from "./shared";
import { RULES } from "./rules";
import type { CenterRow, ManagerCandidate } from "./types";
import styles from "./ClientsScreen.module.css";

const LABELS = {
  code: "센터 코드",
  name: "센터명",
  zipCode: "우편번호",
  addr1: "기본주소",
  addr2: "상세주소",
  inboundTel: "입고 문의 전화",
  managerUserId: "센터 담당자",
  dailyCloseTime: "일마감 예정 시각",
  businessDayStart: "업무일 시작 시각",
  expireGraceDays: "기한경과 취소 유예",
  weeklyOffDays: "정기 휴무 요일",
  isActive: "사용 여부",
};

const CLOSE_TIME_HELP = "이 시각이 지나도 일마감을 실행하지 않으면 알림 대상입니다. 안내용이며 자동으로 마감하지 않습니다.";
const DAY_START_HELP = "이 시각부터 다음 날 이 시각 전까지를 하루 업무일로 셉니다. 06:00이면 새벽 2시에 확정한 검수 실적은 전날 업무일 실적입니다.";
const GRACE_HELP = "승인 전(승인대기·반려) 입고예정은 입고예정일 + 이 영업일 수가 지난 날의 일마감 때 기한경과 취소 대상이 됩니다. 정기 휴무 요일과 휴무일은 세지 않습니다.";
const WEEKLY_OFF_HELP = "매주 쉬는 요일을 고릅니다. 고르지 않으면 모든 요일을 영업일로 셉니다. 공휴일·임시 휴무는 기준정보 › 휴무일에서 따로 등록합니다.";

export function CentersScreen({ rows, candidates, canEdit }: { rows: CenterRow[]; candidates: ManagerCandidate[]; canEdit: boolean }) {
  const [active, setActive] = useState<ActiveFilter>("all");
  const list = useMemo(() => rows.filter((r) => matchActive(active, r.isActive)), [rows, active]);
  const sel = useSelection(list.map((r) => r.id));
  const current = sel.active === "new" ? null : (rows.find((r) => r.id === sel.active) ?? null);
  const edit = useEditTarget(loadCenter);

  const columns: Column<CenterRow>[] = [
    { key: "code", header: "센터 코드", render: (r) => <span className="mono">{r.code}</span> },
    { key: "name", header: "센터명", render: (r) => r.name },
    { key: "addr", header: "주소", render: (r) => r.addr1 },
    { key: "tel", header: "입고 문의 전화", render: (r) => <span className="mono">{r.inboundTel}</span> },
    { key: "manager", header: "센터 담당자", render: (r) => r.managerName ?? <span className="muted">미지정</span> },
    { key: "dayStart", header: "업무일 시작", render: (r) => <span className="mono">{r.businessDayStart}</span> },
    { key: "close", header: "일마감 예정 시각", render: (r) => <span className="mono">{r.dailyCloseTime}</span> },
    { key: "off", header: "정기 휴무", render: (r) => (r.weeklyOffDays.length ? weeklyOffLabel(r.weeklyOffDays) : <span className="muted">없음</span>) },
    { key: "active", header: "사용 여부", render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <>
      <MasterHeader
        title="센터"
        count={rows.length}
        rules={RULES.centers}
        actions={canEdit ? <CreateButton onClick={edit.openNew}>등록</CreateButton> : undefined}
      />
      <FilterBar>
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
              caption="센터 목록"
              columns={columns}
              rows={list}
              rowKey={(r) => String(r.id)}
              activeKey={sel.active === "new" ? null : String(sel.active)}
              onActivate={(k) => sel.select(Number(k))}
              empty="조건에 맞는 센터가 없습니다. 조회조건을 바꿔 보세요."
            />
          </>
        }
        panel={<CenterView row={current} canEdit={canEdit} candidates={candidates} onEdit={() => current && edit.openEdit(current.id)} opening={edit.loading} />}
      />
      {edit.target && (
        <CenterEditModal
          key={edit.nonce}
          row={edit.target === "new" ? null : edit.target}
          candidates={candidates}
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

function CenterView({
  row,
  canEdit,
  candidates,
  onEdit,
  opening,
}: {
  row: CenterRow | null;
  canEdit: boolean;
  candidates: ManagerCandidate[];
  onEdit: () => void;
  opening: boolean;
}) {
  if (!row) {
    return (
      <SidePanel label="센터 상세">
        <p className="muted">목록에서 센터를 선택하면 상세가 보입니다.</p>
      </SidePanel>
    );
  }
  return (
    <SidePanel
      label="센터 상세"
      title={
        <>
          <PanelTitle mono>{row.code}</PanelTitle>
          <ActiveBadge active={row.isActive} />
        </>
      }
      sub={row.name}
      footer={
        <>
          <LastChanged
            by={row.updatedBy}
            at={row.updatedAt}
            title={row.name}
            entries={row.history}
            created={{ at: row.createdAt, by: row.createdBy }}
            labels={LABELS}
            format={(k, v) => fmtValue(k, v, candidates)}
          />
          {/* 수정은 패널 아래 오른쪽 (2026-11-06 Sol 결정: 위쪽 접기 아이콘과 나눔) */}
          {canEdit && <Button size="sm" variant="editSoft" onClick={onEdit} disabled={opening}>수정</Button>}
        </>
      }
    >
      <ViewSection
        title="기본 정보"
        items={[
          ["센터 코드", <span key="c" className="mono">{row.code}</span>],
          ["센터명", row.name],
          ["주소", `(${row.zipCode}) ${row.addr1} ${row.addr2}`],
          ["입고 문의 전화", <span key="t" className="mono">{row.inboundTel}</span>],
        ]}
      />
      <ViewSection
        title="운영"
        items={[
          ["센터 담당자", row.managerName],
          ["업무일 시작 시각", <span key="s" className="mono">{row.businessDayStart}</span>],
          ["일마감 예정 시각", <span key="d" className="mono">{row.dailyCloseTime}</span>],
          ["기한경과 취소 유예", `입고예정일 + ${row.expireGraceDays}영업일`],
          ["정기 휴무 요일", weeklyOffLabel(row.weeklyOffDays)],
          ["소속 사용자", `사용 중 ${row.activeUserCount}명`],
        ]}
      />
    </SidePanel>
  );
}

type Form = {
  code: string;
  name: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  inboundTel: string;
  managerUserId: string;
  dailyCloseTime: string;
  businessDayStart: string;
  expireGraceDays: string;
  /** 요일 순서(월~일)로 정리한 값을 쉼표로 이어 둔다 — 문자열이라야 바뀜 비교가 단순하다 */
  weeklyOffDays: string;
  isActive: boolean;
};

const toDays = (s: string) => (s ? s.split(",").map(Number) : []);
const fromDays = (d: number[]) => normalizeWeeklyOff(d).join(",");

function validate(f: Form, isNew: boolean) {
  const e: Record<string, string> = {};
  if (isNew && !/^[A-Z0-9]{3,5}$/.test(f.code)) e.code = "센터 코드는 영문 대문자·숫자 3~5자로 입력하세요";
  const name = textError(f.name, "센터명", 100);
  if (name) e.name = name;
  Object.assign(e, addressErrors(f));
  if (!isValidPhone(f.inboundTel)) e.inboundTel = f.inboundTel.trim() ? MSG.phone : "입고 문의 전화를 입력하세요";
  if (!isValidTime(f.dailyCloseTime)) e.dailyCloseTime = "일마감 예정 시각을 HH:mm(00:00~23:59)으로 입력하세요";
  if (!isValidTime(f.businessDayStart)) e.businessDayStart = "업무일 시작 시각을 HH:mm(00:00~23:59)으로 입력하세요";
  if (!/^\d{1,2}$/.test(f.expireGraceDays) || !isValidGraceDays(Number(f.expireGraceDays)))
    e.expireGraceDays = `기한경과 취소 유예를 0~${EXPIRE_GRACE_MAX}일로 입력하세요`;
  if (!isValidWeeklyOff(toDays(f.weeklyOffDays))) e.weeklyOffDays = "정기 휴무 요일은 7일 모두 고를 수 없습니다";
  return e;
}

function CenterEditModal({
  row,
  candidates,
  onClose,
  onSaved,
  onConflict,
}: {
  row: CenterRow | null;
  candidates: ManagerCandidate[];
  onClose: () => void;
  onSaved: (id: number) => void;
  onConflict: (id: number) => void;
}) {
  const initial: Form = useMemo(
    () => ({
      code: row?.code ?? "",
      name: row?.name ?? "",
      zipCode: row?.zipCode ?? "",
      addr1: row?.addr1 ?? "",
      addr2: row?.addr2 ?? "",
      inboundTel: row?.inboundTel ?? "",
      managerUserId: row?.managerUserId ? String(row.managerUserId) : "",
      dailyCloseTime: row?.dailyCloseTime ?? "18:00",
      businessDayStart: row?.businessDayStart ?? DEFAULT_BUSINESS_DAY_START,
      expireGraceDays: String(row?.expireGraceDays ?? DEFAULT_EXPIRE_GRACE_DAYS),
      weeklyOffDays: fromDays(row?.weeklyOffDays ?? []),
      isActive: row?.isActive ?? true,
    }),
    [row],
  );
  const [f, setF] = useState<Form>(initial);
  const [confirmOff, setConfirmOff] = useState(false);
  const act = useAction();
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== initial[k]);
  // 담당자 후보: 이 센터 소속 · 사용 중 · 3PL 관리자/운영담당 (새 센터는 소속 사용자가 없다)
  const options = row ? candidates.filter((c) => c.centerId === row.id) : [];
  const set = (k: keyof Form, fmt?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: fmt ? fmt(e.target.value) : e.target.value });

  function save() {
    act.run(
      () =>
        saveCenter({
          id: row?.id,
          version: row?.version,
          code: f.code,
          name: f.name,
          zipCode: f.zipCode,
          addr1: f.addr1,
          addr2: f.addr2,
          inboundTel: f.inboundTel,
          managerUserId: f.managerUserId ? Number(f.managerUserId) : null,
          dailyCloseTime: f.dailyCloseTime,
          businessDayStart: f.businessDayStart,
          expireGraceDays: Number(f.expireGraceDays),
          weeklyOffDays: toDays(f.weeklyOffDays),
          isActive: f.isActive,
        }),
      (d) => d && onSaved(d.id),
      row ? () => onConflict(row.id) : undefined,
    );
  }

  function submit() {
    const errs = validate(f, !row);
    if (Object.keys(errs).length) return act.invalid(errs);
    // 사용 안 함으로 바꿀 때 소속 사용자가 있으면 한 번 더 확인
    if (row && row.isActive && !f.isActive && row.activeUserCount > 0) return setConfirmOff(true);
    save();
  }

  return (
    <EditModal open title={row ? `센터 수정 · ${row.code} ${row.name}` : "센터 등록"} dirty={dirty} pending={act.pending} error={act.error} onClose={onClose} onSubmit={submit}>
      <FormSection title="기본 정보">
        {row ? (
          <FormStatic label="센터 코드">
            <span className="mono">{row.code}</span> <span className="muted">(등록 후 수정 불가)</span>
          </FormStatic>
        ) : (
          <FormField label="센터 코드" htmlFor="ct-code" required hint="영문 대문자·숫자 3~5자 (예: YI1)" error={act.fieldErrors.code}>
            <Input id="ct-code" className="mono" value={f.code} onChange={set("code", (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={5} autoComplete="off" data-autofocus />
          </FormField>
        )}
        <FormField label="센터명" htmlFor="ct-name" required error={act.fieldErrors.name}>
          <Input id="ct-name" value={f.name} onChange={set("name")} maxLength={100} {...(row ? { "data-autofocus": true } : {})} />
        </FormField>
        <Full>
          <AddressInput id="ct-addr" required value={{ zipCode: f.zipCode, addr1: f.addr1, addr2: f.addr2 }} onChange={(a) => setF({ ...f, ...a })} errors={act.fieldErrors} />
        </Full>
        <FormField label="입고 문의 전화" htmlFor="ct-tel" required error={act.fieldErrors.inboundTel}>
          <Input id="ct-tel" className="mono" inputMode="tel" placeholder="031-000-0000" value={f.inboundTel} onChange={set("inboundTel", formatPhone)} maxLength={13} />
        </FormField>
      </FormSection>
      <FormSection title="운영">
        <FormField
          label="센터 담당자"
          htmlFor="ct-manager"
          hint={options.length === 0 ? "지정 가능한 담당자가 없습니다" : "이 센터 소속 3PL 관리자·운영담당 중에서 고릅니다"}
          error={act.fieldErrors.managerUserId}
        >
          <Select id="ct-manager" value={f.managerUserId} onChange={set("managerUserId")} disabled={options.length === 0}>
            <option value="">{options.length === 0 ? "지정 가능한 담당자가 없습니다" : "미지정"}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.roleLabel})
              </option>
            ))}
            {row?.managerUserId && !options.some((c) => c.id === row.managerUserId) && (
              <option value={row.managerUserId}>{row.managerName} (현재 담당자)</option>
            )}
          </Select>
        </FormField>
        <FormField label="일마감 예정 시각" htmlFor="ct-close" required hint={CLOSE_TIME_HELP} error={act.fieldErrors.dailyCloseTime}>
          <Input id="ct-close" className="mono" type="time" value={f.dailyCloseTime} onChange={set("dailyCloseTime")} />
        </FormField>
        <FormField label="업무일 시작 시각" htmlFor="ct-daystart" required hint={DAY_START_HELP} error={act.fieldErrors.businessDayStart}>
          <Input id="ct-daystart" className="mono" type="time" value={f.businessDayStart} onChange={set("businessDayStart")} />
        </FormField>
        <FormField label="기한경과 취소 유예(영업일)" htmlFor="ct-grace" required hint={GRACE_HELP} error={act.fieldErrors.expireGraceDays}>
          <Input id="ct-grace" className="mono" inputMode="numeric" value={f.expireGraceDays} onChange={set("expireGraceDays", (v) => v.replace(/\D/g, "").slice(0, 2))} maxLength={2} />
        </FormField>
        <Full>
          <FormField label="정기 휴무 요일" htmlFor="ct-off-1" hint={WEEKLY_OFF_HELP} error={act.fieldErrors.weeklyOffDays}>
            <div className={styles.weekdays} role="group" aria-label="정기 휴무 요일">
              {WEEKDAYS.map((d) => {
                const days = toDays(f.weeklyOffDays);
                const on = days.includes(d);
                return (
                  <label key={d} htmlFor={`ct-off-${d}`} className={`${styles.weekday} ${on ? styles.weekdayOn : ""}`}>
                    <input
                      id={`ct-off-${d}`}
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setF({ ...f, weeklyOffDays: fromDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d)) })}
                    />
                    {WEEKDAY_LABEL[d]}
                  </label>
                );
              })}
            </div>
          </FormField>
        </Full>
        <Full>
          <FormCheck id="ct-active" label="사용" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} hint="센터는 삭제하지 않습니다. 더 쓰지 않으면 '사용 안 함'으로 바꿉니다." />
        </Full>
      </FormSection>

      <Modal
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="센터를 사용 안 함으로 바꿀까요?"
        description={`소속 사용자 ${row?.activeUserCount ?? 0}명이 있습니다.`}
        footer={
          <>
            <Button onClick={() => setConfirmOff(false)}>취소</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOff(false);
                save();
              }}
            >
              사용 안 함으로 저장
            </Button>
          </>
        }
      >
        <p>사용 안 함으로 바꿔도 소속 사용자 계정은 그대로 남습니다. 필요하면 사용자·역할 화면에서 소속을 옮기세요.</p>
      </Modal>
    </EditModal>
  );
}

function fmtValue(k: string, v: unknown, candidates: ManagerCandidate[]) {
  if (k === "managerUserId") return v ? (candidates.find((c) => c.id === v)?.name ?? `사용자 #${String(v)}`) : "미지정";
  if (k === "isActive") return v ? "사용" : "사용 안 함";
  if (k === "weeklyOffDays") return Array.isArray(v) ? weeklyOffLabel(v as number[]) : "없음";
  if (k === "expireGraceDays") return `${String(v)}영업일`;
  return v === null || v === undefined || v === "" ? "없음" : String(v);
}
