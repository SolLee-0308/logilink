"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChipGroup, FilterBar, FilterField } from "@/components/ui/FilterBar";
import { FormField, Input, Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { Modal } from "@/components/ui/Overlay";
import { KeyValue, PanelTitle, SidePanel, SplitView } from "@/components/ui/SplitView";
import { HOLIDAY_KIND_LABEL, type HolidayKind } from "@/domain/master";
import { fmtDateTime } from "@/lib/format";
import { addHoliday, deleteHoliday } from "@/server/master/actions";
import { EditModal, FormSection } from "./record";
import { MasterHeader, useAction } from "./shared";
import { RULES } from "./rules";
import type { CenterOption, HolidayRow } from "./types";
import styles from "./HolidaysScreen.module.css";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** 날짜만 있는 값이라 모든 계산을 UTC 기준으로 한다 */
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const weekday = (d: string) => WEEKDAY[utc(d).getUTCDay()];

/** YYYY-MM 월에서 n개월 이동 */
function shiftMonth(month: string, n: number) {
  const d = utc(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return ymd(d).slice(0, 7);
}

/** 달력 칸: 그 달 1일이 든 주의 일요일부터 말일이 든 주의 토요일까지 */
function monthCells(month: string) {
  const first = utc(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const last = utc(`${shiftMonth(month, 1)}-01`);
  last.setUTCDate(0);
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const cells: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) cells.push(ymd(d));
  return cells;
}

const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const dateLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${weekday(d)})`;

export function HolidaysScreen({
  rows,
  centers,
  today,
}: {
  rows: HolidayRow[];
  centers: CenterOption[];
  /** YYYY-MM-DD (서버 기준 오늘) */
  today: string;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [centerId, setCenterId] = useState("");
  const [kind, setKind] = useState<"all" | HolidayKind>("all");
  const [selected, setSelected] = useState<number | null>(null);
  /** 등록 모달: 열려 있으면 미리 채울 날짜 */
  const [newDate, setNewDate] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const visible = useMemo(
    () => rows.filter((r) => (!centerId || r.centerId === Number(centerId)) && (kind === "all" || r.kind === kind)),
    [rows, centerId, kind],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, HolidayRow[]>();
    for (const r of visible) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return m;
  }, [visible]);
  const monthRows = visible.filter((r) => r.date.startsWith(month));
  const cells = useMemo(() => monthCells(month), [month]);
  const current = selected === null ? null : (rows.find((r) => r.id === selected) ?? null);
  const multiCenter = centers.length > 1;

  function openNew(date: string) {
    setNewDate(date);
    setNonce((n) => n + 1);
  }

  return (
    <>
      <MasterHeader title="휴무일" count={rows.filter((r) => r.date >= today).length} rules={RULES.holidays} />
      <FilterBar>
        {multiCenter && (
          <FilterField label="센터" htmlFor="f-center">
            <Select id="f-center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
              <option value="">전체</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        <FilterField label="구분">
          <ChipGroup
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "전체" },
              { value: "PUBLIC", label: "공휴일" },
              { value: "CENTER", label: "센터 휴무" },
            ]}
          />
        </FilterField>
      </FilterBar>
      <NoteBox tone="info">설날·추석·부처님오신날과 대체공휴일은 해마다 날짜가 달라 직접 등록해야 합니다. 달력에서 날짜를 누르면 바로 등록할 수 있습니다.</NoteBox>
      <SplitView
        list={
          <section className={styles.calendar} aria-label={`${monthLabel(month)} 휴무일 달력`}>
            <div className={styles.toolbar}>
              <div className={styles.nav}>
                <Button size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">
                  ‹
                </Button>
                <h2 className={styles.month} aria-live="polite">
                  {monthLabel(month)}
                </h2>
                <Button size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">
                  ›
                </Button>
                <Button size="sm" onClick={() => setMonth(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>
                  오늘
                </Button>
              </div>
              <span className={styles.count}>
                이 달 <strong className="mono">{monthRows.length}</strong>건
              </span>
              <Button variant="primary" size="sm" onClick={() => openNew(month === today.slice(0, 7) ? today : `${month}-01`)}>
                + 등록
              </Button>
            </div>

            <div className={styles.grid}>
              <div className={styles.week}>
                {WEEKDAY.map((w, i) => (
                  <div key={w} className={`${styles.wd} ${i === 0 ? styles.sun : i === 6 ? styles.sat : ""}`}>
                    {w}
                  </div>
                ))}
              </div>
              {Array.from({ length: cells.length / 7 }, (_, wi) => (
                <div key={wi} className={styles.week}>
                  {cells.slice(wi * 7, wi * 7 + 7).map((d, di) => {
                    const inMonth = d.startsWith(month);
                    const hs = byDate.get(d) ?? [];
                    const cls = [
                      styles.cell,
                      !inMonth && styles.out,
                      d === today && styles.today,
                      d < today && styles.past,
                      hs.length > 0 && styles.off,
                      di === 0 && styles.sun,
                      di === 6 && styles.sat,
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <div key={d} className={cls}>
                        <button
                          type="button"
                          className={styles.day}
                          onClick={() => (inMonth ? openNew(d) : setMonth(d.slice(0, 7)))}
                          aria-label={inMonth ? `${dateLabel(d)} 휴무일 등록` : `${monthLabel(d.slice(0, 7))}로 이동`}
                          title={inMonth ? "이 날짜를 휴무일로 등록" : undefined}
                        >
                          {Number(d.slice(8, 10))}
                        </button>
                        {inMonth &&
                          hs.map((h) => (
                            <button
                              key={h.id}
                              type="button"
                              className={`${styles.chip} ${h.kind === "PUBLIC" ? styles.public : styles.center} ${selected === h.id ? styles.active : ""}`}
                              onClick={() => setSelected(h.id)}
                              aria-pressed={selected === h.id}
                              title={`${h.name} · ${HOLIDAY_KIND_LABEL[h.kind]}${multiCenter ? ` · ${h.centerName}` : ""}`}
                            >
                              {h.name}
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className={styles.legend}>
              <span className={`${styles.chip} ${styles.public}`}>공휴일</span>
              <span className={`${styles.chip} ${styles.center}`}>센터 휴무</span>
              <span className="muted">날짜 숫자를 누르면 등록, 휴무일 이름을 누르면 상세가 열립니다.</span>
            </div>
          </section>
        }
        panel={
          current ? (
            <HolidayDetail key={current.id} row={current} onBack={() => setSelected(null)} onDeleted={() => setSelected(null)} />
          ) : (
            <MonthSummary month={month} rows={monthRows} today={today} multiCenter={multiCenter} onSelect={setSelected} />
          )
        }
      />
      {newDate && (
        <HolidayEditModal
          key={nonce}
          centers={centers}
          defaultCenterId={centerId}
          defaultDate={newDate}
          onClose={() => setNewDate(null)}
          onCreated={(id, date) => {
            setNewDate(null);
            setMonth(date.slice(0, 7));
            setSelected(id);
          }}
        />
      )}
    </>
  );
}

/** 선택한 휴무일이 없을 때: 보고 있는 달의 휴무일 목록 */
function MonthSummary({
  month,
  rows,
  today,
  multiCenter,
  onSelect,
}: {
  month: string;
  rows: HolidayRow[];
  today: string;
  multiCenter: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <SidePanel label="이 달 휴무일" title={<PanelTitle>{monthLabel(month)} 휴무일</PanelTitle>} sub={`${rows.length}건`}>
      {rows.length === 0 ? (
        <p className="muted">이 달에 등록된 휴무일이 없습니다. 달력에서 날짜를 눌러 등록하세요.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className={`${styles.listItem} ${r.date < today ? styles.past : ""}`} onClick={() => onSelect(r.id)}>
                <span className="mono">{r.date.slice(5)}</span>
                <span className="muted">({weekday(r.date)})</span>
                <span className={styles.listName}>{r.name}</span>
                <span className={`${styles.chip} ${r.kind === "PUBLIC" ? styles.public : styles.center}`}>{HOLIDAY_KIND_LABEL[r.kind]}</span>
                {multiCenter && <span className="muted">{r.centerName}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}

type Form = { centerId: string; date: string; name: string; kind: HolidayKind };

function HolidayEditModal({
  centers,
  defaultCenterId,
  defaultDate,
  onClose,
  onCreated,
}: {
  centers: CenterOption[];
  defaultCenterId: string;
  defaultDate: string;
  onClose: () => void;
  onCreated: (id: number, date: string) => void;
}) {
  const initial: Form = {
    centerId: defaultCenterId || (centers.length === 1 ? String(centers[0].id) : ""),
    date: defaultDate,
    name: "",
    kind: "PUBLIC",
  };
  const [f, setF] = useState<Form>(initial);
  const act = useAction();
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== initial[k]);

  function submit() {
    act.run(
      () => addHoliday({ centerId: Number(f.centerId) || 0, date: f.date, name: f.name, kind: f.kind }),
      (d) => d && onCreated(d.id, f.date),
    );
  }

  return (
    <EditModal open title="휴무일 등록" dirty={dirty} pending={act.pending} error={act.error} submitLabel="등록" onClose={onClose} onSubmit={submit}>
      <FormSection title="휴무일">
        <FormField label="날짜" htmlFor="h-date" required hint={f.date ? weekday(f.date) + "요일" : undefined} error={act.fieldErrors.date}>
          <Input id="h-date" type="date" className="mono" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </FormField>
        <FormField label="센터" htmlFor="h-center" required error={act.fieldErrors.centerId}>
          <Select id="h-center" value={f.centerId} onChange={(e) => setF({ ...f, centerId: e.target.value })}>
            <option value="">센터를 선택하세요</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="이름" htmlFor="h-name" required hint="예: 추석, 대체공휴일, 센터 재고조사" error={act.fieldErrors.name}>
          <Input id="h-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} data-autofocus />
        </FormField>
        <FormField label="구분" htmlFor="h-kind" required error={act.fieldErrors.kind}>
          <Select id="h-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as HolidayKind })}>
            <option value="PUBLIC">공휴일</option>
            <option value="CENTER">센터 휴무</option>
          </Select>
        </FormField>
      </FormSection>
    </EditModal>
  );
}

function HolidayDetail({ row, onBack, onDeleted }: { row: HolidayRow; onBack: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const act = useAction();

  return (
    <SidePanel
      label="휴무일 상세"
      title={
        <PanelTitle mono>
          {row.date} ({weekday(row.date)})
        </PanelTitle>
      }
      sub={`${row.name} · ${HOLIDAY_KIND_LABEL[row.kind]}`}
      footer={
        <>
          <Button onClick={onBack}>이 달 목록</Button>
          <Button variant="danger" onClick={() => setConfirm(true)} disabled={act.pending}>
            삭제
          </Button>
        </>
      }
    >
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}
      <KeyValue
        items={[
          ["센터", row.centerName],
          ["구분", HOLIDAY_KIND_LABEL[row.kind]],
          ["등록", `${fmtDateTime(row.createdAt)} · ${row.createdBy}`],
        ]}
      />
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="휴무일 삭제"
        description="삭제하면 이 날짜가 영업일로 계산됩니다. 삭제 내역은 변경 이력에 남습니다."
        footer={
          <>
            <Button onClick={() => setConfirm(false)} data-autofocus>
              취소
            </Button>
            <Button
              variant="primary"
              disabled={act.pending}
              onClick={() =>
                act.run(
                  () => deleteHoliday({ id: row.id }),
                  () => {
                    setConfirm(false);
                    onDeleted();
                  },
                )
              }
            >
              삭제
            </Button>
          </>
        }
      >
        <p>
          <span className="mono">{row.date}</span> {row.name}
        </p>
      </Modal>
    </SidePanel>
  );
}
