import type { ScheduleRow, VacationRow, SheetData } from './sheets';
import { calendarImageUrl } from './sign';

/* ─────────── 업무 구분 ─────────── */

export const TYPES = [
  { key: 'long-term-out', label: '장기출고', icon: ':large_blue_square:', color: '#3b82f6' },
  { key: 'monthly-rental-out', label: '월렌트출고', icon: ':large_green_square:', color: '#10b981' },
  { key: 'long-term-return', label: '장기반납', icon: ':red_square:', color: '#ef4444' },
  { key: 'monthly-rental-return', label: '월렌트반납', icon: ':large_orange_square:', color: '#f97316' },
  { key: 'affiliate-out', label: '제휴사출고', icon: ':large_purple_square:', color: '#8b5cf6' },
  { key: 'maintenance-out', label: '정비/사고대차', icon: ':large_brown_square:', color: '#0d9488' },
] as const;

/** 휴가 종류별 색 (웹앱 CSS 와 동일하게 맞춤) */
export const VACATION_COLORS: Record<string, string> = {
  연차: '#a78bfa',
  여름휴가: '#14b8a6',
  오전반차: '#f472b6',
  오후반차: '#fbbf24',
  경조사: '#fb7185',
  '훈련(오전)': '#f472b6',
  '훈련(오후)': '#fbbf24',
  '훈련(종일)': '#65a30d',
};

const TYPE_MAP = new Map<string, { key: string; label: string; icon: string; color: string }>(
  TYPES.map((t) => [t.key, { key: t.key, label: t.label, icon: t.icon, color: t.color }])
);

function typeInfo(key: string) {
  return TYPE_MAP.get(key) ?? { key, label: key || '기타', icon: ':white_square:', color: '#94a3b8' };
}

/* ─────────── 화면 상태 ─────────── */

export type Mode = 'day' | 'week' | 'month';

export type HomeState = {
  mode: Mode;
  anchor: string; // yyyy-MM-dd, 기준일
  type: string; // '전체' 또는 TYPES 의 key
};

export function defaultState(): HomeState {
  return { mode: 'week', anchor: todaySeoul(), type: '전체' };
}

/* ─────────── 날짜 유틸 (Asia/Seoul 고정) ─────────── */

export function todaySeoul(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// 날짜 계산은 전부 UTC 정오 기준으로 처리해 서머타임·타임존 밀림을 원천 차단한다
function toUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}
function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}
function addMonths(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromUTC(d);
}
/** 그 주의 월요일 */
function weekStart(date: string): string {
  const dow = toUTC(date).getUTCDay(); // 0=일
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
function weekday(date: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', weekday: 'short' }).format(toUTC(date));
}

/** 현재 상태가 포함하는 날짜 범위 [시작, 끝] */
export function rangeOf(s: HomeState): [string, string] {
  if (s.mode === 'day') return [s.anchor, s.anchor];
  if (s.mode === 'week') {
    const start = weekStart(s.anchor);
    return [start, addDays(start, 6)];
  }
  const start = `${s.anchor.slice(0, 7)}-01`;
  return [start, addDays(addMonths(start, 1), -1)];
}

/** 이전/다음 버튼이 이동할 기준일 */
export function shift(s: HomeState, dir: -1 | 1): string {
  if (s.mode === 'day') return addDays(s.anchor, dir);
  if (s.mode === 'week') return addDays(s.anchor, dir * 7);
  return addMonths(s.anchor, dir);
}

function rangeLabel(s: HomeState): string {
  const [a, b] = rangeOf(s);
  if (s.mode === 'day') return `${a.slice(0, 4)}년 ${Number(a.slice(5, 7))}월 ${Number(a.slice(8))}일 (${weekday(a)})`;
  if (s.mode === 'week') return `${a.slice(5).replace('-', '/')} ~ ${b.slice(5).replace('-', '/')}`;
  return `${a.slice(0, 4)}년 ${Number(a.slice(5, 7))}월`;
}

/* ─────────── 앱 홈 ─────────── */

export function buildHomeView(state: HomeState, data: SheetData) {
  const [from, to] = rangeOf(state);
  const today = todaySeoul();

  const rows = data.schedules
    .filter((e) => e.date >= from && e.date <= to)
    .filter((e) => state.type === '전체' || e.type === state.type)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time || '99:99').localeCompare(b.time || '99:99') ||
        a.type.localeCompare(b.type)
    );

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `📅 ${rangeLabel(state)}`, emoji: true } },
    {
      type: 'actions',
      elements: [
        btn('◀', 'nav_prev', shift(state, -1)),
        btn('오늘', 'nav_today', today),
        btn('▶', 'nav_next', shift(state, 1)),
        modeSelect(state.mode),
        typeSelect(state.type),
      ],
    },
  ];

  // 주간·월간에는 상단에 렌더링된 캘린더 이미지를 얹는다.
  // 일간은 항목이 적어 이미지가 오히려 군더더기다.
  if (state.mode !== 'day') {
    const img = calendarImageUrl(state.mode, state.anchor, state.type);
    if (img) {
      blocks.push({
        type: 'image',
        image_url: img,
        alt_text: state.mode === 'month' ? '월간 캘린더' : '주간 캘린더',
      });
    }
  }

  const vac = vacationLine(data.vacations, from, to);
  if (vac) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: vac }] });

  blocks.push({ type: 'divider' });

  if (rows.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_해당 기간에 등록된 일정이 없습니다._' },
    });
  } else {
    // "하루 = 블록 1개". 일정 1건당 블록 1개로 만들면 100블록 상한에 걸린다.
    for (const [date, items] of groupBy(rows, (r) => r.date)) {
      const mark = date === today ? '  ← *오늘*' : '';
      const lines = items.map(renderRow).join('\n');
      const head = `*${date.slice(5).replace('-', '/')} (${weekday(date)})* · ${items.length}건${mark}`;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: clip(`${head}\n${lines}`, 2900) },
      });
    }
  }

  blocks.push({ type: 'divider' }, {
    type: 'actions',
    elements: [
      { ...btn('＋ 일정 추가', 'open_add'), style: 'primary' },
      btn('🔄 새로고침', 'nav_refresh', state.anchor),
    ],
  }, {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `총 ${rows.length}건 · ${stamp()} 기준` }],
  });

  return {
    type: 'home',
    private_metadata: JSON.stringify(state),
    blocks: blocks.slice(0, 100),
  };
}

