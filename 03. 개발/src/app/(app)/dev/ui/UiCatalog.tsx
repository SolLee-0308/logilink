"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useNavCounts } from "@/components/layout/NavCounts";
import { Button } from "@/components/ui/Button";
import { CountBadge, StatusBadge, Tag } from "@/components/ui/Badges";
import { Tabs } from "@/components/ui/Tabs";
import { ChipGroup, FilterBar, FilterCheckbox, FilterField, SearchInput } from "@/components/ui/FilterBar";
import { CellSub, DataTable, type Column } from "@/components/ui/DataTable";
import { FormError, FormField, Select, Textarea } from "@/components/ui/Form";
import { Modal, Sheet } from "@/components/ui/Overlay";
import { NoteBox } from "@/components/ui/NoteBox";
import { useToast } from "@/components/ui/Toast";
import { PLAN_STATUSES } from "@/domain/plan-status";
import styles from "./UiCatalog.module.css";

const SWATCHES: { group: string; items: [string, string][] }[] = [
  {
    group: "바이올렛",
    items: [
      ["violet-50", "선택 행·건수 바탕"],
      ["violet-100", "보조 바탕"],
      ["violet-300", "검정 위 활성 글자"],
      ["violet-500", "로고·포커스 링"],
      ["violet-600", "활성 탭·흰 글자 바탕"],
      ["violet-700", "흰 바탕 위 강조 글자"],
    ],
  },
  {
    group: "뉴트럴",
    items: [
      ["ink", "사이드바·주 버튼"],
      ["ink-2", "선택 메뉴·카드"],
      ["fg", "본문 글자"],
      ["muted", "보조 글자"],
      ["soft", "흐린 글자"],
      ["line-2", "입력·버튼 테두리"],
      ["line", "구분선"],
      ["surface", "표 머리·조회조건"],
    ],
  },
];

interface Row {
  no: string;
  shipper: string;
  date: string;
  dday: string;
  qty: string;
  rev: number;
  status: (typeof PLAN_STATUSES)[number];
  tags: ("accent" | "warn" | "danger")[];
}

const ROWS: Row[] = [
  { no: "IP-20261102-0031", shipper: "한빛식품", date: "2026-11-03", dday: "D-1", qty: "4종 · 249", rev: 1, status: "WAITING", tags: [] },
  { no: "IP-20261102-0029", shipper: "그린마켓", date: "2026-11-03", dday: "D-1", qty: "3종 · 130", rev: 2, status: "WAITING", tags: ["accent"] },
  { no: "IP-20261101-0044", shipper: "다온생활", date: "2026-11-01", dday: "D+1", qty: "2종 · 350", rev: 1, status: "WAITING", tags: ["warn"] },
  { no: "IP-20261102-0027", shipper: "오션푸드", date: "2026-11-04", dday: "D-2", qty: "2종 · 85", rev: 1, status: "WAITING", tags: ["danger"] },
];

const TAG_LABEL = { accent: "재요청", warn: "기한 지남", danger: "변경됨" } as const;

const COLUMNS: Column<Row>[] = [
  {
    key: "no",
    header: "입고예정번호",
    render: (r) => (
      <span className={styles.noCell}>
        <span className="mono">{r.no}</span>
        {r.tags.map((t) => (
          <Tag key={t} tone={t}>
            {TAG_LABEL[t]}
          </Tag>
        ))}
      </span>
    ),
  },
  { key: "shipper", header: "화주사", render: (r) => r.shipper },
  {
    key: "date",
    header: "입고예정일",
    render: (r) => (
      <>
        <span className="mono">{r.date}</span>
        <CellSub>{r.dday}</CellSub>
      </>
    ),
  },
  {
    key: "qty",
    header: "품목 · 수량",
    align: "right",
    render: (r) => {
      // 한글 단위는 본문 글꼴, 숫자만 mono (Plex Mono에는 한글 글리프가 없음)
      const [kinds, qty] = r.qty.split(" · ");
      return (
        <>
          <span className="mono">{kinds.replace("종", "")}</span>종 · <span className="mono">{qty}</span>
        </>
      );
    },
  },
  {
    key: "rev",
    header: "차수",
    align: "right",
    render: (r) => (
      <>
        <span className="mono">{r.rev}</span>차
      </>
    ),
  },
  { key: "status", header: "상태", render: (r) => <StatusBadge status={r.status} /> },
];

