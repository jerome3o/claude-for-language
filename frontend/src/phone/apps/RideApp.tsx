/**
 * 招手打车 — a fictional ride-hailing app with the big ride apps' flow: 你要去哪儿 → POI search
 * (🎤) → car types with 预估价 and coupons (several can be called at once) → 正在呼叫 → 司机已接单
 * (车牌 first, 车型, 司机, 💬 联系司机) → 司机已到达 (a driver persona may message: "您在哪个门？")
 * → 行程中 → 支付 → 评价; ☰ → 我的行程 → a past trip's 联系司机 / 物品遗失.
 */
import { useEffect, useMemo, useState } from 'react';
import { RIDE_CAR_TYPES, ZH, type RideCarType, type RidePoi, type RideWorld } from '@shared/phone';
import { round2, yuan, zhMonthDay } from '@shared/phone/dates';
import { recordsOf } from '@shared/phone/engine';
import { bestCoupon, cancelFee, estimatePrice, priceAfterCoupon, RIDE_RATING_TAGS_BAD, RIDE_RATING_TAGS_GOOD, rideStatusLine, searchPois, tripMinutes, type RideStatus } from '@shared/phone/ride';
import { useAppNav, usePhone, type Screen } from '../runtime';
import { AppChat, usePersona } from '../persona';
import { AppBar, Body, Btn, Cell, Chip, Dialog, Empty, Group, Price, SearchBox, Sheet } from '../ui';

const APP = 'ride' as const;
const ACCENT = '#f2611c';

function useWorld(): RideWorld {
  return usePhone().spec.world.ride!;
}

type Order = Record<string, unknown> & { status: RideStatus; to: string; car_type: RideCarType; price: number };

function useOrder(id: string | undefined): Order | undefined {
  const p = usePhone();
  return id ? (recordsOf(p.events, 'ride_order').find((r) => r.id === id)?.data as Order | undefined) : undefined;
}

export function RideApp({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'dest':
      return <Destination />;
    case 'confirm':
      return <ConfirmRide poiId={String(screen.params.poi)} />;
    case 'trip':
      return <Trip id={String(screen.params.id)} />;
    case 'chat':
      return <DriverChat personaId={String(screen.params.persona)} driver={String(screen.params.driver ?? '')} plate={String(screen.params.plate ?? '')} context={String(screen.params.context ?? '')} />;
    case 'trips':
      return <Trips />;
    case 'past':
      return <PastTrip id={String(screen.params.id)} />;
    default:
      return <RideHome />;
  }
}

function FakeMap({ route }: { route?: boolean }) {
  return (
    <div className={`ride-map${route ? ' ride-map-route' : ''}`} aria-hidden>
      <span className="ride-road ride-road-h" style={{ top: '30%' }} />
      <span className="ride-road ride-road-h" style={{ top: '62%' }} />
      <span className="ride-road ride-road-v" style={{ left: '28%' }} />
      <span className="ride-road ride-road-v" style={{ left: '70%' }} />
      <span className="ride-street" style={{ top: '25%', left: '34%' }}>延安西路</span>
      <span className="ride-street" style={{ top: '57%', left: '6%' }}>华山路</span>
      <span className="ride-street" style={{ top: '66%', left: '74%' }}>常德路</span>
      {route && <span className="ride-route" />}
      <span className="ride-pin">
        <i />
      </span>
    </div>
  );
}

function activeOrderId(events: ReturnType<typeof usePhone>['events']): string | null {
  const list = recordsOf(events, 'ride_order').filter((r) => !['paid', 'cancelled'].includes(String(r.data.status)) || (r.data.status === 'paid' && r.data.rating === undefined && !r.data.rated));
  return list.length ? list[list.length - 1].id : null;
}

