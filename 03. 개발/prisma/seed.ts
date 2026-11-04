/**
 * 기준정보 초기 데이터 — `npx prisma db seed`
 * 기존 데이터를 모두 지우고 다시 넣는다 (개발용).
 * 사유 코드 중 정의서에 값이 없는 그룹은 임시안이며 tb_code_group.confirmed = false 로 표시한다.
 * 회사·센터·주소·전화 등은 가상 값이다.
 * 사용자 초기 비밀번호는 .env의 SEED_DEFAULT_PASSWORD에서 읽는다 (코드·저장소에 비밀번호를 두지 않는다).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { PASSWORD_RULE_TEXT, isValidPassword } from "../src/domain/validators";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }) });
const SYS = "시스템";
const t = (s: string) => new Date(`${s}:00+09:00`);

/** 시드로 만든 기준정보에 "시스템 · 등록" 이력을 남긴다 */
const createLogs: Prisma.ChangeLogCreateManyInput[] = [];
const created = (tableName: string, recordKey: string | number, after: Record<string, unknown>) =>
  createLogs.push({ tableName, recordKey: String(recordKey), action: "CREATE", actor: SYS, after: after as Prisma.InputJsonValue });

function seedPassword() {
  const pw = process.env.SEED_DEFAULT_PASSWORD;
  if (!pw) throw new Error(".env에 SEED_DEFAULT_PASSWORD(시드 사용자 초기 비밀번호)를 넣은 뒤 다시 실행하세요.");
  if (!isValidPassword(pw)) throw new Error(`SEED_DEFAULT_PASSWORD가 비밀번호 규칙에 맞지 않습니다: ${PASSWORD_RULE_TEXT}`);
  return pw;
}

/** key는 시드 안에서만 쓰는 약어(품목·요청이 참조), code는 실제 화주사 코드(영문 2 + 순번 2) */
const CLIENTS = [
  {
    key: "HB", code: "HB01", name: "한빛식품", bizNo: "214-86-50011", ceoName: "한지원", zipCode: "08390",
    addr1: "서울특별시 구로구 디지털로 300", addr2: "한빛빌딩 5층", tel: "02-555-0101", email: "info@hanbit-food.example",
    contactName: "박민지", contactTel: "010-5550-1101", contactEmail: "minji@hanbit-food.example",
    manager: "kim.haneul", centers: ["YI1", "IC2"], start: "2025-03-01",
  },
  {
    key: "GM", code: "GM01", name: "그린마켓", bizNo: "120-81-47521", ceoName: "이초록", zipCode: "13487",
    addr1: "경기도 성남시 분당구 판교로 255", addr2: "그린타워 3층", tel: "031-555-0202", email: null,
    contactName: "이도윤", contactTel: "010-5550-2202", contactEmail: null,
    manager: "lee.jun", centers: ["YI1"], start: "2025-06-01",
  },
  {
    key: "OF", code: "OF01", name: "오션푸드", bizNo: "617-81-23455", ceoName: "강바다", zipCode: "48058",
    addr1: "부산광역시 해운대구 센텀중앙로 97", addr2: "B동 12층", tel: "051-555-0303", email: "biz@oceanfood.example",
    contactName: "정서준", contactTel: "010-5550-3303", contactEmail: "seojun@oceanfood.example",
    manager: "kim.haneul", centers: ["YI1"], start: "2025-09-15",
  },
  {
    key: "DO", code: "DO01", name: "다온생활", bizNo: "305-86-71234", ceoName: "최다온", zipCode: "34126",
    addr1: "대전광역시 유성구 대학로 99", addr2: "다온빌딩 2층", tel: null, email: null,
    contactName: "최유나", contactTel: "010-5550-4404", contactEmail: null,
    manager: "han.soyul", centers: ["YI1"], start: "2026-01-02", end: "2027-12-31",
  },
  {
    key: "SB", code: "SB01", name: "새봄유통", bizNo: "402-81-36848", ceoName: "윤새봄", zipCode: "54999",
    addr1: "전라북도 전주시 완산구 홍산로 245", addr2: "1층", tel: "063-555-0505", email: null,
    contactName: "윤새봄", contactTel: "010-5550-5505", contactEmail: null,
    manager: "lee.jun", centers: ["YI1"], start: "2024-05-01", end: "2026-04-30", isActive: false,
  },
];

