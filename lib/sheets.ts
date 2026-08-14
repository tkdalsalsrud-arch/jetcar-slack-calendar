import { JWT } from 'google-auth-library';

/**
 * 웹앱(Code.gs)이 하는 시트 조작을 그대로 옮긴 계층.
 * 탭 이름은 하드코딩하지 않고 1행 헤더로 자동 판별한다.
 *   일정 탭   : type + vehicleNumber 있고 checkoutId 없음
 *   휴가 탭   : employeeName + vacationType
 */

export type ScheduleRow = {
  id: string;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm ('' = 미지정)
  type: string;
  vehicleNumber: string;
  customerName: string;
  memo: string;
  completionDate: string;
  agencyContract: string;
  isReady: boolean;
  rowIndex: number;
};

export type VacationRow = {
  id: string;
  date: string;
  employeeName: string;
  vacationType: string;
  status: string; // '' | approved | cancelled | completed
  memo: string;
  rowIndex: number;
};

export type SheetData = { schedules: ScheduleRow[]; vacations: VacationRow[] };

/* ─────────── 인증 ─────────── */

let client: JWT | null = null;

function getClient(): JWT {
  if (client) return client;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) throw new Error('GOOGLE_PRIVATE_KEY 미설정');
  client = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Vercel 환경변수는 개행이 \n 리터럴로 저장되므로 되돌린다
    key: key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return client;
}

