"use client";

import { useState } from "react";
import { AddressInput } from "@/components/ui/AddressInput";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { PanelTitle, SidePanel } from "@/components/ui/SplitView";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedChanges, useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { MSG, addressErrors, formatBizNo, formatPhone, isValidBizNo, isValidEmail, isValidPhone, textError } from "@/domain/validators";
import { saveCompany } from "@/server/master/actions";
import { loadCompany } from "@/server/master/loaders";
import { LastChanged } from "./history";
import { ViewSection } from "./record";
import { MasterHeader, useAction } from "./shared";
import { RULES } from "./rules";
import type { CompanyRow } from "./types";
import styles from "./CompanyScreen.module.css";

const LABELS = {
  name: "회사명",
  bizNo: "사업자등록번호",
  ceoName: "대표자명",
  zipCode: "우편번호",
  addr1: "기본주소",
  addr2: "상세주소",
  phone: "대표 전화",
  email: "이메일",
};

type Form = { name: string; bizNo: string; ceoName: string; zipCode: string; addr1: string; addr2: string; phone: string; email: string };

const toForm = (r: CompanyRow): Form => ({
  name: r.name,
  bizNo: r.bizNo,
  ceoName: r.ceoName,
  zipCode: r.zipCode,
  addr1: r.addr1,
  addr2: r.addr2,
  phone: r.phone ?? "",
  email: r.email ?? "",
});

/** 화면 검증 — 서버(saveCompany)도 같은 규칙으로 다시 검사한다 */
function validate(f: Form) {
  const e: Record<string, string> = {};
  const name = textError(f.name, "회사명", 50);
  if (name) e.name = name;
  if (!isValidBizNo(f.bizNo)) e.bizNo = MSG.bizNo;
  const ceo = textError(f.ceoName, "대표자명", 20);
  if (ceo) e.ceoName = ceo;
  Object.assign(e, addressErrors(f));
  if (f.phone.trim() && !isValidPhone(f.phone)) e.phone = MSG.phone;
  if (f.email.trim() && !isValidEmail(f.email.trim())) e.email = MSG.email;
  return e;
}

export function CompanyScreen({ company, canEdit }: { company: CompanyRow | null; canEdit: boolean }) {
  return (
    <>
      <MasterHeader title="회사 정보" rules={RULES.company} />
      <div className={styles.grid}>
        {company ? (
          <CompanyCard key={company.version} row={company} canEdit={canEdit} />
        ) : (
          <NoteBox tone="error">회사 정보가 없습니다. 초기 데이터(시드)를 확인하세요.</NoteBox>
        )}
        {/* 오른쪽 열: 입고확인서 머리글 미리보기 자리 (범위 확정 후) */}
        <div aria-hidden="true" />
      </div>
    </>
  );
}

/** 기본은 조회 모드. [수정]을 누르면 최신 내용을 다시 읽어 같은 자리에서 편집 폼으로 바뀐다 */
function CompanyCard({ row, canEdit }: { row: CompanyRow; canEdit: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [opening, setOpening] = useState(false);

  async function startEdit() {
    setOpening(true);
    const r = await loadCompany();
    setOpening(false);
    if (!r.ok) return toast.show(r.error);
    setEditing(r.data!);
  }

  if (editing) return <CompanyForm key={editing.version + editing.updatedAt} base={editing} onDone={() => setEditing(null)} onReload={startEdit} />;

  return (
    <SidePanel
      label="회사 정보"
      title={
        <>
          <PanelTitle>회사 정보</PanelTitle>
          {canEdit && (
            <span className={styles.headAction}>
              <Button size="sm" onClick={startEdit} disabled={opening}>
                수정
              </Button>
            </span>
          )}
        </>
      }
      sub="3PL 운영 법인 정보 · 3PL이 발행하는 출력물 머리글에 쓰입니다."
      footer={<LastChanged by={row.updatedBy} at={row.updatedAt} title="회사 정보" entries={row.history} labels={LABELS} />}
    >
      <ViewSection
        title="기본 정보"
        items={[
          ["회사명", row.name],
          ["사업자등록번호", <span key="b" className="mono">{row.bizNo}</span>],
          ["대표자명", row.ceoName],
          ["주소", `(${row.zipCode}) ${row.addr1} ${row.addr2}`],
          ["대표 전화", row.phone ? <span className="mono">{row.phone}</span> : null],
          ["이메일", row.email],
        ]}
      />
    </SidePanel>
  );
}

function CompanyForm({ base, onDone, onReload }: { base: CompanyRow; onDone: () => void; onReload: () => void }) {
  const initial = toForm(base);
  const [f, setF] = useState<Form>(initial);
  const act = useAction();
  const guard = useUnsavedGuard();
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChanges(dirty);

  const set = (k: keyof Form, fmt?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: fmt ? fmt(e.target.value) : e.target.value });

  async function cancel() {
    if (dirty && !(await guard.confirmLeave())) return;
    onDone();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(f);
    if (Object.keys(errs).length) return act.invalid(errs);
    act.run(() => saveCompany({ version: base.version, ...f }), onDone, onReload);
  }

  return (
    <SidePanel
      label="회사 정보 수정"
      onSubmit={submit}
      title={<PanelTitle>회사 정보 수정</PanelTitle>}
      sub="3PL 운영 법인 정보 · 3PL이 발행하는 출력물 머리글에 쓰입니다."
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
      <FormField label="회사명" htmlFor="co-name" required error={act.fieldErrors.name}>
        <Input id="co-name" value={f.name} onChange={set("name")} maxLength={50} autoFocus />
      </FormField>
      <FormField label="사업자등록번호" htmlFor="co-biz" required error={act.fieldErrors.bizNo}>
        <Input id="co-biz" className="mono" inputMode="numeric" placeholder="000-00-00000" value={f.bizNo} onChange={set("bizNo", formatBizNo)} maxLength={12} />
      </FormField>
      <FormField label="대표자명" htmlFor="co-ceo" required error={act.fieldErrors.ceoName}>
        <Input id="co-ceo" value={f.ceoName} onChange={set("ceoName")} maxLength={20} />
      </FormField>
      <AddressInput
        id="co-addr"
        required
        value={{ zipCode: f.zipCode, addr1: f.addr1, addr2: f.addr2 }}
        onChange={(a) => setF({ ...f, ...a })}
        errors={act.fieldErrors}
      />
      <FormField label="대표 전화" htmlFor="co-phone" error={act.fieldErrors.phone}>
        <Input id="co-phone" className="mono" inputMode="tel" placeholder="031-000-0000" value={f.phone} onChange={set("phone", formatPhone)} maxLength={13} />
      </FormField>
      <FormField label="이메일" htmlFor="co-email" error={act.fieldErrors.email}>
        <Input id="co-email" type="email" value={f.email} onChange={set("email")} maxLength={100} />
      </FormField>
    </SidePanel>
  );
}
