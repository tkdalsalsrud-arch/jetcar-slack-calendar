import { JWT } from 'google-auth-library';

/**
 * 제트카 실제 시트 구조에 맞춘 조회 계층.
 *
 * 탭 이름을 하드코딩하지 않는다. 스프레드시트의 모든 탭에서 1행 헤더를 읽어
 * 어떤 탭이 일정인지 / 휴가인지 / 월렌트인지 자동 판별한다.
 * 컬럼 순서가 바뀌어도 헤더 이름으로 찾으므로 깨지지 않는다.
 *
 *   일정 탭   : id, date, type, vehicleNumber, customerName, memo, completionDate, ...
 *   휴가 탭   : id, date, employeeName, memo, status, vacationType
 *   월렌트 탭 : id, checkoutId, date, type, vehicleNumber, lesseeName, amount, status, ...
 */

export type ScheduleRow = {
  id: string;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm ('' = 시간 미지정)
  type: string; // long-term-out 등 원본 값
  vehicleNumber: string;
  customerName: string;
  memo: string;
  completionDate: string;
};

export type VacationRow = {
  id: string;
  date: string;
  employeeName: string;
  vacationType: string;
  status: string;
  memo: string;
};

export type SheetData = { schedules: ScheduleRow[]; vacations: VacationRow[] };

/* ─────────── 인증 ─────────── */

let cachedClient: JWT | null = null;

function getClient(): JWT {
  if (cachedClient) return cachedClient;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) throw new Error('GOOGLE_PRIVATE_KEY 미설정');

  cachedClient = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Vercel 환경변수는 개행이 \n 리터럴로 저장되므로 되돌린다
    key: key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return cachedClient;
}

async function authHeader() {
  const { token } = await getClient().getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

const SHEET_ID = () => process.env.SHEET_ID!;
const BASE = () => `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}`;

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, { headers: await authHeader(), cache: 'no-store' });
  if (!res.ok) throw new Error(`sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/* ─────────── 탭 자동 판별 ─────────── */

type TabMap = { schedule: string | null; vacation: string | null };
let cachedTabs: TabMap | null = null;

export async function resolveTabs(force = false): Promise<TabMap> {
  if (cachedTabs && !force) return cachedTabs;

  // 환경변수로 직접 지정했으면 탐색을 건너뛴다
  if (process.env.SHEET_TAB_SCHEDULE) {
    cachedTabs = {
      schedule: process.env.SHEET_TAB_SCHEDULE,
      vacation: process.env.SHEET_TAB_VACATION ?? null,
    };
    return cachedTabs;
  }

  const meta = await api<{ sheets: { properties: { title: string } }[] }>(
    '?fields=sheets.properties.title'
  );
  const titles = meta.sheets.map((s) => s.properties.title);

  // 모든 탭의 헤더 행을 한 번에 가져온다
  const ranges = titles.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:Z1`)}`).join('&');
  const batch = await api<{ valueRanges: { values?: string[][] }[] }>(
    `/values:batchGet?${ranges}&majorDimension=ROWS`
  );

  const result: TabMap = { schedule: null, vacation: null };

  titles.forEach((title, i) => {
    const head = (batch.valueRanges[i]?.values?.[0] ?? []).map((h) => h.trim());
    const has = (n: string) => head.includes(n);

    if (!result.vacation && has('employeeName') && has('vacationType')) {
      result.vacation = title;
      return;
    }
    // checkoutId 가 있는 탭은 월렌트 대장이므로 일정 탭으로 잡지 않는다
    if (!result.schedule && has('type') && has('vehicleNumber') && !has('checkoutId')) {
      result.schedule = title;
    }
  });

  if (!result.schedule) {
    throw new Error(`일정 탭을 찾지 못했습니다. 탭 목록: ${titles.join(', ')}`);
  }

  cachedTabs = result;
  return result;
}

/* ─────────── 조회 ─────────── */

export async function fetchAll(): Promise<SheetData> {
  const tabs = await resolveTabs();

  const ranges = [`'${tabs.schedule}'!A1:Z`];
  if (tabs.vacation) ranges.push(`'${tabs.vacation}'!A1:Z`);

  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const batch = await api<{ valueRanges: { values?: string[][] }[] }>(
    `/values:batchGet?${qs}&majorDimension=ROWS`
  );

  const schedules = parseSchedules(batch.valueRanges[0]?.values ?? []);
  const vacations = tabs.vacation ? parseVacations(batch.valueRanges[1]?.values ?? []) : [];

  return { schedules, vacations };
}

function indexer(header: string[]) {
  const map = new Map(header.map((h, i) => [h.trim(), i]));
  return (name: string) => map.get(name) ?? -1;
}

function parseSchedules(values: string[][]): ScheduleRow[] {
  if (values.length < 2) return [];
  const at = indexer(values[0]);
  const g = (r: string[], n: string) => {
    const i = at(n);
    return i < 0 ? '' : (r[i] ?? '').toString().trim();
  };

  const seen = new Set<string>();
  const out: ScheduleRow[] = [];

  for (const r of values.slice(1)) {
    const { date, time } = parseDateTime(g(r, 'date'));
    if (!date) continue;

    const id = g(r, 'id');
    // 같은 데이터가 두 탭에 중복 존재하는 경우가 있어 id 로 한 번 거른다
    const key = id || `${date}|${g(r, 'type')}|${g(r, 'vehicleNumber')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id,
      date,
      time,
      type: g(r, 'type'),
      vehicleNumber: g(r, 'vehicleNumber'),
      customerName: g(r, 'customerName'),
      memo: g(r, 'memo'),
      completionDate: g(r, 'completionDate'),
    });
  }
  return out;
}

