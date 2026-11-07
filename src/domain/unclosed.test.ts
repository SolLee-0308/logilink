import { test } from "node:test";
import assert from "node:assert/strict";
import { deactivateBlock, emptyUnclosed, removeCenterBlock, unclosedTotal } from "./unclosed";

test("미종결 전표가 없으면 차단하지 않는다", () => {
  assert.equal(deactivateBlock(emptyUnclosed()), null);
  assert.equal(removeCenterBlock("용인1센터", emptyUnclosed()), null);
});

test("사용 안 함 전환 차단: 합계 + 유형별 건수", () => {
  const c = { plan: 2, asn: 1, loading: 0, inspection: 1 };
  assert.equal(unclosedTotal(c), 4);
  assert.equal(deactivateBlock(c), "미종결 전표 4건이 있어 사용 안 함으로 바꿀 수 없습니다. (입고예정 2건, ASN 1건, 입고검수 1건)");
});

test("이용 센터 제외 차단 문구", () => {
  assert.equal(
    removeCenterBlock("용인1센터", { plan: 0, asn: 0, loading: 3, inspection: 0 }),
    "용인1센터에 미종결 전표 3건이 있어 이용 센터에서 뺄 수 없습니다.",
  );
});
