"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ModeSwitch } from "@/components/ui/ModeSwitch";
import { ItemBulkScreen } from "./ItemBulkScreen";
import { ItemForm } from "./ItemForm";
import { ItemRequestForm } from "./ItemRequestForm";
import { REQ_LIST_KEY, reqListUrl } from "./item-request-list";
import { ITEM_LIST_KEY, itemListUrl } from "./ItemsScreen";
import { RULES } from "./rules";
import { SubHeader } from "./shared";
import type { ClientOption, ItemRow } from "./types";
import styles from "./ItemPages.module.css";

export type ItemNewMode = "single" | "excel";

/** 등록 방법 탭 — 주소(?mode=excel)에 남겨 새로고침·뒤로 가기에도 그대로 */
function useModeTab(defaultMode: ItemNewMode) {
  const [mode, setMode] = useState<ItemNewMode>(defaultMode);
  function change(m: ItemNewMode) {
    setMode(m);
    const u = new URL(window.location.href);
    if (m === "excel") u.searchParams.set("mode", "excel");
    else u.searchParams.delete("mode");
    window.history.replaceState(null, "", u.pathname + u.search);
  }
  return [mode, change] as const;
}

/**
 * 3PL 품목 등록 화면 (/master/items/new) — 화면 제목 줄 오른쪽 '입력 방법' 스위치: [한 품목씩] / [엑셀로 여러 품목].
 * 두 탭 모두 마운트해 두어 탭을 바꿔도 입력·검사 결과가 남는다. 탭은 주소(?mode=excel)에 남긴다.
 * 단건은 저장하면 그 품목이 선택된 목록으로, 엑셀은 그 화주사 목록으로 돌아간다.
 */
export function ItemNewScreen({
  clients,
  defaultClientId,
  defaultMode,
}: {
  clients: ClientOption[];
  defaultClientId: string;
  defaultMode: ItemNewMode;
}) {
  const router = useRouter();
  const [mode, change] = useModeTab(defaultMode);

  return (
    <>
      <SubHeader
        section="품목 관리"
        title="품목 등록"
        backHref="/master/items"
        storageKey={ITEM_LIST_KEY}
        rules={RULES.items}
        actions={
          <ModeSwitch
            label="입력 방법"
            value={mode}
            onChange={change}
            items={[
              { key: "single", label: "한 품목씩", icon: "pencil" },
              { key: "excel", label: "엑셀로 여러 품목", icon: "sheet" },
            ]}
          />
        }
      />
      <div className={styles.tabBody}>
        <div hidden={mode !== "single"}>
          <ItemForm
            row={null}
            clients={clients}
            defaultClientId={defaultClientId}
            onCancel={() => router.push(itemListUrl())}
            onSaved={(id) => router.push(itemListUrl(id))}
          />
        </div>
        <div hidden={mode !== "excel"} className={styles.tabBody}>
          <ItemBulkScreen kind="ITEM" clients={clients.filter((c) => c.isActive)} defaultClientId={defaultClientId} clientName="" embedded />
        </div>
      </div>
    </>
  );
}

/**
 * 3PL 품목 수정 화면 (/master/items/[id]/edit) — 화면을 열 때 서버에서 최신 내용·version을 읽는다.
 * 저장 충돌이면 최신 내용을 다시 읽어 폼을 새로 그린다(key = version).
 */
export function ItemEditScreen({ row }: { row: ItemRow }) {
  const router = useRouter();
  return (
    <>
      <SubHeader section="품목 관리" title={`품목 수정 · ${row.code}`} backHref="/master/items" storageKey={ITEM_LIST_KEY} rules={RULES.items} />
      <ItemForm
        key={row.version}
        row={row}
        clients={[]}
        onCancel={() => router.push(itemListUrl(row.id))}
        onSaved={(id) => router.push(itemListUrl(id))}
        onConflict={() => router.refresh()}
      />
    </>
  );
}

/**
 * 화주사 품목 등록 요청 화면 (/master/item-requests/new) — 화면 제목 줄 오른쪽 '입력 방법' 스위치: [한 품목씩] / [엑셀로 여러 품목].
 * 보내면 요청 목록(등록대기)으로 돌아간다.
 */
export function ItemRequestNewScreen({ clientName, defaultMode }: { clientName: string; defaultMode: ItemNewMode }) {
  const router = useRouter();
  const [mode, change] = useModeTab(defaultMode);
  return (
    <>
      {/* 2026-11-06 시안: 별도 탭 영역 없이 화면 제목 줄 오른쪽에 입력 방법 전환 스위치 — 두 방법 모두 같은 자리 */}
      <SubHeader
        section="품목 등록 요청"
        title="등록 요청"
        backHref="/master/item-requests"
        storageKey={REQ_LIST_KEY}
        rules={RULES.itemRequests}
        actions={
          <ModeSwitch
            label="입력 방법"
            value={mode}
            onChange={change}
            items={[
              { key: "single", label: "한 품목씩", icon: "pencil" },
              { key: "excel", label: "엑셀로 여러 품목", icon: "sheet" },
            ]}
          />
        }
      />
      <div className={styles.tabBody}>
        <div hidden={mode !== "single"}>
          <ItemRequestForm clientName={clientName} onCancel={() => router.push(reqListUrl())} onSaved={() => router.push(reqListUrl("wait"))} />
        </div>
        <div hidden={mode !== "excel"} className={styles.tabBody}>
          <ItemBulkScreen kind="REQUEST" clients={[]} defaultClientId="" clientName={clientName} embedded />
        </div>
      </div>
    </>
  );
}
