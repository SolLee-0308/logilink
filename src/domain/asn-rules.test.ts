import { test } from "node:test";
import assert from "node:assert/strict";
import { distributeError, looksLikeVehicleNo, nextDocNo, normalizeVehicleNo, remainingBase, toLineUnitQty } from "./asn-rules";
import { PATTERNS, code128Values, code128Widths, isCode128B } from "@/lib/code128";

test("전표 번호: 같은 날 가장 큰 번호 + 1, 다른 날·다른 종류 번호는 무시", () => {
  assert.equal(nextDocNo("ASN", "2026-11-04", []), "ASN-20261104-0001");
  assert.equal(nextDocNo("ASN", "2026-11-04", ["ASN-20261104-0002", "ASN-20261104-0009", "ASN-20261103-0050", "LO-20261104-0099"]), "ASN-20261104-0010");
  assert.equal(nextDocNo("LO", "2026-11-04", ["LO-20261104-0001"]), "LO-20261104-0002");
});

test("차량번호: 공백 제거·대문자, 번호판 모양 판별", () => {
  assert.equal(normalizeVehicleNo(" 12가 3456 "), "12가3456");
  assert.ok(looksLikeVehicleNo("12가3456"));
  assert.ok(looksLikeVehicleNo("123 가 4567"));
  assert.ok(looksLikeVehicleNo("서울12가3456"));
  assert.ok(!looksLikeVehicleNo("1234"));
  assert.ok(!looksLikeVehicleNo("ABC-123"));
});

test("분배 잔량: 승인 − 종결 − 분배, 음수는 0", () => {
  assert.equal(remainingBase({ baseQty: 2400, closeQty: 0 }, 0), 2400);
  assert.equal(remainingBase({ baseQty: 2400, closeQty: 400 }, 1200), 800);
  assert.equal(remainingBase({ baseQty: 100, closeQty: 0 }, 150), 0);
  // 입고완료 ASN: 실제 입고·반송 누계로 센다 — 덜 들어온 20은 다시 담을 수 있다
  assert.equal(remainingBase({ baseQty: 100, closeQty: 0, rcvQty: 70, returnQty: 10 }, 0), 20);
  assert.equal(remainingBase({ baseQty: 100, closeQty: 0, rcvQty: 70, returnQty: 10 }, 15), 5);
  assert.equal(toLineUnitQty(2400, 20), 120);
  assert.equal(toLineUnitQty(2410, 20), 120);
  assert.equal(toLineUnitQty(7, 1), 7);
});

test("분배 입력 검사: 1 이상 정수, 남은 수량 이하", () => {
  assert.equal(distributeError(10, 10), null);
  assert.match(distributeError(0, 10)!, /1 이상/);
  assert.match(distributeError(1.5, 10)!, /정수/);
  assert.match(distributeError(11, 10)!, /남은 수량\(10\)/);
});

test("Code128 표: 107개, 모두 다름, 폭 합 11 (정지 13)", () => {
  assert.equal(PATTERNS.length, 107);
  assert.equal(new Set(PATTERNS).size, 107);
  PATTERNS.forEach((p, i) => assert.equal([...p].reduce((s, c) => s + Number(c), 0), i === 106 ? 13 : 11, `값 ${i}`));
  assert.equal(PATTERNS[104], "211214"); // 시작 B
});

test("Code128-B 인코딩: 시작·검사 문자·정지", () => {
  // PJJ123C: (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 55
  assert.deepEqual(code128Values("PJJ123C"), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  const w = code128Widths("LO-20261104-0001");
  assert.equal(w.reduce((a, b) => a + b, 0), 11 * (16 + 2) + 13);
  assert.ok(isCode128B("ASN-20261104-0001"));
  assert.ok(!isCode128B("가나"));
  assert.throws(() => code128Values(""));
});
