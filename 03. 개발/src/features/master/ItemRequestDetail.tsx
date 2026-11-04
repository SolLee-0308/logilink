"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Tag } from "@/components/ui/Badges";
import { Button, LinkButton } from "@/components/ui/Button";
import { FormCheck, FormField, Input, Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { useUnsavedChanges } from "@/components/ui/UnsavedGuard";
import {
  ITEM_REQUEST_ACTION_LABEL,
  ITEM_REQUEST_STATUS_META,
  ITEM_UNITS,
  SOURCE_LABEL,
  STORAGE_TEMP_LABEL,
  STORAGE_TEMPS,
  normalizeAlias,
  type ItemUnit,
  type StorageTemp,
} from "@/domain/master";
import { fmtDateTime } from "@/lib/format";
import { registerItemRequest, rejectItemRequest } from "@/server/master/actions";
import { RejectModal } from "@/features/shared/RejectModal";
import { ItemRequestForm } from "./ItemRequestForm";
import { REQ_LIST_KEY, reqListUrl } from "./item-request-list";
import { findDuplicates } from "./ItemRequestsScreen";
import { FormSection, Full, ViewSection } from "./record";
import { RULES } from "./rules";
import { SubHeader, useAction } from "./shared";
import type { CodeOption, ItemKey, ItemRequestQueue, ItemRequestRow } from "./types";
import styles from "./ItemRequestDetail.module.css";

const tri = (v: boolean | null) => (v === null ? "모름 (3PL이 정함)" : v ? "관리" : "관리 안 함");

function historyEntries(row: ItemRequestRow): TimelineEntry[] {
  return row.histories.map((h) => ({
    key: String(h.id),
    tone: h.action === "REJECT" ? "reject" : h.action === "REGISTER" ? "ok" : "save",
    title: (
      <span>
        {h.actor} · {ITEM_REQUEST_ACTION_LABEL[h.action]}
        {h.reasonName ? ` · ${h.reasonName}` : ""}
      </span>
    ),
    detail: h.memo ?? undefined,
    quote: h.reasonText ?? undefined,
    at: fmtDateTime(h.at),
  }));
}

/**
 * 품목 등록 요청 상세 (/master/item-requests/[id])
 * - 왼쪽: 화주사가 보낸 요청 내용 + 처리 이력
 * - 오른쪽: 3PL 등록대기 → 등록할 품목 입력 + [반려]·[등록] / 그 밖에는 처리 결과
 * - 3PL은 처리하면 같은 화주사의 다음 등록대기 요청이 열린다 (엑셀로 들어온 여러 건을 이어서 검토)
 */
export function ItemRequestDetailScreen({
  row,
  queue,
  itemKeys,
  reasons,
  canReview,
  clientName,
  editing = false,
}: {
  row: ItemRequestRow;
  queue: ItemRequestQueue;
  itemKeys: ItemKey[];
  reasons: CodeOption[];
  canReview: boolean;
  clientName: string;
  /** 화주사: 반려된 요청을 고쳐 다시 보내는 중 (/edit) */
  editing?: boolean;
}) {
  const router = useRouter();
  const waiting = row.status === "WAITING" && canReview;
  const meta = ITEM_REQUEST_STATUS_META[row.status];

  if (editing) {
    return (
      <>
        <SubHeader section="품목 등록 요청" title={`재요청 · ${row.requestNo}`} backHref="/master/item-requests" storageKey={REQ_LIST_KEY} rules={RULES.itemRequests} />
        <ItemRequestForm
          clientName={clientName}
          row={row}
          onCancel={() => router.push(`/master/item-requests/${row.id}`)}
          onSaved={() => router.push(reqListUrl("wait"))}
        />
      </>
    );
  }

  return (
    <>
      <SubHeader
        section="품목 등록 요청"
        title={row.requestNo}
        backHref="/master/item-requests"
        storageKey={REQ_LIST_KEY}
        rules={RULES.itemRequests}
        actions={
          waiting && queue.position !== null ? (
            <div className={styles.queue}>
              <span className="muted">
                {row.clientName} 등록대기{" "}
                <strong className="mono">
                  {queue.position} / {queue.total}
                </strong>
              </span>
              <QueueLink id={queue.prevId} label="‹ 이전 요청" />
              <QueueLink id={queue.nextId} label="다음 요청 ›" />
            </div>
          ) : undefined
        }
      />

      <div className={styles.status}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {row.resubmitCount > 0 && <Tag tone="accent">재요청 {row.resubmitCount}회</Tag>}
        <span className="muted">
          {row.clientName} · {SOURCE_LABEL[row.source]} · {fmtDateTime(row.requestedAt)} {row.requestedBy}
        </span>
      </div>

      <div className={styles.layout}>
        <div className={styles.col}>
          <section className={styles.card} aria-label="요청 내용">
            <div className={styles.cardHead}>
              <h2>요청 내용</h2>
              <p className="muted">화주사가 보낸 값입니다.</p>
            </div>
            <div className={styles.cardBody}>
              <ViewSection
                title="요청 품목"
                items={[
                  ["품목코드", <span key="c" className="mono">{row.itemCode}</span>],
                  ["품목명", row.itemName],
                  ["단위", <span key="u" className="mono">{row.unit}</span>],
                  ["바코드", <span key="b" className="mono">{row.barcode}</span>],
                ]}
              />
              <ViewSection
                title="보관·관리"
                items={[
                  ["보관 온도대", row.storageTemp ? STORAGE_TEMP_LABEL[row.storageTemp] : "모름 (3PL이 정함)"],
                  ["유통기한 관리", tri(row.expiryManaged)],
                  ["로트 관리", tri(row.lotManaged)],
                ]}
              />
              <ViewSection
                title="요청 정보"
                items={[
                  ["요청번호", <span key="n" className="mono">{row.requestNo}</span>],
                  ["화주사", row.clientName],
                  ["원본", SOURCE_LABEL[row.source]],
                  ["요청", `${fmtDateTime(row.requestedAt)} · ${row.requestedBy}`],
                  ["처리", row.processedAt ? `${fmtDateTime(row.processedAt)} · ${row.processedBy}` : null],
                  [row.source === "DIRECT" || row.source === "ITEM_EXCEL" ? "메모" : "원본 내용", row.sourceNote ? <span className="note-quote">{row.sourceNote}</span> : null, { full: true }],
                ]}
              />
            </div>
          </section>
          <section className={styles.card} aria-label="처리 이력">
            <div className={styles.cardHead}>
              <h2>처리 이력</h2>
            </div>
            <div className={styles.cardBody}>
              <Timeline entries={historyEntries(row)} />
            </div>
          </section>
        </div>

        <div className={styles.col}>
          {waiting ? (
            <ReviewCard row={row} queue={queue} itemKeys={itemKeys} reasons={reasons} />
          ) : (
            <ResultCard row={row} canReview={canReview} />
          )}
        </div>
      </div>
    </>
  );
}

function QueueLink({ id, label }: { id: number | null; label: string }) {
  return id ? (
    <LinkButton size="sm" href={`/master/item-requests/${id}`}>
      {label}
    </LinkButton>
  ) : (
    <Button size="sm" disabled>
      {label}
    </Button>
  );
}

/** 등록대기가 아닐 때(또는 화주사) — 처리 결과와 다음 할 일 */
function ResultCard({ row, canReview }: { row: ItemRequestRow; canReview: boolean }) {
  return (
    <section className={styles.card} aria-label="처리 결과">
      <div className={styles.cardHead}>
        <h2>처리 결과</h2>
      </div>
      <div className={styles.cardBody}>
        {row.status === "WAITING" && <NoteBox tone="info">3PL이 검토하고 있습니다. 등록되면 품목 조회에서 볼 수 있습니다.</NoteBox>}
        {row.status === "REJECTED" && (
          <>
            <NoteBox tone="warn">
              반려 사유: <strong>{row.rejectReasonName}</strong>
              {row.rejectReasonText ? ` · ${row.rejectReasonText}` : ""}
              <br />
              {canReview ? "화주사가 수정해 다시 요청하면 등록대기로 돌아옵니다." : "내용을 고쳐 [수정해서 다시 요청]을 누르면 3PL이 다시 검토합니다."}
            </NoteBox>
            {!canReview && (
              <div>
                <LinkButton variant="primary" href={`/master/item-requests/${row.id}/edit`}>
                  수정해서 다시 요청
                </LinkButton>
              </div>
            )}
          </>
        )}
        {row.status === "REGISTERED" && (
          <ViewSection
            title="등록된 품목"
            items={[
              [
                "품목코드",
                row.registeredItemId ? (
                  <Link key="i" className="mono" href={`/master/items?item=${row.registeredItemId}`}>
                    {row.registeredItemCode}
                  </Link>
                ) : (
                  row.registeredItemCode
                ),
              ],
              ["등록", row.processedAt ? `${fmtDateTime(row.processedAt)} · ${row.processedBy}` : null],
            ]}
          />
        )}
      </div>
    </section>
  );
}

/** 3PL 등록대기 — 요청값을 확인·수정해 등록하거나 반려 */
function ReviewCard({ row, queue, itemKeys, reasons }: { row: ItemRequestRow; queue: ItemRequestQueue; itemKeys: ItemKey[]; reasons: CodeOption[] }) {
  const router = useRouter();
  const act = useAction();
  const [code, setCode] = useState(row.itemCode);
  const [name, setName] = useState(row.itemName);
  const [unit, setUnit] = useState<ItemUnit>(row.unit);
  const [barcode, setBarcode] = useState(row.barcode);
  const [storageTemp, setStorageTemp] = useState<StorageTemp | "">(row.storageTemp ?? "");
  const [expiryManaged, setExpiryManaged] = useState(row.expiryManaged ?? false);
  const [lotManaged, setLotManaged] = useState(row.lotManaged ?? false);
  const [keepAlias, setKeepAlias] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  /** 처리 시점 version 충돌·이미 처리됨 — 승인 대기와 같은 안내 + [변경 내용 불러오기] */
  const [conflict, setConflict] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dup = findDuplicates(itemKeys, row.clientId, code, barcode);
  const hasDup = !!(dup.code || dup.barcode);
  const edited = code !== row.itemCode || name !== row.itemName || unit !== row.unit || barcode !== row.barcode;
  const orig = (v: string, now: string) => (v !== now ? `요청값: ${v}` : undefined);
  const nameChanged = normalizeAlias(name) !== normalizeAlias(row.itemName);
  const fromShipper = "화주사 입력값";
  useUnsavedChanges(edited && !done);

  /** 처리 후: 같은 화주사의 다음 등록대기 요청, 없으면 목록 */
  function goNext() {
    setDone(true);
    router.push(queue.afterId ? `/master/item-requests/${queue.afterId}` : reqListUrl());
  }

  function register(e: React.FormEvent) {
    e.preventDefault();
    act.run(
      async () => {
        const r = await registerItemRequest({
          id: row.id,
          version: row.version,
          itemCode: code,
          itemName: name,
          unit,
          barcode,
          storageTemp: storageTemp as StorageTemp,
          expiryManaged,
          lotManaged,
          keepRequestNameAsAlias: keepAlias,
        });
        if (!r.ok && (r.code === "CONFLICT" || r.code === "STATE")) {
          setConflict(r.error);
          return { ...r, code: "STATE" as const };
        }
        return r;
      },
      () => goNext(),
    );
  }

  // 반려 모달은 폼 밖에 둔다 — 모달 안 제출이 React 트리를 따라 등록 폼으로 올라가지 않게
  return (
    <>
    <form className={styles.card} aria-label="등록할 품목" noValidate onSubmit={register}>
      <div className={styles.cardHead}>
        <h2>
          등록할 품목 {edited && <Tag tone="accent">요청값 수정함</Tag>}
        </h2>
        <p className="muted">요청값을 확인하고 필요하면 고쳐 등록합니다. 처리하면 {queue.afterId ? "다음 등록대기 요청이 열립니다." : "목록으로 돌아갑니다."}</p>
      </div>
      <div className={styles.cardBody}>
        {conflict && (
          <NoteBox
            tone="error"
            action={
              <Button size="sm" onClick={() => router.refresh()}>
                변경 내용 불러오기
              </Button>
            }
          >
            <strong>{conflict}</strong>
          </NoteBox>
        )}
        {act.error && !conflict && <NoteBox tone="error">{act.error}</NoteBox>}
        {hasDup && (
          <NoteBox tone="warn">
            <strong>이미 등록된 품목과 겹칩니다.</strong>
            {dup.code && <> 품목코드는 {dup.code.code} {dup.code.name}이(가) 쓰고 있습니다.</>}
            {dup.barcode && <> 바코드는 {dup.barcode.code} {dup.barcode.name}이(가) 쓰고 있습니다.</>} 값을 고치거나 반려하세요.
          </NoteBox>
        )}
        <FormSection title="기본 정보">
          <FormField label="품목코드" htmlFor="r-code" required hint={orig(row.itemCode, code)} error={act.fieldErrors.itemCode ?? (dup.code ? "이미 등록된 품목코드입니다." : undefined)}>
            <Input id="r-code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" />
          </FormField>
          <FormField label="단위" htmlFor="r-unit" required hint={orig(row.unit, unit)} error={act.fieldErrors.unit}>
            <Select id="r-unit" value={unit} onChange={(e) => setUnit(e.target.value as ItemUnit)}>
              {ITEM_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </FormField>
          <Full>
            <FormField label="품목명" htmlFor="r-name" required hint={orig(row.itemName, name)} error={act.fieldErrors.itemName}>
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </FormField>
          </Full>
          <FormField
            label="바코드"
            htmlFor="r-barcode"
            required
            hint={orig(row.barcode, barcode) ?? "숫자 8~14자리"}
            error={act.fieldErrors.barcode ?? (dup.barcode ? "같은 화주사의 다른 품목이 쓰는 바코드입니다." : undefined)}
          >
            <Input id="r-barcode" className="mono" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ""))} maxLength={14} autoComplete="off" />
          </FormField>
        </FormSection>
        <FormSection title="보관·관리">
          <FormField label="보관 온도대" htmlFor="r-temp" required hint={row.storageTemp ? fromShipper : "화주사가 보내지 않아 직접 정합니다."} error={act.fieldErrors.storageTemp}>
            <Select id="r-temp" value={storageTemp} onChange={(e) => setStorageTemp(e.target.value as StorageTemp)}>
              <option value="">온도대를 선택하세요</option>
              {STORAGE_TEMPS.map((t) => (
                <option key={t} value={t}>
                  {STORAGE_TEMP_LABEL[t]}
                </option>
              ))}
            </Select>
          </FormField>
          <div className={styles.checks}>
            <FormCheck id="r-expiry" label="유통기한 관리" checked={expiryManaged} onChange={setExpiryManaged} hint={row.expiryManaged !== null ? fromShipper : undefined} />
            <FormCheck id="r-lot" label="로트 관리" checked={lotManaged} onChange={setLotManaged} hint={row.lotManaged !== null ? fromShipper : undefined} />
          </div>
          {nameChanged && (
            <Full>
              <FormCheck
                id="r-alias"
                label={`요청 품목명 '${row.itemName}'을(를) 별칭으로 등록`}
                checked={keepAlias}
                onChange={setKeepAlias}
                hint="다음 AI 판독·엑셀에서 같은 표기가 오면 이 품목으로 자동 매칭합니다."
              />
            </Full>
          )}
        </FormSection>
        <p className="muted">BOX·PLT 입수와 추가 바코드는 등록한 뒤 품목 관리에서 보완합니다.</p>
      </div>
      <div className={styles.cardFoot}>
        <Button variant="danger" onClick={() => setRejecting(true)} disabled={act.pending || !!conflict}>
          반려
        </Button>
        <Button type="submit" variant="primary" disabled={act.pending || hasDup || !!conflict}>
          {act.pending ? "처리 중…" : edited ? "수정해서 등록" : "등록"}
        </Button>
      </div>
    </form>

      <RejectModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="품목 등록 요청 반려"
        description="반려하면 화주사가 사유를 확인하고 수정해 다시 요청할 수 있습니다."
        target={
          <span>
            <span className="mono">{row.requestNo}</span> · {row.clientName} · {row.itemName}
          </span>
        }
        reasons={reasons}
        onSubmit={async (reasonCode, reasonText) => {
          const r = await rejectItemRequest({ id: row.id, version: row.version, reasonCode, reasonText });
          if (r.ok) act.run(async () => r, () => goNext());
          else if (r.code === "CONFLICT" || r.code === "STATE") {
            setConflict(r.error);
            setRejecting(false);
            return { ok: true, message: "" };
          }
          return r;
        }}
      />
    </>
  );
}