function renderRow(e: ScheduleRow): string {
  const t = typeInfo(e.type);
  // 시트의 09:00 은 "시간 미지정" 기본값이라 표시하지 않는다
  const time = e.time && e.time !== '09:00' ? `\`${e.time}\` ` : '';
  const done = e.completionDate ? ' :white_check_mark:' : '';

  const main = [`*${t.label}*`, e.vehicleNumber, e.customerName].filter(Boolean).join(' · ');
  const memo = e.memo ? `\n　　↳ _${clip(e.memo, 160)}_` : '';

  return `${t.icon} ${time}${main}${done}${memo}`;
}

function vacationLine(vacations: VacationRow[], from: string, to: string): string | null {
  const hit = vacations.filter((v) => v.date >= from && v.date <= to);
  if (hit.length === 0) return null;

  const byDate = [...groupBy(hit, (v) => v.date)]
    .map(([d, list]) => {
      const names = list.map((v) => `${v.employeeName}(${v.vacationType || '연차'})`).join(', ');
      return `${d.slice(5).replace('-', '/')} ${names}`;
    })
    .join('  |  ');

  return clip(`:palm_tree: *휴가* ${byDate}`, 2900);
}

/* ─────────── 일정 추가 모달 ─────────── */

export function buildAddModal(state: HomeState) {
  return {
    type: 'modal',
    callback_id: 'add_schedule',
    private_metadata: JSON.stringify(state),
    title: { type: 'plain_text', text: '일정 추가' },
    submit: { type: 'plain_text', text: '등록' },
    close: { type: 'plain_text', text: '취소' },
    blocks: [
      {
        type: 'input',
        block_id: 'b_date',
        label: { type: 'plain_text', text: '날짜' },
        element: { type: 'datepicker', action_id: 'v', initial_date: state.anchor },
      },
      {
        type: 'input',
        block_id: 'b_time',
        optional: true,
        label: { type: 'plain_text', text: '시간' },
        hint: { type: 'plain_text', text: '비워두면 시간 미지정으로 등록됩니다' },
        element: { type: 'timepicker', action_id: 'v' },
      },
      {
        type: 'input',
        block_id: 'b_type',
        label: { type: 'plain_text', text: '구분' },
        element: {
          type: 'static_select',
          action_id: 'v',
          options: TYPES.map((t) => opt(t.label, t.key)),
          initial_option: opt(TYPES[0].label, TYPES[0].key),
        },
      },
      text('b_vehicle', '차량', '예: 쏘렌토 116호7147'),
      text('b_customer', '고객 / 계약 정보', '예: 지혜 평택 상민 / 신경철 / 60개월'),
      {
        type: 'input',
        block_id: 'b_memo',
        optional: true,
        label: { type: 'plain_text', text: '메모' },
        element: { type: 'plain_text_input', action_id: 'v', multiline: true },
      },
    ],
  };
}

/* ─────────── 헬퍼 ─────────── */

/**
 * action_id 는 반드시 고정값이어야 한다.
 * 날짜를 action_id 에 넣으면 "오늘"과 "▶"가 같은 값이 되는 순간
 * 슬랙이 중복 id 로 보고 views.publish 를 invalid_arguments 로 거부한다.
 * 가변 데이터는 전부 value 로 넘긴다.
 */
function btn(label: string, action_id: string, value?: string) {
  return {
    type: 'button',
    text: { type: 'plain_text', text: label, emoji: true },
    action_id,
    ...(value !== undefined ? { value } : {}),
  };
}

function opt(label: string, value: string) {
  return { text: { type: 'plain_text', text: label }, value };
}

function modeSelect(mode: Mode) {
  const options = [opt('일간', 'day'), opt('주간', 'week'), opt('월간', 'month')];
  return {
    type: 'static_select',
    action_id: 'filter_mode',
    options,
    initial_option: options.find((o) => o.value === mode) ?? options[1],
  };
}

function typeSelect(type: string) {
  const options = [opt('전체 구분', '전체'), ...TYPES.map((t) => opt(t.label, t.key))];
  return {
    type: 'static_select',
    action_id: 'filter_type',
    options,
    initial_option: options.find((o) => o.value === type) ?? options[0],
  };
}

function text(block_id: string, label: string, placeholder: string) {
  return {
    type: 'input',
    block_id,
    label: { type: 'plain_text', text: label },
    element: {
      type: 'plain_text_input',
      action_id: 'v',
      placeholder: { type: 'plain_text', text: placeholder },
    },
  };
}

function groupBy<T>(arr: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function stamp(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}
