import { waitUntil } from '@vercel/functions';
import { verifySlackSignature, publishHome, openModal, pushModal } from '@/lib/slack';
import { fetchAll, appendRow, updateFields, deleteRow, type ScheduleRow, type VacationRow } from '@/lib/sheets';
import { buildHomeView } from '@/lib/home';
import {
  scheduleModal,
  memoModal,
  vacationModal,
  passwordModal,
  confirmDeleteModal,
  copyModal,
  alertModal,
} from '@/lib/modals';
import { parseState, todaySeoul, typeInfo, HAS_AGENCY, type HomeState, type Mode, type View } from '@/lib/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PW = () => process.env.ADMIN_PASSWORD ?? '';
const CLOSE = () => new Response(null, { status: 200 }); // 빈 200 = 모달 닫기
const OK = () => new Response('ok', { status: 200 });

const errors = (block: string, msg: string) =>
  Response.json({ response_action: 'errors', errors: { [block]: msg } });

export async function POST(req: Request) {
  const raw = await req.text();

  const ok = verifySlackSignature(
    raw,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature')
  );
  if (!ok) return new Response('invalid signature', { status: 401 });

  // 인터랙션은 JSON 이 아니라 form-urlencoded 의 payload 필드로 온다
  const p = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}');

  try {
    if (p.type === 'block_actions') return await onAction(p);
    if (p.type === 'view_submission') return await onSubmit(p);
  } catch (err) {
    console.error('[interaction] 처리 실패:', err);
    return OK();
  }
  return OK();
}

/* ─────────── 버튼 / 드롭다운 / 오버플로 ─────────── */

async function onAction(p: any) {
  const user = p.user.id;
  const a = p.actions?.[0];
  const id: string = a?.action_id ?? '';
  const state = parseState(p.view?.private_metadata);

  // 모달 안의 "일정 종류" 변경 — 에이전시 칸을 열고 닫는다
  if (id === 'type_change') {
    const chosen = a.selected_option.value;
    const inner = parseState(p.view.private_metadata);
    const cur = JSON.parse(p.view.private_metadata || '{}');
    const draft = readScheduleForm(p.view.state.values);
    await updateModal(p.view.id, {
      ...scheduleModal(inner, {
        id: cur.id ?? '',
        rowIndex: cur.rowIndex ?? 0,
        date: draft.date || inner.anchor,
        time: draft.time,
        type: chosen,
        vehicleNumber: draft.vehicle,
        customerName: draft.customer,
        agencyContract: HAS_AGENCY.includes(chosen) ? draft.agency : '',
        memo: '',
        completionDate: '',
        isReady: false,
      }),
      // 수정 모드가 아니면 제목을 유지
      title: p.view.title,
    });
    return OK();
  }

  // 즉시 모달을 띄워야 하는 것들 (trigger_id 유효시간 3초)
  if (id === 'add_open') {
    await openModal(
      p.trigger_id,
      state.view === 'schedule' ? scheduleModal(state) : vacationModal(state)
    );
    return OK();
  }

  if (id === 'copy_day') {
    const data = await fetchAll();
    const rows = data.schedules.filter((e) => e.date === a.value);
    await openModal(p.trigger_id, copyModal(a.value, rows));
    return OK();
  }

  if (id.startsWith('item:') || id.startsWith('vitem:')) {
    return await onItemMenu(p, state, a.selected_option.value);
  }

  // 화면 이동 계열은 즉시 200 후 백그라운드 갱신
  const next: HomeState = { ...state };
  if (id === 'nav_prev' || id === 'nav_next' || id === 'nav_today' || id === 'nav_refresh')
    next.anchor = a.value;
  if (id.startsWith('open_day')) {
    next.anchor = a.value;
    next.mode = 'day';
  }
  if (id === 'filter_mode') next.mode = a.selected_option.value as Mode;
  if (id === 'filter_view') next.view = a.selected_option.value as View;
  if (id === 'filter_type') next.type = a.selected_option.value;

  waitUntil(republish(user, next));
  return OK();
}

/** 항목 오버플로 메뉴 */
async function onItemMenu(p: any, state: HomeState, value: string) {
  const data = await fetchAll();
  const [cmd, ...rest] = value.split(':');

  const findS = (id: string) => data.schedules.find((e) => e.id === id);
  const findV = (id: string) => data.vacations.find((v) => v.id === id);

  if (cmd === 'toggle') {
    const e = findS(rest[0]);
    if (!e) return OK();
    // 체크 토글은 모달 없이 바로 반영한다 (웹앱 동작과 동일)
    await updateFields('schedule', e.rowIndex, { isReady: e.isReady ? 'FALSE' : 'TRUE' });
    waitUntil(republish(p.user.id, state));
    return OK();
  }

  if (cmd === 'memo') {
    const e = findS(rest[0]);
    if (e) await openModal(p.trigger_id, memoModal(state, e));
    return OK();
  }

  if (cmd === 'edit') {
    const e = findS(rest[0]);
    if (e) await openModal(p.trigger_id, scheduleModal(state, e));
    return OK();
  }

  if (cmd === 'del') {
    const e = findS(rest[0]);
    if (e)
      await openModal(
        p.trigger_id,
        confirmDeleteModal(state, 'schedule', e.rowIndex, `${typeInfo(e.type).label} · ${e.vehicleNumber}`, false)
      );
    return OK();
  }

  if (cmd === 'vst') {
    const [status, vid] = rest;
    const v = findV(vid);
    const label = status === 'approved' ? '승인' : status === 'cancelled' ? '취소' : '완료';
    if (v) await openModal(p.trigger_id, passwordModal(state, v, status, label));
    return OK();
  }

  if (cmd === 'vedit') {
    const v = findV(rest[0]);
    if (v) await openModal(p.trigger_id, vacationModal(state, v));
    return OK();
  }

  if (cmd === 'vdel') {
    const v = findV(rest[0]);
    if (v)
      await openModal(
        p.trigger_id,
        confirmDeleteModal(state, 'vacation', v.rowIndex, `${v.employeeName} · ${v.vacationType} · ${v.date}`, true)
      );
    return OK();
  }

  return OK();
}

