import type { ScheduleRow, VacationRow, SheetData } from './sheets';
import { buildCalendarTable } from './table';
import {
  TYPES,
  typeInfo,
  VACATION_ICON,
  STATUS_LABEL,
  rangeOf,
  rangeLabel,
  shift,
  todaySeoul,
  eachDay,
  groupBy,
  md,
  clip,
  stamp,
  type HomeState,
} from './domain';

/* ─────────── 블록 헬퍼 ─────────── */

const txt = (s: string) => ({ type: 'mrkdwn' as const, text: s });
const plain = (s: string) => ({ type: 'plain_text' as const, text: s, emoji: true });

function btn(label: string, action_id: string, value: string, style?: 'primary' | 'danger') {
  return { type: 'button', text: plain(label), action_id, value, ...(style ? { style } : {}) };
}

const opt = (label: string, value: string) => ({ text: plain(label), value });

function select(action_id: string, options: { text: any; value: string }[], selected: string) {
  return {
    type: 'static_select',
    action_id,
    options,
    initial_option: options.find((o) => o.value === selected) ?? options[0],
  };
}

/* ─────────── 홈 탭 ─────────── */

export function buildHomeView(state: HomeState, data: SheetData) {
  const [from, to] = rangeOf(state);
  const today = todaySeoul();

  const blocks: any[] = [
    { type: 'header', text: plain(`📅 ${rangeLabel(state)}`) },
    {
      type: 'actions',
      elements: [
        btn('◀', 'nav_prev', shift(state, -1)),
        btn('오늘', 'nav_today', today),
        btn('▶', 'nav_next', shift(state, 1)),
        select('filter_mode', [opt('일간', 'day'), opt('주간', 'week'), opt('월간', 'month')], state.mode),
        select('filter_view', [opt('일정 보기', 'schedule'), opt('휴가 보기', 'vacation')], state.view),
      ],
    },
  ];

  if (state.view === 'schedule') {
    blocks.push({
      type: 'actions',
      elements: [
        select(
          'filter_type',
          [opt('전체 구분', '전체'), ...TYPES.map((t) => opt(t.label, t.key))],
          state.type
        ),
      ],
    });
    blocks.push(...summaryBlock(data.schedules.filter((e) => inRange(e.date, from, to))));
  }

  // 주간·월간에는 실제 7열 격자 테이블을 올린다.
  // 홈 탭이 table 블록을 거부하면 slack.ts 가 빼고 재시도하므로,
  // 아래 목록만으로도 화면이 성립해야 한다.
  const table = buildCalendarTable(
    state,
    data.schedules.filter((e) => state.type === '전체' || e.type === state.type),
    state.view === 'vacation' ? data.vacations : data.vacations
  );
  if (table) blocks.push(table);

  blocks.push({ type: 'divider' });

  if (state.view === 'schedule') {
    blocks.push(...scheduleBody(state, data, from, to, today));
  } else {
    blocks.push(...vacationBody(state, data, from, to, today));
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        btn(state.view === 'schedule' ? '＋ 일정 추가' : '＋ 휴가 신청', 'add_open', state.anchor, 'primary'),
        btn('🔄 새로고침', 'nav_refresh', state.anchor),
        ...(state.mode === 'day' && state.view === 'schedule'
          ? [btn('📋 이 날 복사', 'copy_day', state.anchor)]
          : []),
      ],
    },
    { type: 'context', elements: [txt(`${stamp()} 기준`)] }
  );

  return { type: 'home', private_metadata: JSON.stringify(state), blocks: blocks.slice(0, 100) };
}

const inRange = (d: string, a: string, b: string) => d >= a && d <= b;

/** 웹앱 헤더와 동일한 집계 */
function summaryBlock(rows: ScheduleRow[]) {
  const c = (key: string, agency: boolean) =>
    rows.filter((e) => e.type === key && !!e.agencyContract.trim() === agency).length;
  const ltD = c('long-term-out', false);
  const ltA = c('long-term-out', true);
  const afD = c('affiliate-out', false);
  const afA = c('affiliate-out', true);
  return [
    {
      type: 'context',
      elements: [
        txt(
          `*장기출고 ${ltD + ltA}건* (제트카 ${ltD} / 에이전시 ${ltA})　·　*제휴사출고 ${afD + afA}건* (제트카 ${afD} / 에이전시 ${afA})`
        ),
      ],
    },
  ];
}

/* ─────────── 일정 ─────────── */