type U = "EA" | "BOX" | "PLT";
type T = "ROOM" | "CHILLED" | "FROZEN";
interface SeedItem {
  client: string;
  code: string;
  name: string;
  base: U;
  temp: T;
  expiry?: boolean;
  lot?: boolean;
  active?: boolean;
  /** 기준 단위 외 환산: [단위, 기준 단위 수량] */
  uoms?: [U, number][];
  /** [단위, 바코드] — 첫 번째가 대표 */
  barcodes: [U, string][];
  aliases?: [alias: string, source: "MANUAL" | "REQUEST" | "MATCH"][];
}

const ITEMS: SeedItem[] = [
  { client: "HB", code: "HB-1001", name: "국산콩 두부 300g", base: "EA", temp: "CHILLED", expiry: true, uoms: [["BOX", 20]],
    barcodes: [["EA", "8801100010014"], ["BOX", "18801100010011"]], aliases: [["국산콩두부 300", "MATCH"], ["두부 300g", "MANUAL"]] },
  { client: "HB", code: "HB-1004", name: "유기농 콩나물 500g", base: "EA", temp: "CHILLED", expiry: true, uoms: [["BOX", 12]],
    barcodes: [["EA", "8801100010045"], ["BOX", "18801100010042"]] },
  { client: "HB", code: "HB-2210", name: "생수 2L×6", base: "EA", temp: "ROOM", expiry: true, uoms: [["PLT", 80]],
    barcodes: [["EA", "8801100022109"]] },
  { client: "HB", code: "HB-3105", name: "김치 3kg", base: "EA", temp: "CHILLED", expiry: true, lot: true, uoms: [["BOX", 4]],
    barcodes: [["EA", "8801100031057"], ["BOX", "18801100031054"]] },
  { client: "HB", code: "HB-4402", name: "두유 190ml×24", base: "BOX", temp: "ROOM", expiry: true, lot: true, uoms: [["PLT", 60]],
    barcodes: [["BOX", "8801100044026"]] },
  { client: "GM", code: "GM-0501", name: "친환경 세제 3L", base: "EA", temp: "ROOM", uoms: [["BOX", 4]],
    barcodes: [["EA", "8802200005013"], ["BOX", "18802200005010"]] },
  { client: "GM", code: "GM-0512", name: "주방 행주 10매", base: "EA", temp: "ROOM", uoms: [["BOX", 20]],
    barcodes: [["EA", "8802200005120"]] },
  { client: "GM", code: "GM-0730", name: "종이타월 6롤", base: "EA", temp: "ROOM", uoms: [["BOX", 8]],
    barcodes: [["EA", "8802200007308"], ["BOX", "18802200007305"]], aliases: [["종이타올 6롤", "MATCH"]] },
  { client: "GM", code: "GM-0801", name: "물티슈 100매×10", base: "EA", temp: "ROOM", uoms: [["BOX", 10]],
    barcodes: [["EA", "8802200008015"]] },
  { client: "OF", code: "OF-2201", name: "냉동 고등어 1kg", base: "EA", temp: "FROZEN", expiry: true, lot: true, uoms: [["BOX", 10]],
    barcodes: [["EA", "8803300022011"], ["BOX", "18803300022018"]] },
  { client: "OF", code: "OF-2208", name: "손질 오징어 800g", base: "EA", temp: "FROZEN", expiry: true, lot: true, uoms: [["BOX", 12]],
    barcodes: [["EA", "8803300022080"]], aliases: [["손질오징어 800", "REQUEST"]] },
  { client: "DO", code: "DO-0101", name: "욕실 매트", base: "EA", temp: "ROOM", uoms: [["BOX", 10]],
    barcodes: [["EA", "8804400001019"]] },
  { client: "DO", code: "DO-0144", name: "수납 바구니 L", base: "EA", temp: "ROOM", uoms: [["BOX", 6]],
    barcodes: [["EA", "8804400001446"]] },
  { client: "DO", code: "DO-0099", name: "욕실 매트 (구형)", base: "EA", temp: "ROOM", active: false,
    barcodes: [["EA", "8804400000999"]] },
];