/* ─────────── 모달 제출 ─────────── */

async function onSubmit(p: any) {
  const cb = p.view.callback_id;
  const m = JSON.parse(p.view.private_metadata || '{}');
  const state: HomeState = m.state ?? parseState();
  const v = p.view.state.values;
  const user = p.user.id;

  if (cb === 'copy_view') return CLOSE();

  /* 일정 추가 / 수정 */
  if (cb === 'schedule_form') {
    const f = readScheduleForm(v);
    if (!f.vehicle) return errors('b_vehicle', '차량을 입력해 주세요.');

    const payload: Record<string, string> = {
      date: f.time ? `${f.date} ${f.time}:00` : f.date,
      type: f.type,
      vehicleNumber: f.vehicle,
      customerName: f.customer,
      agencyContract: HAS_AGENCY.includes(f.type) ? f.agency : '',
    };

    if (m.rowIndex) await updateFields('schedule', m.rowIndex, payload);
    else await appendRow('schedule', { ...payload, id: crypto.randomUUID(), memo: '', completionDate: '', isReady: 'FALSE' });

    waitUntil(republish(user, { ...state, anchor: f.date || state.anchor }));
    return CLOSE();
  }

  /* 메모 / 완료일 */
  if (cb === 'memo_form') {
    const patch: Record<string, string> = { memo: val(v, 'b_memo') };
    if (v.b_completion) patch.completionDate = val(v, 'b_completion');
    await updateFields('schedule', m.rowIndex, patch);
    waitUntil(republish(user, state));
    return CLOSE();
  }

  /* 휴가 추가 / 수정 */
  if (cb === 'vacation_form') {
    const date = val(v, 'b_date');
    const name = val(v, 'b_name');
    if (!name) return errors('b_name', '이름을 입력해 주세요.');

    // 웹앱과 동일: 3일 이내 등록·수정, 그리고 모든 수정은 관리자 승인 필요
    const days = Math.round((Date.parse(date) - Date.parse(todaySeoul())) / 86400000);
    const needPw = days < 3 || !!m.rowIndex;
    if (needPw && val(v, 'b_pw') !== ADMIN_PW()) {
      return errors('b_pw', '3일 이내 휴가와 수정은 관리자 비밀번호가 필요합니다.');
    }

    const payload: Record<string, string> = {
      date,
      employeeName: name,
      vacationType: val(v, 'b_vtype'),
      memo: val(v, 'b_memo'),
    };

    if (m.rowIndex) await updateFields('vacation', m.rowIndex, payload);
    else await appendRow('vacation', { ...payload, id: crypto.randomUUID(), status: '' });

    waitUntil(republish(user, { ...state, view: 'vacation', anchor: date || state.anchor }));
    return CLOSE();
  }

  /* 휴가 승인 / 취소 / 완료 */
  if (cb === 'vacation_status') {
    if (val(v, 'b_pw') !== ADMIN_PW()) return errors('b_pw', '비밀번호가 틀렸습니다.');
    await updateFields('vacation', m.rowIndex, { status: m.status });
    waitUntil(republish(user, state));
    return CLOSE();
  }

  /* 삭제 확인 */
  if (cb === 'confirm_delete') {
    if (v.b_pw && val(v, 'b_pw') !== ADMIN_PW()) return errors('b_pw', '비밀번호가 틀렸습니다.');
    await deleteRow(m.kind, m.rowIndex);
    waitUntil(republish(user, state));
    return CLOSE();
  }

  return CLOSE();
}

/* ─────────── 공통 ─────────── */

function val(values: any, block: string): string {
  const el = values?.[block]?.v;
  if (!el) return '';
  return (
    el.value ??
    el.selected_date ??
    el.selected_time ??
    el.selected_option?.value ??
    ''
  ).toString().trim();
}

function readScheduleForm(values: any) {
  return {
    date: val(values, 'b_date'),
    time: val(values, 'b_time'),
    type: values?.b_type?.type_change?.selected_option?.value ?? val(values, 'b_type') ?? 'long-term-out',
    vehicle: val(values, 'b_vehicle'),
    customer: val(values, 'b_customer'),
    agency: val(values, 'b_agency'),
  };
}

/** 열려 있는 모달을 갈아끼운다 (일정 종류 변경 시 에이전시 칸 토글용) */
async function updateModal(view_id: string, view: any) {
  const { title, ...rest } = view;
  const res = await fetch('https://slack.com/api/views.update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ view_id, view: { ...rest, title } }),
  });
  const data = await res.json();
  if (!data.ok) console.error('[views.update]', data.error, JSON.stringify(data.response_metadata ?? {}));
}

async function republish(userId: string, state: HomeState) {
  try {
    const data = await fetchAll();
    await publishHome(userId, buildHomeView(state, data));
  } catch (err) {
    console.error('[republish] 실패:', err);
  }
}

export type { ScheduleRow, VacationRow };
