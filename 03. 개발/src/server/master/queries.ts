import "server-only";
import { db } from "@/server/db";
import { ITEM_REQ_REJECT_GROUP, rolesLabel, sortRoles } from "@/domain/master";
import { isShipperRole } from "@/domain/permissions";
import { getSessionUser } from "@/server/session";
import { countUnclosed } from "@/server/master/unclosed";
import { kstDayRange, todayKst } from "@/lib/format";
import type {
  CenterOption,
  ChangeEntry,
  ClientOption,
  ClientRow,
  CodeGroupRow,
  CodeOption,
  CompanyRow,
  CenterRow,
  HolidayRow,
  CommonCodeRow,
  ManagerCandidate,
  CenterPick,
  ItemKey,
  ItemRequestQueue,
  ItemRequestRow,
  ItemRow,
  SettingRow,
  UserRow,
} from "@/features/master/types";

const iso = (d: Date) => d.toISOString();

/**
 * 화주사 계정은 자기 화주사 데이터만 본다 — 화주사 범위 조건 (3PL은 조건 없음).
 * 세션이 없으면 아무것도 보이지 않게 존재하지 않는 id로 막는다.
 */
async function clientScope(): Promise<number | undefined> {
  const me = await getSessionUser();
  if (!me) return -1;
  return isShipperRole(me.roles) ? (me.clientId ?? -1) : undefined;
}

function audit(r: { version: number; createdAt: Date; createdBy: string; updatedAt: Date; updatedBy: string }) {
  return {
    version: r.version,
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    updatedAt: iso(r.updatedAt),
    updatedBy: r.updatedBy,
  };
}

/** 테이블의 변경 이력을 레코드별로 묶는다 (최신 순) */
async function historyByKey(tableName: string): Promise<Map<string, ChangeEntry[]>> {
  const logs = await db.changeLog.findMany({ where: { tableName }, orderBy: { at: "desc" }, take: 500 });
  const map = new Map<string, ChangeEntry[]>();
  for (const l of logs) {
    const list = map.get(l.recordKey) ?? [];
    list.push({
      id: l.id.toString(),
      action: l.action,
      before: (l.before as Record<string, unknown>) ?? null,
      after: (l.after as Record<string, unknown>) ?? null,
      actor: l.actor,
      at: iso(l.at),
    });
    map.set(l.recordKey, list);
  }
  return map;
}

export async function listClientOptions(): Promise<ClientOption[]> {
  const cid = await clientScope();
  const rows = await db.client.findMany({
    where: { id: cid },
    select: { id: true, code: true, name: true, bizNo: true, isActive: true, centers: { select: { center: { select: { id: true } } } } },
    orderBy: { code: "asc" },
  });
  return rows.map(({ centers, ...c }) => ({ ...c, centerIds: centers.map((x) => x.center.id) }));
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 화주사 목록 (id를 주면 그 한 건) — 이용 센터·담당 운영자·건수·미종결 전표 포함 */
export async function listClients(id?: number): Promise<ClientRow[]> {
  const cid = await clientScope();
  if (cid !== undefined && id !== undefined && cid !== id) return [];
  const [rows, hist] = await Promise.all([
    db.client.findMany({
      where: { id: id ?? cid },
      orderBy: { code: "asc" },
      include: {
        _count: { select: { items: true, users: true } },
        manager: { select: { name: true } },
        centers: { include: { center: { select: { name: true } } }, orderBy: { centerCode: "asc" } },
      },
    }),
    historyByKey("tb_client"),
  ]);
  const unclosed = await countUnclosed(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    bizNo: r.bizNo,
    ceoName: r.ceoName,
    zipCode: r.zipCode,
    addr1: r.addr1,
    addr2: r.addr2,
    tel: r.tel,
    email: r.email,
    contactName: r.contactName,
    contactTel: r.contactTel,
    contactEmail: r.contactEmail,
    managerUserId: r.managerUserId,
    managerName: r.manager.name,
    contractStartDt: ymd(r.contractStartDt),
    contractEndDt: r.contractEndDt ? ymd(r.contractEndDt) : null,
    centers: r.centers.map((c) => ({ code: c.centerCode, name: c.center.name })),
    isActive: r.isActive,
    itemCount: r._count.items,
    userCount: r._count.users,
    unclosed: unclosed.get(r.id)!,
    ...audit(r),
    history: hist.get(String(r.id)) ?? [],
  }));
}

