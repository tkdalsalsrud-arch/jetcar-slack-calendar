import { ImageResponse } from 'next/og';
import { fetchAll, type ScheduleRow, type VacationRow } from '@/lib/sheets';
import { loadFonts } from '@/lib/font';
import { canonical, verify } from '@/lib/sign';
import { TYPES, VACATION_COLORS, rangeOf, todaySeoul, type HomeState, type Mode } from '@/lib/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 웹앱(Apps Script)의 격자 캘린더를 PNG 로 재현한다.
 * 색상·분류·카드 구성은 index.html 의 CSS 를 그대로 따랐다.
 *
 * 슬랙 홈 탭 표시 폭은 약 700px 이라 7열이면 칸당 100px 남짓이다.
 * 그래서 크게 그려두고, 인라인에서는 축소되어 흐름만 보이되
 * 클릭하면 원본 해상도 뷰어가 열려 글자를 읽을 수 있게 한다.
 */

const UI = {
  bg: '#FFFFFF',
  cellBorder: '#E5E7EB',
  cellBg: '#FFFFFF',
  outBg: '#F9FAFB',
  today: '#111827',
  tomorrow: '#22C55E',
  dayNum: '#4B5563',
  catTitle: '#6B7280',
  agency: '#FEF08A',
  head: '#1F2937',
  sub: '#6B7280',
};

const SUN = '#DC2626';
const SAT = '#2563EB';
const WD = ['일', '월', '화', '수', '목', '금', '토'];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'month') as Mode;
  const anchor = url.searchParams.get('anchor') ?? todaySeoul();
  const type = url.searchParams.get('type') ?? '전체';

  if (!verify(canonical(mode, anchor, type), url.searchParams.get('sig'))) {
    return new Response('invalid signature', { status: 401 });
  }

  const state: HomeState = { mode, anchor, type };
  const [from, to] = rangeOf(state);
  const data = await fetchAll();

  const schedules = data.schedules
    .filter((e) => e.date >= from && e.date <= to)
    .filter((e) => type === '전체' || e.type === type);
  const vacations = data.vacations.filter((v) => v.date >= from && v.date <= to);

  const built = build(state, schedules, vacations);

  return new ImageResponse(built.node, {
    width: built.width,
    height: built.height,
    fonts: await loadFonts(built.texts),
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30' },
  });
}

/* ─────────── 치수 ─────────── */

const COL = 220;
const PAD = 10;
const GAP = 4;
const HEADER = 56;
const WDBAR = 26;

const L1 = 17; // 차량번호 줄
const L2 = 16; // 부가 정보 줄
const CARD_PAD = 8;
const CARD_GAP = 3;
const CAT_TITLE = 16;

type Card = { row: ScheduleRow; lines: string[] };

function cardLines(e: ScheduleRow, detailed: boolean): string[] {
  const out: string[] = [];
  if (e.customerName) out.push(clip(e.customerName, detailed ? 44 : 26));
  if (e.completionDate) out.push(e.completionDate);
  if (e.agencyContract) out.push(clip(e.agencyContract, detailed ? 40 : 24));
  if (detailed && e.memo) out.push(clip(e.memo.replace(/\n/g, ' '), 44));
  return out;
}

const cardHeight = (lines: string[]) => CARD_PAD + L1 + lines.length * L2 + CARD_GAP;