const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const CODE_GROUPS: {
  code: string;
  name: string;
  description: string;
  confirmed: boolean;
  codes: [code: string, name: string, requiresText?: boolean][];
}[] = [
  {
    code: "LOAD_DIFF",
    name: "상차 차이",
    description: "상차완료 시 ASN 대비 차이가 있으면 필수 선택 (정의서 ④, C6)",
    confirmed: true,
    codes: [
      ["L01", "재고 부족(결품)"],
      ["L02", "차량 적재 공간 부족"],
      ["L03", "타 차량 이관"],
      ["L04", "예정 외 차량(무지시)"],
      ["L05", "상차 중 파손 발견"],
      ["L99", "기타", true],
    ],
  },
  {
    code: "RCV_DIFF",
    name: "검수 차이·반송",
    description: "입고검수 이상 처리 시 선택 (정의서 ⑥ 이상 유형 기준 임시안)",
    confirmed: false,
    codes: [
      ["V01", "수량 부족"],
      ["V02", "수량 초과"],
      ["V03", "훼손·오염(반송)"],
      ["V04", "품목 불일치(반송)"],
      ["V05", "미도착"],
      ["V99", "기타", true],
    ],
  },
  {
    code: "REMAIN_CLOSE",
    name: "잔량 종결",
    description: "3PL 잔량 종결 시 필수 (정의서 ⑦ 예시 기준 임시안)",
    confirmed: false,
    codes: [
      ["C01", "미도착"],
      ["C02", "화주사 요청"],
      ["C99", "기타", true],
    ],
  },
  {
    code: "PLAN_REJECT",
    name: "입고예정 반려",
    description: "입고예정 반려 시 필수 (승인 대기 시안 임시값)",
    confirmed: false,
    codes: [
      ["R01", "품목 정보 오류"],
      ["R02", "수량 확인 필요"],
      ["R03", "입고예정일 조정 필요"],
      ["R04", "센터 입고 여력 부족"],
      ["R05", "중복 등록"],
      ["R99", "기타", true],
    ],
  },
  {
    code: "CANCEL",
    name: "취소",
    description: "화주사 취소·3PL 승인 건 취소 시 (임시안). 기한경과는 일마감 자동 처리용",
    confirmed: false,
    codes: [
      ["X01", "화주사 입고 취소 요청"],
      ["X02", "중복 등록"],
      ["X03", "입고 일정 변경"],
      ["X04", "기한경과(일마감 자동)"],
      ["X99", "기타", true],
    ],
  },
  {
    code: "ITEM_REQ_REJECT",
    name: "품목 등록 반려",
    description: "품목 등록 요청 반려 시 필수 (임시안)",
    confirmed: false,
    codes: [
      ["I01", "기존 품목과 중복"],
      ["I02", "바코드 오류·중복"],
      ["I03", "단위 확인 필요"],
      ["I04", "품목 정보 부족"],
      ["I99", "기타", true],
    ],
  },
];

