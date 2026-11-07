"use client";

import { useEffect } from "react";
import { Barcode } from "@/components/ui/Barcode";
import { fmtDateTime } from "@/lib/format";
import type { LoadOrderPrint } from "./types";
import styles from "./LoadOrderSheet.module.css";

/**
 * 상차지시서 (A4 세로) — ASN 저장과 함께 발행 (정의서 ③).
 * 상차담당은 PDA로 지시서 바코드를 스캔해 상차를 시작하고, 종이에는 실제 실은 수량을 적어 둘 수 있다.
 * 열리면 바로 인쇄 창을 띄운다 (?auto=0이면 띄우지 않음).
 */
export function LoadOrderSheet({ data: d, auto }: { data: LoadOrderPrint; auto: boolean }) {
  const canceled = d.status === "CANCELED";
  useEffect(() => {
    if (!auto || canceled) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto, canceled]);
  const orderNo = d.loadOrder?.orderNo ?? d.asnNo;
  const total = d.qtyByUnit.map(([u, q]) => `${u} ${q.toLocaleString()}`).join(" · ");

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span>
          상차지시서 <b className="mono">{orderNo}</b> · A4 세로로 인쇄하세요.
        </span>
        <button type="button" className={styles.printBtn} onClick={() => window.print()} disabled={canceled}>
          인쇄
        </button>
        <button type="button" className={styles.closeBtn} onClick={() => window.close()}>
          닫기
        </button>
      </div>

      <article className={styles.sheet} aria-label={`상차지시서 ${orderNo}`}>
        {canceled && (
          <div className={styles.void} role="alert">
            취소된 상차지시서입니다. 상차에 쓰지 마세요.
          </div>
        )}
        <header className={styles.head}>
          <div>
            <h1>상차지시서</h1>
            <p className={styles.sub}>
              ASN <span className="mono">{d.asnNo}</span> · 출고일 <span className="mono">{d.shipDate}</span>
            </p>
          </div>
          <div className={styles.code}>
            <Barcode value={orderNo} height={52} module={1.6} />
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
                  {d.driverName ?? "–"}
                  {d.driverTel ? <span className="mono"> · {d.driverTel}</span> : ""}
                </td>
              </tr>
              <tr>
                <th scope="row">출고일</th>
                <td className="mono">{d.shipDate}</td>
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
              <th scope="col">입고예정번호</th>
              <th scope="col">품목코드 · 품목명</th>
              <th scope="col">품목 바코드</th>
              <th scope="col">소비기한 · 로트</th>
              <th scope="col">단위</th>
              <th scope="col" className={styles.num}>
                지시수량
              </th>
              <th scope="col" className={styles.write}>
                상차수량
              </th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="mono">{l.lineNo}</td>
                <td className="mono">{l.planNo}</td>
                <td>
                  <span className="mono">{l.itemCode}</span>
                  <br />
                  {l.itemName}
                </td>
                <td className="mono">{l.barcode ?? "–"}</td>
                <td className="mono">{[l.expiryDate, l.lotNo].filter(Boolean).join(" · ") || "–"}</td>
                <td className="mono">{l.unit}</td>
                <td className={`${styles.num} mono`}>{l.qty.toLocaleString()}</td>
                <td className={styles.write} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>합계 · {d.lineCount}줄</td>
              <td className={`${styles.num} mono`}>{total}</td>
              <td className={styles.write} />
            </tr>
          </tfoot>
        </table>

        {d.memo && (
          <p className={styles.memo}>
            <b>메모</b> {d.memo}
          </p>
        )}

        <ul className={styles.notes}>
          <li>상차담당은 PDA에서 위 바코드를 스캔해 상차를 시작합니다. 여러 사람이 함께 실어도 됩니다.</li>
          <li>그날 이 화주사 ASN에 없는 품목은 실을 수 없습니다. 지시수량과 다르게 실으면 상차완료 때 사유를 고릅니다.</li>
          <li>상차를 마치면 PDA에서 상차완료를 누르고, 발행되는 상차확인서를 차량에 실어 보냅니다.</li>
        </ul>

        <footer className={styles.foot}>
          <span>
            발행 {d.loadOrder ? `${fmtDateTime(d.loadOrder.issuedAt)} · ${d.loadOrder.issuedBy}` : "–"} · {d.clientName}
          </span>
          <span className={styles.sign}>
            상차담당 <i />
          </span>
          <span className={styles.sign}>
            기사 <i />
          </span>
        </footer>
      </article>
    </div>
  );
}
