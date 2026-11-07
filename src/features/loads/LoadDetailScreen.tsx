"use client";

import { Badge } from "@/components/ui/Badges";
import { Card } from "@/components/ui/Card";
import { NoteBox } from "@/components/ui/NoteBox";
import { LOAD_STATUS_META } from "@/domain/load-rules";
import { SubHeader } from "@/features/master/shared";
import { ViewSection } from "@/features/master/record";
import { ASN_RULES, ASN_STATUS_RULES } from "@/features/asn/rules";
import { ASN_LIST_KEY } from "@/features/asn/asn-list";
import { ASN_STATUS_LIST_KEY } from "@/features/asn/asn-status-list";
import { LoadSection } from "./LoadSection";
import { RcvSection } from "@/features/rcv/RcvSection";
import type { RcvView } from "@/features/rcv/types";
import type { LoadView } from "./types";

/**
 * 무지시 상차 상세 (웹, 조회 전용) — 예정 외 차량은 ASN이 없어 상차 실적만 있다 (D12).
 * 화주사 담당자는 ASN 등록 목록에서, 3PL은 ASN·상차 현황에서 들어온다.
 */
export function LoadDetailScreen({ load, view, rcv = null }: { load: LoadView; view: "shipper" | "tpl"; rcv?: RcvView | null }) {
  const tpl = view === "tpl";
  const meta = LOAD_STATUS_META[load.status];
  return (
    <>
      <SubHeader
        group={["입고 계획"]}
        section={tpl ? "ASN·상차 현황" : "ASN 등록"}
        title={load.loadNo}
        backHref={tpl ? "/plans/asn-status" : "/plans/asn"}
        storageKey={tpl ? ASN_STATUS_LIST_KEY : ASN_LIST_KEY}
        rules={tpl ? ASN_STATUS_RULES : ASN_RULES}
        badges={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />
      <NoteBox tone="warn">
        <strong>무지시 상차 · 예정 외 차량</strong> — ASN 없이 실은 차량이라 전량이 지시와의 차이로 남습니다.
        {tpl ? " 검수 때 실제 수량을 확인하고, 확정하면 화주사의 승인 입고예정에 자동 배분됩니다." : " 다음부터는 상차 전에 ASN을 등록해 주세요."}
      </NoteBox>
      <Card title="차량 정보">
        <ViewSection
          items={[
            ...(tpl ? ([["화주사", load.clientName]] as [string, React.ReactNode][]) : []),
            ["차량번호", <span key="v" className="mono">{load.vehicleNo}</span>],
            ["센터", load.centerName],
            ["상차일", <span key="d" className="mono">{load.loadDate}</span>],
          ]}
        />
      </Card>
      {rcv && <RcvSection rcv={rcv} />}
      <LoadSection load={load} />
    </>
  );
}