async function auth() {
  const { token } = await getClient().getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

const BASE = () => `https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, { headers: await auth(), cache: 'no-store' });
  if (!res.ok) throw new Error(`sheets GET ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sheets POST ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/* ─────────── 탭 판별 + 헤더 캐시 ─────────── */

export type Tab = { title: string; gid: number; header: string[] };
type Tabs = { schedule: Tab; vacation: Tab | null };

let tabs: Tabs | null = null;

export async function resolveTabs(force = false): Promise<Tabs> {
  if (tabs && !force) return tabs;

  const meta = await get<{ sheets: { properties: { title: string; sheetId: number } }[] }>(
    '?fields=sheets.properties(title,sheetId)'
  );
  const props = meta.sheets.map((s) => s.properties);

  const ranges = props.map((p) => `ranges=${encodeURIComponent(`'${p.title}'!A1:Z1`)}`).join('&');
  const batch = await get<{ valueRanges: { values?: string[][] }[] }>(
    `/values:batchGet?${ranges}&majorDimension=ROWS`
  );

  let schedule: Tab | null = null;
  let vacation: Tab | null = null;
  const forced = process.env.SHEET_TAB_SCHEDULE;

  props.forEach((p, i) => {
    const header = (batch.valueRanges[i]?.values?.[0] ?? []).map((h) => h.trim());
    const has = (n: string) => header.includes(n);
    const tab: Tab = { title: p.title, gid: p.sheetId, header };

    if (!vacation && has('employeeName') && has('vacationType')) vacation = tab;
    else if (!schedule && (forced ? p.title === forced : has('type') && has('vehicleNumber') && !has('checkoutId')))
      schedule = tab;
  });

  if (!schedule) throw new Error(`일정 탭을 찾지 못했습니다. 탭 목록: ${props.map((p) => p.title).join(', ')}`);

  tabs = { schedule, vacation };
  return tabs;
}

/* ─────────── 조회 ─────────── */

export async function fetchAll(): Promise<SheetData> {
  const t = await resolveTabs();
  const ranges = [`'${t.schedule.title}'!A1:Z`];
  if (t.vacation) ranges.push(`'${t.vacation.title}'!A1:Z`);

  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const batch = await get<{ valueRanges: { values?: string[][] }[] }>(
    `/values:batchGet?${qs}&majorDimension=ROWS`
  );

  return {
    schedules: parseSchedules(batch.valueRanges[0]?.values ?? []),
    vacations: t.vacation ? parseVacations(batch.valueRanges[1]?.values ?? []) : [],
  };
}

function indexer(header: string[]) {
  const m = new Map(header.map((h, i) => [h.trim(), i]));
  return (r: string[], n: string) => {
    const i = m.get(n);
    return i === undefined ? '' : (r[i] ?? '').toString().trim();
  };
}

function parseSchedules(values: string[][]): ScheduleRow[] {
  if (values.length < 2) return [];
  const g = indexer(values[0]);
  const seen = new Set<string>();
  const out: ScheduleRow[] = [];

  values.slice(1).forEach((r, i) => {
    const { date, time } = parseDateTime(g(r, 'date'));
    if (!date) return;
    const id = g(r, 'id');
    if (id && seen.has(id)) return; // 같은 데이터가 두 탭에 중복될 수 있다
    if (id) seen.add(id);

    out.push({
      id,
      date,
      time,
      type: g(r, 'type'),
      vehicleNumber: g(r, 'vehicleNumber'),
      customerName: g(r, 'customerName'),
      memo: g(r, 'memo'),
      completionDate: parseDateTime(g(r, 'completionDate')).date || g(r, 'completionDate'),
      agencyContract: g(r, 'agencyContract'),
      isReady: g(r, 'isReady').toLowerCase() === 'true',
      rowIndex: i + 2,
    });
  });
  return out;
}

function parseVacations(values: string[][]): VacationRow[] {
  if (values.length < 2) return [];
  const g = indexer(values[0]);
  return values
    .slice(1)
    .map((r, i) => ({
      id: g(r, 'id'),
      date: parseDateTime(g(r, 'date')).date,
      employeeName: g(r, 'employeeName'),
      vacationType: g(r, 'vacationType'),
      status: g(r, 'status'),
      memo: g(r, 'memo'),
      rowIndex: i + 2,
    }))
    .filter((v) => v.date && v.employeeName);
}

/* ─────────── 쓰기 ─────────── */

const col = (i: number) => String.fromCharCode(65 + i);

/** 헤더 이름 기준으로 필요한 셀만 갱신한다. 컬럼 순서를 가정하지 않는다. */
export async function updateFields(
  which: 'schedule' | 'vacation',
  rowIndex: number,
  patch: Record<string, string>
): Promise<void> {
  const t = await resolveTabs();
  const tab = which === 'schedule' ? t.schedule : t.vacation;
  if (!tab) throw new Error('휴가 탭이 없습니다');

  const data = Object.entries(patch)
    .map(([k, v]) => {
      const i = tab.header.indexOf(k);
      return i < 0 ? null : { range: `'${tab.title}'!${col(i)}${rowIndex}`, values: [[v]] };
    })
    .filter(Boolean);

  if (data.length === 0) return;
  await post('/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data });
}

export async function appendRow(
  which: 'schedule' | 'vacation',
  payload: Record<string, string>
): Promise<void> {
  const t = await resolveTabs();
  const tab = which === 'schedule' ? t.schedule : t.vacation;
  if (!tab) throw new Error('휴가 탭이 없습니다');

  const line = tab.header.map((h) => payload[h.trim()] ?? '');
  const range = encodeURIComponent(`'${tab.title}'!A:Z`);
  await post(
    `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: [line] }
  );
}

export async function deleteRow(which: 'schedule' | 'vacation', rowIndex: number): Promise<void> {
  const t = await resolveTabs();
  const tab = which === 'schedule' ? t.schedule : t.vacation;
  if (!tab) throw new Error('휴가 탭이 없습니다');

  await post(':batchUpdate', {
    requests: [
      {
        deleteDimension: {
          range: { sheetId: tab.gid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex },
        },
      },
    ],
  });
}

/* ─────────── 날짜 파싱 ─────────── */

/**
 * 시트에 섞여 들어오는 형식을 모두 흡수한다.
 *   "2026. 2. 28 오후 1:30:00" → { date: '2026-02-28', time: '13:30' }
 *   "2026. 1. 14" / "2025-12-31" → time 없음
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
