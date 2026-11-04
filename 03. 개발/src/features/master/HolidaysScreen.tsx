"use client";

import { useMemo, useState } from "react";
import { Tag } from "@/components/ui/Badges";
import { Button, CreateButton } from "@/components/ui/Button";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { ChipGroup, FilterBar, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { FormField, Input, Select } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { Modal } from "@/components/ui/Overlay";
import { ListToolbar } from "@/components/ui/SplitView";
import { HOLIDAY_KIND_LABEL, type HolidayKind } from "@/domain/master";
import { fmtShortDateTime, includesText } from "@/lib/format";
import { addHoliday, deleteHoliday, importPublicHolidays } from "@/server/master/actions";
import { EditModal, FormSection } from "./record";
import { MasterHeader, useAction } from "./shared";
import { RULES } from "./rules";
import type { CenterOption, HolidayRow } from "./types";
import styles from "./HolidaysScreen.module.css";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** 날짜만 있는 값이라 요일은 UTC 기준으로 계산한다 */
const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];

const SOURCE_LABEL = { API: "공공데이터", MANUAL: "직접 등록" } as const;
type SourceFilter = "all" | keyof typeof SOURCE_LABEL;

/**
 * 휴무일 — 연도별 목록 (2026-11-04 Sol: 달력 → 목록으로 되돌림)
 * 공공데이터(특일 정보)에서 공휴일을 불러온 뒤, 직접 추가·삭제한다. 불러온 공휴일도 삭제할 수 있다.
 */
export function HolidaysScreen({
  rows,
  centers,
  today,
  canEdit,
}: {
  rows: HolidayRow[];
  centers: CenterOption[];
  /** YYYY-MM-DD (서버 기준 오늘) */
  today: string;
  /** 등록·삭제·불러오기 (3PL) */
  canEdit: boolean;
}) {
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const [centerId, setCenterId] = useState("");
  const [kind, setKind] = useState<"all" | HolidayKind>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(0);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<HolidayRow | null>(null);
  const multiCenter = centers.length > 1;

  // 연도 선택지: 등록된 연도 + 올해 앞뒤 1년
  const years = useMemo(() => {
    const s = new Set([thisYear - 1, thisYear, thisYear + 1, ...rows.map((r) => Number(r.date.slice(0, 4)))]);
    return [...s].sort((a, b) => b - a);
  }, [rows, thisYear]);

  const list = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!year || r.date.startsWith(year)) &&
          (!centerId || r.centerId === Number(centerId)) &&
          (kind === "all" || r.kind === kind) &&
          (source === "all" || r.source === source) &&
          includesText([r.name, r.date], q),
      ),
    [rows, year, centerId, kind, source, q],
  );

  const columns: Column<HolidayRow>[] = [
    {
      key: "date",
      header: "날짜",
      render: (r) => (
        <span className={r.date < today ? "muted" : undefined}>
          <span className="mono">{r.date}</span> ({weekday(r.date)})
        </span>
      ),
    },
    { key: "name", header: "휴무일 이름", wrap: true, render: (r) => r.name },
    {
      key: "kind",
      header: "구분",
      render: (r) => <Tag tone={r.kind === "PUBLIC" ? "danger" : "accent"}>{HOLIDAY_KIND_LABEL[r.kind]}</Tag>,
    },
    ...(multiCenter ? [{ key: "center", header: "센터", render: (r: HolidayRow) => r.centerName }] : []),
    {
      key: "source",
      header: "출처",
      render: (r) => (
        <>
          {SOURCE_LABEL[r.source]}
          <CellSub>
            {fmtShortDateTime(r.createdAt)} · {r.createdBy}
          </CellSub>
        </>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "act",
            header: <span className="sr-only">삭제</span>,
            align: "right" as const,
            render: (r: HolidayRow) => (
              <Button size="sm" variant="dangerSoft" onClick={() => setToDelete(r)} aria-label={`${r.date} ${r.name} 삭제`}>
                삭제
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <MasterHeader
        title="휴무일"
        count={rows.filter((r) => r.date >= today).length}
        rules={RULES.holidays}
        actions={
          canEdit ? (
            <>
              <Button onClick={() => setImporting(true)}>공공데이터 불러오기</Button>
              <CreateButton onClick={() => setAdding((n) => n + 1)}>등록</CreateButton>
            </>
          ) : undefined
        }
      />
      <FilterBar>
        <FilterField label="연도" htmlFor="f-year">
          <Select id="f-year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">전체</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </Select>
        </FilterField>
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
        <FilterField label="출처">
          <ChipGroup
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: "전체" },
              { value: "API", label: "공공데이터" },
              { value: "MANUAL", label: "직접 등록" },
            ]}
          />
        </FilterField>
        <SearchInput value={q} onChange={setQ} placeholder="휴무일 이름, 날짜 검색" />
      </FilterBar>

      {canEdit && year && !rows.some((r) => r.date.startsWith(year) && r.source === "API") && (
        <NoteBox tone="info">
          {year}년 공휴일을 아직 불러오지 않았습니다. [공공데이터 불러오기]로 설날·추석·대체공휴일까지 한 번에 넣은 뒤, 센터 휴무만 직접 추가하세요.
        </NoteBox>
      )}

      <div className={styles.listcol}>
        <ListToolbar total={list.length} />
        <DataTable
          caption="휴무일 목록"
          columns={columns}
          rows={list}
          rowKey={(r) => String(r.id)}
          empty="조건에 맞는 휴무일이 없습니다. 연도나 조회조건을 바꿔 보세요."
        />
      </div>

      {adding > 0 && (
        <HolidayAddModal
          key={adding}
          centers={centers}
          defaultCenterId={centerId}
          defaultDate={year && year !== String(thisYear) ? `${year}-01-01` : today}
          onClose={() => setAdding(0)}
          onCreated={(date) => {
            setAdding(0);
            setYear(date.slice(0, 4));
          }}
        />
      )}
      {importing && (
        <ImportModal
          centers={centers}
          defaultYear={year ? Number(year) : thisYear}
          thisYear={thisYear}
          onClose={() => setImporting(false)}
          onDone={(y) => {
            setImporting(false);
            setYear(String(y));
          }}
        />
      )}
      {toDelete && <DeleteModal row={toDelete} onClose={() => setToDelete(null)} />}
    </>
  );
}

