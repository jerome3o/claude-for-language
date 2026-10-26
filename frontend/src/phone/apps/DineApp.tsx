/**
 * 吃喝玩乐 — a fictional restaurant-guide app with the review apps' flow: search / 附近热门
 * (★ 评分, 人均, 区域), a restaurant (口味 / 环境 / 服务, 推荐菜, 评价), 排队取号 (the table type
 * follows the party size; "前方还有8桌"), 订座 (date, 人数, times with 已满, 大厅 / 包间 with a
 * 最低消费, 联系人 先生 / 女士, 手机号 → 商家确认中 → 已确认), and 💬 咨询 the restaurant (a persona).
 */
import { useEffect, useState } from 'react';
import { ZH, type DineRestaurant, type DineWorld } from '@shared/phone';
import { yuan, zhMonthDay, zhRelativeDay, zhWeekday } from '@shared/phone/dates';
import { recordsOf } from '@shared/phone/engine';
import { bookingProblems, queueTableFor, queueTicket, slotFull, ticketsTaken, type BookingDraft } from '@shared/phone/dine';
import { useAppNav, useAppState, usePhone, type Screen } from '../runtime';
import { AppChat } from '../persona';
import { AppBar, Body, Btn, Cell, Chip, Empty, Field, Group, SearchBox, Stars, Stepper } from '../ui';

const APP = 'dine' as const;
const ACCENT = '#ee5a2c';

function useWorld(): DineWorld {
  return usePhone().spec.world.dine!;
}

export function DineApp({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'search':
      return <Search />;
    case 'restaurant':
      return <Restaurant id={String(screen.params.id)} />;
    case 'queue':
      return <Queue id={String(screen.params.id)} />;
    case 'ticket':
      return <QueueTicket id={String(screen.params.id)} />;
    case 'book':
      return <Book id={String(screen.params.id)} />;
    case 'booking':
      return <BookingDone id={String(screen.params.id)} />;
    case 'chat':
      return <HostChat restaurantId={String(screen.params.id)} />;
    case 'mine':
      return <Mine />;
    default:
      return <DineHome />;
  }
}

function RestaurantRow({ r, onClick }: { r: DineRestaurant; onClick: () => void }) {
  return (
    <button type="button" className="dn-row" onClick={onClick} data-testid="dine-restaurant" data-id={r.id}>
      <span className="dn-pic">{r.emoji ?? '🍽'}</span>
      <span className="dn-main">
        <b>{r.name}</b>
        <span className="dn-meta">
          <Stars value={r.rating} size={12} /> <em>{r.rating}</em> 人均¥{r.avg_price}
        </span>
        <small>
          {r.cuisine} · {r.district}
        </small>
        <span className="dn-tags">
          {(r.tags ?? []).map((t) => (
            <i key={t}>{t}</i>
          ))}
        </span>
      </span>
    </button>
  );
}

function DineHome() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  return (
    <div className="ph-col dn" data-testid="dine-home">
      <div className="dn-top" style={{ background: ACCENT }}>
        <span className="dn-city">上海 ▾</span>
        <button type="button" className="dn-search" onClick={() => nav.push('search')} data-testid="dine-search-open">
          🔍 搜索商户、地点、菜名
        </button>
        <button type="button" className="dn-mine" onClick={() => nav.push('mine')} data-testid="dine-mine">
          我的
        </button>
      </div>
      <Body>
        <div className="food-cats">
          {[
            ['美食', '🍲'],
            ['火锅', '🫕'],
            ['本帮菜', '🥢'],
            ['小吃快餐', '🥟'],
            ['休闲娱乐', '🎤'],
            ['酒店', '🏨'],
            ['丽人', '💅'],
            ['亲子', '🧸'],
          ].map(([name, icon]) => (
            <button key={name} type="button" onClick={() => p.toast(ZH.notOpen)}>
              <span>{icon}</span>
              {name}
            </button>
          ))}
        </div>
        <div className="ph-section-title">附近热门 · 必吃榜</div>
        {w.restaurants.map((r) => (
          <RestaurantRow key={r.id} r={r} onClick={() => nav.push('restaurant', { id: r.id })} />
        ))}
      </Body>
    </div>
  );
}