/** 화주사 이용 센터 선택지 (사용 안 함 센터는 이미 연결된 경우에만 화면에서 보인다) */
export async function listCenterPicks(): Promise<CenterPick[]> {
  return db.center.findMany({ select: { code: true, name: true, isActive: true }, orderBy: { code: "asc" } });
}

const UNIT_ORDER = { EA: 0, BOX: 1, PLT: 2 } as const;

export async function listItems(id?: number): Promise<ItemRow[]> {
  const cid = await clientScope();
  const [rows, hist] = await Promise.all([
    db.item.findMany({
      where: { clientId: cid, id },
      orderBy: [{ client: { code: "asc" } }, { code: "asc" }],
      include: {
        client: { select: { name: true } },
        uoms: true,
        barcodes: true,
        aliases: { orderBy: { createdAt: "asc" } },
      },
    }),
    historyByKey("tb_item"),
  ]);
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    code: r.code,
    clientCode: r.clientCode,
    name: r.name,
    baseUnit: r.baseUnit,
    storageTemp: r.storageTemp,
    expiryManaged: r.expiryManaged,
    lotManaged: r.lotManaged,
    isActive: r.isActive,
    uoms: r.uoms.map((u) => ({ unit: u.unit, qty: u.qty })).sort((a, b) => a.qty - b.qty || UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit]),
    barcodes: r.barcodes
      .map((b) => ({ unit: b.unit, barcode: b.barcode, isPrimary: b.isPrimary }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit]),
    aliases: r.aliases.map((a) => ({ id: a.id, alias: a.alias, source: a.source, createdAt: iso(a.createdAt), createdBy: a.createdBy })),
    ...audit(r),
    history: hist.get(String(r.id)) ?? [],
  }));
}

