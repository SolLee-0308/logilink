"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModeSwitch } from "@/components/ui/ModeSwitch";
import { Modal } from "@/components/ui/Overlay";
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

const MODE_LABEL: Record<ItemNewMode, string> = { single: "한 품목씩", excel: "엑셀로 여러 품목" };

/**
 * 등록 방법 탭 — 주소(?mode=excel)에 남겨 새로고침·뒤로 가기에도 그대로.
 * 지금 탭에 입력한 내용이 있으면 바꾸기 전에 확인창을 띄우고, 바꾸면 그 탭 내용을 지운다 (2026-11-07 Sol 피드백:
 * 한 탭에 입력한 채 다른 탭에서 요청하면 어느 내용이 요청되는지 헷갈림). 두 탭 내용이 동시에 남지 않는다.
 */
function useModeTab(defaultMode: ItemNewMode) {
  const [mode, setMode] = useState<ItemNewMode>(defaultMode);
  const dirty = useRef<Record<ItemNewMode, boolean>>({ single: false, excel: false });
  // 탭 내용을 지울 때 key를 올려 다시 그린다
  const [keys, setKeys] = useState<Record<ItemNewMode, number>>({ single: 0, excel: 0 });
  const [pending, setPending] = useState<ItemNewMode | null>(null);

  function apply(m: ItemNewMode) {
    setMode(m);
    const u = new URL(window.location.href);
    if (m === "excel") u.searchParams.set("mode", "excel");
    else u.searchParams.delete("mode");
    window.history.replaceState(null, "", u.pathname + u.search);
  }
  function change(m: ItemNewMode) {
    if (m === mode) return;
    if (dirty.current[mode]) setPending(m);
    else apply(m);
  }
  function confirmChange() {
    if (!pending) return;
    dirty.current[mode] = false;
    setKeys((k) => ({ ...k, [mode]: k[mode] + 1 }));
    apply(pending);
    setPending(null);
  }

  const onSingleDirty = useCallback((d: boolean) => {
    dirty.current.single = d;
  }, []);
  const onExcelDirty = useCallback((d: boolean) => {
    dirty.current.excel = d;
  }, []);

  const confirmModal = (
    <Modal
      open={pending !== null}
      onClose={() => setPending(null)}
      title={`입력 방법을 '${pending ? MODE_LABEL[pending] : ""}'으로 바꿀까요?`}
      description={`'${MODE_LABEL[mode]}'에 입력한 내용은 지워집니다. 지금 내용을 보내려면 [계속 입력]을 누르세요.`}
      footer={
        <>
          <Button onClick={() => setPending(null)} data-autofocus>
            계속 입력
          </Button>
          <Button variant="danger" onClick={confirmChange}>
            지우고 바꾸기
          </Button>
        </>
      }
    />
  );

  return { mode, change, keys, onSingleDirty, onExcelDirty, confirmModal };
}

const MODE_ITEMS = [
  { key: "single" as const, label: MODE_LABEL.single, icon: "pencil" as const },
  { key: "excel" as const, label: MODE_LABEL.excel, icon: "sheet" as const },
];

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
  const { mode, change, keys, onSingleDirty, onExcelDirty, confirmModal } = useModeTab(defaultMode);

  return (
    <>
      <SubHeader
        section="품목 관리"
        title="품목 등록"
        backHref="/master/items"
        storageKey={ITEM_LIST_KEY}
        rules={RULES.items}
        actions={<ModeSwitch label="입력 방법" value={mode} onChange={change} items={MODE_ITEMS} />}
      />
      <div className={styles.tabBody}>
        <div hidden={mode !== "single"}>
          <ItemForm
            key={keys.single}
            row={null}
            clients={clients}
            defaultClientId={defaultClientId}
            onCancel={() => router.push(itemListUrl())}
            onSaved={(id) => router.push(itemListUrl(id))}
            onDirtyChange={onSingleDirty}
          />
        </div>
        <div hidden={mode !== "excel"} className={styles.tabBody}>
          <ItemBulkScreen
            key={keys.excel}
            kind="ITEM"
            clients={clients.filter((c) => c.isActive)}
            defaultClientId={defaultClientId}
            clientName=""
            embedded
            onDirtyChange={onExcelDirty}
          />
        </div>
      </div>
      {confirmModal}
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
  const { mode, change, keys, onSingleDirty, onExcelDirty, confirmModal } = useModeTab(defaultMode);
  return (
    <>
      {/* 2026-11-06 시안: 별도 탭 영역 없이 화면 제목 줄 오른쪽에 입력 방법 전환 스위치 — 두 방법 모두 같은 자리 */}
      <SubHeader
        section="품목 등록 요청"
        title="등록 요청"
        backHref="/master/item-requests"
        storageKey={REQ_LIST_KEY}
        rules={RULES.itemRequests}
        actions={<ModeSwitch label="입력 방법" value={mode} onChange={change} items={MODE_ITEMS} />}
      />
      <div className={styles.tabBody}>
        <div hidden={mode !== "single"}>
          <ItemRequestForm
            key={keys.single}
            clientName={clientName}
            onCancel={() => router.push(reqListUrl())}
            onSaved={() => router.push(reqListUrl("wait"))}
            onDirtyChange={onSingleDirty}
          />
        </div>
        <div hidden={mode !== "excel"} className={styles.tabBody}>
          <ItemBulkScreen key={keys.excel} kind="REQUEST" clients={[]} defaultClientId="" clientName={clientName} embedded onDirtyChange={onExcelDirty} />
        </div>
      </div>
      {confirmModal}
    </>
  );
}
