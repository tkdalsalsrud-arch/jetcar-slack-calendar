import type { ScheduleRow, VacationRow } from './sheets';
import {
  TYPES,
  VACATION_TYPES,
  HAS_AGENCY,
  HAS_COMPLETION,
  typeInfo,
  groupBy,
  type HomeState,
} from './domain';

const plain = (s: string) => ({ type: 'plain_text' as const, text: s, emoji: true });
const opt = (label: string, value: string) => ({ text: plain(label), value });

function input(block_id: string, label: string, opts: {
  optional?: boolean;
  initial?: string;
  placeholder?: string;
  multiline?: boolean;
  hint?: string;
} = {}) {
  return {
    type: 'input',
    block_id,
    optional: !!opts.optional,
    label: plain(label),
    ...(opts.hint ? { hint: plain(opts.hint) } : {}),
    element: {
      type: 'plain_text_input',
      action_id: 'v',
      ...(opts.multiline ? { multiline: true } : {}),
      ...(opts.initial ? { initial_value: opts.initial } : {}),
      ...(opts.placeholder ? { placeholder: plain(opts.placeholder) } : {}),
    },
  };
}

/** 모달 간에 화면 상태와 대상 id 를 실어 나른다 */
export const meta = (state: HomeState, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ state, ...extra });

/* ─────────── 일정 추가 / 수정 ─────────── */

export function scheduleModal(state: HomeState, e?: ScheduleRow) {
  const type = e?.type ?? 'long-term-out';
  const showAgency = HAS_AGENCY.includes(type);

  return {
    type: 'modal',
    callback_id: 'schedule_form',
    private_metadata: meta(state, { id: e?.id, rowIndex: e?.rowIndex }),
    title: plain(e ? '일정 수정' : '일정 추가'),
    submit: plain('저장'),
    close: plain('취소'),
    blocks: [
      {
        type: 'input',
        block_id: 'b_date',
        label: plain('날짜'),
        element: { type: 'datepicker', action_id: 'v', initial_date: e?.date ?? state.anchor },
      },
      {
        type: 'input',
        block_id: 'b_time',
        optional: true,
        label: plain('시간'),
        hint: plain('비워두면 시간 미지정'),
        element: {
          type: 'timepicker',
          action_id: 'v',
          ...(e?.time && e.time !== '09:00' ? { initial_time: e.time } : {}),
        },
      },
      {
        type: 'input',
        block_id: 'b_type',
        label: plain('일정 종류'),
        // 종류를 바꾸면 에이전시 칸을 열고 닫아야 하므로 즉시 이벤트를 받는다
        dispatch_action: true,
        element: {
          type: 'static_select',
          action_id: 'type_change',
          options: TYPES.map((t) => opt(t.label, t.key)),
          initial_option: opt(typeInfo(type).label, type),
        },
      },
      input('b_vehicle', '차종 + 차량번호', { initial: e?.vehicleNumber, placeholder: '예: 쏘렌토 116호7147' }),
      ...(showAgency
        ? [
            input('b_agency', '에이전시명', {
              optional: true,
              initial: e?.agencyContract,
              placeholder: '예: GNA유해주주임, KSO로플랜',
              hint: '장기출고 / 제휴사출고 전용',
            }),
          ]
        : []),
      input('b_customer', '내용 (고객명 등)', {
        optional: true,
        initial: e?.customerName,
        placeholder: '예: 명희 청주 재민 / 고명민 / 36개월',
      }),
    ],
  };
}

/* ─────────── 메모 / 완료일 ─────────── */