function RideHome() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [menu, setMenu] = useState(false);
  const active = activeOrderId(p.events);
  return (
    <div className="ph-col ride-home" data-testid="ride-home">
      <FakeMap />
      <div className="ride-top">
        <button type="button" className="ride-menu-btn" onClick={() => setMenu(true)} aria-label="菜单" data-testid="ride-menu">
          ☰
        </button>
        <div className="ride-kinds">
          {['快车', '专车', '出租车', '代驾', '顺风车'].map((k, i) => (
            <span key={k} className={i === 0 ? 'on' : ''} onClick={() => i > 2 && p.toast(ZH.notOpen)}>
              {k}
            </span>
          ))}
        </div>
      </div>
      <div className="ride-card">
        {active && (
          <button type="button" className="ride-active" onClick={() => nav.push('trip', { id: active })} data-testid="ride-active">
            您有一个进行中的订单，点击查看 ›
          </button>
        )}
        <div className="ride-from">
          <i className="ride-dot ride-dot-from" />
          <span>
            <b>{w.start.name}</b>
            <small>在这里上车 · {w.start.address}</small>
          </span>
        </div>
        <button type="button" className="ride-where" onClick={() => nav.push('dest')} data-testid="ride-where">
          <i className="ride-dot ride-dot-to" />
          你要去哪儿
        </button>
        <div className="ride-quick">
          <button type="button" onClick={() => p.toast('请先设置家的地址')}>🏠 家</button>
          <button type="button" onClick={() => p.toast('请先设置公司的地址')}>💼 公司</button>
          <button type="button" onClick={() => p.toast(ZH.notOpen)}>⏱ 预约</button>
          <button type="button" onClick={() => p.toast(ZH.notOpen)}>👤 帮人叫车</button>
        </div>
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title="我的">
        <Cell icon="🧾" label="我的行程" onClick={() => { setMenu(false); nav.push('trips'); }} testId="ride-trips" />
        <Cell icon="💳" label="钱包" onClick={() => { setMenu(false); p.openApp('wallet'); }} />
        <Cell icon="🎟" label="优惠券" value={`${(w.coupons ?? []).length}张`} onClick={() => p.toast('下单时自动使用最优惠的券')} />
        <Cell icon="🛡" label="安全中心" onClick={() => p.toast(ZH.notOpen)} />
        <Cell icon="⚙" label="设置" onClick={() => p.toast(ZH.notOpen)} />
      </Sheet>
    </div>
  );
}

function Destination() {
  const w = useWorld();
  const nav = useAppNav(APP);
  const [q, setQ] = useState('');
  const hits = q.trim() ? searchPois(w.pois, q) : [];
  const recent = w.pois.filter((x) => ['sh_station', 'nanjing_rd', 'yuyuan'].includes(x.id));
  const pick = (poi: RidePoi) => nav.push('confirm', { poi: poi.id });
  return (
    <div className="ph-col" data-testid="ride-dest">
      <AppBar title="" onBack={nav.pop} right={<span className="ride-city">上海 ▾</span>} />
      <div className="ph-pad ride-dest-inputs">
        <div className="ride-from ride-from-small">
          <i className="ride-dot ride-dot-from" />
          {w.start.name}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="你要去哪儿" autoFocus mic testId="ride-search" />
      </div>
      <Body>
        {q.trim() ? (
          hits.length ? (
            hits.map((poi) => (
              <button key={poi.id} type="button" className="ride-poi" onClick={() => pick(poi)} data-testid="ride-poi" data-poi={poi.id}>
                <span className="ride-poi-icon">📍</span>
                <span className="ride-poi-main">
                  <b>
                    {poi.name}
                    {poi.kind && <i className="ph-tag">{poi.kind}</i>}
                  </b>
                  <small>
                    {poi.district} · {poi.address}
                  </small>
                </span>
                <span className="ride-poi-km">{poi.km}km</span>
              </button>
            ))
          ) : (
            <Empty icon="🔍" text="没有找到相关地点，换个关键词试试" />
          )
        ) : (
          <>
            <div className="ph-section-title">历史记录</div>
            {recent.map((poi) => (
              <button key={poi.id} type="button" className="ride-poi" onClick={() => pick(poi)}>
                <span className="ride-poi-icon">🕘</span>
                <span className="ride-poi-main">
                  <b>{poi.name}</b>
                  <small>{poi.address}</small>
                </span>
                <span className="ride-poi-km">{poi.km}km</span>
              </button>
            ))}
          </>
        )}
      </Body>
    </div>
  );
}