export async function listItemKeys(clientId?: number): Promise<ItemKey[]> {
  const cid = (await clientScope()) ?? clientId;
  const rows = await db.item.findMany({
    where: { clientId: cid },
    select: {
      id: true, clientId: true, code: true, clientCode: true, name: true, isActive: true,
      barcodes: { select: { barcode: true } },
      aliases: { select: { normalized: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, clientId: r.clientId, code: r.code, clientCode: r.clientCode, name: r.name, isActive: r.isActive,
    barcodes: r.barcodes.map((b) => b.barcode),
    aliases: r.aliases.map((a) => a.normalized),
  }));
}

export async function listCodeOptions(groupCode: string): Promise<CodeOption[]> {
  return db.commonCode.findMany({
    where: { groupCode, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, requiresText: true },
  });
}

/** id를 주면 그 요청 하나만 (상세 화면) — 화주사는 자기 요청만 */
export async function listItemRequests(id?: number): Promise<ItemRequestRow[]> {
  const cid = await clientScope();
  const me = await getSessionUser();
  const { start } = kstDayRange(todayKst());
  const [rows, codes] = await Promise.all([
    db.itemRequest.findMany({
      where: { clientId: cid, ...(id ? { id } : {}) },
      orderBy: [{ requestedAt: "asc" }, { requestNo: "asc" }],
      include: {
        client: { select: { name: true } },
        item: { select: { id: true, code: true } },
        histories: { orderBy: { at: "desc" } },
      },
    }),
    db.commonCode.findMany({ where: { groupCode: ITEM_REQ_REJECT_GROUP }, select: { code: true, name: true } }),
  ]);
  const codeName = new Map(codes.map((c) => [c.code, c.name]));
  return rows.map((r) => ({
    id: r.id,
    requestNo: r.requestNo,
    clientId: r.clientId,
    clientName: r.client.name,
    clientCode: r.clientCode,
    itemName: r.itemName,
    unit: r.unit,
    barcode: r.barcode,
    source: r.source,
    sourceNote: r.sourceNote,
    storageTemp: r.storageTemp,
    expiryManaged: r.expiryManaged,
    lotManaged: r.lotManaged,
    status: r.status,
    version: r.version,
    resubmitCount: r.resubmitCount,
    requestedBy: r.requestedBy,
    requestedAt: iso(r.requestedAt),
    processedBy: r.processedBy,
    processedAt: r.processedAt ? iso(r.processedAt) : null,
    rejectReasonCode: r.rejectReasonCode,
    rejectReasonName: r.rejectReasonCode ? (codeName.get(r.rejectReasonCode) ?? r.rejectReasonCode) : null,
    rejectReasonText: r.rejectReasonText,
    registeredItemCode: r.item?.code ?? null,
    registeredItemId: r.item?.id ?? null,
    // 오늘 내가 등록·반려한 마지막 처리 ("오늘 처리" 탭)
    doneByMeToday: (() => {
      const h = r.histories.find((x) => me && x.actorId === me.id && (x.action === "REGISTER" || x.action === "REJECT") && x.at >= start);
      return h ? { action: h.action as "REGISTER" | "REJECT", at: iso(h.at) } : null;
    })(),
    histories: r.histories.map((h) => ({
      id: h.id,
      action: h.action,
      actor: h.actor,
      at: iso(h.at),
      reasonCode: h.reasonCode,
      reasonName: h.reasonCode ? (codeName.get(h.reasonCode) ?? h.reasonCode) : null,
      reasonText: h.reasonText,
      memo: h.memo,
    })),
  }));
}

/** 같은 화주사의 등록대기 요청 순서 — 목록의 등록대기 탭과 같은 순서(오래된 요청부터) */
export async function itemRequestQueue(row: { id: number; clientId: number }): Promise<ItemRequestQueue> {
  const ids = (
    await db.itemRequest.findMany({
      where: { clientId: row.clientId, status: "WAITING" },
      orderBy: [{ requestedAt: "asc" }, { requestNo: "asc" }],
      select: { id: true },
    })
  ).map((r) => r.id);
  const i = ids.indexOf(row.id);
  return {
    position: i >= 0 ? i + 1 : null,
    total: ids.length,
    prevId: i > 0 ? ids[i - 1] : null,
    nextId: i >= 0 ? (ids[i + 1] ?? null) : null,
    afterId: (i >= 0 ? ids[i + 1] : undefined) ?? ids.find((x) => x !== row.id) ?? null,
  };
}

/** 검토 중(등록대기·반려)인 요청 건수 — 화주사 품목 목록 안내용 */
export async function countOpenItemRequests() {
  return db.itemRequest.count({ where: { status: { in: ["WAITING", "REJECTED"] }, clientId: await clientScope() } });
}

/** 반려되어 화주사가 고쳐 다시 보내야 할 요청 건수 — 화주사 사이드바 붉은 숫자 */
export async function countRejectedItemRequests() {
  return db.itemRequest.count({ where: { status: "REJECTED", clientId: await clientScope() } });
}

export async function countWaitingItemRequests() {
  return db.itemRequest.count({ where: { status: "WAITING", clientId: await clientScope() } });
}

export async function listCodeGroups(): Promise<CodeGroupRow[]> {
  return db.codeGroup.findMany({
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, description: true, confirmed: true },
  });
}

export async function listCommonCodes(id?: number): Promise<CommonCodeRow[]> {
  const [rows, hist] = await Promise.all([
    db.commonCode.findMany({ where: { id }, orderBy: [{ groupCode: "asc" }, { sortOrder: "asc" }] }),
    historyByKey("tb_common_code"),
  ]);
  return rows.map((r) => ({
    id: r.id,
    groupCode: r.groupCode,
    code: r.code,
    name: r.name,
    sortOrder: r.sortOrder,
    requiresText: r.requiresText,
    isActive: r.isActive,
    ...audit(r),
    history: hist.get(String(r.id)) ?? [],
  }));
}

export async function listUsers(id?: number): Promise<UserRow[]> {
  const cid = await clientScope();
  const [rows, hist] = await Promise.all([
    db.user.findMany({
      where: { clientId: cid, id },
      orderBy: { loginId: "asc" },
      include: { client: { select: { name: true } }, center: { select: { name: true } }, defaultCenter: { select: { name: true } } },
    }),
    historyByKey("tb_user"),
  ]);
  return rows.map((r) => ({
    id: r.id,
    loginId: r.loginId,
    name: r.name,
    roles: sortRoles(r.roles),
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    centerId: r.centerId,
    centerName: r.center?.name ?? null,
    defaultCenterId: r.defaultCenterId,
    defaultCenterName: r.defaultCenter?.name ?? null,
    isActive: r.isActive,
    locked: !!r.lockedAt,
    lockedAt: r.lockedAt ? iso(r.lockedAt) : null,
    mustChangePw: r.mustChangePw,
    lastLoginAt: r.lastLoginAt ? iso(r.lastLoginAt) : null,
    ...audit(r),
    history: hist.get(String(r.id)) ?? [],
  }));
}

export async function listCenters(): Promise<CenterOption[]> {
  return db.center.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: "asc" } });
}

