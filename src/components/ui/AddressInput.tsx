"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { Button } from "./Button";
import { Input } from "./Form";
import formStyles from "./Form.module.css";
import styles from "./AddressInput.module.css";

/** 카카오(다음) 우편번호 서비스 — API 키 불필요. 이 컴포넌트를 쓰는 화면에서만 스크립트를 불러온다 */
const POSTCODE_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

interface PostcodeData {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  autoJibunAddress?: string;
  userSelectedType: "R" | "J";
  buildingName: string;
}

declare global {
  interface Window {
    daum?: { Postcode: new (opts: { oncomplete: (d: PostcodeData) => void; onclose?: () => void }) => { open: () => void } };
  }
}

export interface AddressValue {
  zipCode: string;
  addr1: string;
  addr2: string;
}

/**
 * 주소 입력: [우편번호(읽기 전용)] [주소 검색] / 기본주소(읽기 전용) / 상세주소(직접 입력)
 * 검색 결과: zonecode → 우편번호, 도로명(지번 선택 시 지번) → 기본주소, 건물명이 있으면 "(건물명)"을 붙인다.
 * 오류 키: addr1(검색 필요), addr2(상세주소)
 */
export function AddressInput({
  id,
  label = "주소",
  required,
  value,
  onChange,
  errors = {},
  readOnly,
}: {
  id: string;
  label?: string;
  required?: boolean;
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
}) {
  const detailRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const [loadError, setLoadError] = useState(false);
  const error = errors.addr1 ?? errors.zipCode;

  function open() {
    if (!window.daum?.Postcode) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    new window.daum.Postcode({
      oncomplete(d) {
        const base = d.userSelectedType === "J" ? d.jibunAddress || d.autoJibunAddress || d.roadAddress : d.roadAddress;
        const addr1 = d.buildingName ? `${base} (${d.buildingName})` : base;
        onChange({ ...value, zipCode: d.zonecode, addr1 });
        // 팝업이 닫힌 뒤 상세주소로 이동
        setTimeout(() => detailRef.current?.focus(), 0);
      },
    }).open();
  }

  return (
    <div className={`${formStyles.field} ${error || errors.addr2 ? formStyles.invalid : ""}`}>
      {!readOnly && <Script src={POSTCODE_SRC} strategy="lazyOnload" onError={() => setLoadError(true)} />}
      <span className={formStyles.label} id={`${id}-label`}>
        {label}
        {required ? (
          <span className={formStyles.req}>
            {" "}
            *<span className="sr-only">필수</span>
          </span>
        ) : (
          <span className={formStyles.opt}> (선택)</span>
        )}
      </span>
      <div className={styles.row} data-invalid={error ? "" : undefined}>
        <Input
          id={`${id}-zip`}
          className={`mono ${styles.zip}`}
          value={value.zipCode}
          readOnly
          tabIndex={-1}
          placeholder="우편번호"
          aria-label="우편번호"
        />
        {!readOnly && (
          <Button ref={searchRef} size="sm" onClick={open} aria-describedby={error ? `${id}-addr1-err` : undefined}>
            주소 검색
          </Button>
        )}
      </div>
      <Input id={`${id}-addr1`} value={value.addr1} readOnly tabIndex={-1} placeholder="주소 검색으로 입력됩니다" aria-label="기본주소" />
      {error && (
        <p className={formStyles.error} id={`${id}-addr1-err`}>
          {error}
        </p>
      )}
      {loadError && <p className={formStyles.error}>주소 검색을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 누르세요.</p>}
      <div data-invalid={errors.addr2 ? "" : undefined}>
        <Input
          ref={detailRef}
          id={`${id}-addr2`}
          value={value.addr2}
          onChange={(e) => onChange({ ...value, addr2: e.target.value })}
          readOnly={readOnly}
          maxLength={100}
          placeholder="상세주소 (동·층·호)"
          aria-label="상세주소"
          aria-invalid={errors.addr2 ? true : undefined}
          className={styles.detail}
        />
      </div>
      {errors.addr2 && (
        <p className={formStyles.error} id={`${id}-addr2-err`}>
          {errors.addr2}
        </p>
      )}
    </div>
  );
}