function clip(s: string, n: number) {
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

/* ─────────── 렌더 ─────────── */

function build(state: HomeState, schedules: ScheduleRow[], vacations: VacationRow[]) {
  const [from, to] = rangeOf(state);
  const today = todaySeoul();
  const detailed = state.mode === 'week'; // 주간은 칸이 넉넉하니 메모까지 노출

  // 주 단위로 쪼갠다. 월간이면 앞뒤 빈칸을 채워 7의 배수로 맞춘다.
  const days: (string | null)[] = [];
  if (state.mode === 'week') {
    for (const d of eachDay(from, to)) days.push(d);
  } else {
    for (let i = 0; i < dow(from); i++) days.push(null);
    for (const d of eachDay(from, to)) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
  }

  const sMap = groupBy(schedules, (e) => e.date);
  const vMap = groupBy(vacations, (v) => v.date);
  const texts: string[] = [];

  // 칸 내용과 높이를 먼저 계산해야 이미지 전체 높이가 나온다
  const cells = days.map((d) => {
    if (!d) return { d: null as string | null, cats: [] as { t: (typeof TYPES)[number]; list: Card[] }[], vacs: [] as VacationRow[], h: 90 };

    const items = sMap.get(d) ?? [];
    const cats = TYPES.map((t) => ({
      t,
      list: items.filter((e) => e.type === t.key).map<Card>((row) => ({ row, lines: cardLines(row, detailed) })),
    })).filter((c) => c.list.length > 0);

    const vacs = vMap.get(d) ?? [];

    let h = 24 + PAD;
    for (const c of cats) {
      h += CAT_TITLE;
      for (const card of c.list) h += cardHeight(card.lines);
      texts.push(c.t.label);
      for (const card of c.list) {
        texts.push(card.row.vehicleNumber, ...card.lines);
        if (card.row.isReady) texts.push('완료');
      }
    }
    if (vacs.length) {
      h += CAT_TITLE + vacs.length * (CARD_PAD + L1 + CARD_GAP);
      texts.push('휴가');
      for (const v of vacs) texts.push(`${v.employeeName} ${v.vacationType}`);
    }
    return { d, cats, vacs, h: Math.max(h, 90) };
  });

  // 한 주의 높이 = 그 주에서 가장 높은 칸
  const weeks: number[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(Math.max(...cells.slice(i, i + 7).map((c) => c.h)));
  }

  const W = PAD * 2 + (COL + 2) * 7 + GAP * 6; // +2 는 칸 테두리
  const H = HEADER + WDBAR + weeks.reduce((a, b) => a + b + GAP, 0) + PAD;

  const title =
    state.mode === 'week'
      ? `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월 ${Number(from.slice(8))}일 ~ ${Number(to.slice(5, 7))}월 ${Number(to.slice(8))}일`
      : `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월`;

  // 웹앱 헤더와 같은 집계 방식
  const cnt = (key: string, agency: boolean) =>
    schedules.filter((e) => e.type === key && !!e.agencyContract.trim() === agency).length;
  const ltD = cnt('long-term-out', false);
  const ltA = cnt('long-term-out', true);
  const afD = cnt('affiliate-out', false);
  const afA = cnt('affiliate-out', true);
  const summary = `장기출고 ${ltD + ltA}건 (제트카 ${ltD} / 에이전시 ${ltA})   ·   제휴사출고 ${afD + afA}건 (제트카 ${afD} / 에이전시 ${afA})`;
  texts.push(title, summary, ...WD);

  const node = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: W,
        height: H,
        background: UI.bg,
        fontFamily: 'NotoKR',
        padding: `0 ${PAD}px ${PAD}px`,
      }}
    >
      <div style={{ display: 'flex', height: HEADER, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: UI.head }}>{title}</div>
        <div style={{ display: 'flex', fontSize: 14, color: UI.sub }}>{summary}</div>
      </div>

      <div style={{ display: 'flex', height: WDBAR }}>
        {WD.map((w, i) => (
          <div
            key={w}
            style={{
              display: 'flex',
              width: COL + 2,
              flexShrink: 0,
              marginRight: i < 6 ? GAP : 0,
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 500,
              color: i === 0 ? SUN : i === 6 ? SAT : UI.sub,
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {weeks.map((wh, wi) => (
        <div key={wi} style={{ display: 'flex', height: wh, marginBottom: GAP }}>
          {cells.slice(wi * 7, wi * 7 + 7).map((c, di) => {
            const isToday = c.d === today;
            const isTomorrow = c.d === addDays(today, 1);
            const accent = isToday ? UI.today : isTomorrow ? UI.tomorrow : null;

            return (
              <div
                key={di}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: COL,
                  flexShrink: 0,
                  height: wh,
                  marginRight: di < 6 ? GAP : 0,
                  border: `1px solid ${UI.cellBorder}`,
                  ...(accent ? { boxShadow: `inset 0 0 0 3px ${accent}` } : {}),
                  borderRadius: 6,
                  background: c.d ? UI.cellBg : UI.outBg,
                  padding: 4,
                }}
              >
                {c.d && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', height: 20 }}>
                    <div
                      style={{
                        display: 'flex',
                        fontSize: 14,
                        fontWeight: 700,
                        lineHeight: '20px',
                        borderRadius: 10,
                        padding: '0 7px',
                        color: isToday ? '#FFFFFF' : di === 0 ? SUN : di === 6 ? SAT : UI.dayNum,
                        background: isToday ? UI.today : 'transparent',
                      }}
                    >
                      {Number(c.d.slice(8))}
                    </div>
                  </div>
                )}

                {c.cats.map((cat) => (
                  <div key={cat.t.key} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', fontSize: 11, fontWeight: 700, color: UI.catTitle, height: CAT_TITLE, paddingLeft: 3 }}>
                      {cat.t.label}
                    </div>
                    {cat.list.map((card, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          background: cat.t.color,
                          borderRadius: 4,
                          padding: '3px 5px',
                          marginBottom: CARD_GAP,
                          opacity: card.row.isReady ? 0.72 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', height: L1 }}>
                          <div style={{ display: 'flex', fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>
                            {card.row.vehicleNumber}
                          </div>
                          {card.row.isReady && (
                            <div
                              style={{
                                display: 'flex',
                                marginLeft: 4,
                                background: '#FFFFFF',
                                color: cat.t.color,
                                fontSize: 10,
                                fontWeight: 700,
                                lineHeight: '14px',
                                height: 14,
                                padding: '0 4px',
                                borderRadius: 3,
                              }}
                            >
                              완료
                            </div>
                          )}
                        </div>
                        {card.lines.map((ln, j) => (
                          <div
                            key={j}
                            style={{
                              display: 'flex',
                              fontSize: 12,
                              height: L2,
                              // 에이전시명은 웹앱과 동일하게 노란색 강조
                              color: ln === card.row.agencyContract ? UI.agency : 'rgba(255,255,255,0.88)',
                              fontWeight: ln === card.row.agencyContract ? 700 : 400,
                            }}
                          >
                            {ln}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}

                {c.vacs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', fontSize: 11, fontWeight: 700, color: UI.catTitle, height: CAT_TITLE, paddingLeft: 3 }}>
                      휴가
                    </div>
                    {c.vacs.map((v, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          height: L1 + CARD_PAD - CARD_GAP,
                          background: VACATION_COLORS[v.vacationType] ?? '#a78bfa',
                          borderRadius: 4,
                          padding: '0 5px',
                          marginBottom: CARD_GAP,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            fontSize: 12,
                            fontWeight: 500,
                            color:
                              v.vacationType === '오후반차' || v.vacationType === '훈련(오후)' ? '#111827' : '#FFFFFF',
                            textDecoration: v.status === 'cancelled' ? 'line-through' : 'none',
                          }}
                        >
                          {v.employeeName} {v.vacationType}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return { node, width: W, height: H, texts };
}

/* ─────────── 날짜 유틸 ─────────── */

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

function groupBy<T>(arr: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const i of arr) {
    const k = key(i);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return m;
}
