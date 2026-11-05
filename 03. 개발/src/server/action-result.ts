/** 서버 액션 결과 — 화면은 ok로 분기하고, 오류는 문장으로 그대로 보여 준다 */
export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | {
      ok: false;
      /** CONFLICT: 다른 사람이 먼저 바꿈(version 불일치) / VALIDATION: 입력 오류 / NOT_FOUND / STATE: 처리할 수 없는 상태 / FORBIDDEN: 권한 없음 / CONFIRM: 경고를 보고 한 번 더 확인해야 함 */
      code: "CONFLICT" | "VALIDATION" | "NOT_FOUND" | "STATE" | "FORBIDDEN" | "EXTERNAL" | "ERROR" | "CONFIRM";
      error: string;
      fieldErrors?: Record<string, string>;
    };

export const fail = (
  code: Exclude<ActionResult, { ok: true }>["code"],
  error: string,
  fieldErrors?: Record<string, string>,
): ActionResult<never> => ({ ok: false, code, error, fieldErrors });