function ConfirmRide({ poiId }: { poiId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const poi = w.pois.find((x) => x.id === poiId)!;
  const [picked, setPicked] = useState<RideCarType[]>(['快车']);
  const offers = RIDE_CAR_TYPES.map((t) => w.cars.find((c) => c.type === t)).filter((x): x is NonNullable<typeof x> => !!x);
  const priced = offers.map((c) => {
    const raw = estimatePrice(c, poi.km);
    const coupon = bestCoupon(w.coupons, c.type, raw);
    return { c, raw, coupon, price: priceAfterCoupon(raw, coupon) };
  });
  const call = () => {
    if (picked.length === 0) return p.toast('请至少选择一种车型');
    // The car type whose driver answers first (the shortest pickup time).
    const chosen = priced.filter((x) => picked.includes(x.c.type)).sort((a, b) => a.c.eta_min - b.c.eta_min)[0];
    const id = p.newId('ride_order', 'D');
    p.write('ride_order', id, {
      order_id: id,
      from: w.start.name,
      to: poi.name,
      to_id: poi.id,
      car_type: chosen.c.type,
      called: picked,
      km: poi.km,
      price: chosen.price,
      coupon: chosen.coupon?.amount ?? 0,
      status: 'calling',
      called_at: Date.now(),
    });
    nav.resetTo([{ name: 'trip', params: { id } }]);
  };
  return (
    <div className="ph-col" data-testid="ride-confirm">
      <AppBar title="" onBack={nav.pop} />
      <FakeMap route />
      <div className="ride-sheet">
        <div className="ride-route-line">
          <span>
            <i className="ride-dot ride-dot-from" />
            {w.start.name}
          </span>
          <span>
            <i className="ride-dot ride-dot-to" />
            {poi.name}
          </span>
          <small>
            全程约{poi.km}公里 · 约{tripMinutes(poi.km)}分钟
          </small>
        </div>
        <div className="ride-cars">
          {priced.map(({ c, raw, coupon, price }) => {
            const on = picked.includes(c.type);
            return (
              <label key={c.type} className={`ride-car${on ? ' on' : ''}`} data-testid="ride-car" data-car={c.type}>
                <span className="ride-car-icon">{c.type === '专车' ? '🚘' : c.type === '出租车' ? '🚕' : '🚗'}</span>
                <span className="ride-car-main">
                  <b>{c.type}</b>
                  <small>
                    {c.note} · 约{c.eta_min}分钟接驾
                  </small>
                </span>
                <span className="ride-car-price">
                  <small>预估</small>
                  <Price value={price} />
                  {coupon && <small className="ride-coupon">券已抵{yuan(coupon.amount)}元 · 原价{yuan(raw)}</small>}
                </span>
                <input type="checkbox" checked={on} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, c.type] : cur.filter((x) => x !== c.type)))} />
              </label>
            );
          })}
        </div>
        <Btn block accent={ACCENT} onClick={call} testId="ride-call">
          {picked.length > 1 ? `同时呼叫${picked.length}种车型` : picked.length === 1 ? `呼叫${picked[0]}` : '请选择车型'}
        </Btn>
      </div>
    </div>
  );
}