function Search() {
  const w = useWorld();
  const nav = useAppNav(APP);
  const [q, setQ] = useState('');
  const t = q.trim();
  const hits = t ? w.restaurants.filter((r) => r.name.includes(t) || r.cuisine.includes(t) || r.district.includes(t) || (r.dishes ?? []).some((d) => d.includes(t))) : [];
  return (
    <div className="ph-col dn" data-testid="dine-search">
      <AppBar title="" onBack={nav.pop} />
      <div className="ph-pad">
        <SearchBox value={q} onChange={setQ} placeholder="搜索商户、地点、菜名" autoFocus mic testId="dine-search-input" />
      </div>
      <Body>
        {t ? hits.length ? hits.map((r) => <RestaurantRow key={r.id} r={r} onClick={() => nav.push('restaurant', { id: r.id })} />) : <Empty icon="🔍" text="没有找到相关商户" /> : null}
      </Body>
    </div>
  );
}

function Restaurant({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const r = w.restaurants.find((x) => x.id === id)!;
  return (
    <div className="ph-col dn" data-testid="dine-restaurant-page" data-id={r.id}>
      <AppBar title="" onBack={nav.pop} right={<button type="button" className="ph-bar-icon" onClick={() => p.toast('已收藏')} aria-label="收藏">☆</button>} />
      <Body>
        <div className="dn-head">
          <span className="dn-pic big">{r.emoji ?? '🍽'}</span>
          <b>{r.name}</b>
          <span className="dn-meta">
            <Stars value={r.rating} /> <em>{r.rating}</em> 人均¥{r.avg_price}
          </span>
          {r.scores && (
            <small>
              口味{r.scores[0]} 环境{r.scores[1]} 服务{r.scores[2]}
            </small>
          )}
          <span className="dn-tags">
            {(r.tags ?? []).map((t) => (
              <i key={t}>{t}</i>
            ))}
          </span>
        </div>
        <Group>
          <Cell icon="📍" label={r.address} sub={r.district} onClick={() => p.toast('地图导航：暂未开放')} />
          <Cell icon="🕘" label={`营业时间 ${r.hours}`} arrow={false} />
        </Group>
        {r.dishes && (
          <Group title="推荐菜">
            <div className="ph-chips ph-pad">
              {r.dishes.map((d) => (
                <Chip key={d}>{d}</Chip>
              ))}
            </div>
          </Group>
        )}
        <Group title={`网友点评（${(r.reviews ?? []).length}）`}>
          {(r.reviews ?? []).map((v, i) => (
            <div key={i} className="dn-review">
              <span>
                <b>{v.user}</b> <Stars value={v.stars} size={12} />
              </span>
              <p>{v.text}</p>
            </div>
          ))}
        </Group>
      </Body>
      <div className="ph-footer dn-actions">
        <button type="button" className="dn-ask" onClick={() => (r.persona ? nav.push('chat', { id: r.id }) : p.toast('商家暂未开通在线咨询'))} data-testid="dine-ask">
          💬<small>咨询</small>
        </button>
        {r.queue && (
          <Btn kind="line" accent={ACCENT} onClick={() => nav.push('queue', { id: r.id })} testId="dine-queue">
            排队
          </Btn>
        )}
        {r.booking && (
          <Btn accent={ACCENT} onClick={() => nav.push('book', { id: r.id })} testId="dine-book">
            订座
          </Btn>
        )}
      </div>
    </div>
  );
}

function Queue({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const r = w.restaurants.find((x) => x.id === id)!;
  const [people, setPeople] = useState(2);
  const table = queueTableFor(r.queue ?? [], people);
  const records = recordsOf(p.events, 'dine_queue');
  const take = () => {
    if (!table) return p.toast('该人数暂不支持线上取号，请到店咨询');
    if (records.some((x) => x.data.restaurant_id === id && x.data.status === 'waiting')) return p.toast('您已在排队中，请勿重复取号');
    const t = queueTicket(table, ticketsTaken(records, id, table.id));
    const qid = p.newId('dine_queue', 'Q');
    p.write('dine_queue', qid, { restaurant_id: id, restaurant: r.name, people, table_id: table.id, table: `${table.name}(${table.min}-${table.max}人)`, number: t.number, ahead: t.ahead, minutes: t.minutes, status: 'waiting' });
    nav.resetTo([{ name: 'restaurant', params: { id } }, { name: 'ticket', params: { id: qid } }]);
  };
  return (
    <div className="ph-col dn" data-testid="dine-queue-page">
      <AppBar title="在线排队" onBack={nav.pop} />
      <Body>
        <div className="dn-queue-shop">
          <b>{r.name}</b>
          <small>当前排队人数较多，取号后可先去附近逛逛</small>
        </div>
        <Group title="排队情况">
          {(r.queue ?? []).map((t) => (
            <div key={t.id} className={`dn-qtable${table?.id === t.id ? ' on' : ''}`} data-testid="dine-qtable">
              <b>
                {t.name}
                <small>
                  （{t.min}-{t.max}人）
                </small>
              </b>
              <span>前方{t.waiting}桌</span>
              <span>约{t.minutes}分钟</span>
            </div>
          ))}
        </Group>
        <Group>
          <div className="dn-people">
            <span>用餐人数</span>
            <Stepper value={people} min={1} max={10} onChange={setPeople} testId="dine-people" />
          </div>
          {table && <div className="ph-note">将为您取号：{table.name}（{table.min}-{table.max}人）</div>}
        </Group>
        <div className="ph-note">· 叫号时请及时到店，过号作废需重新取号<br />· 线上取号与现场排队同步进行</div>
      </Body>
      <div className="ph-footer">
        <Btn block accent={ACCENT} onClick={take} testId="dine-queue-take">
          立即取号
        </Btn>
      </div>
    </div>
  );
}

function QueueTicket({ id }: { id: string }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const q = recordsOf(p.events, 'dine_queue').find((x) => x.id === id)?.data;
  if (!q) return <Empty text="排队信息不存在" />;
  const waiting = q.status === 'waiting';
  return (
    <div className="ph-col dn" data-testid="dine-ticket">
      <AppBar title="排队详情" onBack={nav.pop} />
      <Body>
        <div className="dn-ticket">
          <small>{String(q.restaurant)}</small>
          <b data-testid="dine-ticket-number">{String(q.number)}</b>
          <span>
            {String(q.table)} · {String(q.people)}人
          </span>
          {waiting ? (
            <span className="dn-ticket-wait">
              前方还有 <em>{String(q.ahead)}</em> 桌，预计等待 <em>{String(q.minutes)}</em> 分钟
            </span>
          ) : (
            <span>已取消排队</span>
          )}
          <small>叫号时会通过短信提醒，过号作废</small>
        </div>
      </Body>
      {waiting && (
        <div className="ph-footer">
          <Btn
            block
            kind="line"
            onClick={() => {
              p.write('dine_queue', id, { status: 'cancelled' });
              p.toast('已取消排队');
            }}
          >
            取消排队
          </Btn>
        </div>
      )}
    </div>
  );
}

function Book({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const r = w.restaurants.find((x) => x.id === id)!;
  const b = r.booking!;
  const [d, setD] = useAppState<BookingDraft & { note?: string }>(APP, `book:${id}`, { date: b.dates.find((x) => x >= p.clock.date), people: 2, area: '大厅', title: '先生' });
  const set = (patch: Partial<BookingDraft & { note?: string }>) => setD((x) => ({ ...x, ...patch }));
  const submit = () => {
    const problems = bookingProblems(r, d);
    if (problems.length) {
      p.emit({ type: 'error', code: 'booking_form', app: APP });
      return p.toast(problems[0]);
    }
    const bid = p.newId('dine_booking', 'B');
    p.write('dine_booking', bid, { restaurant_id: id, restaurant: r.name, date: d.date, time: d.time, people: d.people, area: d.area, name: d.name?.trim(), title: d.title, phone: d.phone?.replace(/\s+/g, ''), note: d.note ?? '', status: 'pending' });
    nav.resetTo([{ name: 'restaurant', params: { id } }, { name: 'booking', params: { id: bid } }]);
  };
  return (
    <div className="ph-col dn" data-testid="dine-book-page">
      <AppBar title="预订座位" onBack={nav.pop} />
      <Body>
        <div className="dn-queue-shop">
          <b>{r.name}</b>
          <small>免费预订 · 商家确认后短信通知</small>
        </div>
        <Group title="用餐日期">
          <div className="ph-chips ph-pad">
            {b.dates.filter((x) => x >= p.clock.date).map((x) => (
              <Chip key={x} on={d.date === x} accent={ACCENT} onClick={() => set({ date: x, time: undefined })} testId={`dine-date-${x}`}>
                {zhRelativeDay(x, p.clock.date) === zhWeekday(x) ? zhWeekday(x) : zhRelativeDay(x, p.clock.date)} {zhMonthDay(x)}
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="用餐人数">
          <div className="ph-chips ph-pad">
            {Array.from({ length: Math.min(12, b.max_people) }, (_, i) => i + 1).map((n) => (
              <Chip key={n} on={d.people === n} accent={ACCENT} onClick={() => set({ people: n })} testId={`dine-people-${n}`}>
                {n}人
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="到店时间">
          <div className="dn-times">
            {b.times.map((t) => {
              const full = !!d.date && slotFull(r, d.date, t);
              const past = d.date === p.clock.date && t <= p.clock.time;
              return (
                <button key={t} type="button" disabled={full || past} className={d.time === t ? 'on' : ''} style={d.time === t ? { background: ACCENT, color: '#fff' } : undefined} onClick={() => set({ time: t })} data-testid={`dine-time-${t}`}>
                  {t}
                  <small>{full ? '已满' : past ? '已过' : '可订'}</small>
                </button>
              );
            })}
          </div>
        </Group>
        <Group title="位置">
          <div className="ph-chips ph-pad">
            {(['大厅', '包间'] as const).map((a) => (
              <Chip key={a} on={d.area === a} accent={ACCENT} onClick={() => set({ area: a })} disabled={a === '包间' && !b.rooms} testId={`dine-area-${a}`}>
                {a}
              </Chip>
            ))}
          </div>
          {d.area === '包间' && b.rooms && <div className="ph-note">包间{b.rooms.min_people}人起订，最低消费¥{yuan(b.rooms.min_spend)}</div>}
        </Group>
        <Group title="联系人">
          <Field label="姓氏" value={d.name ?? ''} onChange={(v) => set({ name: v })} placeholder="请输入您的姓氏" testId="dine-name" />
          <div className="ph-field">
            <span className="ph-field-label" />
            <span className="ph-chips">
              {(['先生', '女士'] as const).map((t) => (
                <Chip key={t} on={d.title === t} accent={ACCENT} onClick={() => set({ title: t })}>
                  {t}
                </Chip>
              ))}
            </span>
          </div>
          <Field
            label="手机号"
            value={d.phone ?? ''}
            onChange={(v) => set({ phone: v.replace(/\D/g, '').slice(0, 11) })}
            placeholder={ZH.phonePlaceholder}
            type="tel"
            testId="dine-phone"
            right={
              <button type="button" className="ph-code-btn" style={{ color: ACCENT }} onClick={() => set({ phone: p.spec.profile.phone })} data-testid="dine-phone-mine">
                本机号码
              </button>
            }
          />
          <Field label="备注" value={d.note ?? ''} onChange={(v) => set({ note: v.slice(0, 40) })} placeholder="选填，如：靠窗、有老人小孩" mic />
        </Group>
      </Body>
      <div className="ph-footer">
        <Btn block accent={ACCENT} onClick={submit} testId="dine-book-submit">
          提交订座
        </Btn>
      </div>
    </div>
  );
}

function BookingDone({ id }: { id: string }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const b = recordsOf(p.events, 'dine_booking').find((x) => x.id === id)?.data;
  const status = b?.status;
  useEffect(() => {
    if (status !== 'pending') return;
    const t = window.setTimeout(() => {
      p.write('dine_booking', id, { status: 'confirmed' });
      p.sms('10690000', `【吃喝玩乐】您预订的${String(b!.restaurant)}${zhMonthDay(String(b!.date))} ${String(b!.time)} ${String(b!.people)}位（${String(b!.area)}）已确认，请准时到店，座位保留15分钟。`);
    }, 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, id]);
  if (!b) return <Empty text="预订不存在" />;
  return (
    <div className="ph-col dn" data-testid="dine-booking" data-status={String(status)}>
      <AppBar title="预订详情" onBack={nav.pop} />
      <Body>
        <div className="dn-ticket">
          <small>{String(b.restaurant)}</small>
          <b className="dn-booked">{status === 'confirmed' ? '预订成功' : status === 'cancelled' ? '已取消' : '商家确认中…'}</b>
          <span>
            {zhMonthDay(String(b.date))} {zhWeekday(String(b.date))} {String(b.time)} · {String(b.people)}人 · {String(b.area)}
          </span>
          <small>
            {String(b.name)}
            {String(b.title)} {String(b.phone)}
          </small>
        </div>
        <div className="ph-note">座位保留15分钟，如需变更请提前联系商家。</div>
      </Body>
      {status !== 'cancelled' && (
        <div className="ph-footer">
          <Btn
            block
            kind="line"
            onClick={() => {
              p.write('dine_booking', id, { status: 'cancelled' });
              p.toast('已取消预订');
            }}
          >
            取消预订
          </Btn>
        </div>
      )}
    </div>
  );
}

function HostChat({ restaurantId }: { restaurantId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const r = w.restaurants.find((x) => x.id === restaurantId)!;
  const booking = recordsOf(p.events, 'dine_booking').filter((x) => x.data.restaurant_id === restaurantId && x.data.status !== 'cancelled').pop();
  const context = booking
    ? `客人在本店的预订：${zhMonthDay(String(booking.data.date))} ${String(booking.data.time)}，${String(booking.data.people)}人，${String(booking.data.area)}，${String(booking.data.name)}${String(booking.data.title)}`
    : '客人还没有在本店预订';
  const persona = p.spec.personas?.find((x) => x.id === r.persona);
  return <AppChat personaId={r.persona!} title={persona?.name ?? r.name} subtitle="商家客服" context={context} accent={ACCENT} avatar="店" onBack={nav.pop} tip="商家一般会在几分钟内回复您" quick={['你好，请问还有包间吗？', '好的，谢谢！']} />;
}

function Mine() {
  const p = usePhone();
  const nav = useAppNav(APP);
  const bookings = recordsOf(p.events, 'dine_booking').reverse();
  const queues = recordsOf(p.events, 'dine_queue').reverse();
  return (
    <div className="ph-col dn" data-testid="dine-mine-page">
      <AppBar title="我的订单" onBack={nav.pop} />
      <Body>
        <Group title="订座">
          {bookings.length === 0 ? <Empty icon="🪑" text="暂无订座" /> : bookings.map((b) => <Cell key={b.id} label={String(b.data.restaurant)} sub={`${zhMonthDay(String(b.data.date))} ${String(b.data.time)} · ${String(b.data.people)}人`} value={({ pending: '待确认', confirmed: '已确认', cancelled: '已取消' } as Record<string, string>)[String(b.data.status)]} onClick={() => nav.push('booking', { id: b.id })} />)}
        </Group>
        <Group title="排队">
          {queues.length === 0 ? <Empty icon="🎫" text="暂无排队" /> : queues.map((q) => <Cell key={q.id} label={String(q.data.restaurant)} sub={`${String(q.data.number)} · ${String(q.data.people)}人`} value={q.data.status === 'waiting' ? '排队中' : '已取消'} onClick={() => nav.push('ticket', { id: q.id })} />)}
        </Group>
      </Body>
    </div>
  );
}

