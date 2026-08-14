import crypto from 'node:crypto';

const API = 'https://slack.com/api';

/**
 * 슬랙 요청 서명 검증.
 * 반드시 가공되지 않은 원본 body 문자열로 검증해야 한다.
 * JSON.parse 후 다시 stringify 하면 서명이 절대 맞지 않는다.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false; // 리플레이 방지

  const mine = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  const a = Buffer.from(mine);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function api<T = any>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as any;
  if (!data.ok) {
    // response_metadata 에 Block Kit 검증 실패 사유가 상세히 담긴다
    console.error(`[slack] ${method} 실패:`, data.error, JSON.stringify(data.response_metadata ?? {}));
    throw new Error(`slack ${method}: ${data.error}`);
  }
  return data as T;
}

/**
 * 홈 탭 렌더링.
 * table 블록은 비교적 최근에 추가돼 일부 환경에서 거부될 수 있다.
 * 거부되면 테이블만 빼고 한 번 더 시도해 화면이 아예 안 뜨는 일을 막는다.
 */
export async function publishHome(user_id: string, view: any) {
  try {
    return await api('views.publish', { user_id, view });
  } catch (err) {
    const blocks = (view?.blocks ?? []).filter((b: any) => b.type !== 'table');
    if (blocks.length === (view?.blocks ?? []).length) throw err;
    console.warn('[slack] table 블록이 거부됨 — 목록만으로 재시도합니다');
    return api('views.publish', { user_id, view: { ...view, blocks } });
  }
}
export const openModal = (trigger_id: string, view: unknown) => api('views.open', { trigger_id, view });
export const pushModal = (trigger_id: string, view: unknown) => api('views.push', { trigger_id, view });
export const postMessage = (channel: string, blocks: unknown[], text: string) =>
  api('chat.postMessage', { channel, blocks, text });