export function memoModal(state: HomeState, e: ScheduleRow) {
  return {
    type: 'modal',
    callback_id: 'memo_form',
    private_metadata: meta(state, { id: e.id, rowIndex: e.rowIndex, type: e.type }),
    title: plain('메모'),
    submit: plain('저장'),
    close: plain('닫기'),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${e.vehicleNumber}*\n${e.customerName || ''}` } },
      ...(HAS_COMPLETION.includes(e.type)
        ? [
            {
              type: 'input',
              block_id: 'b_completion',
              optional: true,
              label: plain('완료일'),
              element: {
                type: 'datepicker',
                action_id: 'v',
                ...(e.completionDate ? { initial_date: e.completionDate } : {}),
              },
            },
          ]
        : []),
      input('b_memo', '메모', { optional: true, initial: e.memo, multiline: true }),
    ],
  };
}

/* ─────────── 휴가 추가 / 수정 ─────────── */

export function vacationModal(state: HomeState, v?: VacationRow) {
  return {
    type: 'modal',
    callback_id: 'vacation_form',
    private_metadata: meta(state, { id: v?.id, rowIndex: v?.rowIndex }),
    title: plain(v ? '휴가 수정' : '휴가 신청'),
    submit: plain('저장'),
    close: plain('취소'),
    blocks: [
      {
        type: 'input',
        block_id: 'b_date',
        label: plain('날짜'),
        element: { type: 'datepicker', action_id: 'v', initial_date: v?.date ?? state.anchor },
      },
      {
        type: 'input',
        block_id: 'b_vtype',
        label: plain('종류'),
        element: {
          type: 'static_select',
          action_id: 'v',
          options: VACATION_TYPES.map((t) => opt(t, t)),
          initial_option: opt(v?.vacationType ?? '연차', v?.vacationType ?? '연차'),
        },
      },
      input('b_name', '이름', { initial: v?.employeeName }),
      input('b_memo', '메모', { optional: true, initial: v?.memo, multiline: true }),
      // 웹앱과 동일: 3일 이내는 승인이 필요하므로 비밀번호를 함께 받는다
      input('b_pw', '관리자 비밀번호', {
        optional: true,
        hint: '3일 이내 날짜이거나 수정일 때만 필요합니다',
      }),
    ],
  };
}

/* ─────────── 승인 / 취소 / 완료 ─────────── */

export function passwordModal(state: HomeState, v: VacationRow, status: string, label: string) {
  return {
    type: 'modal',
    callback_id: 'vacation_status',
    private_metadata: meta(state, { id: v.id, rowIndex: v.rowIndex, status }),
    title: plain(`휴가 ${label}`),
    submit: plain(label),
    close: plain('취소'),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${v.employeeName}* · ${v.vacationType} · ${v.date}` },
      },
      input('b_pw', '관리자 비밀번호'),
    ],
  };
}

/* ─────────── 삭제 확인 ─────────── */

export function confirmDeleteModal(
  state: HomeState,
  kind: 'schedule' | 'vacation',
  rowIndex: number,
  title: string,
  needPassword: boolean
) {
  return {
    type: 'modal',
    callback_id: 'confirm_delete',
    private_metadata: meta(state, { kind, rowIndex }),
    title: plain('삭제 확인'),
    submit: plain('삭제'),
    close: plain('취소'),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `다음 항목을 삭제합니다.\n\n*${title}*` } },
      ...(needPassword ? [input('b_pw', '관리자 비밀번호')] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: '되돌릴 수 없습니다.' }] },
    ],
  };
}

/* ─────────── 일자별 복사 ─────────── */

export function copyModal(date: string, rows: ScheduleRow[]) {
  const lines: string[] = [];
  for (const t of TYPES) {
    const list = rows.filter((e) => e.type === t.key);
    if (list.length === 0) continue;
    lines.push(`[${t.label}]`);
    for (const e of list) {
      const c = e.customerName.trim();
      lines.push(c ? `${e.vehicleNumber} / ${c}` : e.vehicleNumber);
    }
    lines.push('');
  }

  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8));
  const body = lines.length
    ? `📅 ${y}년 ${m}월 ${d}일\n\n${lines.join('\n').trim()}`
    : '복사할 일정이 없습니다.';

  return {
    type: 'modal',
    callback_id: 'copy_view',
    title: plain('일정 복사'),
    close: plain('닫기'),
    blocks: [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '아래 내용을 전체 선택해 복사하세요.' }],
      },
      {
        type: 'input',
        block_id: 'b_copy',
        optional: true,
        label: plain(`${m}월 ${d}일`),
        element: { type: 'plain_text_input', action_id: 'v', multiline: true, initial_value: body },
      },
    ],
  };
}

/** 오류를 사용자에게 보여주는 간단한 모달 */
export function alertModal(title: string, message: string) {
  return {
    type: 'modal',
    title: plain(title),
    close: plain('닫기'),
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: message } }],
  };
}

export { groupBy };
