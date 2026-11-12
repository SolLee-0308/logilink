"use client";

import { useEffect } from "react";
import { Barcode } from "@/components/ui/Barcode";
import { LINE_STATE_LABEL, LOAD_TYPE_LABEL, qtyInUnit } from "@/domain/load-rules";
import { fmtDateTime } from "@/lib/format";
import type { LoadConfirmPrint } from "./types";
import styles from "@/features/asn/LoadOrderSheet.module.css";

/**
 * 상차확인서 (A4 세로) — 상차완료와 함께 발행, 거래명세서 역할 (정의서 ④ · D13).
 * 바코드 = 상차 실적 번호. 입고검수자는 이 바코드를 스캔해 검수를 시작한다 (정의서 ⑥).
 * 열리면 바로 인쇄 창을 띄운다 (?auto=0이면 띄우지 않음).
 */
export function LoadConfirmSheet({ data: d, auto }: { data: LoadConfirmPrint; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  const ordered = d.type === "ORDERED";
  const loaded = d.lines.filter((l) => l.loadBase > 0 || l.orderBase > 0);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span>
          상차확인서 <b className="mono">{d.loadNo}</b>
          {d.revisionNo > 1 && <b> · {d.revisionNo}차 (이전 차수 확인서는 폐기)</b>} · A4 세로로 인쇄하세요.
        </span>
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          인쇄
        </button>
        <button type="button" className={styles.closeBtn} onClick={() => window.close()}>
          닫기
        </button>
      </div>

      <article className={styles.sheet} aria-label={`상차확인서 ${d.loadNo}`}>
        <header className={styles.head}>
          <div>
            {/* 차수 — 상차 재개 후 재발행이면 표시 (정의서 v1.5 D20) */}
            <h1>상차확인서{d.revisionNo > 1 && <span className={styles.rev}> ({d.revisionNo}차)</span>}</h1>
            <p className={styles.sub}>
              {LOAD_TYPE_LABEL[d.type]}
              {d.asn ? (
                <>
                  {" "}
                  · ASN <span className="mono">{d.asn.asnNo}</span> · 지시서 <span className="mono">{d.asn.orderNo}</span>
                </>
              ) : (
                " · ASN 없음(예정 외 차량)"
              )}
            </p>
          </div>
          <div className={styles.code}>
            <Barcode value={d.loadNo} height={52} module={1.6} />
          </div>
        </header>

        <section className={styles.parties}>
          <table className={styles.kv}>
            <caption>차량</caption>
            <tbody>
              <tr>
                <th scope="row">차량번호</th>
                <td className={`mono ${styles.big}`}>{d.vehicleNo}</td>
              </tr>
              <tr>
                <th scope="row">기사</th>
                <td>
                  {d.asn?.driverName ?? "–"}
                  {d.asn?.driverTel ? <span className="mono"> · {d.asn.driverTel}</span> : ""}
                </td>
              </tr>
              <tr>
                <th scope="row">상차완료</th>
                <td className="mono">{fmtDateTime(d.completedAt)}</td>
              </tr>
              {/* 출차 (2026-11-12 Sol) — 출차 전에 인쇄하면 "출차 전" */}
              <tr>
                <th scope="row">출차</th>
                <td className="mono">{d.departure ? (d.departure.auto ? `자동 출차 · ${fmtDateTime(d.departure.at)}` : fmtDateTime(d.departure.at)) : "출차 전"}</td>
              </tr>
            </tbody>
          </table>
          <table className={styles.kv}>
            <caption>발송인</caption>
            <tbody>
              <tr>
                <th scope="row">상호</th>
                <td>
                  {d.sender.name} <span className={styles.dim}>(대표 {d.sender.ceoName})</span>
                </td>
              </tr>
              <tr>
                <th scope="row">사업자번호</th>
                <td className="mono">{d.sender.bizNo}</td>
              </tr>
              <tr>
                <th scope="row">주소</th>
                <td>{d.sender.address}</td>
              </tr>
              <tr>
                <th scope="row">담당</th>
                <td>{d.sender.contact}</td>
              </tr>
            </tbody>
          </table>
          <table className={styles.kv}>
            <caption>도착 (입고 센터)</caption>
            <tbody>
              <tr>
                <th scope="row">센터</th>
                <td>{d.receiver.name}</td>
              </tr>
              <tr>
                <th scope="row">주소</th>
                <td>{d.receiver.address}</td>
              </tr>
              <tr>
                <th scope="row">입고 문의</th>
                <td className="mono">{d.receiver.tel}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <table className={styles.lines}>
          <caption className="sr-only">상차 품목</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">품목코드 · 품목명</th>
              {ordered && (
                <th scope="col" className={styles.num}>
                  지시수량
                </th>
              )}
              <th scope="col" className={styles.num}>
                상차수량
              </th>
              {ordered && <th scope="col">비교</th>}
              <th scope="col" className={styles.write}>
                검수 확인
              </th>
            </tr>
          </thead>
          <tbody>
            {loaded.map((l, i) => (
              <tr key={l.itemId}>
                <td className="mono">{i + 1}</td>
                <td>
                  <span className="mono">{l.itemCode}</span>
                  <br />
                  {l.itemName}
                </td>
                {ordered && <td className={`${styles.num} mono`}>{l.orderBase ? qtyInUnit(l.orderBase, l.showUnit, l.showFactor, l.baseUnit) : "–"}</td>}
                <td className={`${styles.num} mono`}>
                  <b>{qtyInUnit(l.loadBase, l.showUnit, l.showFactor, l.baseUnit)}</b>
                  {l.showUnit !== l.baseUnit && <span className={styles.dim}> ({l.loadBase.toLocaleString()} {l.baseUnit})</span>}
                </td>
                {ordered && <td>{LINE_STATE_LABEL[l.state]}</td>}
                <td className={styles.write} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={ordered ? 5 : 3}>합계 · {loaded.filter((l) => l.loadBase > 0).length}개 품목 실음</td>
              <td className={styles.write} />
            </tr>
          </tfoot>
        </table>

        {d.diffReasonName && (
          <p className={styles.memo}>
            <b>차이 사유</b> {d.diffReasonName}
            {d.diffReasonText ? ` — ${d.diffReasonText}` : ""}
          </p>
        )}

        <ul className={styles.notes}>
          <li>이 확인서는 실제로 실은 수량을 적은 거래명세서입니다. 차량에 함께 보내 주세요.</li>
          <li>입고검수자는 위 바코드를 스캔해 이 차량의 검수를 시작합니다. 실물과 다른 수량은 입고검수에서 처리합니다.</li>
        </ul>

        <footer className={styles.foot}>
          <span>
            상차완료 {fmtDateTime(d.completedAt)} · {d.completedBy} · 작업자 {d.workers.map((w) => w.name).join(", ")} · {d.clientName}
          </span>
          <span className={styles.sign}>
            상차담당 <i />
          </span>
          <span className={styles.sign}>
            기사 <i />
          </span>
          <span className={styles.sign}>
            입고 확인 <i />
          </span>
        </footer>
      </article>
    </div>
  );
}