function Trip({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const o = useOrder(id);
  const status = o?.status;
  const persona = w.arrival_persona ?? w.driver.persona;
  const chat = usePersona(persona);
  const found = p.events.some((e) => e.type === 'persona.action' && e.persona === w.arrival_persona && e.action === 'found_passenger');
  const [cancel, setCancel] = useState(false);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const car = w.cars.find((c) => c.type === o?.car_type);

  // The trip moves on by itself, like a real one (seconds instead of minutes).
  useEffect(() => {
    if (!o) return;
    let t: number | undefined;
    if (status === 'calling') {
      t = window.setTimeout(() => {
        p.write('ride_order', id, { status: 'accepted', accepted_at: Date.now(), driver: w.driver.name, plate: w.driver.plate });
        p.notify({ app: APP, title: '司机已接单', body: `${w.driver.plate} ${w.driver.car} ${w.driver.name}正在赶来`, open: { app: APP, screen: 'trip', params: { id } } });
      }, 2500);
    } else if (status === 'accepted') {
      t = window.setTimeout(() => {
        p.write('ride_order', id, { status: 'arrived', arrived_at: Date.now() });
        p.notify({ app: APP, title: '司机已到达', body: `${w.driver.plate} 已到达上车点，请尽快上车`, open: { app: APP, screen: 'trip', params: { id } } });
        if (w.arrival_persona) {
          chat.start();
          const opening = chat.persona?.opening;
          if (opening) p.notify({ app: APP, title: w.driver.name, body: opening, open: { app: APP, screen: 'chat', params: { persona: w.arrival_persona, driver: w.driver.name, plate: w.driver.plate } } });
        }
      }, Math.max(4000, (car?.eta_min ?? 3) * 1500));
    } else if (status === 'arrived' && (!w.arrival_persona || found)) {
      t = window.setTimeout(() => {
        p.write('ride_order', id, { status: 'in_trip', started_at: Date.now() });
        p.notify({ app: APP, title: '行程已开始', body: '请系好安全带，祝您旅途愉快' });
      }, w.arrival_persona ? 3500 : 4000);
    } else if (status === 'in_trip') {
      t = window.setTimeout(() => {
        p.write('ride_order', id, { status: 'finished', finished_at: Date.now() });
        p.notify({ app: APP, title: '已到达目的地', body: `本次行程费用${yuan(Number(o.price))}元，请尽快支付`, open: { app: APP, screen: 'trip', params: { id } } });
      }, 6000);
    }
    return () => window.clearTimeout(t);
    // Status changes drive the timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, found, id]);

  if (!o) return <Empty text="订单不存在" />;
  const context = `订单：${o.car_type}，${String(o.from)} → ${o.to}；状态：${rideStatusLine(o.status, car?.eta_min ?? 3)}`;
  const openChat = () => (persona ? nav.push('chat', { persona, driver: w.driver.name, plate: w.driver.plate, context }) : p.toast('司机正在开车，请稍后再试'));
  const pay = async () => {
    const r = await p.pay({ app: APP, title: `${o.car_type} ${String(o.from)} → ${o.to}`, payee: '招手打车', amount: Number(o.price) });
    if (!r) return;
    p.write('ride_order', id, { status: 'paid', pay_method: r.method });
  };
  const unread = chat.lines.filter((l) => l.from === 'them').length;
  return (
    <div className="ph-col" data-testid="ride-trip" data-status={o.status}>
      <AppBar title={o.status === 'paid' ? '行程结束' : ''} onBack={nav.home} />
      <FakeMap route={o.status !== 'calling'} />
      <div className="ride-sheet">
        <div className="ride-status" data-testid="ride-status">
          {rideStatusLine(o.status, car?.eta_min ?? 3)}
        </div>
        {o.status === 'calling' && (
          <div className="ride-calling">
            <span className="ride-spinner" />
            已为您呼叫 {(o.called as string[] | undefined)?.join('、') ?? o.car_type}，预估 <Price value={Number(o.price)} />
          </div>
        )}
        {['accepted', 'arrived', 'in_trip', 'finished'].includes(o.status) && (
          <div className="ride-driver" data-testid="ride-driver">
            <span className="ride-plate">{w.driver.plate}</span>
            <span className="ride-driver-car">{w.driver.car}</span>
            <span className="ride-driver-name">
              {w.driver.name} ★{w.driver.rating} · {w.driver.trips}单
            </span>
            <span className="ride-driver-actions">
              <button type="button" onClick={openChat} data-testid="ride-chat">
                💬 联系司机{unread > 0 && <i className="wx-badge">{unread}</i>}
              </button>
              <button type="button" onClick={() => p.toast('正在通过隐私号码呼叫…对方暂时无法接听')}>📞 打电话</button>
              <button type="button" onClick={() => p.toast('已开启行程分享')}>🛡 安全</button>
            </span>
          </div>
        )}
        {o.status === 'arrived' && w.arrival_persona && !found && <div className="ride-wait">司机在找您，请回复司机的消息</div>}
        {o.status === 'finished' && (
          <div className="ride-pay">
            <span>
              本次行程 <Price value={Number(o.price)} size="big" />
            </span>
            {Number(o.coupon) > 0 && <small>已使用优惠券抵扣{yuan(Number(o.coupon))}元</small>}
            <Btn block accent={ACCENT} onClick={() => void pay()} testId="ride-pay">
              去支付
            </Btn>
          </div>
        )}
        {o.status === 'paid' && o.rating === undefined && (
          <div className="ride-rate" data-testid="ride-rate">
            <b>匿名评价司机</b>
            <div className="ride-stars">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" className={s <= stars ? 'on' : ''} onClick={() => setStars(s)} aria-label={`${s}星`} data-testid={`ride-star-${s}`}>
                  ★
                </button>
              ))}
            </div>
            {stars > 0 && <small>{['', '非常不满意', '不满意', '一般', '满意', '非常满意'][stars]}</small>}
            {stars > 0 && (
              <div className="ph-chips">
                {(stars >= 4 ? RIDE_RATING_TAGS_GOOD : RIDE_RATING_TAGS_BAD).map((t) => (
                  <Chip key={t} on={tags.includes(t)} accent={ACCENT} onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}>
                    {t}
                  </Chip>
                ))}
              </div>
            )}
            <Btn
              block
              accent={ACCENT}
              disabled={stars === 0}
              testId="ride-rate-submit"
              onClick={() => {
                p.write('ride_order', id, { rating: stars, tags, rated: true });
                p.emit({ type: 'ride.rated', stars });
                p.toast('感谢您的评价');
              }}
            >
              提交评价
            </Btn>
          </div>
        )}
        {o.status === 'paid' && o.rating !== undefined && (
          <div className="ride-done" data-testid="ride-done">
            <b>行程已完成</b>
            <small>
              实付 ¥{yuan(Number(o.price))} · 已评价{Number(o.rating)}星
            </small>
            <Btn block kind="line" accent={ACCENT} onClick={nav.home}>
              返回首页
            </Btn>
          </div>
        )}
        {['calling', 'accepted', 'arrived'].includes(o.status) && (
          <button type="button" className="ride-cancel" onClick={() => setCancel(true)} data-testid="ride-cancel">
            取消订单
          </button>
        )}
      </div>
      <Dialog
        open={cancel}
        title="确定要取消订单吗？"
        onClose={() => setCancel(false)}
        actions={[
          { label: '再等等', onClick: () => setCancel(false) },
          {
            label: '确定取消',
            primary: true,
            onClick: () => {
              const fee = cancelFee(o.status, (Date.now() - Number(o.accepted_at ?? Date.now())) / 60_000);
              p.write('ride_order', id, { status: 'cancelled', cancel_fee: fee });
              setCancel(false);
              p.toast(fee ? `订单已取消，需支付取消费${fee}元` : '订单已取消');
              nav.home();
            },
          },
        ]}
      >
        {o.status === 'calling' ? '附近司机正在接单，现在取消不收费。' : '司机已经在赶来的路上，取消可能产生取消费。'}
      </Dialog>
    </div>
  );
}

