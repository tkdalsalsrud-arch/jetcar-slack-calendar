import { ImageResponse } from 'next/og';
import { fetchAll, type ScheduleRow, type VacationRow } from '@/lib/sheets';
import { loadFonts } from '@/lib/font';
import { canonical, verify } from '@/lib/sign';
import { rangeOf, todaySeoul, type HomeState, type Mode } from '@/lib/views';

export const runtime = 'nodejs'; // google-auth-library 와 next/og 를 함께 쓴다
export const dynamic = 'force-dynamic';

/* 슬랙은 라이트/다크 테마를 구분해 알려주지 않는다.
   어느 쪽에서도 카드처럼 보이도록 밝은 배경 한 벌로 간다. */
const C = {
  bg: '#FFFFFF',
  line: '#E5E3DD',
  head: '#F7F6F3',
  text: '#1F1E1C',
  sub: '#6B6A65',
  faint: '#A3A29C',
  out: '#185FA5',
  outBg: '#E6F1FB',
  ret: '#0F6E56',
  retBg: '#E1F5EE',
  today: '#FAEEDA',
  todayLine: '#BA7517',
  sat: '#378ADD',
  sun: '#E24B4A',
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'week') as Mode;
  const anchor = url.searchParams.get('anchor') ?? todaySeoul();
  const type = url.searchParams.get('type') ?? '전체';

  if (!verify(canonical(mode, anchor, type), url.searchParams.get('sig'))) {
    return new Response('invalid signature', { status: 401 });
  }

  const state: HomeState = { mode, anchor, type };
  const data = await fetchAll();

  const rows = data.schedules
    .filter((e) => type === '전체' || e.type === type)
    .filter((e) => {
      const [f, t] = rangeOf(state);
      return e.date >= f && e.date <= t;
    });

  const tree = mode === 'month' ? monthGrid(state, rows, data.vacations) : weekTable(state, rows, data.vacations);

  return new ImageResponse(tree.node, {
    width: tree.width,
    height: tree.height,
    fonts: await loadFonts(tree.texts),
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30' },
  });
}

/* ─────────── 공통 ─────────── */

const isOut = (e: ScheduleRow) => e.type.endsWith('-out');

function byDate<T extends { date: string }>(items: T[]) {
  const m = new Map<string, T[]>();
  for (const i of items) {
    if (!m.has(i.date)) m.set(i.date, []);
    m.get(i.date)!.push(i);
  }
  return m;
}

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

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

/** "쏘렌토 116호7147 · 신경철" 형태로 압축. customerName 은 첫 토막만 쓴다. */
function label(e: ScheduleRow): string {
  const who = (e.customerName || '').split('/')[1]?.trim() || e.customerName || '';
  const v = e.vehicleNumber.replace(/\s*,\s*/g, ' ').trim();
  return who ? `${v} · ${clip(who, 10)}` : v;
}