export function UiCatalog() {
  const toast = useToast();
  const { setCount } = useNavCounts();
  const [tab, setTab] = useState<"wait" | "rej" | "today">("wait");
  const [chip, setChip] = useState<"all" | "over" | "today" | "tomorrow" | "later">("all");
  const [rev, setRev] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string | null>(ROWS[0].no);
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");

  // 사이드바 건수 배지 표시 확인용
  useEffect(() => setCount("approvalWaiting", ROWS.length), [setCount]);

  function openModal() {
    setReason("");
    setDetail("");
    setError("");
    setModal(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError("반려 사유를 선택하세요.");
    if (reason === "ETC" && !detail.trim()) return setError("\"기타\"를 고르면 상세 내용을 입력해야 합니다.");
    setModal(false);
    toast.show("모달 입력 확인 완료");
  }

  return (
    <>
      <PageHeader
        crumbs={["개발", "공통 컴포넌트"]}
        title="공통 컴포넌트"
        count={ROWS.length}
        onHelp={() => setSheet(true)}
        helpLabel="도움말 시트 열기"
      />

      <Section title="디자인 토큰" note="src/styles/tokens.css 한 파일에서 관리합니다.">
        {SWATCHES.map((g) => (
          <div key={g.group} className={styles.swGroup}>
            <h3>{g.group}</h3>
            <div className={styles.swatches}>
              {g.items.map(([name, use]) => (
                <div key={name} className={styles.sw}>
                  <div className={styles.chip} style={{ background: `var(--${name})` }} />
                  <div className={styles.meta}>
                    <strong className="mono">{name}</strong>
                    <span>{use}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className={styles.type}>
          <span className={styles.display}>
            Logi<span>Link</span>
          </span>
          <span>본문 Pretendard 14 — 승인·반려 시점에 조회한 version과 현재 version이 다르면 처리를 막습니다.</span>
          <span className="mono">IBM Plex Mono · IP-20261103-0007 · 2026-11-03 · 1,240</span>
        </div>
      </Section>

      <Section title="버튼" note="주 버튼(검정)은 화면에서 가장 중요한 행위 하나에만 씁니다.">
        <div className={styles.row}>
          <Button variant="primary">승인</Button>
          <Button>보조</Button>
          <Button variant="danger">반려</Button>
          <Button variant="primary" disabled>
            승인 (비활성)
          </Button>
          <Button size="sm">변경 내용 불러오기</Button>
        </div>
      </Section>

      <Section title="상태 배지 · 태그 · 건수" note="상태는 배지 색으로만 표시합니다. 정의서 v1.4의 7개 상태입니다.">
        <div className={styles.row}>
          {PLAN_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className={styles.row}>
          <Tag tone="accent">재요청</Tag>
          <Tag tone="accent">재요청 2차</Tag>
          <Tag tone="warn">기한 지남</Tag>
          <Tag tone="danger">변경됨</Tag>
          <Tag tone="neutral">미확정</Tag>
          <CountBadge value={12} label="승인대기" />
        </div>
      </Section>

      <Section title="조회조건 바 · 탭">
        <FilterBar>
          <FilterField label="화주사" htmlFor="dev-shipper">
            <Select id="dev-shipper" defaultValue="">
              <option value="">전체</option>
              <option>한빛식품</option>
              <option>그린마켓</option>
            </Select>
          </FilterField>
          <FilterField label="입고예정일">
            <ChipGroup
              value={chip}
              onChange={setChip}
              options={[
                { value: "all", label: "전체" },
                { value: "over", label: "기한 지남" },
                { value: "today", label: "오늘" },
                { value: "tomorrow", label: "내일" },
                { value: "later", label: "모레 이후" },
              ]}
            />
          </FilterField>
          <FilterCheckbox id="dev-rev" label="재요청 건만" checked={rev} onChange={setRev} />
          <SearchInput value={q} onChange={setQ} placeholder="입고예정번호, 품목명 검색" />
        </FilterBar>
        <Tabs
          label="처리 구분"
          value={tab}
          onChange={setTab}
          items={[
            { key: "wait", label: "승인대기", count: 6 },
            { key: "rej", label: "반려 · 화주사 수정 중", count: 2 },
            { key: "today", label: "오늘 처리", count: 3 },
          ]}
        />
      </Section>

      <Section title="목록 표" note="행 클릭 또는 Enter로 선택, 위·아래 화살표로 이동합니다. 4번째 행은 version 충돌 강조입니다.">
        <DataTable
          caption="입고예정 목록"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.no}
          activeKey={active}
          onActivate={setActive}
          rowTone={(r) => (r.tags.includes("danger") ? "conflict" : undefined)}
        />
        <DataTable caption="빈 목록" columns={COLUMNS} rows={[]} rowKey={(r) => r.no} empty="조건에 맞는 입고예정이 없습니다. 조회조건을 바꿔 보세요." />
      </Section>

      <Section title="안내 박스">
        <NoteBox tone="error" action={<Button size="sm">변경 내용 불러오기</Button>}>
          <strong>화주사가 수정한 건입니다.</strong> 화면을 연 뒤 v1 → v2로 바뀌었습니다. 변경 내용을 확인한 뒤 다시 처리하세요.
        </NoteBox>
        <NoteBox tone="warn">
          입고예정일이 지났습니다. 오늘 일마감까지 승인·반려하지 않으면 <strong>기한경과 취소</strong>로 자동 정리됩니다.
        </NoteBox>
        <NoteBox tone="info">
          화주사가 수정 후 재저장하면 차수가 2차로 올라가고 승인대기로 돌아옵니다.
        </NoteBox>
      </Section>

      <Section title="모달 · 시트 · 토스트">
        <div className={styles.row}>
          <Button onClick={openModal}>모달 열기</Button>
          <Button onClick={() => setSheet(true)}>시트 열기</Button>
          <Button onClick={() => toast.show("IP-20261102-0031 승인 완료")}>토스트 보기</Button>
        </div>
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="입고예정 반려"
        description="오류는 모달 안에 문장으로 표시합니다. 아무것도 고르지 않고 반려를 눌러 보세요."
        onSubmit={submit}
        footer={
          <>
            <Button onClick={() => setModal(false)}>취소</Button>
            <Button type="submit" variant="primary">
              반려
            </Button>
          </>
        }
      >
        <FormField label="반려 사유" htmlFor="dev-reason" required>
          <Select id="dev-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus>
            <option value="">사유를 선택하세요</option>
            <option value="QTY">수량 확인 필요</option>
            <option value="ETC">기타</option>
          </Select>
        </FormField>
        <FormField label="상세 내용" htmlFor="dev-detail" required={reason === "ETC"}>
          <Textarea id="dev-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </FormField>
        <FormError>{error}</FormError>
      </Modal>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="이 화면의 업무 규칙">
        <p>오른쪽 시트는 도움말(?) 버튼으로 엽니다. 바깥을 누르거나 Esc로 닫힙니다.</p>
      </Sheet>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.secHead}>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}