type Form = { centerId: string; date: string; name: string; kind: HolidayKind };

function HolidayAddModal({
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
  onCreated: (date: string) => void;
}) {
  const initial: Form = {
    centerId: defaultCenterId || (centers.length === 1 ? String(centers[0].id) : ""),
    date: defaultDate,
    name: "",
    kind: "CENTER",
  };
  const [f, setF] = useState<Form>(initial);
  const act = useAction();
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => f[k] !== initial[k]);

  function submit() {
    act.run(
      () => addHoliday({ centerId: Number(f.centerId) || 0, date: f.date, name: f.name, kind: f.kind }),
      () => onCreated(f.date),
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
        <FormField label="이름" htmlFor="h-name" required hint="예: 센터 재고조사, 임시공휴일" error={act.fieldErrors.name}>
          <Input id="h-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} data-autofocus />
        </FormField>
        <FormField label="구분" htmlFor="h-kind" required error={act.fieldErrors.kind}>
          <Select id="h-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as HolidayKind })}>
            <option value="CENTER">센터 휴무</option>
            <option value="PUBLIC">공휴일</option>
          </Select>
        </FormField>
      </FormSection>
    </EditModal>
  );
}

/** 공공데이터 불러오기 — 연도·센터를 골라 공휴일을 넣는다 */
function ImportModal({
  centers,
  defaultYear,
  thisYear,
  onClose,
  onDone,
}: {
  centers: CenterOption[];
  defaultYear: number;
  thisYear: number;
  onClose: () => void;
  onDone: (year: number) => void;
}) {
  const [year, setYear] = useState(String(defaultYear));
  const [centerId, setCenterId] = useState("");
  const act = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title="공공데이터에서 공휴일 불러오기"
      description="공공데이터포털(한국천문연구원 특일 정보)의 공휴일·대체공휴일을 휴무일로 넣습니다."
      onSubmit={(e) => {
        e.preventDefault();
        if (!act.pending) act.run(() => importPublicHolidays({ year: Number(year), centerId: centerId ? Number(centerId) : null }), () => onDone(Number(year)));
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={act.pending}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={act.pending}>
            {act.pending ? "불러오는 중…" : "불러오기"}
          </Button>
        </>
      }
    >
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}
      <div className={styles.importForm}>
        <FormField label="연도" htmlFor="i-year" required error={act.fieldErrors.year}>
          <Select id="i-year" value={year} onChange={(e) => setYear(e.target.value)} data-autofocus>
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="센터" htmlFor="i-center" error={act.fieldErrors.centerId}>
          <Select id="i-center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
            <option value="">사용 중인 모든 센터</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <ul className={styles.notes}>
        <li>이미 휴무일이 있는 날짜(직접 등록 포함)는 건너뜁니다.</li>
        <li>전에 삭제한 공휴일도 다시 들어갑니다. 필요 없으면 불러온 뒤 다시 삭제하세요.</li>
        <li>다음 해 공휴일은 보통 전년도 하반기에 공개됩니다.</li>
      </ul>
    </Modal>
  );
}

function DeleteModal({ row, onClose }: { row: HolidayRow; onClose: () => void }) {
  const act = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title="휴무일 삭제"
      description="삭제하면 이 날짜가 영업일로 계산됩니다. 삭제 내역은 변경 이력에 남습니다."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            취소
          </Button>
          <Button variant="danger" disabled={act.pending} onClick={() => act.run(() => deleteHoliday({ id: row.id }), onClose)}>
            삭제
          </Button>
        </>
      }
    >
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}
      <p>
        <span className="mono">{row.date}</span> ({weekday(row.date)}) {row.name} · {HOLIDAY_KIND_LABEL[row.kind]} · {SOURCE_LABEL[row.source]}
        {row.centerName ? ` · ${row.centerName}` : ""}
      </p>
      {row.source === "API" && <p className="muted">공공데이터에서 불러온 공휴일입니다. 같은 연도를 다시 불러오면 다시 들어갑니다.</p>}
    </Modal>
  );
}
