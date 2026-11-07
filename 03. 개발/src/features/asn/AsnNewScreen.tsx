"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Tag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedChanges } from "@/components/ui/UnsavedGuard";
import { DISTRIBUTE_CONFLICT_MSG, distributeError, looksLikeVehicleNo, normalizeVehicleNo } from "@/domain/asn-rules";
import type { ItemUnit } from "@/domain/master";
import { dday, ddayLabel } from "@/domain/plan-rules";
import { PLAN_STATUS_META } from "@/domain/plan-status";
import { createAsn, reloadAsnOptions } from "@/server/asn/actions";
import { SubHeader, focusFirstError } from "@/features/master/shared";
import { ASN_RULES } from "./rules";
import type { AsnOptions, DistLine, DistPlan } from "./types";
import { ASN_LIST_KEY, asnListUrl } from "./asn-list";
import styles from "./AsnNewScreen.module.css";

const UNIT_ORDER: ItemUnit[] = ["EA", "BOX", "PLT"];
const lineKey = (id: number) => `line.${id}`;
const parseQty = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/**
 * ASN 등록 (/plans/asn/new) — ① 차량·출고 정보 → ② 고른 센터의 승인 입고예정에서 이 차량에 담을 수량 입력 → 저장(상차지시서 발행).
 * 입고예정 라인마다 "남은 수량"(승인 − 다른 ASN에 담은 수량)까지만 담을 수 있다 (C4).
 */
