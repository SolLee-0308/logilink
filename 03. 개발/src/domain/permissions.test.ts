import { test } from "node:test";
import assert from "node:assert/strict";
import { can, resourceOfPath } from "./permissions";

/* 사유 코드·운영 설정 (K1, 2026-11-24 Sol): 화주사 숨김, 3PL 운영담당 조회만, 3PL 관리자 수정 */
for (const resource of ["codes", "settings"] as const) {
  test(`${resource}: 화주사 담당자는 조회·수정 모두 불가`, () => {
    assert.equal(can(["SHIPPER_STAFF"], resource, "view"), false);
    assert.equal(can(["SHIPPER_STAFF"], resource, "edit"), false);
  });
  test(`${resource}: 3PL 운영담당은 조회만`, () => {
    assert.equal(can(["TPL_OPERATOR"], resource, "view"), true);
    assert.equal(can(["TPL_OPERATOR"], resource, "edit"), false);
  });
  test(`${resource}: 3PL 관리자는 조회·수정`, () => {
    assert.equal(can(["TPL_ADMIN"], resource, "view"), true);
    assert.equal(can(["TPL_ADMIN"], resource, "edit"), true);
  });
  test(`${resource}: PDA 역할은 불가`, () => {
    assert.equal(can(["TPL_INSPECTOR"], resource, "view"), false);
    assert.equal(can(["SHIPPER_LOADER"], resource, "view"), false);
  });
}

test("메뉴 경로가 사유 코드·운영 설정 권한으로 연결된다 (사이드바 숨김 기준)", () => {
  assert.equal(resourceOfPath("/master/codes"), "codes");
  assert.equal(resourceOfPath("/master/settings"), "settings");
});

test("입고취소(입고검수 실적 edit)는 3PL 관리자만 (K2)", () => {
  assert.equal(can(["TPL_ADMIN"], "rcvResults", "edit"), true);
  assert.equal(can(["TPL_OPERATOR"], "rcvResults", "edit"), false);
  assert.equal(can(["TPL_OPERATOR"], "rcvResults", "view"), true);
});