function scheduleBody(state: HomeState, data: SheetData, from: string, to: string, today: string) {
  const rows = data.schedules
    .filter((e) => inRange(e.date, from, to))
    .filter((e) => state.type === '전체' || e.type === state.type);

  if (state.mode === 'day') {
    // 일간에서만 항목별 조작 메뉴를 붙인다. 주/월간은 건수가 많아 100블록을 넘긴다.
    if (rows.length === 0) return [{ type: 'section', text: txt('_이 날 등록된 일정이 없습니다._') }];

    const out: any[] = [];
    for (const t of TYPES) {
      const list = rows.filter((e) => e.type === t.key);
      if (list.length === 0) continue;
      out.push({ type: 'context', elements: [txt(`*${t.label}* · ${list.length}건`)] });
      for (const e of list) out.push(scheduleItem(e, t.key));
    }
    const vac = data.vacations.filter((v) => v.date === state.anchor);
    if (vac.length) {
      out.push({
        type: 'context',
        elements: [txt(`🌴 *휴가* ${vac.map((v) => `${v.employeeName}(${v.vacationType})`).join(', ')}`)],
      });
    }
    return out;
  }

  // 주간·월간: 날짜별 요약 + 그 날로 들어가는 버튼
  const map = groupBy(rows, (e) => e.date);
  const days = state.mode === 'week' ? eachDay(from, to) : [...map.keys()].sort();
  if (days.length === 0) return [{ type: 'section', text: txt('_해당 기간에 등록된 일정이 없습니다._') }];

  return days.map((d) => {
    const list = map.get(d) ?? [];
    const mark = d === today ? '  ← *오늘*' : '';
    const lines = list.length
      ? [...groupBy(list, (e) => e.type).entries()]
          .map(([k, v]) => `${typeInfo(k).icon} ${typeInfo(k).label} ${v.length}`)
          .join('　')
      : '_없음_';
    const detail = list
      .slice(0, 6)
      .map((e) => `${typeInfo(e.type).icon} ${e.vehicleNumber}${e.isReady ? ' ✅' : ''}`)
      .join('\n');

    return {
      type: 'section',
      text: txt(
        `*${md(d)}* · ${list.length}건${mark}\n${lines}${detail ? `\n${detail}` : ''}${
          list.length > 6 ? `\n_외 ${list.length - 6}건_` : ''
        }`
      ),
      // action_id 는 뷰 안에서 유일해야 한다. 날짜를 붙여 구분하고 값은 value 로 넘긴다.
      accessory: btn('열기', `open_day:${d}`, d),
    };
  });
}

function scheduleItem(e: ScheduleRow, typeKey: string) {
  const t = typeInfo(typeKey);
  const time = e.time && e.time !== '09:00' ? `\`${e.time}\` ` : '';
  const ready = e.isReady ? ' ✅ *완료*' : '';
  const parts = [`${time}*${e.vehicleNumber}*${ready}`];
  if (e.customerName) parts.push(e.customerName);
  if (e.agencyContract) parts.push(`🏷 ${e.agencyContract}`);
  if (e.completionDate) parts.push(`완료일 ${e.completionDate}`);
  if (e.memo) parts.push(`_${clip(e.memo.replace(/\n/g, ' '), 120)}_`);

  const options = [
    ...(t.ready ? [opt(e.isReady ? '준비완료 해제' : '준비완료 체크', `toggle:${e.id}`)] : []),
    opt('메모 / 완료일', `memo:${e.id}`),
    opt('수정', `edit:${e.id}`),
    opt('삭제', `del:${e.id}`),
  ];

  return {
    type: 'section',
    text: txt(`${t.icon} ${parts.join('\n')}`),
    accessory: { type: 'overflow', action_id: `item:${e.id}`, options },
  };
}

/* ─────────── 휴가 ─────────── */

function vacationBody(state: HomeState, data: SheetData, from: string, to: string, today: string) {
  const rows = data.vacations
    .filter((v) => inRange(v.date, from, to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));

  if (rows.length === 0) return [{ type: 'section', text: txt('_해당 기간에 등록된 휴가가 없습니다._') }];

  const out: any[] = [];
  for (const [d, list] of groupBy(rows, (v) => v.date)) {
    out.push({ type: 'context', elements: [txt(`*${md(d)}*${d === today ? '  ← 오늘' : ''}`)] });
    for (const v of list) out.push(vacationItem(v));
  }
  return out;
}

function vacationItem(v: VacationRow) {
  const icon = VACATION_ICON[v.vacationType] ?? '🟪';
  const st = STATUS_LABEL[v.status] ?? v.status;
  const strike = v.status === 'cancelled';
  const name = strike ? `~${v.employeeName}~` : `*${v.employeeName}*`;
  const memo = v.memo ? `\n_${clip(v.memo.replace(/\n/g, ' '), 100)}_` : '';

  const options = [
    ...(!v.status ? [opt('승인', `vst:approved:${v.id}`), opt('취소', `vst:cancelled:${v.id}`)] : []),
    ...(v.status === 'approved' ? [opt('완료 처리', `vst:completed:${v.id}`)] : []),
    opt('수정', `vedit:${v.id}`),
    opt('삭제', `vdel:${v.id}`),
  ];

  return {
    type: 'section',
    text: txt(`${icon} ${name} · ${v.vacationType} · \`${st}\`${memo}`),
    accessory: { type: 'overflow', action_id: `vitem:${v.id}`, options },
  };
}
