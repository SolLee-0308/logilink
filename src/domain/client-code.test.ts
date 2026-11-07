import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_CODE_PATTERN, composeClientCode, hangulInitial, nextClientSerial, suggestClientPrefix } from "./client-code";

test("프롬프트 예시: 기존 화주사명 추천", () => {
  assert.equal(suggestClientPrefix("다온생활"), "DO");
  assert.equal(suggestClientPrefix("한빛식품"), "HB");
  assert.equal(suggestClientPrefix("새봄유통"), "SB");
  assert.equal(suggestClientPrefix("오션푸드"), "OS");
  assert.equal(suggestClientPrefix("그린마켓"), "GR");
});

test("법인 표기 제거", () => {
  assert.equal(suggestClientPrefix("(주)다온생활"), "DO");
  assert.equal(suggestClientPrefix("다온생활(주)"), "DO");
  assert.equal(suggestClientPrefix("㈜한빛식품"), "HB");
  assert.equal(suggestClientPrefix("주식회사 새봄유통"), "SB");
  assert.equal(suggestClientPrefix("(유)그린마켓"), "GR");
  assert.equal(suggestClientPrefix("유한회사 오션푸드"), "OS");
  assert.equal(suggestClientPrefix("다온 생활"), "DO");
});

test("영문명: 여러 단어는 각 단어 첫 글자, 한 단어는 앞 두 글자", () => {
  assert.equal(suggestClientPrefix("Green Market"), "GM");
  assert.equal(suggestClientPrefix("ocean food co"), "OF");
  assert.equal(suggestClientPrefix("Coupang"), "CO");
  assert.equal(suggestClientPrefix("(주)Daon Living"), "DL");
});

test("ㅇ 초성은 중성으로 결정", () => {
  assert.equal(hangulInitial("아"), "A");
  assert.equal(hangulInitial("애"), "A");
  assert.equal(hangulInitial("어"), "E");
  assert.equal(hangulInitial("으"), "E");
  assert.equal(hangulInitial("의"), "E");
  assert.equal(hangulInitial("오"), "O");
  assert.equal(hangulInitial("외"), "O");
  assert.equal(hangulInitial("우"), "U");
  assert.equal(hangulInitial("이"), "I");
  assert.equal(hangulInitial("야"), "Y");
  assert.equal(hangulInitial("유"), "Y");
  assert.equal(hangulInitial("와"), "W");
  assert.equal(hangulInitial("위"), "W");
  assert.equal(suggestClientPrefix("이마트"), "IM");
  assert.equal(suggestClientPrefix("우리유통"), "UR");
  assert.equal(suggestClientPrefix("오아시스"), "OA");
});

test("초성 표 (된소리 포함)", () => {
  const cases: [string, string][] = [
    ["가", "G"], ["까", "K"], ["나", "N"], ["다", "D"], ["따", "T"], ["라", "R"], ["마", "M"], ["바", "B"], ["빠", "P"],
    ["사", "S"], ["싸", "S"], ["자", "J"], ["짜", "J"], ["차", "C"], ["카", "K"], ["타", "T"], ["파", "P"], ["하", "H"],
  ];
  for (const [ch, exp] of cases) assert.equal(hangulInitial(ch), exp, ch);
});

test("숫자는 건너뛰고 첫 글자는 반드시 영문", () => {
  assert.equal(suggestClientPrefix("365마트"), "MT");
  assert.equal(suggestClientPrefix("7일유통"), "IY");
  assert.equal(suggestClientPrefix("24/7 Store"), "ST");
});

test("2자를 만들지 못하면 만든 만큼만", () => {
  assert.equal(suggestClientPrefix("빛"), "B");
  assert.equal(suggestClientPrefix("(주)"), "");
  assert.equal(suggestClientPrefix("123"), "");
});

test("순번: 사용 안 함 포함 최댓값 + 1, 99 초과 시 null", () => {
  assert.equal(nextClientSerial("DO", []), 1);
  assert.equal(nextClientSerial("DO", ["DO01"]), 2);
  assert.equal(nextClientSerial("DO", ["DO01", "DO03", "GM01"]), 4);
  assert.equal(nextClientSerial("GM", ["DO01", "DO02"]), 1);
  assert.equal(nextClientSerial("DO", ["DO99"]), null);
  assert.equal(composeClientCode("DO", 2), "DO02");
  assert.equal(composeClientCode("DO", 12), "DO12");
});

test("코드 형식: 영문 2 + 순번 2 (00 불가)", () => {
  assert.ok(CLIENT_CODE_PATTERN.test("DO01"));
  assert.ok(CLIENT_CODE_PATTERN.test("HB99"));
  assert.ok(!CLIENT_CODE_PATTERN.test("DO00"));
  assert.ok(!CLIENT_CODE_PATTERN.test("DO1"));
  assert.ok(!CLIENT_CODE_PATTERN.test("D001"));
  assert.ok(!CLIENT_CODE_PATTERN.test("do01"));
});
