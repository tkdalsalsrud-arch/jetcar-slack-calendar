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

export const publishHome = (user_id: string, view: unknown) => api('views.publish', { user_id, view });
export const openModal = (trigger_id: string, view: unknown) => api('views.open', { trigger_id, view });
export const pushModal = (trigger_id: string, view: unknown) => api('views.push', { trigger_id, view });
export const postMessage = (channel: string, blocks: unknown[], text: string) =>
  api('chat.postMessage', { channel, blocks, text });
