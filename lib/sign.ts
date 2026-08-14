import crypto from 'node:crypto';

/**
 * 캘린더 PNG 엔드포인트는 슬랙이 서버에서 직접 가져가므로 인증 헤더를 붙일 수 없다.
 * 대신 쿼리에 서명을 넣어 URL 을 추측 불가능하게 만든다.
 */
export function sign(canonical: string): string {
  return crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET ?? '')
    .update(canonical)
    .digest('hex')
    .slice(0, 32);
}

export function verify(canonical: string, sig: string | null): boolean {
  if (!sig) return false;
  const mine = sign(canonical);
  if (mine.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
}

/** 서명 대상 문자열. 순서가 고정돼야 서명이 일치한다. */
export function canonical(mode: string, anchor: string, type: string): string {
  return `${mode}|${anchor}|${type}`;
}

/**
 * 배포 도메인. Vercel 이 자동 주입하는 값을 쓰되,
 * 커스텀 도메인을 붙였다면 PUBLIC_BASE_URL 로 덮어쓸 수 있다.
 */
export function baseUrl(): string | null {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

/** 홈 탭 이미지 블록에 넣을 서명된 PNG URL */
export function calendarImageUrl(mode: string, anchor: string, type: string): string | null {
  const base = baseUrl();
  if (!base) return null;

  const q = new URLSearchParams({
    mode,
    anchor,
    type,
    sig: sign(canonical(mode, anchor, type)),
    // 슬랙이 이미지 URL 을 공격적으로 캐싱한다. 이 값이 없으면 어제 달력이 계속 보인다.
    v: String(Date.now()),
  });
  return `${base}/api/calendar?${q}`;
}
