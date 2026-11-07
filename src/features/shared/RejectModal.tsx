"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError, FormField, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import type { ActionResult } from "@/server/action-result";
import styles from "./RejectModal.module.css";

export interface ReasonOption {
  code: string;
  name: string;
  requiresText: boolean;
}

/**
 * 반려 모달 — 대상 표시 → 사유 드롭다운(필수) → 상세 내용(기본 선택, '기타'류는 필수) → 반려.
 * 오류는 모달 안에 문장으로 표시한다. 입고예정·품목 등록 요청 반려에 함께 쓴다.
 */
export function RejectModal({
  open,
  onClose,
  title,
  description,
  target,
  reasons,
  onSubmit,
  reasonLabel = "반려 사유",
  submitLabel = "반려",
  closeLabel = "취소",
  placeholder = "화주사가 무엇을 고쳐야 하는지 적어 주세요.",
}: {
  /** 입고예정 취소 등 다른 사유 입력에 쓸 때 문구 */
  reasonLabel?: string;
  submitLabel?: string;
  closeLabel?: string;
  placeholder?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  target: React.ReactNode;
  reasons: ReasonOption[];
  onSubmit: (reasonCode: string, reasonText: string) => Promise<ActionResult<unknown>>;
}) {
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const reason = reasons.find((r) => r.code === code);

  function close() {
    setCode("");
    setText("");
    setError("");
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return setError(`${reasonLabel}를 선택하세요.`);
    if (reason?.requiresText && !text.trim()) return setError(`"${reason.name}"을(를) 고르면 상세 내용을 입력해야 합니다.`);
    setPending(true);
    const r = await onSubmit(code, text.trim());
    setPending(false);
    if (r.ok) return close();
    setError(r.fieldErrors?.reasonText ?? r.fieldErrors?.reasonCode ?? r.error);
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={close} disabled={pending}>
            {closeLabel}
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className={styles.target}>{target}</div>
      <FormField label={reasonLabel} htmlFor="rej-code" required>
        <Select id="rej-code" value={code} onChange={(e) => setCode(e.target.value)} data-autofocus>
          <option value="">사유를 선택하세요</option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="상세 내용" htmlFor="rej-text" required={!!reason?.requiresText}>
        <Textarea
          id="rej-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={placeholder}
        />
      </FormField>
      <FormError>{error}</FormError>
    </Modal>
  );
}
