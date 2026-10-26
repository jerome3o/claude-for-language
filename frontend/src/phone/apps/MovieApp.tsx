/**
 * 爆米花电影 — a fictional cinema-ticket app with the ticketing apps' flow: 正在热映 → a film →
 * 特惠购票 → cinemas (date tabs, IMAX filter, distance, ¥起) → 场次 (版本: 英语 IMAX 2D, 厅,
 * 散场 time) → 选座 (银幕中央, 已售, 情侣座 pairs, at most 4, "don't leave a lone seat") →
 * 确认订单 (小食 套餐) → pay → 取票码.
 */
import { useMemo, useState } from 'react';
import { ZH, type MovieFilm, type MovieShow, type MovieWorld } from '@shared/phone';
import { addDays, minutesOf, yuan, zhMonthDay, zhRelativeDay, zhWeekday } from '@shared/phone/dates';
import { recordsFrom, recordsOf } from '@shared/phone/engine';
import { couplePair, movieOrderData, seatExists, seatId, seatLabel, showEnd, showsFor, singleGapProblem, soldSeats, toggleSeat } from '@shared/phone/movie';
import { useAppNav, useAppState, usePhone, type Screen } from '../runtime';
import { AppBar, Body, Btn, Chip, Empty, Group, Cell, Price, Stepper, Tabs } from '../ui';

const APP = 'movie' as const;
const ACCENT = '#e23d4b';

function useWorld(): MovieWorld {
  return usePhone().spec.world.movie!;
}

export function MovieApp({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'film':
      return <Film filmId={String(screen.params.film)} />;
    case 'cinemas':
      return <Cinemas filmId={String(screen.params.film)} />;
    case 'shows':
      return <Shows filmId={String(screen.params.film)} cinemaId={String(screen.params.cinema)} />;
    case 'seats':
      return <Seats showId={String(screen.params.show)} />;
    case 'confirm':
      return <Confirm showId={String(screen.params.show)} />;
    case 'ticket':
      return <Ticket id={String(screen.params.id)} />;
    default:
      return <MovieHome />;
  }
}

function Poster({ f, size = 'normal' }: { f: MovieFilm; size?: 'normal' | 'big' }) {
  return (
    <span className={`mv-poster${size === 'big' ? ' big' : ''}`} style={{ background: `linear-gradient(160deg, ${f.colors?.[0] ?? '#444'}, ${f.colors?.[1] ?? '#111'})` }} aria-hidden>
      <b>{f.title}</b>
    </span>
  );
}

function useFilmDate(filmId: string) {
  const p = usePhone();
  return useAppState<string>(APP, `date:${filmId}`, p.clock.date);
}

