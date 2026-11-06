"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AddressInput } from "@/components/ui/AddressInput";
import { ActiveBadge, Tag } from "@/components/ui/Badges";
import { Button, CreateButton } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { FormCheck, FormField, FormStatic, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ListToolbar, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { suggestClientPrefix } from "@/domain/client-code";
import { UNCLOSED_KINDS, UNCLOSED_LABEL, unclosedTotal } from "@/domain/unclosed";
import { MSG, addressErrors, formatBizNo, formatPhone, bizNoError, isValidEmail, isValidPhone, textError } from "@/domain/validators";
import { includesText } from "@/lib/format";
import { saveClient } from "@/server/master/actions";
import { loadClient, previewClientCode } from "@/server/master/loaders";
import { LastChanged } from "./history";
import { EditModal, Full, FormSection, ViewSection, useEditTarget } from "./record";
import { ACTIVE_OPTIONS, MasterHeader, matchActive, useAction, useSelection, type ActiveFilter } from "./shared";
import { RULES } from "./rules";
import type { CenterPick, ClientRow, ManagerCandidate } from "./types";
import styles from "./ClientsScreen.module.css";

const LABELS = {
  code: "화주사 코드",
  name: "화주사명",
  bizNo: "사업자등록번호",
  ceoName: "대표자명",
  zipCode: "우편번호",
  addr1: "기본주소",
  addr2: "상세주소",
  tel: "대표 전화",
  email: "이메일",
  contactName: "업무 연락 담당자",
  contactTel: "담당자 전화",
  contactEmail: "담당자 이메일",
  manager: "3PL 담당 운영자",
  centers: "이용 센터",
  contractStartDt: "계약 시작일",
  contractEndDt: "계약 종료일",
  isActive: "사용 여부",
};

export function ClientsScreen({
  rows,
  centers,
  candidates,
  canEdit,
}: {
  rows: ClientRow[];
  centers: CenterPick[];
  candidates: ManagerCandidate[];
  canEdit: boolean;
}) {
  const [active, setActive] = useState<ActiveFilter>("all");
  const [center, setCenter] = useState("");
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      rows.filter(
        (r) =>
          matchActive(active, r.isActive) &&
          (!center || r.centers.some((c) => c.code === center)) &&
          includesText([r.code, r.name, r.bizNo, r.bizNo.replace(/-/g, "")], q),
      ),
    [rows, active, center, q],
  );
  const sel = useSelection(list.map((r) => r.id));
  const current = sel.active === "new" ? null : (rows.find((r) => r.id === sel.active) ?? null);
  const edit = useEditTarget(loadClient);

  const columns: Column<ClientRow>[] = [
    { key: "code", header: "화주사 코드", render: (r) => <span className="mono">{r.code}</span> },
    { key: "name", header: "화주사명", render: (r) => r.name },
    { key: "biz", header: "사업자등록번호", render: (r) => <span className="mono">{r.bizNo}</span> },
    { key: "centers", header: "이용 센터", render: (r) => r.centers.map((c) => c.name).join(", ") },
    { key: "manager", header: "3PL 담당", render: (r) => r.managerName },
    { key: "items", header: "품목", align: "right", render: (r) => <><span className="mono">{r.itemCount}</span>개</> },
    { key: "users", header: "사용자", align: "right", render: (r) => <><span className="mono">{r.userCount}</span>명</> },
    { key: "active", header: "사용 여부", render: (r) => <ActiveBadge active={r.isActive} /> },
  ];

  return (
    <>
      <MasterHeader
        title="화주사"
        count={rows.length}
        rules={RULES.clients}
        actions={canEdit ? <CreateButton onClick={edit.openNew}>등록</CreateButton> : undefined}
      />
      <FilterBar>
        <FilterField label="사용 여부">
          <ChipGroup options={ACTIVE_OPTIONS} value={active} onChange={setActive} />
        </FilterField>
        <FilterField label="이용 센터" htmlFor="f-center">
          <Select id="f-center" value={center} onChange={(e) => setCenter(e.target.value)}>
            <option value="">전체</option>
            {centers.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
                {c.isActive ? "" : " (사용 안 함)"}
              </option>
            ))}
          </Select>
        </FilterField>
        <SearchInput value={q} onChange={setQ} placeholder="화주사 코드, 화주사명, 사업자등록번호 검색" />
      </FilterBar>
      <SplitView
        collapsible
        list={
          <>
            <ListToolbar total={list.length} />
            <DataTable
              caption="화주사 목록"
              columns={columns}
              rows={list}
              rowKey={(r) => String(r.id)}
              activeKey={sel.active === "new" ? null : String(sel.active)}
              onActivate={(k) => sel.select(Number(k))}
              empty="조건에 맞는 화주사가 없습니다. 조회조건을 바꿔 보세요."
            />
          </>
        }
        panel={<ClientView row={current} canEdit={canEdit} onEdit={() => current && edit.openEdit(current.id)} opening={edit.loading} />}
      />
      {edit.target && (
        <ClientEditModal
          key={edit.nonce}
          row={edit.target === "new" ? null : edit.target}
          centers={centers}
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

/* ───────── 우측 조회 패널 ───────── */

function ClientView({ row, canEdit, onEdit, opening }: { row: ClientRow | null; canEdit: boolean; onEdit: () => void; opening: boolean }) {
  if (!row) {
    return (
      <SidePanel label="화주사 상세">
        <p className="muted">목록에서 화주사를 선택하면 상세가 보입니다.</p>
      </SidePanel>
    );
  }
  const unclosed = unclosedTotal(row.unclosed);
  return (
    <SidePanel
      label="화주사 상세"
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
          />
          {/* 수정은 패널 아래 오른쪽 (2026-11-06 Sol 결정: 위쪽 접기 아이콘과 나눔) */}
          {canEdit && <Button size="sm" variant="editSoft" onClick={onEdit} disabled={opening}>수정</Button>}
        </>
      }
    >
      <ViewSection
        title="요약"
        items={[
          ["품목", <Link key="i" className={styles.link} href={`/master/items?client=${row.id}`}>{row.itemCount}개</Link>],
          ["사용자", <Link key="u" className={styles.link} href={`/master/users?client=${row.id}`}>{row.userCount}명</Link>],
          [
            "미종결 전표",
            <span key="c">
              {unclosed}건
              {unclosed > 0 && (
                <span className="muted">
                  {" "}
                  ({UNCLOSED_KINDS.filter((k) => row.unclosed[k] > 0).map((k) => `${UNCLOSED_LABEL[k]} ${row.unclosed[k]}`).join(", ")})
                </span>
              )}
            </span>,
          ],
        ]}
      />
      <ViewSection
        title="기본 정보"
        items={[
          ["화주사명", row.name],
          ["사업자등록번호", <span key="b" className="mono">{row.bizNo}</span>],
          ["대표자명", row.ceoName],
          ["주소", `(${row.zipCode}) ${row.addr1} ${row.addr2}`],
          ["대표 전화", row.tel ? <span className="mono">{row.tel}</span> : null],
          ["이메일", row.email],
        ]}
      />
      <ViewSection
        title="연락처"
        items={[
          ["업무 연락 담당자", row.contactName],
          ["담당자 전화", <span key="t" className="mono">{row.contactTel}</span>],
          ["담당자 이메일", row.contactEmail],
          ["3PL 담당", row.managerName],
        ]}
      />
      <ViewSection
        title="이용 센터 · 계약"
        items={[
          ["이용 센터", row.centers.map((c) => c.name).join(", ")],
          ["계약 기간", `${row.contractStartDt} ~ ${row.contractEndDt ?? "기간 미정"}`],
        ]}
      />
    </SidePanel>
  );
}

/* ───────── 편집 모달 ([+ 등록]·[수정] 공용) ───────── */

type Form = {
  prefix: string;
  name: string;
  bizNo: string;
  ceoName: string;
  zipCode: string;
  addr1: string;
  addr2: string;
  tel: string;
  email: string;
  contactName: string;
  contactTel: string;
  contactEmail: string;
  managerUserId: string;
  centerCodes: string[];
  contractStartDt: string;
  contractEndDt: string;
  isActive: boolean;
};

const todayYmd = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function toForm(r: ClientRow | null, centers: CenterPick[]): Form {
  const activeCenters = centers.filter((c) => c.isActive);
  return {
    prefix: r ? r.code.slice(0, 2) : "",
    name: r?.name ?? "",
    bizNo: r?.bizNo ?? "",
    ceoName: r?.ceoName ?? "",
    zipCode: r?.zipCode ?? "",
    addr1: r?.addr1 ?? "",
    addr2: r?.addr2 ?? "",
    tel: r?.tel ?? "",
    email: r?.email ?? "",
    contactName: r?.contactName ?? "",
    contactTel: r?.contactTel ?? "",
    contactEmail: r?.contactEmail ?? "",
    managerUserId: r ? String(r.managerUserId) : "",
    centerCodes: r ? r.centers.map((c) => c.code) : activeCenters.length === 1 ? [activeCenters[0].code] : [],
    contractStartDt: r?.contractStartDt ?? todayYmd(),
    contractEndDt: r?.contractEndDt ?? "",
    isActive: r?.isActive ?? true,
  };
}

function validate(f: Form, isNew: boolean) {
  const e: Record<string, string> = {};
  const name = textError(f.name, "화주사명", 50);
  if (name) e.name = name;
  if (isNew && !/^[A-Z]{2}$/.test(f.prefix)) e.prefix = "영문 대문자 2자를 입력하세요";
  const bizErr = bizNoError(f.bizNo);
  if (bizErr) e.bizNo = bizErr;
  const ceo = textError(f.ceoName, "대표자명", 20);
  if (ceo) e.ceoName = ceo;
  Object.assign(e, addressErrors(f));
  if (f.tel.trim() && !isValidPhone(f.tel)) e.tel = MSG.phone;
  if (f.email.trim() && !isValidEmail(f.email.trim())) e.email = MSG.email;
  const cn = textError(f.contactName, "업무 연락 담당자", 20);
  if (cn) e.contactName = cn;
  if (!isValidPhone(f.contactTel)) e.contactTel = f.contactTel.trim() ? MSG.phone : "담당자 전화를 입력하세요";
  if (f.contactEmail.trim() && !isValidEmail(f.contactEmail.trim())) e.contactEmail = MSG.email;
  if (f.centerCodes.length === 0) e.centerCodes = "이용 센터를 1개 이상 고르세요";
  if (!f.managerUserId) e.managerUserId = "3PL 담당 운영자를 고르세요";
  if (!f.contractStartDt) e.contractStartDt = "계약 시작일을 입력하세요";
  if (f.contractEndDt && f.contractStartDt && f.contractEndDt < f.contractStartDt) e.contractEndDt = "계약 종료일은 시작일 이후로 입력하세요";
  return e;
}

function ClientEditModal({
  row,
  centers,
  candidates,
  onClose,
  onSaved,
  onConflict,
}: {
  row: ClientRow | null;
  centers: CenterPick[];
  candidates: ManagerCandidate[];
  onClose: () => void;
  onSaved: (id: number) => void;
  onConflict: (id: number) => void;
}) {
  const isNew = !row;
  const initial = useMemo(() => toForm(row, centers), [row, centers]);
  const [f, setF] = useState<Form>(initial);
  /** 영문 2자를 사용자가 직접 고쳤으면 화주사명을 바꿔도 덮어쓰지 않는다 */
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [preview, setPreview] = useState<{ serial: string | null; error: string | null }>({ serial: null, error: null });
  const act = useAction();

  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) =>
    k === "centerCodes" ? [...f.centerCodes].sort().join() !== [...initial.centerCodes].sort().join() : f[k] !== initial[k],
  );

  // 약어 → 다음 순번 미리 보기 (예정). 최종 순번은 저장 시 서버에서 확정
  useEffect(() => {
    if (!isNew) return;
    if (!/^[A-Z]{2}$/.test(f.prefix)) return setPreview({ serial: null, error: null });
    let alive = true;
    const t = setTimeout(async () => {
      const r = await previewClientCode(f.prefix);
      if (alive && r.ok && r.data) setPreview({ serial: r.data.serial, error: r.data.error });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [f.prefix, isNew]);

  const suggested = suggestClientPrefix(f.name);
  const set = (k: keyof Form, fmt?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: fmt ? fmt(e.target.value) : e.target.value });

  function onName(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    setF({ ...f, name, ...(isNew && !prefixTouched ? { prefix: suggestClientPrefix(name) } : {}) });
  }

  // 3PL 담당 운영자 후보: 고른 이용 센터 중 한 곳 소속 · 사용 중 · 관리자/운영담당
  const managerOptions = candidates.filter((c) => f.centerCodes.includes(c.centerCode));
  const managerStillValid = !f.managerUserId || managerOptions.some((c) => String(c.id) === f.managerUserId);

  function toggleCenter(code: string, on: boolean) {
    const centerCodes = on ? [...f.centerCodes, code] : f.centerCodes.filter((c) => c !== code);
    const keepManager = candidates.some((c) => String(c.id) === f.managerUserId && centerCodes.includes(c.centerCode));
    setF({ ...f, centerCodes, managerUserId: keepManager ? f.managerUserId : "" });
  }

  /** 사업자등록번호가 다른 화주사와 같을 때 서버가 보낸 확인 문구 (있으면 확인창을 띄움) */
  const [dupBizMsg, setDupBizMsg] = useState<string | null>(null);

  function submit(confirmDupBizNo = false) {
    const errs = validate(f, isNew);
    if (preview.error && isNew) errs.prefix = preview.error;
    if (Object.keys(errs).length) return act.invalid(errs);
    setDupBizMsg(null);
    act.run(
      () =>
        saveClient({
          id: row?.id,
          version: row?.version,
          prefix: isNew ? f.prefix : undefined,
          name: f.name,
          bizNo: f.bizNo,
          ceoName: f.ceoName,
          zipCode: f.zipCode,
          addr1: f.addr1,
          addr2: f.addr2,
          tel: f.tel,
          email: f.email,
          contactName: f.contactName,
          contactTel: f.contactTel,
          contactEmail: f.contactEmail,
          managerUserId: f.managerUserId ? Number(f.managerUserId) : null,
          centerCodes: f.centerCodes,
          contractStartDt: f.contractStartDt,
          contractEndDt: f.contractEndDt,
          isActive: f.isActive,
          confirmDupBizNo,
        }),
      (d) => d && onSaved(d.id),
      row ? () => onConflict(row.id) : undefined,
      setDupBizMsg,
    );
  }

  // 이용 센터 선택지: 사용 중인 센터 + 이미 연결된 사용 안 함 센터
  const centerChoices = centers.filter((c) => c.isActive || initial.centerCodes.includes(c.code));

  return (
    <EditModal
      open
      title={isNew ? "화주사 등록" : `화주사 수정 · ${row.code} ${row.name}`}
      dirty={dirty}
      pending={act.pending}
      error={act.error}
      onClose={onClose}
      onSubmit={() => submit()}
    >
      <FormSection title="기본 정보">
        <FormField label="화주사명" htmlFor="cl-name" required error={act.fieldErrors.name}>
          <Input id="cl-name" value={f.name} onChange={onName} maxLength={50} data-autofocus autoComplete="off" />
        </FormField>
        {isNew ? (
          <FormField
            label="화주사 코드"
            htmlFor="cl-prefix"
            required
            hint="영문 2자는 화주사명으로 추천합니다. 순번 2자는 저장할 때 확정됩니다."
            error={act.fieldErrors.prefix ?? preview.error ?? undefined}
          >
            <div className={styles.codeRow}>
              <Input
                id="cl-prefix"
                className={`mono ${styles.prefix}`}
                value={f.prefix}
                maxLength={2}
                autoComplete="off"
                aria-label="화주사 코드 영문 2자"
                onChange={(e) => {
                  setPrefixTouched(true);
                  setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) });
                }}
              />
              <span className={`mono ${styles.serial}`} aria-live="polite" data-testid="code-serial">
                {preview.serial ? `${preview.serial} (예정)` : "__"}
              </span>
              {prefixTouched && suggested.length === 2 && suggested !== f.prefix && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setPrefixTouched(false);
                    setF({ ...f, prefix: suggested });
                  }}
                >
                  추천값 다시 적용 ({suggested})
                </button>
              )}
            </div>
          </FormField>
        ) : (
          <FormStatic label="화주사 코드">
            <span className="mono">{row.code}</span> <span className="muted">(등록 후 수정 불가)</span>
          </FormStatic>
        )}
        <FormField label="사업자등록번호" htmlFor="cl-biz" required error={act.fieldErrors.bizNo}>
          <Input id="cl-biz" className="mono" inputMode="numeric" placeholder="000-00-00000" value={f.bizNo} onChange={set("bizNo", formatBizNo)} maxLength={12} />
        </FormField>
        <FormField label="대표자명" htmlFor="cl-ceo" required error={act.fieldErrors.ceoName}>
          <Input id="cl-ceo" value={f.ceoName} onChange={set("ceoName")} maxLength={20} />
        </FormField>
        <Full>
          <AddressInput id="cl-addr" required value={{ zipCode: f.zipCode, addr1: f.addr1, addr2: f.addr2 }} onChange={(a) => setF({ ...f, ...a })} errors={act.fieldErrors} />
        </Full>
        <FormField label="대표 전화" htmlFor="cl-tel" error={act.fieldErrors.tel}>
          <Input id="cl-tel" className="mono" inputMode="tel" placeholder="02-000-0000" value={f.tel} onChange={set("tel", formatPhone)} maxLength={13} />
        </FormField>
        <FormField label="이메일" htmlFor="cl-email" error={act.fieldErrors.email}>
          <Input id="cl-email" type="email" value={f.email} onChange={set("email")} maxLength={100} />
        </FormField>
        <Full>
          <FormCheck
            id="cl-active"
            label="사용"
            checked={f.isActive}
            onChange={(v) => setF({ ...f, isActive: v })}
            hint={act.fieldErrors.isActive ? undefined : "미종결 전표가 있으면 사용 안 함으로 바꿀 수 없습니다. 화주사는 삭제하지 않습니다."}
          />
          {act.fieldErrors.isActive && <p className={styles.err}>{act.fieldErrors.isActive}</p>}
        </Full>
      </FormSection>

      <FormSection title="연락처">
        <FormField label="업무 연락 담당자" htmlFor="cl-cname" required hint="계약·업무 연락을 받는 화주사 쪽 담당자입니다. 시스템 로그인 계정과는 관계없습니다." error={act.fieldErrors.contactName}>
          <Input id="cl-cname" value={f.contactName} onChange={set("contactName")} maxLength={20} />
        </FormField>
        <FormField label="담당자 전화" htmlFor="cl-ctel" required error={act.fieldErrors.contactTel}>
          <Input id="cl-ctel" className="mono" inputMode="tel" placeholder="010-0000-0000" value={f.contactTel} onChange={set("contactTel", formatPhone)} maxLength={13} />
        </FormField>
        <FormField label="담당자 이메일" htmlFor="cl-cemail" error={act.fieldErrors.contactEmail}>
          <Input id="cl-cemail" type="email" value={f.contactEmail} onChange={set("contactEmail")} maxLength={100} />
        </FormField>
        <FormField
          label="3PL 담당 운영자"
          htmlFor="cl-manager"
          required
          hint={
            f.centerCodes.length === 0
              ? "이용 센터를 먼저 고르세요"
              : managerOptions.length === 0
                ? "지정 가능한 담당자가 없습니다"
                : "이용 센터 소속 3PL 관리자·운영담당 중에서 고릅니다"
          }
          error={act.fieldErrors.managerUserId}
        >
          <Select id="cl-manager" value={managerStillValid ? f.managerUserId : ""} onChange={set("managerUserId")} disabled={managerOptions.length === 0}>
            <option value="">{managerOptions.length === 0 ? "지정 가능한 담당자가 없습니다" : "담당 운영자를 고르세요"}</option>
            {managerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.roleLabel} · {centers.find((x) => x.code === c.centerCode)?.name})
              </option>
            ))}
          </Select>
        </FormField>
      </FormSection>

      <FormSection title="이용 센터 · 계약">
        <Full>
          <fieldset className={styles.centers} data-invalid={act.fieldErrors.centerCodes ? "" : undefined}>
            <legend>
              이용 센터 <span className={styles.req}>*</span> <span className="muted">(1개 이상)</span>
            </legend>
            <div className={styles.centerList}>
              {centerChoices.map((c) => (
                <FormCheck
                  key={c.code}
                  id={`cl-center-${c.code}`}
                  label={`${c.name} (${c.code})${c.isActive ? "" : " · 사용 안 함"}`}
                  checked={f.centerCodes.includes(c.code)}
                  onChange={(on) => toggleCenter(c.code, on)}
                />
              ))}
            </div>
            {act.fieldErrors.centerCodes && <p className={styles.err}>{act.fieldErrors.centerCodes}</p>}
          </fieldset>
        </Full>
        <FormField label="계약 시작일" htmlFor="cl-start" required error={act.fieldErrors.contractStartDt}>
          <Input id="cl-start" type="date" className="mono" value={f.contractStartDt} onChange={set("contractStartDt")} />
        </FormField>
        <FormField label="계약 종료일" htmlFor="cl-end" hint="비우면 기간 미정" error={act.fieldErrors.contractEndDt}>
          <Input id="cl-end" type="date" className="mono" value={f.contractEndDt} min={f.contractStartDt || undefined} onChange={set("contractEndDt")} />
        </FormField>
        {!isNew && row && unclosedTotal(row.unclosed) > 0 && (
          <Full>
            <Tag tone="warn">미종결 전표 {unclosedTotal(row.unclosed)}건 — 사용 안 함 전환·이용 센터 제외 불가</Tag>
          </Full>
        )}
      </FormSection>

      <Modal
        open={dupBizMsg !== null}
        onClose={() => setDupBizMsg(null)}
        title="사업자등록번호가 같은 화주사가 있습니다"
        footer={
          <>
            <Button onClick={() => setDupBizMsg(null)} disabled={act.pending}>
              번호 다시 확인
            </Button>
            <Button variant="primary" onClick={() => submit(true)} disabled={act.pending}>
              {act.pending ? "저장 중…" : "그래도 저장"}
            </Button>
          </>
        }
      >
        <p>{dupBizMsg}</p>
      </Modal>
    </EditModal>
  );
}
