/**
 * Satori(next/og)는 CJK 글리프를 내장하지 않아 한글 폰트를 직접 넘겨야 한다.
 * Noto Sans KR 전체는 수 MB라 매 요청마다 받기엔 무겁다.
 * Google Fonts 의 text= 파라미터로 "실제 쓰이는 글자만" 잘라 받으면 보통 수십 KB로 끝난다.
 */

// woff2 를 모르는 구형 UA 로 요청해야 ttf 가 내려온다. Satori 는 woff2 를 못 읽는다.
const LEGACY_UA =
  'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/28.0.1500.71 Safari/537.36';

const cache = new Map<string, ArrayBuffer>();

async function fetchSubset(chars: string, weight: 400 | 500): Promise<ArrayBuffer> {
  const key = `${weight}:${chars}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cssUrl =
    `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}` +
    `&text=${encodeURIComponent(chars)}`;

  const css = await fetch(cssUrl, { headers: { 'User-Agent': LEGACY_UA } }).then((r) => r.text());
  const m = css.match(/src:\s*url\(([^)]+)\)/);
  if (!m) throw new Error('폰트 CSS 파싱 실패');

  const data = await fetch(m[1]).then((r) => r.arrayBuffer());
  cache.set(key, data);
  return data;
}

/** 렌더링에 등장하는 모든 문자열을 넘기면 필요한 글리프만 담긴 폰트 2종을 돌려준다. */
export async function loadFonts(texts: string[]) {
  // 숫자·구분자는 항상 쓰이므로 기본 포함
  const chars = [...new Set(('0123456789/·—' + texts.join('')).split(''))].join('');

  const [regular, medium] = await Promise.all([fetchSubset(chars, 400), fetchSubset(chars, 500)]);

  return [
    { name: 'NotoKR', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'NotoKR', data: medium, weight: 500 as const, style: 'normal' as const },
  ];
}
