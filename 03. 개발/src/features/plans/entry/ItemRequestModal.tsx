"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { NoteBox } from "@/components/ui/NoteBox";
import { Modal } from "@/components/ui/Overlay";
import { ITEM_UNITS, type ItemUnit } from "@/domain/master";
import { submitItemRequest } from "@/server/master/actions";
import { useAction } from "@/features/master/shared";
import type { EditorLine } from "./PlanEditor";

/**
 * 입고예정 줄에서 바로 보내는 품목 등록 요청 — 마스터에 없는 실제 신규 품목일 때만 (정의서 ① · D2).
 * 원문(엑셀 행·판독 줄)을 메모에 남겨 3PL이 확인할 수 있게 한다.
 */
export function ItemRequestModal({
  line,
  source,
  onClose,
  onSent,
}: {
  line: EditorLine;
  source: "DIRECT" | "EXCEL" | "AI";
  onClose: () => void;
  onSent: (requestNo: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(line.text && line.text !== "(품목 정보 없음)" ? line.text.split(" · ").pop()! : "");
  const [unit, setUnit] = useState<ItemUnit>(line.unit ?? "EA");
  const [barcode, setBarcode] = useState("");
  const [note, setNote] = useState(line.origin ? `입고예정 등록 중 ${line.origin}: '${line.text}'` : "");
  const act = useAction();

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="품목 등록 요청"
      description="품목 마스터에 없는 새 품목이면 3PL에 등록을 요청합니다. 3PL이 등록한 뒤 입고예정에 넣을 수 있습니다."
      onSubmit={(e) => {
        e.preventDefault();
        act.run(
          () =>
            submitItemRequest({
              itemCode: code,
              itemName: name,
              unit,
              barcode,
              storageTemp: null,
              expiryManaged: null,
              lotManaged: null,
              note,
              source,
            }),
          (d) => d && onSent(d.requestNo),
        );
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={act.pending}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={act.pending}>
            {act.pending ? "보내는 중…" : "요청"}
          </Button>
        </>
      }
    >
      {act.error && <NoteBox tone="error">{act.error}</NoteBox>}
      <NoteBox tone="info">
        판독 오류나 표기 차이로 못 찾은 경우가 많습니다. 품목 찾기에서 품목코드·바코드로 한 번 더 찾아본 뒤 요청하세요.
      </NoteBox>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px" }}>
        <FormField label="품목코드" htmlFor="rq-code" required hint="화주사에서 쓰는 품목코드" error={act.fieldErrors.itemCode}>
          <Input id="rq-code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" autoFocus />
        </FormField>
        <FormField label="품목명" htmlFor="rq-name" required error={act.fieldErrors.itemName}>
          <Input id="rq-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </FormField>
        <FormField label="단위" htmlFor="rq-unit" required error={act.fieldErrors.unit}>
          <Select id="rq-unit" value={unit} onChange={(e) => setUnit(e.target.value as ItemUnit)}>
            {ITEM_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="바코드" htmlFor="rq-barcode" required hint="숫자 8~14자리" error={act.fieldErrors.barcode}>
          <Input id="rq-barcode" className="mono" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ""))} maxLength={14} />
        </FormField>
      </div>
      <FormField label="메모" htmlFor="rq-note" hint="3PL에 전달할 내용" error={act.fieldErrors.note}>
        <Textarea id="rq-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </Modal>
  );
}