function MovieHome() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [tab, setTab] = useState<'showing' | 'coming'>('showing');
  const [home, setHome] = useAppState<'films' | 'me'>(APP, 'tab', 'films');
  const films = w.films.filter((f) => (f.status ?? 'showing') === tab);
  const orders = recordsOf(p.events, 'movie_order').filter((r) => r.data.status === 'paid').reverse();
  return (
    <div className="ph-col mv" data-testid="movie-home">
      {home === 'films' ? (
        <>
          <div className="mv-top">
            <span className="mv-city">{w.city} ▾</span>
            <button type="button" className="mv-search" onClick={() => p.toast('搜索影片、影院：暂未开放')}>
              🔍 找影视剧、影院
            </button>
          </div>
          <Tabs
            accent={ACCENT}
            value={tab}
            onChange={setTab}
            items={[
              { id: 'showing', label: '正在热映' },
              { id: 'coming', label: '即将上映' },
            ]}
          />
          <Body>
            {films.map((f) => (
              <div key={f.id} className="mv-film" data-testid="movie-film" data-film={f.id}>
                <button type="button" className="mv-film-main" onClick={() => nav.push('film', { film: f.id })}>
                  <Poster f={f} />
                  <span>
                    <b>{f.title}</b>
                    {f.status === 'coming' ? <small>{f.release}</small> : <small className="mv-score">观众评分 <em>{f.score}</em></small>}
                    <small>{f.genres.join('/')}</small>
                    {f.cast && <small>{f.cast}</small>}
                  </span>
                </button>
                {f.status === 'coming' ? (
                  <Btn small kind="line" accent="#f7a400" onClick={() => p.toast('已加入想看，上映时提醒你')}>
                    想看
                  </Btn>
                ) : (
                  <Btn small accent={ACCENT} onClick={() => nav.push('cinemas', { film: f.id })} testId="movie-buy">
                    购票
                  </Btn>
                )}
              </div>
            ))}
          </Body>
        </>
      ) : (
        <Body>
          <AppBar title="我的" />
          <Group title="电影票">
            {orders.length === 0 ? (
              <Empty icon="🎬" text="还没有电影票" />
            ) : (
              orders.map((r) => <Cell key={r.id} label={String(r.data.film)} sub={`${zhMonthDay(String(r.data.date))} ${String(r.data.start)} · ${String(r.data.cinema)}`} onClick={() => nav.push('ticket', { id: r.id })} />)
            )}
          </Group>
        </Body>
      )}
      <div className="ph-tabbar">
        {(
          [
            ['films', '电影', '🎬'],
            ['me', '我的', '👤'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" className={home === id ? 'on' : ''} style={home === id ? { color: ACCENT } : undefined} onClick={() => setHome(id)} data-testid={`movie-tab-${id}`}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Film({ filmId }: { filmId: string }) {
  const w = useWorld();
  const nav = useAppNav(APP);
  const f = w.films.find((x) => x.id === filmId)!;
  return (
    <div className="ph-col mv" data-testid="movie-film-page">
      <AppBar title={f.title} onBack={nav.pop} />
      <Body>
        <div className="mv-film-head" style={{ background: `linear-gradient(160deg, ${f.colors?.[0] ?? '#444'}, ${f.colors?.[1] ?? '#111'})` }}>
          <Poster f={f} size="big" />
          <span>
            <b>{f.title}</b>
            {f.original && <small>{f.original}</small>}
            <small>
              {f.genres.join(' / ')} · {f.region} · {f.minutes}分钟
            </small>
            {f.status !== 'coming' && (
              <span className="mv-film-score">
                <em>{f.score}</em> 观众评分
              </span>
            )}
          </span>
        </div>
        <div className="ph-pad">
          <p className="ph-muted">{f.cast}</p>
          <p className="mv-intro">剧情简介：一段关于选择与勇气的故事，上映以来口碑持续发酵，适合与家人朋友一起观看。</p>
        </div>
      </Body>
      {f.status !== 'coming' && (
        <div className="ph-footer">
          <Btn block accent={ACCENT} onClick={() => nav.push('cinemas', { film: f.id })} testId="movie-film-buy">
            特惠购票
          </Btn>
        </div>
      )}
    </div>
  );
}

function DateTabs({ dates, value, onChange, today }: { dates: string[]; value: string; onChange: (d: string) => void; today: string }) {
  return (
    <div className="mv-dates" role="tablist">
      {dates.map((d) => (
        <button key={d} type="button" className={d === value ? 'on' : ''} style={d === value ? { color: ACCENT, borderColor: ACCENT } : undefined} onClick={() => onChange(d)} data-testid={`movie-date-${d}`}>
          {zhRelativeDay(d, today) === zhWeekday(d) ? zhWeekday(d) : zhRelativeDay(d, today)}
          {zhMonthDay(d).replace('日', '')}
        </button>
      ))}
    </div>
  );
}

function filmDates(w: MovieWorld, filmId: string, today: string): string[] {
  const set = new Set(w.shows.filter((s) => s.film === filmId).map((s) => s.date));
  return Array.from({ length: 5 }, (_, i) => addDays(today, i)).filter((d) => set.has(d) || d === today);
}

function Cinemas({ filmId }: { filmId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const f = w.films.find((x) => x.id === filmId)!;
  const [date, setDate] = useFilmDate(filmId);
  const [filter, setFilter] = useState<'all' | 'imax' | 'near'>('all');
  const cinemas = w.cinemas
    .map((c) => ({ c, shows: showsFor(w, filmId, date, c.id) }))
    .filter((x) => x.shows.length > 0)
    .filter((x) => (filter === 'imax' ? x.shows.some((s) => s.format.startsWith('IMAX')) : true))
    .sort((a, b) => (filter === 'near' ? a.c.km - b.c.km : a.c.km - b.c.km));
  return (
    <div className="ph-col mv" data-testid="movie-cinemas">
      <AppBar title={f.title} onBack={nav.pop} />
      <DateTabs dates={filmDates(w, filmId, p.clock.date)} value={date} onChange={setDate} today={p.clock.date} />
      <div className="ph-chips ph-chips-bar">
        <Chip on={filter === 'all'} accent={ACCENT} onClick={() => setFilter('all')}>
          全城
        </Chip>
        <Chip on={filter === 'near'} accent={ACCENT} onClick={() => setFilter('near')}>
          离我最近
        </Chip>
        <Chip on={filter === 'imax'} accent={ACCENT} onClick={() => setFilter('imax')} testId="movie-filter-imax">
          特色：IMAX厅
        </Chip>
      </div>
      <Body>
        {cinemas.length === 0 ? (
          <Empty icon="🎬" text="当天没有该影片的场次，换个日期看看" />
        ) : (
          cinemas.map(({ c, shows }) => (
            <button key={c.id} type="button" className="mv-cinema" onClick={() => nav.push('shows', { film: filmId, cinema: c.id })} data-testid="movie-cinema" data-cinema={c.id}>
              <span className="mv-cinema-top">
                <b>{c.name}</b>
                <span>
                  <Price value={Math.min(...shows.map((s) => s.price))} color={ACCENT} />
                  <small>起</small>
                </span>
              </span>
              <small className="mv-cinema-addr">
                {c.address} <span>{c.km}km</span>
              </small>
              <span className="mv-cinema-tags">
                {(c.tags ?? []).map((t) => (
                  <i key={t}>{t}</i>
                ))}
              </span>
              <small className="mv-cinema-times">近期场次：{shows.slice(0, 4).map((s) => s.start).join(' | ')}</small>
            </button>
          ))
        )}
      </Body>
    </div>
  );
}

function Shows({ filmId, cinemaId }: { filmId: string; cinemaId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const c = w.cinemas.find((x) => x.id === cinemaId)!;
  const f = w.films.find((x) => x.id === filmId)!;
  const [date, setDate] = useFilmDate(filmId);
  const shows = showsFor(w, filmId, date, cinemaId);
  const started = (s: MovieShow) => s.date === p.clock.date && minutesOf(s.start) <= minutesOf(p.clock.time);
  return (
    <div className="ph-col mv" data-testid="movie-shows">
      <AppBar title={c.name} onBack={nav.pop} />
      <div className="mv-cinema-strip">
        <small>{c.address}</small>
        <span className="mv-cinema-tags">
          {(c.tags ?? []).map((t) => (
            <i key={t}>{t}</i>
          ))}
        </span>
      </div>
      <div className="mv-film-strip">
        <Poster f={f} />
        <span>
          <b>{f.title}</b>
          <small>
            {f.minutes}分钟 | {f.genres.join('/')}
          </small>
        </span>
      </div>
      <DateTabs dates={filmDates(w, filmId, p.clock.date)} value={date} onChange={setDate} today={p.clock.date} />
      <Body>
        {shows.length === 0 ? (
          <Empty icon="🎬" text="今日场次已售完或已结束" />
        ) : (
          shows.map((s) => (
            <div key={s.id} className={`mv-show${started(s) ? ' past' : ''}`} data-testid="movie-show" data-show={s.id}>
              <span className="mv-show-time">
                <b>{s.start}</b>
                <small>{showEnd(w, s)}散场</small>
              </span>
              <span className="mv-show-ver">
                <b>
                  {s.language} {s.format}
                </b>
                <small>{s.hall}</small>
              </span>
              <span className="mv-show-price">
                <Price value={s.price} color={ACCENT} />
              </span>
              <Btn small kind={started(s) ? 'grey' : 'line'} accent={ACCENT} disabled={started(s)} onClick={() => nav.push('seats', { show: s.id })} testId="movie-show-buy">
                {started(s) ? '已开场' : '购票'}
              </Btn>
            </div>
          ))
        )}
      </Body>
    </div>
  );
}

function useSelected(showId: string) {
  return useAppState<string[]>(APP, `seats:${showId}`, []);
}

function Seats({ showId }: { showId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const show = w.shows.find((s) => s.id === showId)!;
  const f = w.films.find((x) => x.id === show.film)!;
  const [selected, setSelected] = useSelected(showId);
  const sold = useMemo(() => soldSeats(show, recordsFrom(p.events)), [show, p.events]);
  const map = show.seats;
  const tap = (id: string) => {
    const r = toggleSeat(map, sold, selected, id);
    if (r.problem) p.toast(r.problem);
    setSelected(r.selected);
  };
  const go = () => {
    const problem = singleGapProblem(map, sold, selected);
    if (problem) {
      p.emit({ type: 'error', code: 'seat_gap', app: APP });
      return p.toast(problem);
    }
    nav.push('confirm', { show: showId });
  };
  return (
    <div className="ph-col mv mv-seats-page" data-testid="movie-seats">
      <AppBar title={w.cinemas.find((c) => c.id === show.cinema)?.name ?? ''} onBack={nav.pop} />
      <div className="mv-seat-film">
        <b>{f.title}</b>
        <small>
          {zhRelativeDay(show.date, p.clock.date)} {zhMonthDay(show.date)} {show.start} · {show.language} {show.format} · {show.hall}
        </small>
      </div>
      <div className="mv-legend">
        <span>
          <i className="mv-seat" /> 可选
        </span>
        <span>
          <i className="mv-seat sold" /> 已售
        </span>
        <span>
          <i className="mv-seat on" /> 已选
        </span>
        {(map.couple ?? []).length > 0 && (
          <span>
            <i className="mv-seat couple" />
            <i className="mv-seat couple" /> 情侣座
          </span>
        )}
      </div>
      <Body className="mv-seat-body">
        <div className="mv-screen">{show.hall} 银幕中央</div>
        <div className="mv-grid" data-testid="movie-seat-grid">
          {Array.from({ length: map.rows }, (_, ri) => {
            const row = ri + 1;
            return (
              <div key={row} className="mv-row">
                <span className="mv-row-n">{row}</span>
                {Array.from({ length: map.cols }, (_, ci) => {
                  const col = ci + 1;
                  const id = seatId(row, col);
                  const aisle = (map.aisles_after ?? []).includes(col);
                  const exists = seatExists(map, id);
                  const couple = couplePair(map, id);
                  const cls = !exists ? 'none' : sold.has(id) ? 'sold' : selected.includes(id) ? 'on' : couple ? 'couple' : '';
                  return (
                    <span key={col} className={`mv-cell${aisle ? ' aisle' : ''}`}>
                      {exists && (
                        <button type="button" className={`mv-seat ${cls}${couple ? (couple[0] === id ? ' cl' : ' cr') : ''}`} disabled={sold.has(id)} onClick={() => tap(id)} aria-label={`${seatLabel(id)}${couple ? '情侣座' : ''}${sold.has(id) ? '已售' : ''}`} data-seat={id} data-testid="movie-seat" />
                      )}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Body>
      <div className="mv-seat-foot">
        <div className="mv-picked">
          {selected.length === 0 ? (
            <span className="ph-muted">请选择座位（一次最多4个）</span>
          ) : (
            selected.map((id) => (
              <button key={id} type="button" onClick={() => tap(id)} data-testid="movie-picked">
                {seatLabel(id)}
                <small>¥{yuan(show.price)} ✕</small>
              </button>
            ))
          )}
        </div>
        <Btn block accent={ACCENT} disabled={selected.length === 0} onClick={go} testId="movie-seats-ok">
          {selected.length ? `¥${yuan(show.price * selected.length)} 确认选座` : '请先选座'}
        </Btn>
      </div>
    </div>
  );
}

function Confirm({ showId }: { showId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const show = w.shows.find((s) => s.id === showId)!;
  const f = w.films.find((x) => x.id === show.film)!;
  const cinema = w.cinemas.find((c) => c.id === show.cinema)!;
  const [selected, setSelected] = useSelected(showId);
  const [snacks, setSnacks] = useState<Record<string, number>>({});
  const snackList = (w.snacks ?? []).map((s) => ({ name: s.name, price: s.price, qty: snacks[s.id] ?? 0 }));
  const total = Math.round((show.price * selected.length + snackList.reduce((t, s) => t + s.price * s.qty, 0)) * 100) / 100;
  const submit = async () => {
    const id = p.newId('movie_order', 'M');
    p.write('movie_order', id, movieOrderData({ world: w, show, seatIds: selected, snacks: snackList, orderId: id, status: 'unpaid' }));
    const r = await p.pay({ app: APP, title: `${f.title} ${selected.length}张`, payee: '爆米花电影', amount: total });
    if (!r) {
      p.write('movie_order', id, { status: 'cancelled' });
      return p.toast('支付未完成，座位已释放');
    }
    p.write('movie_order', id, { status: 'paid', pay_method: r.method });
    setSelected([]);
    p.sms('10690000', `【爆米花电影】取票码${movieOrderData({ world: w, show, seatIds: [], snacks: [], orderId: id, status: 'paid' }).code}，${zhMonthDay(show.date)} ${show.start}《${f.title}》${cinema.name}${show.hall}，请提前到影院自助取票机取票。`);
    nav.resetTo([{ name: 'ticket', params: { id } }]);
  };
  return (
    <div className="ph-col mv" data-testid="movie-confirm">
      <AppBar title="确认订单" onBack={nav.pop} />
      <Body>
        <div className="mv-confirm-card">
          <Poster f={f} />
          <span>
            <b>{f.title}</b>
            <small>
              {zhRelativeDay(show.date, p.clock.date)} {zhMonthDay(show.date)} {show.start} · {show.language} {show.format}
            </small>
            <small>
              {cinema.name} · {show.hall}
            </small>
            <small className="mv-confirm-seats" data-testid="movie-confirm-seats">
              {selected.map(seatLabel).join('　')}
            </small>
          </span>
        </div>
        <Group title="小食">
          {(w.snacks ?? []).map((s) => (
            <div key={s.id} className="mv-snack" data-testid="movie-snack" data-snack={s.id}>
              <span>
                <b>🍿 {s.name}</b>
                <small>{s.desc}</small>
              </span>
              <Price value={s.price} color={ACCENT} />
              <Stepper value={snacks[s.id] ?? 0} max={4} onChange={(n) => setSnacks((x) => ({ ...x, [s.id]: n }))} testId={`movie-snack-${s.id}`} />
            </div>
          ))}
        </Group>
        <Group>
          <Cell label="购票手机号" value={p.spec.profile.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')} arrow={false} />
          <Cell label="优惠券" value="暂无可用" arrow={false} />
        </Group>
        <div className="ph-note">· 电影票一经售出，开场前60分钟以上可改签/退票，具体以影院规定为准<br />· 请提前到影院取票，迟到可能影响观影</div>
      </Body>
      <div className="ph-footer">
        <span className="ph-footer-sum">
          实付 <Price value={total} size="big" color={ACCENT} />
        </span>
        <Btn accent={ACCENT} onClick={() => void submit()} testId="movie-submit">
          {ZH.submitOrder}
        </Btn>
      </div>
    </div>
  );
}

function Ticket({ id }: { id: string }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const o = recordsOf(p.events, 'movie_order').find((r) => r.id === id)?.data;
  if (!o) return <Empty text="订单不存在" />;
  return (
    <div className="ph-col mv" data-testid="movie-ticket">
      <AppBar title="电影票" onBack={nav.home} />
      <Body>
        <div className="mv-ticket">
          <b>{String(o.film)}</b>
          <small>
            {zhMonthDay(String(o.date))} {String(o.start)} · {String(o.language)} {String(o.format)}
          </small>
          <small>
            {String(o.cinema)} {String(o.hall)}
          </small>
          <div className="mv-ticket-seats">{(o.seats as string[]).join('　')}</div>
          <div className="mv-ticket-code">
            取票码
            <b data-testid="movie-code">{String(o.code)}</b>
          </div>
          <div className="wx-qr-img mv-ticket-qr" aria-hidden>
            {Array.from({ length: 49 }, (_, i) => (
              <i key={i} className={(i * 5 + 3) % 3 === 0 || [0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43].includes(i) ? 'on' : ''} />
            ))}
          </div>
          <small>请于开场前到影院自助取票机输入取票码取票</small>
          {(o.snacks as string[]).length > 0 && <small>小食：{(o.snacks as string[]).join('、')}（凭取票码到卖品部领取）</small>}
        </div>
      </Body>
    </div>
  );
}
