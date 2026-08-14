import type { ScheduleRow, VacationRow } from './sheets';
import { TYPES, typeInfo, todaySeoul, addDays, weekStart, groupBy, type HomeState } from './domain';

/**
 * Slack table 블록으로 7열 격자 캘린더를 만든다.
 *
 * 제약 (Slack 공식 문서)
 *   - 행 최대 100, 행당 셀 최대 20
 *   - 테이블 하나의 전체 문자 수 10,000자
 *   - 셀 타입: rich_text / raw_text / raw_number
 *   - rich_text 는 굵게·이모지·링크 가능, 색상은 불가
 *
 * 10,000자 상한이 실질적 제약이라, 예산을 넘으면 칸당 표시 건수를 줄이고
 * 나머지는 "외 N건"으로 접는다.
 */

const CHAR_BUDGET = 9200; // 10,000 에서 여유를 둔다
const WD = ['일', '월', '화', '수', '목', '금', '토'];

type RT = { type: 'rich_text'; elements: [{ type: 'rich_text_section'; elements: any[] }] };

const text = (t: string, style?: Record<string, boolean>) => ({
  type: 'text',
  text: t,
  ...(style ? { style } : {}),
});
const emoji = (name: string) => ({ type: 'emoji', name });

function cell(elements: any[]): RT {
  // 빈 셀도 유효해야 하므로 최소 한 개는 넣는다
  return {
    type: 'rich_text',
    elements: [{ type: 'rich_text_section', elements: elements.length ? elements : [text(' ')] }],
  };
}

/** 셀 안 문자 수를 대략 계산해 예산 관리에 쓴다 */
function weigh(c: RT): number {
  return c.elements[0].elements.reduce(
    (n, e: any) => n + (e.type === 'text' ? e.text.length : 4),
    0
  );
}

/**
 * 격자 테이블 블록을 만든다. 상태가 일간이면 격자가 의미 없으므로 null.
 */
export function buildCalendarTable(
  state: HomeState,
  schedules: ScheduleRow[],
  vacations: VacationRow[]
): any | null {
  if (state.mode === 'day') return null;

  const today = todaySeoul();
  const sMap = groupBy(schedules, (e) => e.date);
  const vMap = groupBy(vacations, (v) => v.date);

  // 주간이면 1주, 월간이면 그 달을 덮는 주들
  let start: string;
  let weekCount: number;
  let from: string;
  let to: string;

  if (state.mode === 'week') {
    start = weekStart(state.anchor);
    weekCount = 1;
    from = start;
    to = addDays(start, 6);
  } else {
    from = `${state.anchor.slice(0, 7)}-01`;
    to = addDays(addMonth(from), -1);
    start = weekStart(from);
    weekCount = Math.ceil((diffDays(start, to) + 1) / 7);
  }

  // 표시 건수를 줄여가며 예산에 맞춘다
  for (const cap of [8, 6, 5, 4, 3, 2, 1]) {
    const rows = buildRows(start, weekCount, from, to, today, sMap, vMap, cap, state.mode === 'week');
    const total = rows.flat().reduce((n, c) => n + weigh(c as RT), 0);
    if (total <= CHAR_BUDGET || cap === 1) {
      return {
        type: 'table',
        column_settings: WD.map(() => ({ align: 'left', is_wrapped: true })),
        rows: [WD.map((w) => ({ type: 'raw_text', text: w })), ...rows],
      };
    }
  }
  return null;
}

function buildRows(
  start: string,
  weekCount: number,
  from: string,
  to: string,
  today: string,
  sMap: Map<string, ScheduleRow[]>,
  vMap: Map<string, VacationRow[]>,
  cap: number,
  detailed: boolean
): RT[][] {
  const rows: RT[][] = [];

  for (let w = 0; w < weekCount; w++) {
    const row: RT[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const inRange = day >= from && day <= to;
      row.push(dayCell(day, inRange, day === today, sMap.get(day) ?? [], vMap.get(day) ?? [], cap, detailed));
    }
    rows.push(row);
  }
  return rows;
}

function dayCell(
  day: string,
  inRange: boolean,
  isToday: boolean,
  items: ScheduleRow[],
  vacs: VacationRow[],
  cap: number,
  detailed: boolean
): RT {
  const num = Number(day.slice(8));

  if (!inRange) return cell([text(String(num), { italic: true })]);

  const els: any[] = [];
  // 오늘은 굵게 + 화살표로 표시한다. rich_text 에는 색상이 없다.
  els.push(text(isToday ? `▶ ${num}` : String(num), { bold: true }));

  if (items.length === 0 && vacs.length === 0) return cell(els);

  // 분류 순서대로 (웹앱과 동일)
  const ordered = TYPES.flatMap((t) => items.filter((e) => e.type === t.key));
  const shown = ordered.slice(0, cap);

  for (const e of shown) {
    els.push(text('\n'));
    els.push(emoji(typeInfo(e.type).emoji));
    els.push(text(` ${e.vehicleNumber}${e.isReady ? ' ✓' : ''}`));
    if (detailed && e.customerName) {
      els.push(text(`\n　${short(e.customerName)}`, { italic: true }));
    }
  }

  if (ordered.length > shown.length) {
    els.push(text(`\n외 ${ordered.length - shown.length}건`, { italic: true }));
  }

  for (const v of vacs.slice(0, 3)) {
    els.push(text('\n'));
    els.push(emoji('palm_tree'));
    els.push(text(` ${v.employeeName}`, v.status === 'cancelled' ? { strike: true } : undefined));
  }
  if (vacs.length > 3) els.push(text(`\n휴가 외 ${vacs.length - 3}`, { italic: true }));

  return cell(els);
}

/** "명희 청주 재민 / 고명민 / 36개월" → "고명민 / 36개월" */
function short(s: string): string {
  const parts = s.split('/').map((x) => x.trim());
  const t = parts.length >= 2 ? parts.slice(1).join(' / ') : s;
  return t.length <= 20 ? t : t.slice(0, 20) + '…';
}

const addMonth = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 1, 12));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
