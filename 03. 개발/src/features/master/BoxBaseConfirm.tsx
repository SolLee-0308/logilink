"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Overlay";

/**
 * 기준 단위를 BOX로 정할 때 확인 창 (2026-11-17 Sol)
 * 기준 단위 = 출고할 수 있는 가장 작은 단위가 원칙이라, BOX로 정하면 낱개(EA)로는 셀 수 없음을 한 번 더 묻는다.
 */
export function BoxBaseConfirm({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="낱개 출고가 없는 품목이 맞나요?"
      description="기준 단위는 출고할 수 있는 가장 작은 단위로 정합니다."
      footer={
        <>
          <Button onClick={onCancel}>취소</Button>
          <Button variant="primary" onClick={onConfirm}>
            BOX로 정하기
          </Button>
        </>
      }
    >
      <p>기준 단위를 BOX로 정하면 수량을 BOX로만 셉니다. 상자가 터져 낱개로 들어오거나 낱개로 출고해야 할 때 시스템이 수량을 나눌 수 없습니다.</p>
      <p className="muted">낱개로 나갈 수 있는 품목이면 기준 단위를 EA로 두고, BOX는 [+ BOX 추가]로 환산(입수)을 넣으세요.</p>
    </Modal>
  );
}
