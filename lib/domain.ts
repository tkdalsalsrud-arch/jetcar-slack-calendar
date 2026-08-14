/* 웹앱(index.html)의 분류·색상·휴가 종류를 그대로 옮긴 상수 */

export const TYPES = [
  { key: 'long-term-out', label: '장기출고', icon: '🔵', ready: true },
  { key: 'monthly-rental-out', label: '월렌트출고', icon: '🟢', ready: true },
  { key: 'long-term-return', label: '장기반납', icon: '🔴', ready: false },
  { key: 'monthly-rental-return', label: '월렌트반납', icon: '🟠', ready: false },
  { key: 'affiliate-out', label: '제휴사출고', icon: '🟣', ready: false },
  { key: 'maintenance-out', label: '정비/사고대차', icon: '🟦', ready: false },
] as const;

export type TypeInfo = { key: string; label: string; icon: string; ready: boolean };

const TYPE_MAP = new Map<string, TypeInfo>(TYPES.map((t) => [t.key, { ...t }]));

export function typeInfo(key: string): TypeInfo {
  return TYPE_MAP.get(key) ?? { key, label: key || '기타', icon: '⚪', ready: false };
}

/** 완료일 입력이 열리는 분류 (웹앱 openMemoModal 과 동일) */
export const HAS_COMPLETION = ['long-term-return', 'monthly-rental-return', 'maintenance-out'];

/** 에이전시명 입력이 열리는 분류 */
export const HAS_AGENCY = ['long-term-out', 'affiliate-out'];

export const VACATION_TYPES = [
  '오전반차',
  '오후반차',
  '연차',
  '여름휴가',
  '경조사',
  '훈련(오전)',
  '훈련(오후)',
  '훈련(종일)',
] as const;

export const VACATION_ICON: Record<string, string> = {
  연차: '🟪',
  여름휴가: '🟩',
  오전반차: '🩷',
  오후반차: '🟨',
  경조사: '🟥',
  '훈련(오전)': '🩷',
  '훈련(오후)': '🟨',
  '훈련(종일)': '🫒',
};

export const STATUS_LABEL: Record<string, string> = {
  '': '대기',
  approved: '승인',
  cancelled: '취소',
  completed: '완료',
};

/* ─────────── 화면 상태 ─────────── */

export type Mode = 'day' | 'week' | 'month';
export type View = 'schedule' | 'vacation';

export type HomeState = {
  view: View;
  mode: Mode;
  anchor: string; // yyyy-MM-dd
  type: string; // '전체' 또는 TYPES 의 key
};

export function defaultState(): HomeState {
  return { view: 'schedule', mode: 'day', anchor: todaySeoul(), type: '전체' };
}

export function parseState(meta?: string): HomeState {
  if (!meta) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(meta) };
  } catch {
    return defaultState();
  }
}

/* ─────────── 날짜 (Asia/Seoul 고정) ─────────── */

export function todaySeoul(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// 모든 날짜 연산은 UTC 정오 기준으로 처리해 타임존 밀림을 원천 차단한다
const toUTC = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd, 12));
};
const fmt = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function addMonths(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmt(d);
}

/** 그 주의 일요일 (웹앱 격자가 일요일 시작이라 맞춤) */
export function weekStart(date: string): string {
  return addDays(date, -toUTC(date).getUTCDay());
}

export function weekday(date: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', weekday: 'short' }).format(toUTC(date));
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function rangeOf(s: HomeState): [string, string] {
  if (s.mode === 'day') return [s.anchor, s.anchor];
  if (s.mode === 'week') {
    const start = weekStart(s.anchor);
    return [start, addDays(start, 6)];
  }
  const start = `${s.anchor.slice(0, 7)}-01`;
  return [start, addDays(addMonths(start, 1), -1)];
}

export function shift(s: HomeState, dir: -1 | 1): string {
  if (s.mode === 'day') return addDays(s.anchor, dir);
  if (s.mode === 'week') return addDays(s.anchor, dir * 7);
  return addMonths(s.anchor, dir);
}

export function rangeLabel(s: HomeState): string {
  const [a, b] = rangeOf(s);
  if (s.mode === 'day')
    return `${Number(a.slice(5, 7))}월 ${Number(a.slice(8))}일 (${weekday(a)})`;
  if (s.mode === 'week') return `${a.slice(5).replace('-', '/')} ~ ${b.slice(5).replace('-', '/')}`;
  return `${a.slice(0, 4)}년 ${Number(a.slice(5, 7))}월`;
}

export function md(date: string): string {
  return `${date.slice(5).replace('-', '/')} (${weekday(date)})`;
}

export function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of arr) {
    const k = key(i);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return m;
}

export function clip(s: string, n: number): string {
  const t = (s ?? '').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

export function stamp(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}