function DriverChat({ personaId, driver, plate, context }: { personaId: string; driver: string; plate: string; context: string }) {
  const nav = useAppNav(APP);
  return <AppChat personaId={personaId} title={driver} subtitle={plate} context={context} accent={ACCENT} avatar="司" onBack={nav.pop} quick={['我马上到', '我在上车点了', '请稍等一下', '好的，谢谢师傅']} />;
}

function Trips() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const mine = recordsOf(p.events, 'ride_order').reverse();
  return (
    <div className="ph-col" data-testid="ride-trips-list">
      <AppBar title="我的行程" onBack={nav.pop} />
      <Body>
        {mine.map((r) => (
          <button key={r.id} type="button" className="ride-trip-row" onClick={() => nav.push('trip', { id: r.id })}>
            <span>
              <small>今天 · {String(r.data.car_type)}</small>
              <b>{String(r.data.from)}</b>
              <b>→ {String(r.data.to)}</b>
            </span>
            <span className="ride-trip-status">{({ paid: '已完成', cancelled: '已取消' } as Record<string, string>)[String(r.data.status)] ?? '进行中'}</span>
          </button>
        ))}
        {(w.trips ?? []).map((t) => (
          <button key={t.id} type="button" className="ride-trip-row" onClick={() => nav.push('past', { id: t.id })} data-testid="ride-past-trip" data-trip={t.id}>
            <span>
              <small>
                {zhMonthDay(t.date)} {t.time} · {t.car_type}
              </small>
              <b>{t.from}</b>
              <b>→ {t.to}</b>
            </span>
            <span className="ride-trip-status">已完成 ›</span>
          </button>
        ))}
        {mine.length === 0 && (w.trips ?? []).length === 0 && <Empty icon="🚗" text="暂无行程" />}
      </Body>
    </div>
  );
}

function PastTrip({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const t = (w.trips ?? []).find((x) => x.id === id);
  const fee = useMemo(() => (t ? round2(t.price) : 0), [t]);
  if (!t) return <Empty text="行程不存在" />;
  const contact = () => {
    if (!t.driver.persona) return p.toast('行程已结束超过24小时，无法联系司机，如有问题请联系客服');
    nav.push('chat', { persona: t.driver.persona, driver: t.driver.name, plate: t.driver.plate, context: `已完成的行程：${zhMonthDay(t.date)} ${t.time}，${t.from} → ${t.to}，${t.car_type}，${yuan(t.price)}元` });
  };
  return (
    <div className="ph-col" data-testid="ride-past">
      <AppBar title="行程详情" onBack={nav.pop} />
      <Body>
        <Group>
          <Cell label="时间" value={`${zhMonthDay(t.date)} ${t.time}`} />
          <Cell label="起点" value={t.from} />
          <Cell label="终点" value={t.to} />
          <Cell label="车型" value={t.car_type} />
          <Cell label="实付" value={`¥${yuan(fee)}`} />
        </Group>
        <Group title="司机">
          <Cell label={`${t.driver.name} ★${t.driver.rating}`} sub={`${t.driver.plate} · ${t.driver.car}`} />
        </Group>
        <Group title="行程问题">
          <Cell icon="🎒" label="物品遗失" sub="联系司机找回遗落在车上的物品" onClick={contact} testId="ride-lost" />
          <Cell icon="💬" label="联系司机" onClick={contact} />
          <Cell icon="⚠️" label="费用疑问 / 投诉" onClick={() => p.toast(ZH.notOpen)} />
          <Cell icon="🧾" label="开发票" onClick={() => p.toast(ZH.notOpen)} />
        </Group>
      </Body>
    </div>
  );
}