export async function listSettings(key?: string): Promise<SettingRow[]> {
  const [rows, hist] = await Promise.all([db.setting.findMany({ where: { key }, orderBy: { key: "asc" } }), historyByKey("tb_setting")]);
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.value,
    valueType: r.valueType === "TIME" ? "TIME" : "INT",
    unit: r.unit,
    minValue: r.minValue,
    maxValue: r.maxValue,
    description: r.description,
    version: r.version,
    updatedAt: iso(r.updatedAt),
    updatedBy: r.updatedBy,
    history: hist.get(r.key) ?? [],
  }));
}

export async function getCompany(): Promise<CompanyRow | null> {
  const [r, hist] = await Promise.all([db.company.findUnique({ where: { id: 1 } }), historyByKey("tb_company")]);
  if (!r) return null;
  return {
    name: r.name, bizNo: r.bizNo, ceoName: r.ceoName, zipCode: r.zipCode, addr1: r.addr1, addr2: r.addr2,
    phone: r.phone, email: r.email, version: r.version, updatedAt: iso(r.updatedAt), updatedBy: r.updatedBy,
    history: hist.get("1") ?? [],
  };
}

export async function listCenterRows(id?: number): Promise<CenterRow[]> {
  const [rows, active, hist] = await Promise.all([
    db.center.findMany({ where: { id }, orderBy: { code: "asc" }, include: { manager: { select: { name: true } } } }),
    db.user.groupBy({ by: ["centerId"], where: { isActive: true, centerId: { not: null } }, _count: { _all: true } }),
    historyByKey("tb_center"),
  ]);
  const activeBy = new Map(active.map((a) => [a.centerId, a._count._all]));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    zipCode: r.zipCode,
    addr1: r.addr1,
    addr2: r.addr2,
    inboundTel: r.inboundTel,
    managerUserId: r.managerUserId,
    managerName: r.manager?.name ?? null,
    dailyCloseTime: r.dailyCloseTime,
    isActive: r.isActive,
    activeUserCount: activeBy.get(r.id) ?? 0,
    ...audit(r),
    history: hist.get(String(r.id)) ?? [],
  }));
}

/** 센터 담당자 후보: 그 센터 소속 · 사용 중 · 3PL 관리자 또는 3PL 운영담당 (입고검수자 제외) */
export async function listManagerCandidates(): Promise<ManagerCandidate[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, roles: { hasSome: ["TPL_ADMIN", "TPL_OPERATOR"] }, centerId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, centerId: true, name: true, roles: true, center: { select: { code: true } } },
  });
  // 3PL 관리자 먼저, 그다음 이름 순
  return rows
    .sort((a, b) => Number(b.roles.includes("TPL_ADMIN")) - Number(a.roles.includes("TPL_ADMIN")) || a.name.localeCompare(b.name, "ko"))
    .map((r) => ({
      id: r.id,
      centerId: r.centerId!,
      centerCode: r.center!.code,
      name: r.name,
      roleLabel: rolesLabel(r.roles.filter((x) => x === "TPL_ADMIN" || x === "TPL_OPERATOR")),
    }));
}

export async function listHolidays(): Promise<HolidayRow[]> {
  const rows = await db.holiday.findMany({ orderBy: { date: "asc" }, include: { center: { select: { name: true } } } });
  return rows.map((r) => ({
    id: r.id,
    centerId: r.centerId,
    centerName: r.center.name,
    date: r.date.toISOString().slice(0, 10),
    name: r.name,
    kind: r.kind,
    source: r.source,
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
  }));
}