function parseVacations(values: string[][]): VacationRow[] {
  if (values.length < 2) return [];
  const at = indexer(values[0]);
  const g = (r: string[], n: string) => {
    const i = at(n);
    return i < 0 ? '' : (r[i] ?? '').toString().trim();
  };

  return values
    .slice(1)
    .map((r) => ({
      id: g(r, 'id'),
      date: parseDateTime(g(r, 'date')).date,
      employeeName: g(r, 'employeeName'),
      vacationType: g(r, 'vacationType'),
      status: g(r, 'status'),
      memo: g(r, 'memo'),
    }))
    .filter((v) => v.date && v.employeeName);
}

/* ─────────── 일정 추가 ─────────── */

export async function appendSchedule(row: {
  date: string; // yyyy-MM-dd
  time: string; // HH:mm ('' 가능)
  type: string;
  vehicleNumber: string;
  customerName: string;
  memo: string;
}): Promise<void> {
  const tabs = await resolveTabs();

  // 헤더를 다시 읽어 컬럼 위치에 정확히 값을 꽂는다.
  // 순서를 가정하고 쓰면 컬럼이 추가되는 순간 데이터가 밀린다.
  const head = await api<{ values?: string[][] }>(
    `/values/${encodeURIComponent(`'${tabs.schedule}'!A1:Z1`)}`
  );
  const header = head.values?.[0] ?? [];

  const payload: Record<string, string> = {
    id: crypto.randomUUID(),
    date: row.time ? `${row.date} ${row.time}:00` : row.date,
    type: row.type,
    vehicleNumber: row.vehicleNumber,
    customerName: row.customerName,
    memo: row.memo,
  };

  const line = header.map((h) => payload[h.trim()] ?? '');

  const range = encodeURIComponent(`'${tabs.schedule}'!A:Z`);
  const res = await fetch(
    `${BASE()}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [line] }),
    }
  );
  if (!res.ok) throw new Error(`sheets append ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/* ─────────── 날짜 파싱 ─────────── */

/**
 * 시트에 섞여 들어오는 모든 형식을 흡수한다.
 *   "2026. 2. 28 오후 1:30:00"  → { date: '2026-02-28', time: '13:30' }
 *   "2026. 1. 14"               → { date: '2026-01-14', time: '' }
 *   "2025-12-31"                → { date: '2025-12-31', time: '' }
 */
export function parseDateTime(raw: string): { date: string; time: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { date: '', time: '' };

  const d = s.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (!d) return { date: '', time: '' };
  const date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;

  const t = s.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);
  if (!t) return { date, time: '' };

  let h = Number(t[2]);
  if (t[1] === '오후' && h !== 12) h += 12;
  if (t[1] === '오전' && h === 12) h = 0;

  return { date, time: `${String(h).padStart(2, '0')}:${t[3]}` };
}
