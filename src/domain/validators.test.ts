import { test } from "node:test";
import assert from "node:assert/strict";
import { MSG, bizNoError, isValidBizNo } from "./validators";

test("사업자등록번호: 국세청 검증식 — 검증 숫자가 맞으면 통과", () => {
  assert.equal(isValidBizNo("318-86-45218"), true);
  assert.equal(bizNoError("318-86-45218"), null);
});

test("사업자등록번호: 자릿수 부족과 검증 숫자 불일치를 나눠 안내", () => {
  assert.equal(bizNoError("318-86-452"), MSG.bizNoLen);
  assert.equal(bizNoError("318-86-45219"), MSG.bizNoCheck); // 2026-11-06 Sol 입력값 — 끝자리는 8이어야 함
});
