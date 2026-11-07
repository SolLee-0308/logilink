"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";
import { PASSWORD_RULE_TEXT } from "@/domain/validators";
import { changePassword, type FormState } from "@/server/auth/actions";
import styles from "./Auth.module.css";

export function ChangePasswordForm({ goto }: { goto: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    const first = ["current", "next", "confirm"].find((k) => fe[k]);
    if (first) document.getElementById(`pw-${first}`)?.focus();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className={styles.form} noValidate>
      <input type="hidden" name="goto" value={goto} />
      {state.error && (
        <p className={styles.alert} role="alert">
          {state.error}
        </p>
      )}
      <FormField label="현재 비밀번호" htmlFor="pw-current" required error={fe.current}>
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" maxLength={64} autoFocus />
      </FormField>
      <FormField label="새 비밀번호" htmlFor="pw-next" required hint={PASSWORD_RULE_TEXT} error={fe.next}>
        <Input id="pw-next" name="next" type="password" autoComplete="new-password" maxLength={64} />
      </FormField>
      <FormField label="새 비밀번호 확인" htmlFor="pw-confirm" required error={fe.confirm}>
        <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" maxLength={64} />
      </FormField>
      <Button type="submit" variant="primary" className={styles.submit} disabled={pending}>
        {pending ? "저장 중…" : "비밀번호 변경"}
      </Button>
    </form>
  );
}
