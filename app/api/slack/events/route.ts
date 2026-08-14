import { waitUntil } from '@vercel/functions';
import { verifySlackSignature, publishHome } from '@/lib/slack';
import { fetchAll } from '@/lib/sheets';
import { buildHomeView, defaultState } from '@/lib/views';

export const runtime = 'nodejs'; // crypto / google-auth-library 사용
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text(); // 서명 검증용 원본 body

  // 1) URL 검증 챌린지 — 이벤트 구독 최초 설정 시 슬랙이 한 번 보낸다
  if (raw.includes('"type":"url_verification"')) {
    const { challenge } = JSON.parse(raw);
    return Response.json({ challenge });
  }

  // 2) 서명 검증
  const ok = verifySlackSignature(
    raw,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature')
  );
  if (!ok) return new Response('invalid signature', { status: 401 });

  // 3) 재시도 요청은 무시 (지연 시 슬랙이 최대 3회 재전송)
  if (req.headers.get('x-slack-retry-num')) return new Response('ok', { status: 200 });

  const event = JSON.parse(raw).event;

  // 같은 이벤트가 Messages 탭에서도 발생하므로 tab 체크가 필수
  if (event?.type === 'app_home_opened' && event.tab === 'home') {
    waitUntil(renderHome(event.user)); // 3초 내 200 반환, 렌더링은 백그라운드
  }

  return new Response('ok', { status: 200 });
}

async function renderHome(userId: string) {
  try {
    const data = await fetchAll();
    await publishHome(userId, buildHomeView(defaultState(), data));
  } catch (err) {
    console.error('[app_home_opened] 렌더링 실패:', err);
    await publishHome(userId, {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              ':warning: *캘린더를 불러오지 못했습니다.*\n' +
              '환경변수와 시트 공유 권한을 확인해 주세요. 자세한 원인은 Vercel 로그에 남습니다.',
          },
        },
      ],
    }).catch(() => {});
  }
}
