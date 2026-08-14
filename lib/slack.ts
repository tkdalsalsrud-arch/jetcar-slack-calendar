import crypto from 'node:crypto';

const SLACK_API = 'https://slack.com/api';

/**
 * 슬랙 요청 서명 검증.
 * 반드시 "가공되지 않은 원본 body 문자열"로 검증해야 한다.
 * JSON.parse 후 다시 stringify 하면 서명이 절대 맞지 않는다.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // 리플레이 공격 방지: 5분 초과된 요청은 거부
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const mine = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');

  const a = Buffer.from(mine);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 슬랙 Web API 호출 공통 래퍼 */
async function slackApi<T = any>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as any;
  if (!data.ok) {
    // response_metadata.messages 에 Block Kit 검증 실패 사유가 상세히 담긴다
    console.error(`[slack] ${method} 실패:`, data.error, data.response_metadata ?? '');
    throw new Error(`slack ${method}: ${data.error}`);
  }
  return data as T;
}

/** 앱 홈 탭 렌더링 */
export function publishHome(userId: string, view: unknown, hash?: string) {
  return slackApi('views.publish', { user_id: userId, view, ...(hash ? { hash } : {}) });
}

/** 모달 열기 (trigger_id 는 발급 후 3초 내에 써야 함) */
export function openModal(triggerId: string, view: unknown) {
  return slackApi('views.open', { trigger_id: triggerId, view });
}

/** 채널 메시지 전송 (아침 브리핑 등에 사용) */
export function postMessage(channel: string, blocks: unknown[], text: string) {
  return slackApi('chat.postMessage', { channel, blocks, text });
}