async function main() {
  const password = seedPassword();

  // 모든 기준정보 테이블을 비우고 번호를 1부터 다시 시작한다 (로그인 세션·이력 포함)
  await db.$executeRawUnsafe(
    'TRUNCATE tb_inb_plan_his, tb_inb_plan_rej_d, tb_inb_plan_rej_h, tb_inb_plan_d, tb_inb_plan_h, tb_session, tb_login_log, tb_change_log, tb_item_req_his, tb_item_req, tb_item_alias, tb_item_barcode, tb_item_uom, tb_item, tb_user, tb_holiday, tb_client_center, tb_client, tb_common_code, tb_code_group, tb_setting, tb_company, tb_center RESTART IDENTITY CASCADE',
  );

  // 회사 정보 (3PL 운영 법인, 가상) — 시스템명 LogiLink와 운영사명을 분리한다
  const company = {
    name: "온길로지스(주)",
    bizNo: "123-45-67891", // 체크섬을 통과하는 가상 번호
    ceoName: "정다온",
    zipCode: "17084",
    addr1: "경기도 용인시 기흥구 온길로 128",
    addr2: "온길타워 7층",
    phone: "031-555-0128",
    email: "contact@ongil-logis.example",
  };
  await db.company.create({ data: { ...company, updatedBy: SYS } });
  created("tb_company", 1, company);

  // 센터 (가상 주소) — 일마감 예정 시각은 운영 설정에서 센터로 옮겼다
  const centerData = {
    code: "YI1",
    name: "용인1센터",
    zipCode: "17030",
    addr1: "경기도 용인시 처인구 백암면 물류단지로 45",
    addr2: "A동 1층 입고장",
    inboundTel: "031-555-0300",
    dailyCloseTime: "18:00",
    isActive: true,
  };
  const center = await db.center.create({ data: { ...centerData, companyId: 1, createdBy: SYS, updatedBy: SYS } });
  const center2Data = {
    code: "IC2",
    name: "이천2센터",
    zipCode: "17405",
    addr1: "경기도 이천시 마장면 물류로 210",
    addr2: "냉장동 1층",
    inboundTel: "031-555-0400",
    dailyCloseTime: "17:00",
    isActive: true,
  };
  const center2 = await db.center.create({ data: { ...center2Data, companyId: 1, createdBy: SYS, updatedBy: SYS } });
  const centerIdOf: Record<string, number> = { YI1: center.id, IC2: center2.id };

  // 휴무일 — 날짜가 고정된 공휴일만 넣는다. 설날·추석·부처님오신날·대체공휴일은 화면에서 추가
  const HOLIDAYS: [string, string][] = [
    ["2026-12-25", "성탄절"], ["2027-01-01", "신정"], ["2027-03-01", "삼일절"], ["2027-05-05", "어린이날"],
    ["2027-06-06", "현충일"], ["2027-08-15", "광복절"], ["2027-10-03", "개천절"], ["2027-10-09", "한글날"], ["2027-12-25", "성탄절"],
  ];
  await db.holiday.createMany({
    data: HOLIDAYS.map(([d, name]) => ({ centerId: center.id, date: new Date(d + "T00:00:00Z"), name, kind: "PUBLIC" as const, createdBy: SYS })),
  });

  type Role = "SHIPPER_STAFF" | "SHIPPER_LOADER" | "TPL_ADMIN" | "TPL_OPERATOR" | "TPL_INSPECTOR";
  // [아이디, 이름, 역할, 소속(3PL은 센터 코드 / 화주사는 화주사 약어), 사용 여부]
  // 역할이 여러 개면 배열 (작은 화주사·센터에서 한 사람이 여러 역할을 맡는 경우)
  const users: [loginId: string, name: string, role: Role | Role[], scope: string, active?: boolean][] = [
    ["han.soyul", "한소율", "TPL_ADMIN", "YI1"],
    ["kim.haneul", "김하늘", "TPL_OPERATOR", "YI1"],
    ["lee.jun", "이준", ["TPL_OPERATOR", "TPL_INSPECTOR"], "YI1"],
    ["jung.minseo", "정민서", "TPL_OPERATOR", "IC2"],
    ["park.seoyeon", "박서연", "TPL_INSPECTOR", "YI1"],
    ["choi.woojin", "최우진", "TPL_INSPECTOR", "YI1"],
    ["hb.minji", "박민지", "SHIPPER_STAFF", "HB"],
    ["hb.jiho", "한지호", "SHIPPER_LOADER", "HB"],
    ["gm.doyun", "이도윤", "SHIPPER_STAFF", "GM"],
    ["gm.sera", "오세라", "SHIPPER_LOADER", "GM"],
    ["of.seojun", "정서준", "SHIPPER_STAFF", "OF"],
    ["do.yuna", "최유나", ["SHIPPER_STAFF", "SHIPPER_LOADER"], "DO"],
    ["do.minho", "윤민호", "SHIPPER_LOADER", "DO", false],
  ];
  const DEFAULT_CENTER: Record<string, string> = { "hb.minji": "YI1" };
  const userId: Record<string, number> = {};
  const clientId: Record<string, number> = {};
  async function createUser([loginId, name, role, scopeKey, active]: (typeof users)[number]) {
    const roles = Array.isArray(role) ? role : [role];
    const isShipper = roles[0].startsWith("SHIPPER");
    const row = await db.user.create({
      data: {
        loginId,
        name,
        roles,
        clientId: isShipper ? clientId[scopeKey] : null,
        centerId: isShipper ? null : centerIdOf[scopeKey],
        // 화주사 사용자 기본 센터 예시 — 박민지(한빛식품, 이용 센터 2곳)는 용인1센터
        defaultCenterId: DEFAULT_CENTER[loginId] ? centerIdOf[DEFAULT_CENTER[loginId]] : null,
        isActive: active ?? true,
        // 개발용 시드라 첫 로그인 비밀번호 변경은 강제하지 않는다 (관리자 초기화 후에는 강제)
        passwordHash: await hashPassword(password),
        mustChangePw: false,
        pwChangedAt: new Date(),
        createdBy: SYS,
        updatedBy: SYS,
      },
    });
    userId[loginId] = row.id;
    created("tb_user", row.id, { loginId, name, roles: roles.join(","), clientId: row.clientId, centerId: row.centerId, isActive: row.isActive });
  }
  const isShipperUser = (u: (typeof users)[number]) => (Array.isArray(u[2]) ? u[2][0] : u[2]).startsWith("SHIPPER");
  for (const u of users) if (!isShipperUser(u)) await createUser(u);

  // 화주사 — 3PL 담당 운영자·이용 센터 포함
  for (const c of CLIENTS) {
    const { key, manager, centers, start, end, isActive, ...info } = c as (typeof CLIENTS)[number] & { end?: string; isActive?: boolean };
    const row = await db.client.create({
      data: {
        ...info,
        managerUserId: userId[manager],
        contractStartDt: new Date(start + "T00:00:00Z"),
        contractEndDt: end ? new Date(end + "T00:00:00Z") : null,
        isActive: isActive ?? true,
        createdBy: SYS,
        updatedBy: SYS,
        centers: { create: centers.map((code) => ({ centerCode: code, createdBy: SYS })) },
      },
    });
    clientId[key] = row.id;
    const managerName = users.find((u) => u[0] === manager)![1];
    created("tb_client", row.id, {
      ...info, manager: managerName, contractStartDt: start, contractEndDt: end ?? null,
      centers: [...centers].sort().join(", "), isActive: row.isActive,
    });
  }
  for (const u of users) if (isShipperUser(u)) await createUser(u);

  const itemId: Record<string, number> = {};
  for (const it of ITEMS) {
    const cid = clientId[it.client];
    const row = await db.item.create({
      data: {
        clientId: cid,
        code: it.code,
        name: it.name,
        baseUnit: it.base,
        storageTemp: it.temp,
        expiryManaged: !!it.expiry,
        lotManaged: !!it.lot,
        isActive: it.active ?? true,
        createdBy: SYS,
        updatedBy: SYS,
        uoms: { create: [{ unit: it.base, qty: 1 }, ...(it.uoms ?? []).map(([unit, qty]) => ({ unit, qty }))] },
      },
    });
    await db.itemBarcode.createMany({
      data: it.barcodes.map(([unit, barcode], i) => ({ itemId: row.id, clientId: cid, unit, barcode, isPrimary: i === 0 })),
    });
    if (it.aliases?.length)
      await db.itemAlias.createMany({
        data: it.aliases.map(([alias, source]) => ({ itemId: row.id, clientId: cid, alias, normalized: normalize(alias), source, createdBy: SYS })),
      });
    itemId[it.code] = row.id;
    created("tb_item", row.id, {
      code: row.code,
      name: row.name,
      baseUnit: row.baseUnit,
      storageTemp: row.storageTemp,
      expiryManaged: row.expiryManaged,
      lotManaged: row.lotManaged,
      isActive: row.isActive,
    });
  }

  for (const [gi, g] of CODE_GROUPS.entries()) {
    await db.codeGroup.create({
      data: { code: g.code, name: g.name, description: g.description, confirmed: g.confirmed, sortOrder: gi + 1 },
    });
    await db.commonCode.createManyAndReturn({
      data: g.codes.map(([code, name, requiresText], i) => ({
        groupCode: g.code,
        code,
        name,
        requiresText: !!requiresText,
        sortOrder: (i + 1) * 10,
        createdBy: SYS,
        updatedBy: SYS,
      })),
    }).then((rows) =>
      rows.forEach((r) => created("tb_common_code", r.id, { groupCode: r.groupCode, code: r.code, name: r.name, sortOrder: r.sortOrder, requiresText: r.requiresText, isActive: r.isActive })),
    );
  }

  // 센터 담당자 — 용인1센터 소속 3PL 운영담당
  await db.center.update({ where: { id: center.id }, data: { managerUserId: userId["kim.haneul"] } });
  created("tb_center", center.id, { ...centerData, managerUserId: userId["kim.haneul"] });
  await db.center.update({ where: { id: center2.id }, data: { managerUserId: userId["jung.minseo"] } });
  created("tb_center", center2.id, { ...center2Data, managerUserId: userId["jung.minseo"] });

  await db.setting.create({
    data: {
      key: "UNCLOSED_ALERT_DAYS",
      label: "미종결 알림 기준 경과일",
      value: "3",
      unit: "일",
      minValue: 1,
      maxValue: 30,
      description: "입고예정일로부터 이 일수가 지나도 종결되지 않은 입고예정(승인·부분입고)을 알림 대상으로 봅니다. (정의서 미결 O2)",
      updatedBy: SYS,
    },
  });
  created("tb_setting", "UNCLOSED_ALERT_DAYS", { value: "3" });

  // 품목 등록 요청
  const reqs = [
    {
      requestNo: "IR-20261102-0003", client: "OF", itemCode: "OF-2230", itemName: "새우살 500g", unit: "BOX" as U,
      barcode: "8803300022301", source: "AI" as const, sourceNote: "이미지 판독값: '새우살 500g × 20' (신뢰도 0.62, 유사 품목 없음)", storageTemp: "FROZEN" as const, expiryManaged: true, lotManaged: true,
      status: "WAITING" as const, requestedBy: "정서준", requestedAt: t("2026-11-02T07:40"),
      hist: [{ action: "REQUEST" as const, actor: "정서준", at: t("2026-11-02T07:40") }],
    },
    {
      requestNo: "IR-20261102-0002", client: "GM", itemCode: "GM-0745", itemName: "키친타월 리필 4롤", unit: "BOX" as U,
      barcode: "8802200007308", source: "EXCEL" as const, sourceNote: "엑셀 4행: '키친타월 리필 4롤 / 30 BOX' — 품목 마스터 미매칭",
      status: "WAITING" as const, requestedBy: "이도윤", requestedAt: t("2026-11-02T09:20"),
      hist: [{ action: "REQUEST" as const, actor: "이도윤", at: t("2026-11-02T09:20") }],
    },
    {
      requestNo: "IR-20261101-0007", client: "HB", itemCode: "HB-1002", itemName: "국산콩 두부 300g 실속형", unit: "BOX" as U,
      barcode: "8801100010021", source: "DIRECT" as const, sourceNote: null,
      status: "WAITING" as const, resubmitCount: 1, version: 2, requestedBy: "박민지", requestedAt: t("2026-11-02T08:30"),
      hist: [
        { action: "REQUEST" as const, actor: "박민지", at: t("2026-11-01T14:00") },
        { action: "REJECT" as const, actor: "김하늘", at: t("2026-11-01T16:30"), reasonCode: "I02", reasonText: "바코드가 12자리입니다. 상자에 인쇄된 13자리 바코드를 확인해 주세요." },
        { action: "RESUBMIT" as const, actor: "박민지", at: t("2026-11-02T08:30"), memo: "바코드 880110001002 → 8801100010021" },
      ],
    },
    {
      requestNo: "IR-20261101-0004", client: "DO", itemCode: "DO-0210", itemName: "욕실 슬리퍼", unit: "EA" as U,
      barcode: "8804400002108", source: "DIRECT" as const, sourceNote: null,
      status: "REJECTED" as const, requestedBy: "최유나", requestedAt: t("2026-11-01T10:15"),
      processedBy: "김하늘", processedAt: t("2026-11-01T11:05"), rejectReasonCode: "I04", rejectReasonText: "사이즈(M·L)별로 품목코드와 바코드를 나눠 요청해 주세요.",
      hist: [
        { action: "REQUEST" as const, actor: "최유나", at: t("2026-11-01T10:15") },
        { action: "REJECT" as const, actor: "김하늘", at: t("2026-11-01T11:05"), reasonCode: "I04", reasonText: "사이즈(M·L)별로 품목코드와 바코드를 나눠 요청해 주세요." },
      ],
    },
    {
      requestNo: "IR-20261031-0011", client: "OF", itemCode: "OF-2208", itemName: "손질 오징어 800g", unit: "BOX" as U,
      barcode: "8803300022080", source: "AI" as const, sourceNote: "이미지 판독값: '손질오징어 800 × 35' (신뢰도 0.71)",
      status: "REGISTERED" as const, requestedBy: "정서준", requestedAt: t("2026-10-31T15:10"),
      processedBy: "김하늘", processedAt: t("2026-10-31T16:00"), item: "OF-2208",
      hist: [
        { action: "REQUEST" as const, actor: "정서준", at: t("2026-10-31T15:10") },
        { action: "REGISTER" as const, actor: "김하늘", at: t("2026-10-31T16:00"), memo: "품목명 '손질오징어 800' → '손질 오징어 800g'로 수정 후 등록" },
      ],
    },
  ];
  for (const r of reqs) {
    const { hist, client, item, ...data } = r as typeof r & { item?: string };
    await db.itemRequest.create({
      data: {
        ...data,
        clientId: clientId[client],
        itemId: item ? itemId[item] : null,
        histories: { create: hist },
      },
    });
  }

  /* ───── 입고예정 (승인 대기 화면 검수용) — 날짜는 시드 실행일(한국 시간) 기준 상대값 ───── */
  const kstToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  const day = (n: number) => {
    const d = new Date(`${kstToday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  const uomQty = (code: string, unit: string) => {
    const it = ITEMS.find((i) => i.code === code)!;
    return unit === it.base ? 1 : (it.uoms?.find(([u]) => u === unit)?.[1] ?? 1);
  };
  type L = [code: string, unit: "EA" | "BOX" | "PLT", qty: number];
  const lineData = (lines: L[]) =>
    lines.map(([code, unit, qty], i) => {
      const it = ITEMS.find((x) => x.code === code)!;
      return {
        lineNo: i + 1,
        itemId: itemId[code],
        unit,
        qty,
        baseQty: qty * uomQty(code, unit),
        expiryDate: it.expiry ? new Date(`${day(180 + i * 30)}T00:00:00Z`) : null,
        lotNo: it.lot ? `L${kstToday.slice(2, 4)}${kstToday.slice(5, 7)}-${String(i + 1).padStart(2, "0")}` : null,
      };
    });
  const planSeq: Record<string, number> = {};
  const planNo = (at: Date) => {
    const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(at).replaceAll("-", "");
    planSeq[ymd] = (planSeq[ymd] ?? 0) + 1;
    return `IP-${ymd}-${String(planSeq[ymd]).padStart(4, "0")}`;
  };
  type H = { action: "CREATE" | "UPDATE" | "RESUBMIT" | "APPROVE" | "REJECT"; by: string; h: number; rev?: number; v?: number; reason?: [string, string, string?] };
  const actorIdOf: Record<string, number> = { 김하늘: userId["kim.haneul"], 박민지: userId["hb.minji"], 이도윤: userId["gm.doyun"], 정서준: userId["of.seojun"], 최유나: userId["do.yuna"] };
  const plans: {
    client: string; date: number; status: "WAITING" | "REJECTED" | "APPROVED"; method: "DIRECT" | "EXCEL" | "AI_IMAGE";
    by: string; rev: number; ver: number; lines: L[]; hist: H[]; rejectLines?: L[]; memo?: string;
  }[] = [
    { client: "HB", date: 1, status: "WAITING", method: "EXCEL", by: "박민지", rev: 1, ver: 2,
      lines: [["HB-1001", "BOX", 120], ["HB-1004", "BOX", 80], ["HB-2210", "PLT", 4], ["HB-3105", "BOX", 45]],
      hist: [{ action: "CREATE", by: "박민지", h: 3.5 }, { action: "UPDATE", by: "박민지", h: 3, v: 2 }] },
    { client: "GM", date: 1, status: "WAITING", method: "DIRECT", by: "이도윤", rev: 2, ver: 2,
      lines: [["GM-0501", "BOX", 60], ["GM-0512", "BOX", 40], ["GM-0730", "BOX", 30]],
      rejectLines: [["GM-0501", "BOX", 80], ["GM-0512", "BOX", 40], ["GM-0801", "BOX", 20]],
      hist: [
        { action: "CREATE", by: "이도윤", h: 20 },
        { action: "REJECT", by: "김하늘", h: 4, reason: ["R02", "수량 확인 필요", "친환경 세제 수량이 발주서와 다릅니다."] },
        { action: "RESUBMIT", by: "이도윤", h: 2, rev: 2, v: 2 },
      ] },
    { client: "OF", date: 2, status: "WAITING", method: "AI_IMAGE", by: "정서준", rev: 1, ver: 1,
      lines: [["OF-2201", "BOX", 50], ["OF-2208", "BOX", 35]],
      hist: [{ action: "CREATE", by: "정서준", h: 4.2 }] },
    { client: "DO", date: -2, status: "WAITING", method: "DIRECT", by: "최유나", rev: 1, ver: 1,
      lines: [["DO-0101", "EA", 200], ["DO-0144", "EA", 150]],
      hist: [{ action: "CREATE", by: "최유나", h: 64 }] },
    { client: "HB", date: 3, status: "WAITING", method: "DIRECT", by: "박민지", rev: 1, ver: 3, memo: "두유는 오전 입고 희망",
      lines: [["HB-1001", "BOX", 90], ["HB-4402", "BOX", 60]],
      hist: [{ action: "CREATE", by: "박민지", h: 6 }, { action: "UPDATE", by: "박민지", h: 2, v: 2 }, { action: "UPDATE", by: "박민지", h: 1, v: 3 }] },
    { client: "GM", date: 2, status: "WAITING", method: "EXCEL", by: "이도윤", rev: 1, ver: 1,
      lines: [["GM-0730", "BOX", 50], ["GM-0801", "BOX", 70], ["GM-0512", "BOX", 25]],
      hist: [{ action: "CREATE", by: "이도윤", h: 5 }] },
    { client: "OF", date: 1, status: "REJECTED", method: "DIRECT", by: "정서준", rev: 1, ver: 1,
      lines: [["OF-2201", "BOX", 500]],
      hist: [{ action: "CREATE", by: "정서준", h: 7 }, { action: "REJECT", by: "김하늘", h: 3.2, reason: ["R02", "수량 확인 필요", "평소 물량의 10배입니다. 단위를 확인해 주세요."] }] },
    { client: "DO", date: 0, status: "REJECTED", method: "EXCEL", by: "최유나", rev: 1, ver: 1,
      lines: [["DO-0101", "EA", 120]],
      hist: [{ action: "CREATE", by: "최유나", h: 26 }, { action: "REJECT", by: "김하늘", h: 4.5, reason: ["R03", "입고예정일 조정 필요", "해당일 도크 예약이 마감되었습니다."] }] },
    { client: "HB", date: 0, status: "APPROVED", method: "DIRECT", by: "박민지", rev: 1, ver: 1,
      lines: [["HB-2210", "PLT", 6]],
      hist: [{ action: "CREATE", by: "박민지", h: 18 }, { action: "APPROVE", by: "김하늘", h: 0.5 }] },
  ];
  for (const p of plans) {
    const firstAt = hoursAgo(p.hist[0].h);
    const saves = p.hist.filter((h) => ["CREATE", "UPDATE", "RESUBMIT"].includes(h.action));
    const lastSave = saves[saves.length - 1];
    const approve = p.hist.find((h) => h.action === "APPROVE");
    const plan = await db.inboundPlan.create({
      data: {
        planNo: planNo(firstAt), clientId: clientId[p.client], centerId: center.id,
        planDate: new Date(`${day(p.date)}T00:00:00Z`), status: p.status, inputMethod: p.method, memo: p.memo ?? null,
        version: p.ver, revisionNo: p.rev,
        approvedRevisionNo: approve ? p.rev : null, approvedAt: approve ? hoursAgo(approve.h) : null, approvedBy: approve?.by ?? null,
        savedAt: hoursAgo(lastSave.h), savedBy: p.by, createdAt: firstAt, createdBy: p.by, updatedBy: p.hist[p.hist.length - 1].by,
        lines: { create: lineData(p.lines) },
      },
    });
    let rev = 1, ver = 1;
    for (const h of p.hist) {
      rev = h.rev ?? rev;
      ver = h.v ?? ver;
      if (h.action === "REJECT") {
        const snap = lineData(p.rejectLines ?? p.lines);
        await db.inboundPlanReject.create({
          data: {
            planId: plan.id, revisionNo: rev, version: ver, planDate: plan.planDate, memo: plan.memo,
            reasonCode: h.reason![0], reasonName: h.reason![1], reasonText: h.reason![2] ?? null, rejectedBy: h.by, rejectedAt: hoursAgo(h.h),
            lines: { create: snap.map((l) => ({ ...l, itemCode: ITEMS.find((i) => itemId[i.code] === l.itemId)!.code, itemName: ITEMS.find((i) => itemId[i.code] === l.itemId)!.name })) },
          },
        });
      }
      await db.inboundPlanHistory.create({
        data: {
          planId: plan.id, action: h.action, version: ver, revisionNo: rev, actor: h.by, actorId: actorIdOf[h.by] ?? null, at: hoursAgo(h.h),
          reasonCode: h.reason?.[0] ?? null, reasonName: h.reason?.[1] ?? null, reasonText: h.reason?.[2] ?? null,
        },
      });
    }
  }

  await db.changeLog.createMany({ data: createLogs });

  const counts = await Promise.all([
    db.client.count(), db.item.count(), db.itemRequest.count(), db.commonCode.count(), db.user.count(), db.setting.count(), db.inboundPlan.count(),
  ]);
  console.log("seed 완료 — 화주사 %d, 품목 %d, 품목 등록 요청 %d, 사유 코드 %d, 사용자 %d, 설정 %d, 입고예정 %d", ...counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
