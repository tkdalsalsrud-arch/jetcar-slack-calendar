import type { ScheduleRow, VacationRow } from './sheets';
import { TYPES, typeInfo, todaySeoul, addDays, weekStart, groupBy, type HomeState } from './domain';

/**
 * Slack table 블록으로 웹앱과 같은 7열 격자 캘린더를 만든다.
 *
 * 유일한 실질 제약은 "테이블 전체 문자 수 10,000자"다.
 * 그래서 무조건 자르지 않고, 예산에 맞을 때까지 아래 순서로만 정보를 덜어낸다.
 *   0) 분류 라벨 + 차량 + 고객명   ← 웹앱과 동일, 기본값
 *   1) 분류 라벨 + 차량
 *   2) 차량만
 *   3) 그래도 넘치면 그때만 건수 제한
 * 실제 운영 데이터(하루 15~20건)에서는 0단계로 전부 들어간다.
 */

const BUDGET = 9400; // 10,000 에서 안전 여유
const WD = ['일', '월', '화', '수', '목', '금', '토'];

type Section = { type: 'rich_text_section'; elements: any[] };
type RT = { type: 'rich_text'; elements: Section[] };

const text = (t: string, style?: Record<string, boolean>) => ({
  type: 'text',
  text: t,
  ...(style ? { style } : {}),
});
const emoji = (name: string) => ({ type: 'emoji', name });

const cell = (els: any[]): RT => ({
  type: 'rich_text',
  elements: [{ type: 'rich_text_section', elements: els.length ? els : [text(' ')] }],
});

/** 문자 수 추정. 이모지는 슬랙이 짧은 이름으로 세므로 넉넉히 잡는다. */
function weigh(c: RT): number {
  return c.elements[0].elements.reduce(
    (n, e: any) => n + (e.type === 'text' ? e.text.length : 6),
    0
  );
}

type Level = { label: boolean; customer: boolean; cap: number };

const LEVELS: Level[] = [
  { label: true, customer: true, cap: Infinity },
  { label: true, customer: false, cap: Infinity },
  { label: false, customer: false, cap: Infinity },
  { label: false, customer: false, cap: 12 },
  { label: false, customer: false, cap: 8 },
  { label: false, customer: false, cap: 5 },
  { label: false, customer: false, cap: 3 },
];

export function buildCalendarTable(
  state: HomeState,
  schedules: ScheduleRow[],
  vacations: VacationRow[]
): any | null {
  if (state.mode === 'day') return null;

  const today = todaySeoul();
  const sMap = groupBy(schedules, (e) => e.date);
  const vMap = groupBy(vacations, (v) => v.date);

  let start: string, weeks: number, from: string, to: string;
  if (state.mode === 'week') {
    start = weekStart(state.anchor);
    from = start;
    to = addDays(start, 6);
    weeks = 1;
  } else {
    from = `${state.anchor.slice(0, 7)}-01`;
    to = addDays(nextMonth(from), -1);
    start = weekStart(from);
    weeks = Math.ceil((diff(start, to) + 1) / 7);
  }

  for (const lv of LEVELS) {
    const rows: RT[][] = [];
    for (let w = 0; w < weeks; w++) {
      const row: RT[] = [];
      for (let d = 0; d < 7; d++) {
        const day = addDays(start, w * 7 + d);
        row.push(
          dayCell(day, day >= from && day <= to, day === today, sMap.get(day) ?? [], vMap.get(day) ?? [], lv)
        );
      }
      rows.push(row);
    }

    const total = rows.flat().reduce((n, c) => n + weigh(c), 0);
    if (total <= BUDGET || lv === LEVELS[LEVELS.length - 1]) {
      return {
        type: 'table',
        column_settings: WD.map(() => ({ align: 'left', is_wrapped: true })),
        rows: [WD.map((w) => ({ type: 'raw_text', text: w })), ...rows],
      };
    }
  }
  return null;
}

function dayCell(
  day: string,
  inRange: boolean,
  isToday: boolean,
  items: ScheduleRow[],
  vacs: VacationRow[],
  lv: Level
): RT {
  const num = Number(day.slice(8));
  if (!inRange) return cell([text(String(num), { italic: true })]);

  const els: any[] = [text(isToday ? `▶ ${num}` : String(num), { bold: true })];
  if (items.length === 0 && vacs.length === 0) return cell(els);

  let shown = 0;
  for (const t of TYPES) {
    const list = items.filter((e) => e.type === t.key);
    if (list.length === 0) continue;

    if (lv.label) els.push(text(`\n${t.label}`, { bold: true }));

    for (const e of list) {
      if (shown >= lv.cap) break;
      shown++;
      els.push(text('\n'), emoji(typeInfo(e.type).emoji), text(` ${e.vehicleNumber}`));
      if (e.isReady) els.push(text(' ✓'));
      if (lv.customer && e.customerName) els.push(text(`\n　${e.customerName}`, { italic: true }));
    }
  }

  const hidden = items.length - shown;
  if (hidden > 0) els.push(text(`\n＋${hidden}`, { italic: true }));

  for (const v of vacs) {
    els.push(text('\n'), emoji('palm_tree'));
    els.push(text(` ${v.employeeName} ${v.vacationType}`, v.status === 'cancelled' ? { strike: true } : undefined));
  }

  return cell(els);
}

const nextMonth = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 1, 12));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const diff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
