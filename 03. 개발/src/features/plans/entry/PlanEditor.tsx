"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/FilterBar";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { revealError, useToast } from "@/components/ui/Toast";
import { useUnsavedChanges, useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import type { ItemUnit } from "@/domain/master";
import {
  MATCHED_BY_LABEL,
  minExpiryDate,
  PLAN_MAX_LINES,
  duplicateLines,
  lineErrors,
  parseQty,
  type CatalogItem,
  type DraftLine,
  type MatchedBy,
} from "@/domain/plan-entry";
import { dday, ddayLabel } from "@/domain/plan-rules";
import type { PlanInputMethod } from "@/domain/plan-status";
import { savePlan } from "@/server/plans/actions";
import { Card } from "@/components/ui/Card";
import { ItemFinderModal } from "./ItemFinderModal";
import { ItemRequestModal } from "./ItemRequestModal";
import type { EntryOptions } from "../types";
import styles from "./PlanEditor.module.css";

/** 편집기 한 줄 — 입력 중인 값은 문자열로 들고 있다가 저장할 때 바꾼다 */
export interface EditorLine {
  key: string;
  /** 엑셀·판독에서 온 줄: "엑셀 3행" */
  origin: string | null;
  text: string | null;
  itemId: number | null;
  matchedBy: MatchedBy | null;
  candidates: number[];
  unit: ItemUnit | null;
  qty: string;
  expiryDate: string;
  lotNo: string;
  /** 원문 값 문제 (엑셀·판독) */
  issues: string[];
  lowConfidence: boolean;
  confirmed: boolean;
  /** 이 줄에서 보낸 품목 등록 요청 번호 */
  requestNo: string | null;
}

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export const blankLine = (): EditorLine => ({
  key: newKey(), origin: null, text: null, itemId: null, matchedBy: null, candidates: [], unit: null,
  qty: "", expiryDate: "", lotNo: "", issues: [], lowConfidence: false, confirmed: false, requestNo: null,
});

export const fromDraft = (d: DraftLine): EditorLine => ({
  key: newKey(), origin: d.origin, text: d.text, itemId: d.itemId, matchedBy: d.matchedBy, candidates: d.candidates, unit: d.unit,
  qty: d.qty ? String(d.qty) : "", expiryDate: d.expiryDate ?? "", lotNo: d.lotNo ?? "", issues: d.issues,
  lowConfidence: d.lowConfidence, confirmed: false, requestNo: null,
});

export const fromSaved = (l: { itemId: number; unit: ItemUnit; qty: number; expiryDate: string | null; lotNo: string | null }): EditorLine => ({
  ...blankLine(), itemId: l.itemId, unit: l.unit, qty: String(l.qty), expiryDate: l.expiryDate ?? "", lotNo: l.lotNo ?? "",
});

type FieldKey = "itemId" | "unit" | "qty" | "expiryDate" | "lotNo";

/**
 * 입고예정 편집기 — 기본 정보(센터·입고예정일·메모) + 품목 줄.
 * 직접 입력·엑셀·AI 판독·수정이 모두 이 화면을 쓴다. 저장 규칙은 서버(service.savePlan)가 다시 검사한다.
 */
export function PlanEditor({
  options,
  method,
  plan,
  initial,
  aiReadId,
  submitLabel,
  onCancel,
  onSaved,
  side,
  extraItems,
}: {
  options: EntryOptions;
  method: PlanInputMethod;
  /** 수정·재요청 */
  plan?: { id: number; version: number; planNo: string; status: string };
  initial: { centerId: string; planDate: string; memo: string; lines: EditorLine[] };
  aiReadId?: number;
  submitLabel: string;
  onCancel: () => void;
  onSaved: (id: number) => void;
  /** 품목 표 옆(넓은 화면)·위(좁은 화면)에 둘 내용 — AI 판독 원본 이미지 */
  side?: React.ReactNode;
  /** 초안 라인이 가리키는 품목 (엑셀·판독 매칭·후보) */
  extraItems?: CatalogItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const guard = useUnsavedGuard();
  const [centerId, setCenterId] = useState(initial.centerId || options.defaultCenterId);
  const [planDate, setPlanDate] = useState(initial.planDate);
  /** 소비기한 하한 — 입고예정일(없으면 오늘) + 최소 잔여일수 */
  const minExpiry = { date: minExpiryDate(planDate || options.today, options.minExpiryDays), days: options.minExpiryDays };
  const [memo, setMemo] = useState(initial.memo);
  // 처음 줄의 key는 서버·브라우저 렌더가 같도록 순번으로 (새로 추가하는 줄만 임의 key)
  const [lines, setLines] = useState<EditorLine[]>(() => (initial.lines.length ? initial.lines : [blankLine()]).map((l, i) => ({ ...l, key: `i${i}` })));
  const [showAll, setShowAll] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState<"all" | "issues">("all");
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [requestFor, setRequestFor] = useState<EditorLine | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** 품목 찾기 창 (입력한 검색어로 연다) */
  const [finder, setFinder] = useState<{ q: string; lineKey: string | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const tableRef = useRef<HTMLDivElement>(null);
  // 등록 화면은 탭마다 편집기를 띄워 두므로 id가 겹치지 않게 등록 방식을 붙인다 (p-direct-center 등)
  const pid = `p-${method.toLowerCase().replace("_image", "")}`;

  // 품목은 화면에 전체를 들고 있지 않고, 줄에 넣거나 찾은 품목만 기억한다 (품목이 수천 개여도 가볍게)
  const [itemMap, setItemMap] = useState(() => new Map([...options.items, ...(extraItems ?? [])].map((i) => [i.id, i])));
  const remember = (items: CatalogItem[]) =>
    setItemMap((m) => {
      if (items.every((i) => m.has(i.id))) return m;
      const n = new Map(m);
      items.forEach((i) => n.set(i.id, i));
      return n;
    });
  // 처음 그린 상태와 비교. 엑셀·판독으로 채운 새 초안은 아직 저장하지 않았으므로 처음부터 "저장 안 한 변경"
  const initialSnapshot = useRef(JSON.stringify({ centerId, planDate, memo, lines }));
  const dirty = JSON.stringify({ centerId, planDate, memo, lines }) !== initialSnapshot.current || (!plan && initial.lines.length > 0);
  useUnsavedChanges(dirty && !saved);

  /* ───── 검사 ───── */
  const values = lines.map((l) => ({
    itemId: l.itemId,
    unit: l.unit,
    qty: parseQty(l.qty),
    expiryDate: l.expiryDate || null,
    lotNo: l.lotNo || null,
    lowConfidence: l.lowConfidence,
    confirmed: l.confirmed,
  }));
  const dups = duplicateLines(values, itemMap);
  const errorsOf = (i: number): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = { ...lineErrors(values[i], values[i].itemId ? itemMap.get(values[i].itemId!) : undefined, minExpiry) };
    if (lines[i].qty.trim() && values[i].qty === null) e.qty = "수량은 1 이상의 정수로 입력하세요.";
    if (dups.has(i)) e.itemId ??= "같은 품목·단위·소비기한·로트 줄이 있습니다. 한 줄로 합치세요.";
    for (const k of ["itemId", "unit", "qty", "expiryDate", "lotNo"] as const) {
      const s = serverErrors[`lines.${i}.${k}`];
      if (s) e[k] ??= s;
    }
    return e;
  };
  const lineErrs = lines.map((_, i) => errorsOf(i));
  const hasErr = (i: number) => Object.keys(lineErrs[i]).length > 0;
  // 엑셀·판독 줄은 처음부터, 직접 입력 줄은 저장을 한 번 누른 뒤부터 오류를 보여 준다
  const visible = (i: number) => showAll || !!lines[i].origin;
  const issueCount = lines.filter((_, i) => hasErr(i)).length;
  const today = options.today;
  const holiday = options.holidays.find((h) => String(h.centerId) === centerId && h.date === planDate);
  const centerName = options.centers.find((c) => String(c.id) === centerId)?.name ?? "";
  const headerErrors = {
    centerId: !centerId ? "센터를 선택하세요." : serverErrors.centerId,
    planDate: !planDate ? "입고예정일을 선택하세요." : planDate < today ? "입고예정일은 오늘 이후로 선택하세요." : serverErrors.planDate,
    memo: serverErrors.memo,
  };

  /* ───── 줄 바꾸기 ───── */
  function update(key: string, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setServerErrors({});
  }

  /** 품목에 맞는 기본 단위 — 바코드로 찾았으면 그 단위, 단위가 하나면 그것, 아니면 기준 단위 */
  const defaultUnit = (it: CatalogItem, prefer?: ItemUnit | null) =>
    prefer && it.uoms.some((u) => u.unit === prefer)
      ? prefer
      : it.uoms.length === 1
        ? it.uoms[0].unit
        : it.uoms.some((u) => u.unit === it.baseUnit)
          ? it.baseUnit
          : (it.uoms[0]?.unit ?? null);

  function setItem(line: EditorLine, it: CatalogItem, unitFromBarcode?: ItemUnit | null) {
    remember([it]);
    const keep = !unitFromBarcode && line.unit && it.uoms.some((u) => u.unit === line.unit);
    const unit = keep ? line.unit : defaultUnit(it, unitFromBarcode);
    update(line.key, { itemId: it.id, unit, candidates: [], matchedBy: line.origin ? line.matchedBy : null, expiryDate: it.expiryManaged ? line.expiryDate : "", lotNo: it.lotManaged ? line.lotNo : "" });
  }

  /** 품목 찾기 창에서 고른 품목들 → 줄. 찾기 창을 연 줄이 비어 있으면 그 줄부터 채운다 */
  function addFromFinder(items: CatalogItem[]) {
    remember(items);
    const isBlank = (l: EditorLine) => !l.itemId && !l.origin && !l.qty;
    setLines((ls) => {
      const next = [...ls];
      const queue = [...items];
      const target = finder?.lineKey ? next.findIndex((l) => l.key === finder.lineKey && !l.itemId) : -1;
      const fill = (idx: number, it: CatalogItem) => {
        next[idx] = { ...next[idx], itemId: it.id, unit: defaultUnit(it), candidates: [], expiryDate: "", lotNo: "" };
      };
      if (target >= 0 && queue.length) fill(target, queue.shift()!);
      for (const it of queue) {
        const blank = next.findIndex(isBlank);
        if (blank >= 0) fill(blank, it);
        else next.push({ ...blankLine(), itemId: it.id, unit: defaultUnit(it) });
      }
      if (next.length > PLAN_MAX_LINES) {
        toast.show(`한 입고예정에 ${PLAN_MAX_LINES}줄까지 넣을 수 있습니다.`);
        return next.slice(0, PLAN_MAX_LINES);
      }
      return next;
    });
    toast.show(`${items.length}개 품목을 넣었습니다. 수량을 입력하세요.`);
    setFinder(null);
  }

  function addLine() {
    if (lines.length >= PLAN_MAX_LINES) return toast.show(`한 입고예정에 ${PLAN_MAX_LINES}줄까지 넣을 수 있습니다.`);
    const l = blankLine();
    setLines((ls) => [...ls, l]);
    setFocusKey(l.key);
  }

  function removeLine(key: string) {
    setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((l) => l.key !== key)));
    setServerErrors({});
  }

  /* ───── 저장 ───── */
  function submit() {
    setShowAll(true);
    setFormError(null);
    const bad = lines.findIndex((_, i) => hasErr(i));
    if (headerErrors.centerId || headerErrors.planDate || bad >= 0) {
      toast.show(bad >= 0 ? `확인 필요 ${issueCount}줄을 고친 뒤 저장하세요.` : "입력 내용을 확인하세요.", { tone: "error" });
      revealError();
      return;
    }
    start(async () => {
      const r = await savePlan(
        {
          id: plan?.id,
          version: plan?.version,
          centerId: Number(centerId),
          planDate,
          inputMethod: method,
          memo,
          lines: lines.map((l, i) => ({
            itemId: l.itemId!,
            unit: l.unit!,
            qty: values[i].qty!,
            expiryDate: l.expiryDate || null,
            lotNo: l.lotNo.trim() || null,
          })),
        },
        aiReadId,
      );
      if (r.ok) {
        setSaved(true);
        toast.show(r.message);
        onSaved(r.data!.id);
        return;
      }
      if (r.code === "CONFLICT" || r.code === "STATE") {
        setConflict(r.error);
        toast.show(r.error, { tone: "error" });
        revealError();
        return;
      }
      setServerErrors(r.fieldErrors ?? {});
      setFormError(r.fieldErrors ? null : r.error);
      // 실패는 붉은 알림 + 오류 칸·오류 상자로 이동 (2026-11-07 Sol 확정)
      toast.show(r.error, { tone: "error" });
      revealError();
    });
  }

  async function cancel() {
    if (dirty && !saved && !(await guard.confirmLeave())) return;
    onCancel();
  }

  /* ───── 합계 ───── */
  const totals = new Map<string, number>();
  lines.forEach((l, i) => l.unit && values[i].qty && totals.set(l.unit, (totals.get(l.unit) ?? 0) + values[i].qty!));
  const imported = lines.some((l) => l.origin);
  const shownLines = lines.map((l, i) => ({ l, i })).filter(({ i }) => onlyIssues === "all" || hasErr(i));

  return (
    <div className={styles.editor}>
      {conflict && (
        <NoteBox
          tone="error"
          action={
            <Button size="sm" onClick={() => router.refresh()}>
              최신 내용 불러오기
            </Button>
          }
        >
          <strong>{conflict}</strong> 지금 입력한 내용은 저장되지 않았습니다.
        </NoteBox>
      )}
      {formError && <NoteBox tone="error">{formError}</NoteBox>}

      <Card step={1} stepState={centerId && planDate ? "done" : "current"} title="기본 정보" description="센터 1곳·입고예정일 하루가 입고예정 1건입니다.">
        <div className={styles.headGrid}>
          {options.centers.length === 1 ? (
            <FormField label="센터" htmlFor={`${pid}-center`} required>
              <span id={`${pid}-center`} className={styles.static}>
                {options.centers[0].name}
              </span>
            </FormField>
          ) : (
            <FormField label="센터" htmlFor={`${pid}-center`} required error={showAll ? headerErrors.centerId : serverErrors.centerId}>
              <Select id={`${pid}-center`} value={centerId} onChange={(e) => setCenterId(e.target.value)} aria-invalid={showAll && !!headerErrors.centerId}>
                <option value="">센터를 선택하세요</option>
                {options.centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField
            label="입고예정일"
            htmlFor={`${pid}-date`}
            required
            error={showAll || (planDate && planDate < today) ? headerErrors.planDate : undefined}
            hint={planDate ? ddayLabel(dday(planDate, today)) : "오늘 이후 날짜"}
          >
            <Input id={`${pid}-date`} type="date" min={today} value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </FormField>
          <div className={styles.memo}>
            <FormField label="메모" htmlFor={`${pid}-memo`} hint="3PL에 전달할 내용 (500자 이내)" error={headerErrors.memo}>
              <Textarea id={`${pid}-memo`} rows={2} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
            </FormField>
          </div>
        </div>
        {holiday && (
          <NoteBox tone="warn">
            {planDate}은(는) {centerName} 휴무일({holiday.name})입니다. 입고할 수 있는지 센터와 확인하세요.
          </NoteBox>
        )}
        {options.centers.length === 0 && <NoteBox tone="error">이용 중인 센터가 없습니다. 3PL에 센터 연결을 요청하세요.</NoteBox>}
      </Card>

      <Card
        step={2}
        stepState={lines.some((l) => l.itemId) && issueCount === 0 ? "done" : "current"}
        title="품목"
        count={lines.length}
        description="품목은 [품목 찾기] 창에서만 고릅니다. 여러 품목은 체크해 한 번에 넣고, 줄의 품목 칸을 누르면 그 줄 품목을 고르거나 바꿉니다."
        aside={
          <>
            {imported && (
              <ChipGroup
                value={onlyIssues}
                onChange={setOnlyIssues}
                options={[
                  { value: "all", label: `전체 ${lines.length}` },
                  { value: "issues", label: `확인 필요 ${issueCount}` },
                ]}
              />
            )}
            <Button size="sm" variant="primary" onClick={() => setFinder({ q: "", lineKey: null })}>
              품목 찾기
            </Button>
            <Button size="sm" onClick={addLine}>
              + 빈 줄
            </Button>
          </>
        }
      >
        <div className={side ? styles.withSide : undefined}>
          {side && <div className={styles.side}>{side}</div>}
          <div className={styles.main}>
        {imported && issueCount > 0 && (
          <NoteBox tone="warn">
            <strong>확인 필요 {issueCount}줄</strong> — 품목을 찾지 못했거나 값이 비어 있는 줄입니다. 후보에서 품목을 고르거나 직접 찾고, 새 품목이면
            [품목 등록 요청]을 보낸 뒤 그 줄을 빼고 저장하세요.
          </NoteBox>
        )}

        <div className={styles.tableWrap} ref={tableRef}>
          <table className={styles.table}>
            <caption className="sr-only">입고예정 품목 입력</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.cNo}>
                  #
                </th>
                <th scope="col" className={styles.cItem}>
                  품목 <span className={styles.req}>*</span>
                </th>
                <th scope="col" className={styles.cUnit}>
                  단위 <span className={styles.req}>*</span>
                </th>
                <th scope="col" className={styles.cQty}>
                  수량 <span className={styles.req}>*</span>
                </th>
                <th scope="col" className={styles.cDate}>
                  소비기한
                </th>
                <th scope="col" className={styles.cLot}>
                  로트
                </th>
                <th scope="col" className={styles.cAct}>
                  <span className="sr-only">줄 빼기</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shownLines.map(({ l, i }) => (
                <LineRow
                  key={l.key}
                  idPrefix={pid}
                  no={i + 1}
                  line={l}
                  item={l.itemId ? itemMap.get(l.itemId) : undefined}
                  itemMap={itemMap}
                  minExpiry={minExpiry.date}
                  errors={visible(i) ? lineErrs[i] : {}}
                  flagged={hasErr(i) && visible(i)}
                  autoFocus={focusKey === l.key}
                  onPick={(it, unit) => setItem(l, it, unit)}
                  onFind={() => setFinder({ q: "", lineKey: l.key })}
                  onChange={(p) => update(l.key, p)}
                  onRemove={() => removeLine(l.key)}
                  onRequest={() => setRequestFor(l)}
                />
              ))}
              {shownLines.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.emptyRow}>
                    확인 필요 줄이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </div>
        </div>
      </Card>

      <div className={styles.foot}>
        <span className={styles.total}>
          품목 <strong className="mono">{lines.filter((l) => l.itemId).length}</strong>
          {[...totals].map(([u, n]) => (
            <span key={u} className="mono">
              {" "}
              · {u} {n.toLocaleString()}
            </span>
          ))}
          {issueCount > 0 && (showAll || imported) && <span className={styles.bad}> · 확인 필요 {issueCount}줄</span>}
        </span>
        <Button onClick={cancel} disabled={pending}>
          취소
        </Button>
        <Button variant="primary" onClick={submit} disabled={pending || !!conflict || options.centers.length === 0}>
          {pending ? "저장 중…" : submitLabel}
        </Button>
      </div>

      {finder && (
        <ItemFinderModal
          initialQuery={finder.q}
          inPlan={new Set(lines.map((l) => l.itemId).filter((x): x is number => !!x))}
          onClose={() => setFinder(null)}
          single={!!finder.lineKey}
          onAdd={(items) => {
            // 줄의 품목 칸에서 연 창 — 그 줄의 품목을 고르거나 바꾼다
            const line = finder.lineKey ? lines.find((l) => l.key === finder.lineKey) : undefined;
            if (line && items[0]) {
              setItem(line, items[0]);
              setFinder(null);
              setFocusKey(null);
            } else addFromFinder(items);
          }}
        />
      )}

      {requestFor && (
        <ItemRequestModal
          line={requestFor}
          source={method === "AI_IMAGE" ? "AI" : method === "EXCEL" ? "EXCEL" : "DIRECT"}
          onClose={() => setRequestFor(null)}
          onSent={(requestNo) => {
            update(requestFor.key, { requestNo });
            setRequestFor(null);
          }}
        />
      )}
    </div>
  );
}

/* ───────── 한 줄 ───────── */

function LineRow({
  idPrefix,
  no,
  line,
  item,
  itemMap,
  minExpiry,
  errors,
  flagged,
  autoFocus,
  onPick,
  onFind,
  onChange,
  onRemove,
  onRequest,
}: {
  idPrefix: string;
  no: number;
  line: EditorLine;
  item: CatalogItem | undefined;
  itemMap: Map<number, CatalogItem>;
  /** 고를 수 있는 가장 이른 소비기한 */
  minExpiry: string;
  errors: Partial<Record<FieldKey, string>>;
  flagged: boolean;
  autoFocus: boolean;
  onPick: (it: CatalogItem, unit?: ItemUnit | null) => void;
  /** 품목 찾기 창으로 이 줄의 품목 고르기 */
  onFind: () => void;
  onChange: (p: Partial<EditorLine>) => void;
  onRemove: () => void;
  onRequest: () => void;
}) {
  const id = `${idPrefix}-ln-${line.key}`;
  const uom = item?.uoms.find((u) => u.unit === line.unit);
  const qty = parseQty(line.qty);
  const msgs = [...new Set(Object.values(errors))];
  const showIssues = flagged && line.issues.length > 0;
  return (
    <>
      <tr className={`${styles.row} ${flagged ? styles.flagged : ""}`}>
        <td className={`${styles.cNo} mono`}>{no}</td>
        <td className={styles.cItem}>
          {line.origin && (
            <div className={styles.origin}>
              <span className={styles.originLabel}>{line.origin}</span>
              <span className={styles.originText} title={line.text ?? ""}>
                {line.text}
              </span>
              {line.matchedBy && <Tag tone="accent">{MATCHED_BY_LABEL[line.matchedBy]}</Tag>}
              {flagged && <Tag tone="warn">확인 필요</Tag>}
            </div>
          )}
          {/* 드롭다운 자동완성 없이, 누르면 품목 찾기 창이 열린다 (2026-11-13 Sol 결정) */}
          <button
            type="button"
            id={`${id}-item`}
            className={`${styles.itemBtn} ${item ? "" : styles.itemBtnEmpty} ${errors.itemId ? styles.itemBtnInvalid : ""}`}
            aria-invalid={!!errors.itemId || undefined}
            aria-describedby={msgs.length ? `${id}-err` : undefined}
            aria-haspopup="dialog"
            aria-label={item ? `${no}번째 줄 품목 ${item.code} ${item.name}, 바꾸기` : `${no}번째 줄 품목 찾기`}
            autoFocus={autoFocus}
            onClick={onFind}
          >
            <span className={styles.itemBtnText}>
              {item ? (
                <>
                  <span className="mono">{item.code}</span> {item.name}
                </>
              ) : (
                "품목 찾기"
              )}
            </span>
            <span className={styles.itemBtnHint} aria-hidden>
              {item ? "바꾸기" : "찾기"}
            </span>
          </button>
          {!line.itemId && line.candidates.length > 0 && (
            <div className={styles.cands}>
              <span className="muted">후보</span>
              {line.candidates.map((cid) => {
                const c = itemMap.get(cid);
                return c ? (
                  <button key={cid} type="button" className={styles.cand} onClick={() => onPick(c)}>
                    <span className="mono">{c.code}</span> {c.name}
                  </button>
                ) : null;
              })}
            </div>
          )}
          {!line.itemId && line.origin && !line.requestNo && (
            <button type="button" className={styles.linkBtn} onClick={onRequest}>
              새 품목이면 품목 등록 요청
            </button>
          )}
          {line.requestNo && (
            <p className={styles.requested}>
              품목 등록 요청 <span className="mono">{line.requestNo}</span>을(를) 보냈습니다. 3PL이 등록하면 다음 입고예정에 넣고, 이 줄은 빼고 저장하세요.
            </p>
          )}
        </td>
        <td className={styles.cUnit}>
          <Select
            aria-label={`${no}번째 줄 단위`}
            value={line.unit ?? ""}
            onChange={(e) => onChange({ unit: (e.target.value || null) as ItemUnit | null })}
            disabled={!item}
            aria-invalid={!!errors.unit || undefined}
          >
            <option value="">{item ? "단위" : "–"}</option>
            {item?.uoms.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.unit}
                {u.unit === item.baseUnit ? "" : ` (${u.qty}${item.baseUnit})`}
              </option>
            ))}
          </Select>
        </td>
        <td className={styles.cQty}>
          <Input
            aria-label={`${no}번째 줄 수량`}
            className="mono"
            inputMode="numeric"
            value={line.qty}
            onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d,]/g, ""), confirmed: false })}
            aria-invalid={!!errors.qty || undefined}
          />
          {uom && qty && item && uom.unit !== item.baseUnit && (
            <span className={`${styles.base} mono`}>
              = {(qty * uom.qty).toLocaleString()} {item.baseUnit}
            </span>
          )}
          {line.lowConfidence && (
            <label className={styles.confirm}>
              <input type="checkbox" checked={line.confirmed} onChange={(e) => onChange({ confirmed: e.target.checked })} />
              원본과 대조함
            </label>
          )}
        </td>
        <td className={styles.cDate}>
          {item?.expiryManaged ? (
            <Input
              type="date"
              aria-label={`${no}번째 줄 소비기한`}
              min={minExpiry}
              title={`${minExpiry} 이후 날짜 (입고예정일 + 최소 잔여일수)`}
              value={line.expiryDate}
              onChange={(e) => onChange({ expiryDate: e.target.value })}
              aria-invalid={!!errors.expiryDate || undefined}
            />
          ) : (
            <span className="muted">{item ? "관리 안 함" : "–"}</span>
          )}
        </td>
        <td className={styles.cLot}>
          {item?.lotManaged ? (
            <Input aria-label={`${no}번째 줄 로트`} maxLength={40} value={line.lotNo} onChange={(e) => onChange({ lotNo: e.target.value })} aria-invalid={!!errors.lotNo || undefined} />
          ) : (
            <span className="muted">{item ? "관리 안 함" : "–"}</span>
          )}
        </td>
        <td className={styles.cAct}>
          <button type="button" className={styles.remove} onClick={onRemove} aria-label={`${no}번째 줄 빼기`} title="줄 빼기">
            ×
          </button>
        </td>
      </tr>
      {(msgs.length > 0 || showIssues) && (
        <tr className={styles.errRow}>
          <td />
          <td colSpan={6} id={`${id}-err`}>
            <ul className={styles.errs}>
              {msgs.map((m) => (
                <li key={m}>{m}</li>
              ))}
              {showIssues && line.issues.filter((m) => !msgs.includes(m)).map((m) => <li key={`i-${m}`}>원본: {m}</li>)}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
