import { waitUntil } from '@vercel/functions';
import { verifySlackSignature, publishHome, openModal } from '@/lib/slack';
import { fetchAll, appendSchedule } from '@/lib/sheets';
import {
  buildHomeView,
  buildAddModal,
  defaultState,
  type HomeState,
  type Mode,
} from '@/lib/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();

  const ok = verifySlackSignature(
    raw,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature')
  );
  if (!ok) return new Response('invalid signature', { status: 401 });

  // 인터랙션은 JSON 이 아니라 form-urlencoded 의 payload 필드로 온다.
  // 이벤트 API 와 형식이 다르다는 점이 흔한 함정.
  const payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}');

  if (payload.type === 'block_actions') return handleAction(payload);
  if (payload.type === 'view_submission') return handleSubmit(payload);
  return new Response('ok', { status: 200 });
}

/* ─────────── 버튼 / 드롭다운 ─────────── */

async function handleAction(payload: any) {
  const userId = payload.user.id;
  const action = payload.actions?.[0];
  const state = parseState(payload.view?.private_metadata);
  const id: string = action?.action_id ?? '';

  // 모달은 trigger_id 유효시간이 3초라 즉시 열어야 한다
  if (id === 'open_add') {
    await openModal(payload.trigger_id, buildAddModal(state));
    return new Response('ok', { status: 200 });
  }

  const next: HomeState = { ...state };
  if (id.startsWith('nav:')) next.anchor = id.slice(4);
  if (id === 'filter_mode') next.mode = action.selected_option.value as Mode;
  if (id === 'filter_type') next.type = action.selected_option.value;

  waitUntil(republish(userId, next));
  return new Response('ok', { status: 200 });
}

/* ─────────── 모달 제출 ─────────── */

async function handleSubmit(payload: any) {
  if (payload.view?.callback_id !== 'add_schedule') {
    return new Response('ok', { status: 200 });
  }

  const v = payload.view.state.values;
  const get = (block: string) => {
    const el = v[block]?.v;
    return (
      el?.value ??
      el?.selected_date ??
      el?.selected_time ??
      el?.selected_option?.value ??
      ''
    ).trim();
  };

  const record = {
    date: get('b_date'),
    time: get('b_time'),
    type: get('b_type'),
    vehicleNumber: get('b_vehicle'),
    customerName: get('b_customer'),
    memo: get('b_memo'),
  };

  // 쓰기는 인라인 처리. 실패하면 모달에 오류를 띄워야 하기 때문.
  try {
    await appendSchedule(record);
  } catch (err) {
    console.error('[view_submission] 시트 기록 실패:', err);
    return Response.json({
      response_action: 'errors',
      errors: { b_date: '시트에 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    });
  }

  // 등록한 날짜로 화면을 이동시켜 결과를 바로 확인시킨다
  const state = parseState(payload.view.private_metadata);
  waitUntil(republish(payload.user.id, { ...state, anchor: record.date || state.anchor }));

  return new Response(null, { status: 200 }); // 빈 200 = 모달 닫기
}

/* ─────────── 공통 ─────────── */

async function republish(userId: string, state: HomeState) {
  try {
    const data = await fetchAll();
    await publishHome(userId, buildHomeView(state, data));
  } catch (err) {
    console.error('[republish] 실패:', err);
  }
}

function parseState(meta?: string): HomeState {
  if (!meta) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(meta) };
  } catch {
    return defaultState();
  }
}
