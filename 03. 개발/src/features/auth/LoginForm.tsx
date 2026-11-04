"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";
import { login, type FormState } from "@/server/auth/actions";
import styles from "./Auth.module.css";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  const idRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  // 실패하면 비밀번호를 비우고 다시 입력할 칸으로 포커스를 옮긴다
  useEffect(() => {
    if (state.fieldErrors?.loginId) idRef.current?.focus();
    else if (state.error || state.fieldErrors?.password) {
      if (pwRef.current) pwRef.current.value = "";
      pwRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={action} className={styles.form} noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <p className={styles.alert} role="alert">
          {state.error}
        </p>
      )}
      <FormField label="아이디" htmlFor="login-id" required error={state.fieldErrors?.loginId}>
        <Input ref={idRef} id="login-id" name="loginId" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus maxLength={100} />
      </FormField>
      <FormField label="비밀번호" htmlFor="login-pw" required error={state.fieldErrors?.password}>
        <Input ref={pwRef} id="login-pw" name="password" type="password" autoComplete="current-password" maxLength={64} />
      </FormField>
      <Button type="submit" variant="primary" className={styles.submit} disabled={pending}>
        {pending ? "확인 중…" : "로그인"}
      </Button>
    </form>
  );
}