export function AsnNewScreen({ options }: { options: AsnOptions }) {
  const router = useRouter();
  const toast = useToast();
  const today = options.today;
  const [plans, setPlans] = useState<DistPlan[]>(options.plans);
  const [centerId, setCenterId] = useState(options.defaultCenterId);
  const [shipDate, setShipDate] = useState(today);
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverTel, setDriverTel] = useState("");
  const [memo, setMemo] = useState("");
  /** 입고예정 라인 id → 이번 차량에 담을 수량(입력 문자열) */
  const [qty, setQty] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [reloading, startReload] = useTransition();

  const centerPlans = useMemo(() => plans.filter((p) => String(p.centerId) === centerId), [plans, centerId]);
  const visiblePlans = useMemo(() => {
    const t = search.trim().toUpperCase().replace(/-/g, "");
    if (!t) return centerPlans;
    return centerPlans.filter(
      (p) =>
        p.planNo.toUpperCase().replace(/-/g, "").includes(t) ||
        p.lines.some((l) => l.itemCode.toUpperCase().includes(t) || l.itemName.toUpperCase().includes(search.trim().toUpperCase())),
    );
  }, [centerPlans, search]);

  /** 담은 줄 (고른 센터 것만 저장한다) */
  const picked = useMemo(
    () => centerPlans.flatMap((p) => p.lines.filter((l) => (qty[l.planLineId] ?? "").trim() !== "").map((l) => ({ plan: p, line: l, value: parseQty(qty[l.planLineId]) }))),
    [centerPlans, qty],
  );
  const totals = useMemo(() => {
    const m = new Map<ItemUnit, number>();
    for (const p of picked) if (Number.isFinite(p.value)) m.set(p.line.unit, (m.get(p.line.unit) ?? 0) + p.value);
    return UNIT_ORDER.filter((u) => m.has(u)).map((u) => [u, m.get(u)!] as const);
  }, [picked]);
  const pickedPlans = new Set(picked.map((p) => p.plan.id)).size;
  const centerLineCount = centerPlans.reduce((n, p) => n + p.lines.length, 0);

  const dirty = !!(vehicleNo || driverName || driverTel || memo || picked.length);
  useUnsavedChanges(dirty && !saved);

  /* ───── 검사 ───── */
  const headerErrors: Record<string, string> = {};
  if (!centerId) headerErrors.centerId = "센터를 선택하세요.";
  if (!shipDate) headerErrors.shipDate = "출고일을 선택하세요.";
  else if (shipDate < today) headerErrors.shipDate = "출고일은 오늘 이후로 선택하세요.";
  if (!vehicleNo.trim()) headerErrors.vehicleNo = "차량번호를 입력하세요.";
  if (driverTel && !/^[0-9-]*$/.test(driverTel)) headerErrors.driverTel = "연락처는 숫자와 -만 입력하세요.";
  const headErr = (k: string) => (showAll ? headerErrors[k] : undefined) ?? serverErrors[k];
  const lineErr = (l: DistLine) => {
    const raw = (qty[l.planLineId] ?? "").trim();
    const local = raw ? distributeError(parseQty(raw), l.remainingQty) : null;
    return local ?? serverErrors[lineKey(l.planLineId)] ?? null;
  };
  const lineIssues = picked.filter((p) => lineErr(p.line)).length;
  const vehicleWarn = vehicleNo.trim() && !looksLikeVehicleNo(vehicleNo) ? "번호판 모양(예: 12가3456)과 다릅니다. 맞게 적었는지 확인하세요." : undefined;

  /* ───── 입력 ───── */
  const setLine = (id: number, v: string) => {
    setQty((q) => ({ ...q, [id]: v.replace(/[^\d]/g, "") }));
    if (serverErrors[lineKey(id)]) setServerErrors(({ [lineKey(id)]: _, ...rest }) => rest);
  };
  const fillPlan = (p: DistPlan, on: boolean) =>
    setQty((q) => {
      const n = { ...q };
      for (const l of p.lines) if (l.remainingQty > 0) n[l.planLineId] = on ? String(l.remainingQty) : "";
      return n;
    });
  const fillVisible = () => visiblePlans.forEach((p) => fillPlan(p, true));

  function reload() {
    startReload(async () => {
      const r = await reloadAsnOptions();
      if (!r.ok || !r.data) {
        toast.show(r.ok ? "다시 불러오지 못했습니다." : r.error, { tone: "error" });
        return;
      }
      setPlans(r.data.plans);
      setServerErrors({});
      setFormError(null);
      setStale(false);
      toast.show("남은 수량을 다시 불러왔습니다. 담은 수량이 남은 수량보다 많은 줄을 고친 뒤 저장하세요.");
    });
  }

  function submit() {
    setShowAll(true);
    setFormError(null);
    if (Object.keys(headerErrors).length || lineIssues > 0) {
      toast.show("입력 내용을 확인하세요.", { tone: "error" });
      focusFirstError();
      return;
    }
    if (!picked.length) {
      setFormError("차량에 담을 품목이 없습니다. 아래 입고예정에서 이번 차량에 실을 수량을 입력하세요.");
      toast.show("차량에 담을 품목이 없습니다.", { tone: "error" });
      focusFirstError();
      return;
    }
    start(async () => {
      const r = await createAsn({
        centerId: Number(centerId),
        shipDate,
        vehicleNo,
        driverName: driverName || null,
        driverTel: driverTel || null,
        memo: memo || null,
        lines: picked.map((p) => ({ planLineId: p.line.planLineId, qty: p.value })),
      });
      toast.show(r.ok ? r.message : r.error, { tone: r.ok ? "default" : "error" });
      if (r.ok && r.data) {
        setSaved(true);
        router.push(`/plans/asn/${r.data.id}?issued=1`);
        return;
      }
      if (!r.ok) {
        setServerErrors(r.fieldErrors ?? {});
        setFormError(r.fieldErrors && r.error !== DISTRIBUTE_CONFLICT_MSG ? null : r.error);
        setStale(r.error === DISTRIBUTE_CONFLICT_MSG);
        // 실패는 오류 칸·오류 상자로 이동 (2026-11-07 Sol 확정)
        focusFirstError();
      }
    });
  }

  const centerName = options.centers.find((c) => String(c.id) === centerId)?.name ?? "";

  return (
    <>
      <SubHeader group={["입고 계획"]} section="ASN 등록" title="새 ASN" backHref="/plans/asn" storageKey={ASN_LIST_KEY} rules={ASN_RULES} />
      <div className={styles.body}>
        {stale && (
          <NoteBox
            tone="error"
            action={
              <Button size="sm" onClick={reload} disabled={reloading}>
                {reloading ? "불러오는 중…" : "남은 수량 다시 불러오기"}
              </Button>
            }
          >
            <strong>{DISTRIBUTE_CONFLICT_MSG}</strong> 지금 입력한 내용은 저장되지 않았습니다.
          </NoteBox>
        )}
        {formError && !stale && <NoteBox tone="error">{formError}</NoteBox>}

        <Card step={1} stepState={centerId && shipDate && vehicleNo.trim() ? "done" : "current"} title="차량·출고 정보" description="차량 1대가 ASN 1건입니다. 한 센터로 가는 차량만 등록합니다.">
          <div className={styles.headGrid}>
            {options.centers.length === 1 ? (
              <FormField label="센터" htmlFor="asn-center" required>
                <span id="asn-center" className={styles.static}>
                  {options.centers[0].name}
                </span>
              </FormField>
            ) : (
              <FormField label="센터" htmlFor="asn-center" required error={headErr("centerId")} hint="센터를 바꾸면 그 센터의 입고예정만 보입니다.">
                <Select id="asn-center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                  <option value="">센터를 선택하세요</option>
                  {options.centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {String(c.id) === options.defaultCenterId ? " (기본)" : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField label="출고일" htmlFor="asn-date" required error={headErr("shipDate")} hint={shipDate ? `${ddayLabel(dday(shipDate, today))} · 상차하는 날` : "상차하는 날"}>
              <Input id="asn-date" type="date" min={today} value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
            </FormField>
            <FormField label="차량번호" htmlFor="asn-vehicle" required error={headErr("vehicleNo")} hint={vehicleWarn ?? "예: 12가3456 (띄어쓰기는 빼고 저장)"}>
              <Input
                id="asn-vehicle"
                className="mono"
                maxLength={20}
                placeholder="12가3456"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
                onBlur={() => setVehicleNo(normalizeVehicleNo(vehicleNo))}
                autoComplete="off"
              />
            </FormField>
            <FormField label="기사 이름" htmlFor="asn-driver" error={headErr("driverName")}>
              <Input id="asn-driver" maxLength={20} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </FormField>
            <FormField label="기사 연락처" htmlFor="asn-tel" error={headErr("driverTel")}>
              <Input id="asn-tel" className="mono" maxLength={15} inputMode="tel" placeholder="010-1234-5678" value={driverTel} onChange={(e) => setDriverTel(e.target.value)} />
            </FormField>
            <div className={styles.memo}>
              <FormField label="메모" htmlFor="asn-memo" error={headErr("memo")} hint="센터·상차담당에 전달할 내용 (500자 이내)">
                <Textarea id="asn-memo" rows={2} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
              </FormField>
            </div>
          </div>
          {options.centers.length === 0 && <NoteBox tone="error">이용 중인 센터가 없습니다. 3PL에 센터 연결을 요청하세요.</NoteBox>}
        </Card>

        <Card
          step={2}
          stepState={picked.length && !lineIssues ? "done" : "current"}
          title="차량에 담을 품목"
          description="승인된 입고예정에서 이 차량에 실을 수량을 입력합니다. 남은 수량까지만 담을 수 있습니다."
          aside={
            centerPlans.length > 0 && (
              <>
                <Input type="search" aria-label="입고예정번호·품목 찾기" className={styles.search} placeholder="입고예정번호·품목" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Button size="sm" onClick={fillVisible}>
                  {search ? "찾은 건 " : ""}남은 수량 모두 담기
                </Button>
                {picked.length > 0 && (
                  <Button size="sm" onClick={() => setQty({})}>
                    모두 비우기
                  </Button>
                )}
              </>
            )
          }
        >
          {!centerId ? (
            <p className={styles.empty}>센터를 먼저 고르세요.</p>
          ) : centerPlans.length === 0 ? (
            <p className={styles.empty}>
              {centerName}에 ASN에 담을 수 있는 승인 입고예정이 없습니다. 입고예정이 승인되면 여기에 나타납니다.
            </p>
          ) : (
            <>
              {/* 건수 요약 — 담을 수 있는 입고예정·품목 / 이번 차량에 담은 것 */}
              <div className={styles.summary} aria-live="polite">
                <span className={styles.chip}>
                  입고예정 <b className="mono">{centerPlans.length}</b>건
                </span>
                <span className={styles.chip}>
                  품목 <b className="mono">{centerLineCount}</b>줄
                </span>
                {search && (
                  <span className={styles.chip}>
                    찾은 입고예정 <b className="mono">{visiblePlans.length}</b>건
                  </span>
                )}
                <span className={`${styles.chip} ${picked.length ? styles.chipOn : ""}`}>
                  이번 차량 · 입고예정 <b className="mono">{pickedPlans}</b>건 · 품목 <b className="mono">{picked.length}</b>줄
                </span>
              </div>
              {visiblePlans.length === 0 ? (
                <p className={styles.empty}>찾는 입고예정·품목이 없습니다.</p>
              ) : (
                <div className={styles.plans}>
                  {visiblePlans.map((p) => (
                    <PlanBlock
                      key={p.id}
                      plan={p}
                      index={centerPlans.indexOf(p) + 1}
                      total={centerPlans.length}
                      today={today}
                      qty={qty}
                      lineErr={lineErr}
                      onLine={setLine}
                      onFill={(on) => fillPlan(p, on)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

        <div className={styles.foot}>
          <span className={styles.total}>
            입고예정 <strong className="mono">{pickedPlans}</strong>건 · 품목 <strong className="mono">{picked.length}</strong>줄
            {totals.map(([u, n]) => (
              <span key={u} className="mono">
                {" "}
                · {u} {n.toLocaleString()}
              </span>
            ))}
            {lineIssues > 0 && <span className={styles.bad}> · 확인 필요 {lineIssues}줄</span>}
          </span>
          <Button onClick={() => router.push(asnListUrl())} disabled={pending}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || stale || options.centers.length === 0}>
            {pending ? "저장 중…" : "ASN 저장 · 상차지시서 발행"}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ───────── 입고예정 1건 = 테두리 상자 1개 ───────── */

function PlanBlock({
  plan: p,
  index,
  total,
  today,
  qty,
  lineErr,
  onLine,
  onFill,
}: {
  plan: DistPlan;
  index: number;
  total: number;
  today: string;
  qty: Record<number, string>;
  lineErr: (l: DistLine) => string | null;
  onLine: (id: number, v: string) => void;
  onFill: (on: boolean) => void;
}) {
  const n = dday(p.planDate, today);
  const pickedLines = p.lines.filter((l) => (qty[l.planLineId] ?? "").trim() !== "").length;
  const open = p.lines.filter((l) => l.remainingQty > 0).length;
  const headId = `asn-plan-${p.id}`;
  return (
    <section className={`${styles.plan} ${pickedLines ? styles.planOn : ""}`} aria-labelledby={headId}>
      <header className={styles.planHead}>
        <span className={`${styles.planIdx} mono`} aria-label={`입고예정 ${total}건 중 ${index}번째`}>
          {index}
        </span>
        <h3 id={headId} className="mono">
          {p.planNo}
        </h3>
        <span className={styles.planMeta}>
          입고예정일 <span className="mono">{p.planDate}</span> · {ddayLabel(n)}
        </span>
        {n < 0 && <Tag tone="warn">지난 입고예정 잔량</Tag>}
        {p.status !== "APPROVED" && <Tag tone="neutral">{PLAN_STATUS_META[p.status].label}</Tag>}
        <Tag tone="neutral">{`${p.lines.length}품목 · 남음 ${open}`}</Tag>
        {pickedLines > 0 && <Tag tone="accent">{`담음 ${pickedLines}줄`}</Tag>}
        <span className={styles.planActs}>
          {open > 0 && (
            <Button size="sm" onClick={() => onFill(true)}>
              남은 수량 담기
            </Button>
          )}
          {pickedLines > 0 && (
            <Button size="sm" onClick={() => onFill(false)}>
              비우기
            </Button>
          )}
        </span>
      </header>
      {p.memo && <p className={styles.planMemo}>메모: {p.memo}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">{`${p.planNo} 품목`}</caption>
          <colgroup>
            <col className={styles.cCode} />
            <col />
            <col className={styles.cExp} />
            <col className={styles.cUnit} />
            <col className={styles.cNum} />
            <col className={styles.cNum} />
            <col className={styles.cNum} />
            <col className={styles.cIn} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">품목코드</th>
              <th scope="col">품목명</th>
              <th scope="col">소비기한 · 로트</th>
              <th scope="col">단위</th>
              <th scope="col" className={styles.num}>
                승인
              </th>
              <th scope="col" className={styles.num}>
                다른 ASN
              </th>
              <th scope="col" className={styles.num}>
                남은 수량
              </th>
              <th scope="col" className={styles.num}>
                이번 차량
              </th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => {
              const err = lineErr(l);
              const done = l.remainingQty === 0;
              const id = `asn-q-${l.planLineId}`;
              return (
                <tr key={l.planLineId} className={`${styles.row} ${done ? styles.doneRow : ""}`} data-invalid={err ? "" : undefined}>
                  <td className="mono">{l.itemCode}</td>
                  <td>{l.itemName}</td>
                  <td className={`mono ${styles.nowrap}`}>{l.expiryDate || l.lotNo ? [l.expiryDate, l.lotNo].filter(Boolean).join(" · ") : <span className="muted">–</span>}</td>
                  <td className="mono">{l.unit}</td>
                  <td className={`${styles.num} mono`}>{l.qty.toLocaleString()}</td>
                  <td className={`${styles.num} mono`}>{l.distributedQty ? l.distributedQty.toLocaleString() : <span className="muted">–</span>}</td>
                  <td className={`${styles.num} mono ${styles.remain}`}>{done ? <span className="muted">다 담음</span> : l.remainingQty.toLocaleString()}</td>
                  <td className={styles.num}>
                    {!done && (
                      <>
                        <label htmlFor={id} className="sr-only">
                          {`${l.itemName} 이번 차량 수량 (${l.unit})`}
                        </label>
                        <Input
                          id={id}
                          className={`${styles.qtyInput} mono`}
                          inputMode="numeric"
                          placeholder="0"
                          value={qty[l.planLineId] ?? ""}
                          onChange={(e) => onLine(l.planLineId, e.target.value)}
                          aria-invalid={!!err}
                          aria-describedby={err ? `${id}-err` : undefined}
                        />
                        {err && (
                          <p className={styles.err} id={`${id}-err`}>
                            {err}
                          </p>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