function clip(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

/* ─────────── 주간: 상세 표 (레이아웃 C) ─────────── */

function weekTable(state: HomeState, rows: ScheduleRow[], vacs: VacationRow[]) {
  const [from, to] = rangeOf(state);
  const days = eachDay(from, to);
  const today = todaySeoul();
  const map = byDate(rows);
  const vmap = byDate(vacs.filter((v) => v.date >= from && v.date <= to));

  const W = 1000;
  const COL = [110, 52, 366, 366, 106];
  const MAX = 6;
  const LINE = 27;

  const texts: string[] = [];
  const bodyRows = days.map((d) => {
    const items = map.get(d) ?? [];
    const outs = items.filter(isOut).map(label);
    const rets = items.filter((e) => !isOut(e)).map(label);
    const vac = (vmap.get(d) ?? []).map((v) => v.employeeName);
    texts.push(...outs, ...rets, ...vac);
    const lines = Math.max(outs.length, rets.length, vac.length, 1);
    return { d, outs, rets, vac, h: Math.max(Math.min(lines, MAX + 1) * LINE + 20, 54) };
  });

  const HEAD = 58;
  const THEAD = 36;
  const height = HEAD + THEAD + bodyRows.reduce((a, r) => a + r.h, 0);

  const total = rows.length;
  const outN = rows.filter(isOut).length;
  const title = `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월 ${Number(from.slice(8))}일 ~ ${Number(to.slice(5, 7))}월 ${Number(to.slice(8))}일`;
  const summary = `출고 ${outN} · 반납 ${total - outN}`;
  texts.push(title, summary, '날짜', '건', '출고', '반납', '휴가', ...WD);

  const cell = (list: string[], w: number, color: string, bg: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', width: w, padding: '10px 12px' }}>
      {list.slice(0, MAX).map((s, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            fontSize: 15,
            lineHeight: `${LINE}px`,
            color,
            ...(i === 0 ? { borderLeft: `3px solid ${bg}`, paddingLeft: 8 } : { paddingLeft: 11 }),
          }}
        >
          {s}
        </div>
      ))}
      {list.length > MAX && (
        <div style={{ display: 'flex', fontSize: 14, lineHeight: `${LINE}px`, color: C.faint, paddingLeft: 11 }}>
          외 {list.length - MAX}건
        </div>
      )}
      {list.length === 0 && (
        <div style={{ display: 'flex', fontSize: 15, lineHeight: `${LINE}px`, color: C.faint, paddingLeft: 11 }}>—</div>
      )}
    </div>
  );

  const node = (
    <div style={{ display: 'flex', flexDirection: 'column', width: W, height, background: C.bg, fontFamily: 'NotoKR' }}>
      <div
        style={{
          display: 'flex',
          height: HEAD,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 500, color: C.text }}>{title}</div>
        <div style={{ display: 'flex', fontSize: 15, color: C.sub }}>{summary}</div>
      </div>

      <div style={{ display: 'flex', height: THEAD, background: C.head, borderBottom: `1px solid ${C.line}` }}>
        {['날짜', '건', '출고', '반납', '휴가'].map((h, i) => (
          <div
            key={h}
            style={{
              display: 'flex',
              width: COL[i],
              alignItems: 'center',
              justifyContent: i === 1 ? 'flex-end' : 'flex-start',
              padding: '0 12px',
              fontSize: 14,
              color: C.sub,
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {bodyRows.map((r) => {
        const w = dow(r.d);
        const isToday = r.d === today;
        return (
          <div
            key={r.d}
            style={{
              display: 'flex',
              height: r.h,
              borderBottom: `1px solid ${C.line}`,
              background: isToday ? C.today : w === 0 || w === 6 ? C.head : C.bg,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', width: COL[0], padding: '14px 12px 0 12px' }}>
              <div style={{ display: 'flex', fontSize: 17, fontWeight: 500, color: C.text }}>{r.d.slice(5).replace('-', '/')}</div>
              <div
                style={{
                  display: 'flex',
                  marginLeft: 6,
                  fontSize: 14,
                  color: w === 0 ? C.sun : w === 6 ? C.sat : C.sub,
                }}
              >
                {WD[w]}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                width: COL[1],
                justifyContent: 'flex-end',
                padding: '14px 12px 0 0',
                fontSize: 16,
                color: r.outs.length + r.rets.length ? C.text : C.faint,
              }}
            >
              {r.outs.length + r.rets.length || '0'}
            </div>
            {cell(r.outs, COL[2], C.text, C.out)}
            {cell(r.rets, COL[3], C.text, C.ret)}
            <div style={{ display: 'flex', flexDirection: 'column', width: COL[4], padding: '10px 12px' }}>
              {r.vac.slice(0, 4).map((n, i) => (
                <div key={i} style={{ display: 'flex', fontSize: 14, lineHeight: `${LINE}px`, color: C.sub }}>
                  {n}
                </div>
              ))}
              {r.vac.length === 0 && (
                <div style={{ display: 'flex', fontSize: 14, lineHeight: `${LINE}px`, color: C.faint }}>—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return { node, width: W, height, texts };
}

/* ─────────── 월간: 진짜 7×5 격자 (건수 요약) ─────────── */

function monthGrid(state: HomeState, rows: ScheduleRow[], vacs: VacationRow[]) {
  const [from, to] = rangeOf(state);
  const today = todaySeoul();
  const map = byDate(rows);
  const vmap = byDate(vacs.filter((v) => v.date >= from && v.date <= to));

  // 1일이 속한 주의 일요일부터 시작해 7칸씩 채운다
  const lead = dow(from);
  const start = new Date(`${from}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - lead);
  const startStr = start.toISOString().slice(0, 10);

  const cells: string[] = [];
  const d = new Date(`${startStr}T12:00:00Z`);
  while (cells.length < 42) {
    cells.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    if (cells.length % 7 === 0 && cells[cells.length - 1] > to) break;
  }

  const CW = 140;
  const CH = 108;
  const W = CW * 7;
  const HEAD = 58;
  const THEAD = 34;
  const weeks = cells.length / 7;
  const height = HEAD + THEAD + weeks * CH;

  const total = rows.length;
  const outN = rows.filter(isOut).length;
  const title = `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월`;
  const summary = `출고 ${outN} · 반납 ${total - outN}`;
  const texts = [title, summary, '출고', '반납', '휴가', ...WD];

  const node = (
    <div style={{ display: 'flex', flexDirection: 'column', width: W, height, background: C.bg, fontFamily: 'NotoKR' }}>
      <div
        style={{
          display: 'flex',
          height: HEAD,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 500, color: C.text }}>{title}</div>
        <div style={{ display: 'flex', fontSize: 15, color: C.sub }}>{summary}</div>
      </div>

      <div style={{ display: 'flex', height: THEAD, background: C.head, borderBottom: `1px solid ${C.line}` }}>
        {WD.map((w, i) => (
          <div
            key={w}
            style={{
              display: 'flex',
              width: CW,
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              color: i === 0 ? C.sun : i === 6 ? C.sat : C.sub,
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {Array.from({ length: weeks }, (_, wi) => (
        <div key={wi} style={{ display: 'flex', height: CH }}>
          {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => {
            const inMonth = day >= from && day <= to;
            const items = map.get(day) ?? [];
            const o = items.filter(isOut).length;
            const r = items.length - o;
            const v = (vmap.get(day) ?? []).length;
            const isToday = day === today;

            return (
              <div
                key={day}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: CW,
                  height: CH,
                  padding: '8px 10px',
                  borderRight: `1px solid ${C.line}`,
                  borderBottom: `1px solid ${C.line}`,
                  background: isToday ? C.today : C.bg,
                  ...(isToday ? { borderTop: `2px solid ${C.todayLine}` } : {}),
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: 17,
                    lineHeight: '22px',
                    fontWeight: 500,
                    marginBottom: 5,
                    color: !inMonth ? C.faint : di === 0 ? C.sun : di === 6 ? C.sat : C.text,
                  }}
                >
                  {Number(day.slice(8))}
                </div>

                {inMonth && o > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignSelf: 'flex-start',
                      background: C.outBg,
                      color: C.out,
                      fontSize: 14,
                      lineHeight: '21px',
                      height: 21,
                      padding: '0 7px',
                      borderRadius: 4,
                      marginBottom: 3,
                    }}
                  >
                    출고 {o}
                  </div>
                )}
                {inMonth && r > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignSelf: 'flex-start',
                      background: C.retBg,
                      color: C.ret,
                      fontSize: 14,
                      lineHeight: '21px',
                      height: 21,
                      padding: '0 7px',
                      borderRadius: 4,
                      marginBottom: 3,
                    }}
                  >
                    반납 {r}
                  </div>
                )}
                {inMonth && v > 0 && (
                  <div style={{ display: 'flex', fontSize: 13, color: C.faint }}>휴가 {v}</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return { node, width: W, height, texts };
}
