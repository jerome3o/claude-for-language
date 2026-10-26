/**
 * 铁路出行 — a fictional rail-ticket app with the national rail app's flow: 出发地 / 到达地 /
 * 日期 → 车次列表 (G/D/K, 历时, seats left / 候补) → 预订 → (登录 with an SMS 验证码) → 填写订单
 * (乘车人, 添加乘车人 with 证件类型 护照, 选座 A–F) → 提交订单 → 待支付 → 支付 → 订单详情
 * (车厢座位, 检票口) and, from 订单, 改签 / 退票 with the real fee rules (shared/phone/rail.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { RAIL_ID_TYPES, RAIL_PASSENGER_TYPES, ZH, smsCode, type RailPassenger, type RailSeatClass, type RailTrain, type RailWorld } from '@shared/phone';
import { addDays, daysBetween, minutesUntil, round2, spanMinutes, weekday, yuan, zhDateLabel, zhDuration, zhMonthDay, zhRelativeDay, zhWeekday } from '@shared/phone/dates';
import {
  assignSeats,
  changeDifference,
  changeOptions,
  findTrain,
  isWindow,
  normalizePassportName,
  passengerProblems,
  railOrderData,
  refundFee,
  refundRateLabel,
  searchStations,
  searchTrains,
  seatLetters,
  seatsLabel,
  seatsLeft,
  trainKind,
  validPhone,
  type TrainSort,
} from '@shared/phone/rail';
import { recordsFrom, recordsOf } from '@shared/phone/engine';
import { railPassengers, smsCodeFor } from '@shared/phone/world';
import { useAppNav, useAppState, usePhone, type Screen } from '../runtime';
import { AppBar, Body, Btn, Cell, Chip, Dialog, Empty, Field, Group, Price, SearchBox, Sheet, Tabs } from '../ui';

const APP = 'rail' as const;
const ACCENT = '#2f7de1';

interface Search {
  from: string;
  to: string;
  date: string;
  highSpeed: boolean;
}

function useWorld(): RailWorld {
  return usePhone().spec.world.rail!;
}

function useSearch(): [Search, (v: Search | ((p: Search) => Search)) => void] {
  const p = usePhone();
  const w = useWorld();
  return useAppState<Search>(APP, 'search', { from: w.default_from ?? '', to: w.default_to ?? '', date: addDays(p.spec.today, 1), highSpeed: false });
}

function useLoggedIn(): boolean {
  const p = usePhone();
  return !useWorld().logged_out || p.events.some((e) => e.type === 'login' && e.app === APP);
}

function orderNo(seed: number, n: number): string {
  return `E${String(100_000_000 + ((Math.abs(seed) * 7 + n * 104_729) % 899_999_999)).slice(0, 9)}`;
}

export function RailApp({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'station':
      return <StationPicker field={screen.params.field as 'from' | 'to'} />;
    case 'date':
      return <DatePicker />;
    case 'trains':
      return <TrainList />;
    case 'train':
      return <TrainDetail no={String(screen.params.no)} date={String(screen.params.date)} />;
    case 'login':
      return <Login next={screen.params.next as { name: string; params: Record<string, unknown> } | undefined} />;
    case 'confirm':
      return <ConfirmOrder no={String(screen.params.no)} date={String(screen.params.date)} cls={screen.params.cls as RailSeatClass} />;
    case 'passenger_add':
      return <AddPassenger />;
    case 'pay_order':
      return <PayOrder id={String(screen.params.id)} />;
    case 'order':
      return <OrderDetail id={String(screen.params.id)} />;
    case 'change':
      return <ChangeTrain id={String(screen.params.id)} />;
    default:
      return <RailHome />;
  }
}

// ---------------------------------------------------------------------------

function RailHome() {
  const p = usePhone();
  const nav = useAppNav(APP);
  const [tab, setTab] = useAppState<'home' | 'service' | 'orders' | 'me'>(APP, 'tab', 'home');
  const [s, setS] = useSearch();
  const loggedIn = useLoggedIn();
  return (
    <div className="ph-col" data-testid="rail-home">
      {tab === 'home' && (
        <Body className="rail-home">
          <div className="rail-hero">
            <div className="rail-hero-title">铁路出行</div>
            <div className="rail-hero-sub">安全 · 便捷 · 准点</div>
          </div>
          <div className="rail-search">
            <div className="rail-od">
              <button type="button" className="rail-od-place" onClick={() => nav.push('station', { field: 'from' })} data-testid="rail-from">
                <small>出发地</small>
                {s.from || <span className="ph-ph">请选择</span>}
              </button>
              <button type="button" className="rail-od-swap" aria-label="互换" onClick={() => setS((x) => ({ ...x, from: x.to, to: x.from }))}>
                ⇄
              </button>
              <button type="button" className="rail-od-place rail-od-to" onClick={() => nav.push('station', { field: 'to' })} data-testid="rail-to">
                <small>到达地</small>
                {s.to || <span className="ph-ph">请选择</span>}
              </button>
            </div>
            <button type="button" className="rail-date" onClick={() => nav.push('date')} data-testid="rail-date">
              <b>{zhMonthDay(s.date)}</b> {zhRelativeDay(s.date, p.clock.date) === zhWeekday(s.date) ? zhWeekday(s.date) : `${zhRelativeDay(s.date, p.clock.date)} ${zhWeekday(s.date)}`}
              <span className="ph-cell-arrow">›</span>
            </button>
            <div className="rail-opts">
              <label>
                <input type="checkbox" checked={s.highSpeed} onChange={(e) => setS((x) => ({ ...x, highSpeed: e.target.checked }))} /> 只看高铁/动车
              </label>
              <label onClick={(e) => { e.preventDefault(); p.toast('学生票需先完成学生资质核验'); }}>
                <input type="checkbox" checked={false} readOnly /> 学生票
              </label>
            </div>
            <Btn
              block
              accent={ACCENT}
              testId="rail-search"
              onClick={() => {
                if (!s.from) return p.toast('请选择出发地');
                if (!s.to) return p.toast('请选择到达地');
                if (s.from === s.to) return p.toast('出发地和到达地不能相同');
                nav.push('trains');
              }}
            >
              查询车票
            </Btn>
          </div>
          <div className="rail-grid">
            {['车票', '候补购票', '计次·定期票', '约车', '餐饮·特产', '酒店住宿', '旅游', '会员服务'].map((x, i) => (
              <button key={x} type="button" onClick={() => (i === 0 ? undefined : p.toast(ZH.notOpen))}>
                <span>{['🎫', '⏳', '🗓', '🚗', '🍱', '🏨', '🗺', '⭐'][i]}</span>
                {x}
              </button>
            ))}
          </div>
          <div className="rail-notice">
            <b>温馨提示</b> 购票、改签和退票需不晚于开车前30分钟办理；铁路客票预售期为15天。
          </div>
        </Body>
      )}
      {tab === 'service' && (
        <Body>
          <AppBar title="出行服务" />
          <Group>
            {['正晚点', '起售时间', '时刻表', '车站大屏', '检票口查询', '遗失物品查找'].map((x) => (
              <Cell key={x} label={x} onClick={() => p.toast(ZH.notOpen)} />
            ))}
          </Group>
        </Body>
      )}
      {tab === 'orders' && <RailOrders />}
      {tab === 'me' && (
        <Body>
          <div className="rail-me-head">
            <span className="rail-me-avatar">👤</span>
            {loggedIn ? (
              <span>
                <b>{p.spec.profile.name}</b>
                <small>{p.spec.profile.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</small>
              </span>
            ) : (
              <button type="button" className="rail-me-login" onClick={() => nav.push('login')}>
                登录/注册
              </button>
            )}
          </div>
          <Group title="常用乘车人">
            {railPassengers(useWorld(), p.events).map((x) => (
              <Cell key={x.id} label={`${x.name}${x.self ? '（本人）' : ''}`} sub={`${x.id_type} ${x.id_no.slice(0, 2)}******${x.id_no.slice(-2)}`} />
            ))}
          </Group>
          <Group>
            {['我的钱包', '温馨服务', '设置'].map((x) => (
              <Cell key={x} label={x} onClick={() => p.toast(ZH.notOpen)} />
            ))}
          </Group>
        </Body>
      )}
      <div className="ph-tabbar">
        {(
          [
            ['home', '首页', '🏠'],
            ['service', '出行服务', '🧭'],
            ['orders', '订单', '📄'],
            ['me', '我的', '👤'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} style={tab === id ? { color: ACCENT } : undefined} onClick={() => setTab(id)} data-testid={`rail-tab-${id}`}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StationPicker({ field }: { field: 'from' | 'to' }) {
  const w = useWorld();
  const nav = useAppNav(APP);
  const [, setS] = useSearch();
  const [q, setQ] = useState('');
  const hits = q.trim() ? searchStations(w.stations, q) : [];
  const cities = [...new Set(w.stations.map((s) => s.city))];
  const pick = (name: string) => {
    setS((x) => ({ ...x, [field]: name }));
    nav.pop();
  };
  return (
    <div className="ph-col" data-testid="rail-station-picker">
      <AppBar title={field === 'from' ? '选择出发地' : '选择到达地'} onBack={nav.pop} />
      <div className="ph-pad">
        <SearchBox value={q} onChange={setQ} placeholder="搜索城市/车站（支持汉字/拼音/简拼）" autoFocus mic testId="rail-station-search" />
      </div>
      <Body>
        {q.trim() ? (
          hits.length ? (
            <Group>
              {hits.map((s) => (
                <Cell key={s.name} label={s.name} sub={`${s.city} · ${s.pinyin.replace(/\s+/g, '')}`} onClick={() => pick(s.name)} testId="rail-station-option" />
              ))}
            </Group>
          ) : (
            <Empty icon="🚉" text="没有找到相关车站" />
          )
        ) : (
          <>
            <div className="ph-section-title">热门城市</div>
            <div className="ph-chips">
              {cities.map((c) => (
                <Chip key={c} onClick={() => pick(c)}>
                  {c}
                </Chip>
              ))}
            </div>
            <div className="ph-section-title">全部车站</div>
            <Group>
              {w.stations.map((s) => (
                <Cell key={s.name} label={s.name} sub={s.city} onClick={() => pick(s.name)} />
              ))}
            </Group>
          </>
        )}
      </Body>
    </div>
  );
}

function DatePicker() {
  const p = usePhone();
  const nav = useAppNav(APP);
  const [s, setS] = useSearch();
  const today = p.clock.date;
  const first = addDays(today, -weekday(today));
  const days = Array.from({ length: 28 }, (_, i) => addDays(first, i));
  return (
    <div className="ph-col" data-testid="rail-date-picker">
      <AppBar title="选择日期" onBack={nav.pop} />
      <div className="rail-cal-note">铁路客票预售期为15天，今天可购买至 {zhMonthDay(addDays(today, 14))} 的车票</div>
      <div className="rail-cal-week">
        {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <Body>
        <div className="rail-cal">
          {days.map((d) => {
            const n = daysBetween(today, d);
            const ok = n >= 0 && n < 15;
            return (
              <button
                key={d}
                type="button"
                disabled={!ok}
                className={`${d === s.date ? 'on' : ''}${weekday(d) % 6 === 0 ? ' wkd' : ''}`}
                style={d === s.date ? { background: ACCENT } : undefined}
                onClick={() => {
                  setS((x) => ({ ...x, date: d }));
                  nav.pop();
                }}
                data-testid={`rail-day-${d}`}
              >
                <b>{Number(d.slice(8))}</b>
                <small>{n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '后天' : ok ? '' : n < 0 ? '' : '未开售'}</small>
              </button>
            );
          })}
        </div>
      </Body>
    </div>
  );
}

function TrainList() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [s, setS] = useSearch();
  const [sort, setSort] = useState<TrainSort>('depart');
  const [available, setAvailable] = useState(false);
  const records = useMemo(() => recordsFrom(p.events), [p.events]);
  const list = searchTrains(w, s.from, s.to, s.date, { highSpeedOnly: s.highSpeed, availableOnly: available, sort }, records);
  const shift = (n: number) => {
    const d = addDays(s.date, n);
    const k = daysBetween(p.clock.date, d);
    if (k < 0) return p.toast('不能选择今天之前的日期');
    if (k >= 15) return p.toast('该日期车票尚未开售');
    setS((x) => ({ ...x, date: d }));
  };
  return (
    <div className="ph-col" data-testid="rail-trains">
      <AppBar title={`${s.from} ⇀ ${s.to}`} onBack={nav.pop} tone="accent" accent={ACCENT} />
      <div className="rail-daybar" style={{ background: ACCENT }}>
        <button type="button" onClick={() => shift(-1)}>
          ‹ 前一天
        </button>
        <button type="button" className="rail-daybar-date" onClick={() => nav.push('date')}>
          {zhDateLabel(s.date)} ▾
        </button>
        <button type="button" onClick={() => shift(1)}>
          后一天 ›
        </button>
      </div>
      <div className="ph-chips ph-chips-bar">
        <Chip on={sort === 'depart'} accent={ACCENT} onClick={() => setSort('depart')}>
          出发最早
        </Chip>
        <Chip on={sort === 'duration'} accent={ACCENT} onClick={() => setSort('duration')}>
          耗时最短
        </Chip>
        <Chip on={sort === 'price'} accent={ACCENT} onClick={() => setSort('price')}>
          价格最低
        </Chip>
        <Chip on={s.highSpeed} accent={ACCENT} onClick={() => setS((x) => ({ ...x, highSpeed: !x.highSpeed }))}>
          高铁动车
        </Chip>
        <Chip on={available} accent={ACCENT} onClick={() => setAvailable((v) => !v)}>
          只看有票
        </Chip>
      </div>
      <Body>
        {list.length === 0 ? (
          <Empty icon="🚄" text="当前日期没有符合条件的车次，换个日期或车站试试" />
        ) : (
          list.map((t) => (
            <button key={`${t.no}-${t.date}`} type="button" className="rail-train" onClick={() => nav.push('train', { no: t.no, date: t.date })} data-testid="rail-train-row" data-train={t.no}>
              <div className="rail-train-top">
                <span className="rail-train-time">
                  <b>{t.depart}</b>
                  <small>
                    <i className="rail-tag-s">始</i>
                    {t.from}
                  </small>
                </span>
                <span className="rail-train-mid">
                  <small>{zhDuration(spanMinutes(t.depart, t.arrive))}</small>
                  <span className="rail-train-line">
                    <b>{t.no}</b>
                  </span>
                  <small>{trainKind(t.no)}</small>
                </span>
                <span className="rail-train-time rail-train-arr">
                  <b>
                    {t.arrive}
                    {t.arrive < t.depart && <sup>+1</sup>}
                  </b>
                  <small>
                    <i className="rail-tag-z">终</i>
                    {t.to}
                  </small>
                </span>
                <span className="rail-train-price">
                  <Price value={Math.min(...t.seats.map((x) => x.price))} color="#f26b1d" />
                  <small>起</small>
                </span>
              </div>
              <div className="rail-train-seats">
                {t.seats.map((o) => {
                  const left = seatsLeft(t, o.class, records);
                  const label = seatsLabel(left, o.waitlist);
                  return (
                    <span key={o.class} className={left > 0 ? 'ok' : o.waitlist ? 'wait' : 'none'}>
                      {o.class}:{label}
                    </span>
                  );
                })}
              </div>
            </button>
          ))
        )}
      </Body>
    </div>
  );
}

function TrainDetail({ no, date }: { no: string; date: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const loggedIn = useLoggedIn();
  const t = findTrain(w, no, date);
  const [stops, setStops] = useState(false);
  const [waitlist, setWaitlist] = useState(false);
  const records = useMemo(() => recordsFrom(p.events), [p.events]);
  if (!t) return <Empty text="车次信息不存在" />;
  return (
    <div className="ph-col" data-testid="rail-train-detail">
      <AppBar title={`${t.no} ${zhDateLabel(t.date)}`} onBack={nav.pop} tone="accent" accent={ACCENT} />
      <div className="rail-detail-head" style={{ background: ACCENT }}>
        <span>
          <b>{t.depart}</b>
          {t.from}
        </span>
        <button type="button" onClick={() => setStops(true)}>
          {t.no}
          <small>{zhDuration(spanMinutes(t.depart, t.arrive))} · 经停 ›</small>
        </button>
        <span>
          <b>{t.arrive}</b>
          {t.to}
        </span>
      </div>
      <Body>
        <Group>
          {t.seats.map((o) => {
            const left = seatsLeft(t, o.class, records);
            return (
              <div key={o.class} className="rail-seat-row" data-testid="rail-seat-class" data-class={o.class}>
                <span className="rail-seat-name">
                  {o.class}
                  <small className={left > 0 ? 'ok' : ''}>{left > 0 ? (left >= 20 ? '有票' : `剩${left}张`) : o.waitlist ? '无票，可候补' : '无票'}</small>
                </span>
                <Price value={o.price} color="#f26b1d" />
                {left > 0 ? (
                  <Btn
                    small
                    accent={ACCENT}
                    testId="rail-book"
                    onClick={() => {
                      const next = { name: 'confirm', params: { no: t.no, date: t.date, cls: o.class } };
                      if (!loggedIn) nav.push('login', { next });
                      else nav.push(next.name, next.params);
                    }}
                  >
                    预订
                  </Btn>
                ) : o.waitlist ? (
                  <Btn small kind="line" accent="#f28c28" onClick={() => setWaitlist(true)}>
                    候补
                  </Btn>
                ) : (
                  <Btn small kind="grey" disabled>
                    预订
                  </Btn>
                )}
              </div>
            );
          })}
        </Group>
        <div className="ph-note">
          · 票价为成人票价，实际以订单为准
          <br />· 请提前到达车站，凭购票时所使用的有效身份证件原件检票乘车
        </div>
      </Body>
      <Sheet open={stops} onClose={() => setStops(false)} title={`${t.no} 经停站`}>
        {(t.stops ?? [t.from, t.to]).map((st, i, arr) => (
          <div key={st + i} className="rail-stop">
            <span>{i + 1}</span>
            <b>{st}</b>
            <small>{i === 0 ? `${t.depart} 出发` : i === arr.length - 1 ? `${t.arrive} 到达` : '停2分'}</small>
          </div>
        ))}
      </Sheet>
      <Dialog open={waitlist} title="候补购票" actions={[{ label: ZH.ok, primary: true, onClick: () => setWaitlist(false) }]} onClose={() => setWaitlist(false)}>
        当前车次该席别余票不足。候补购票需预付票款，有人退票时系统将自动为您购票，不保证一定成功。本次练习请选择有余票的席别。
      </Dialog>
    </div>
  );
}

function Login({ next }: { next?: { name: string; params: Record<string, unknown> } }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [wait, setWait] = useState(0);
  const expected = smsCodeFor(p.startedAt);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((x) => x - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);
  return (
    <div className="ph-col" data-testid="rail-login">
      <AppBar title="" onBack={nav.pop} />
      <Body className="ph-login">
        <h2>手机号登录</h2>
        <p className="ph-muted">未注册的手机号验证后将自动注册</p>
        <Field label="+86" value={phone} onChange={(v) => setPhone(v.replace(/\D/g, '').slice(0, 11))} placeholder={ZH.phonePlaceholder} type="tel" testId="rail-login-phone" />
        <Field
          label="验证码"
          value={code}
          onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          placeholder={ZH.codePlaceholder}
          type="number"
          testId="rail-login-code"
          right={
            <button
              type="button"
              className="ph-code-btn"
              disabled={wait > 0}
              style={{ color: wait > 0 ? undefined : ACCENT }}
              data-testid="rail-login-send"
              onClick={() => {
                if (!validPhone(phone)) {
                  p.emit({ type: 'error', code: 'phone', app: APP });
                  return p.toast(ZH.badPhone);
                }
                setWait(60);
                window.setTimeout(() => p.sms('10690000', smsCode(APP, expected)), 1500);
                p.toast('验证码已发送');
              }}
            >
              {wait > 0 ? ZH.smsSent(wait) : ZH.sendSms}
            </button>
          }
        />
        <label className="ph-agree">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="rail-login-agree" />
          我已阅读并同意《用户服务协议》和《隐私政策》
        </label>
        <Btn
          block
          accent={ACCENT}
          disabled={phone.length < 11 || code.length < 6}
          testId="rail-login-submit"
          onClick={() => {
            if (!agree) return p.toast('请先阅读并同意用户服务协议和隐私政策');
            if (phone !== p.spec.profile.phone.replace(/\s+/g, '')) {
              p.emit({ type: 'error', code: 'login_phone', app: APP });
              return p.toast('该手机号未绑定账号，请输入您注册时使用的手机号');
            }
            if (code !== expected) {
              p.emit({ type: 'error', code: 'sms_code', app: APP });
              return p.toast(ZH.wrongCode);
            }
            p.emit({ type: 'login', app: APP });
            p.toast('登录成功');
            if (next) {
              nav.pop();
              nav.push(next.name, next.params);
            } else nav.pop();
          }}
        >
          登录
        </Btn>
      </Body>
    </div>
  );
}

function ConfirmOrder({ no, date, cls }: { no: string; date: string; cls: RailSeatClass }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const t = findTrain(w, no, date)!;
  const passengers = railPassengers(w, p.events);
  const [picked, setPicked] = useAppState<string[]>(APP, `picked:${no}:${date}`, []);
  const [letters, setLetters] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [lastAdded, setLastAdded] = useAppState<string | null>(APP, 'lastAdded', null);
  useEffect(() => {
    if (!lastAdded) return;
    setPicked((cur) => (cur.includes(lastAdded) ? cur : [...cur, lastAdded]));
    setLastAdded(null);
  }, [lastAdded, setPicked, setLastAdded]);
  const layout = seatLetters(cls);
  const offer = t.seats.find((s) => s.class === cls)!;
  const chosen = passengers.filter((x) => picked.includes(x.id));
  const total = round2(offer.price * chosen.length);
  const records = recordsFrom(p.events);

  const toggleLetter = (row: number, l: string) => {
    const key = `${row}${l}`;
    setLetters((cur) => {
      if (cur.includes(key)) return cur.filter((x) => x !== key);
      if (cur.length >= Math.max(1, chosen.length)) {
        p.toast(chosen.length ? `最多选择${chosen.length}个座位` : '请先选择乘车人');
        return cur;
      }
      return [...cur, key];
    });
  };

  const submit = () => {
    if (chosen.length === 0) {
      p.emit({ type: 'error', code: 'no_passenger', app: APP });
      return p.toast('请选择乘车人');
    }
    if (seatsLeft(t, cls, records) < chosen.length) return p.toast('余票不足，请减少乘车人或选择其他车次');
    if (minutesUntil(p.clock.date, p.clock.time, t.date, t.depart) < 30) return p.toast('距开车时间不足30分钟，请到车站窗口办理');
    setConfirm(true);
  };

  const place = () => {
    setConfirm(false);
    const id = p.newId('rail_order', 'R');
    // The letters picked are kept (one row: the system picks the row, like the real one).
    const wanted = [...new Set(letters.map((k) => k.slice(1)))];
    const seats = assignSeats(t, cls, chosen.length, wanted, id);
    p.write('rail_order', id, { ...railOrderData({ train: t, seatClass: cls, passengers: chosen, seats, orderId: id, orderNo: orderNo(p.startedAt, recordsOf(p.events, 'rail_order').length + 1), status: 'unpaid' }), placed_at: Date.now() });
    setPicked([]);
    setLetters([]);
    nav.resetTo([{ name: 'pay_order', params: { id } }]);
  };

  return (
    <div className="ph-col" data-testid="rail-confirm">
      <AppBar title="填写订单" onBack={nav.pop} />
      <Body>
        <div className="rail-confirm-train">
          <div className="rail-confirm-od">
            <span>
              <b>{t.depart}</b>
              {t.from}
            </span>
            <span className="rail-confirm-no">
              {t.no}
              <small>{zhDuration(spanMinutes(t.depart, t.arrive))}</small>
            </span>
            <span>
              <b>{t.arrive}</b>
              {t.to}
            </span>
          </div>
          <div className="rail-confirm-date">
            {zhDateLabel(t.date)} · {cls} <Price value={offer.price} color="#f26b1d" />
          </div>
        </div>
        <Group title="乘车人">
          {passengers.map((x) => (
            <label key={x.id} className="rail-pas" data-testid="rail-passenger">
              <input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, x.id] : cur.filter((i) => i !== x.id)))} />
              <span>
                <b>
                  {x.name}
                  {x.self && <i className="ph-tag">本人</i>}
                </b>
                <small>
                  {x.id_type} {x.id_no.slice(0, 2)}******{x.id_no.slice(-2)} · {x.type ?? '成人'}票
                </small>
              </span>
            </label>
          ))}
          <button type="button" className="rail-add-pas" onClick={() => nav.push('passenger_add')} data-testid="rail-add-passenger" style={{ color: ACCENT }}>
            ＋ 添加乘车人
          </button>
        </Group>
        {layout ? (
          <Group title="选座服务">
            <div className="rail-seatpick" data-testid="rail-seat-picker">
              <p className="ph-muted">已选 {letters.length}/{chosen.length || 0} · 靠窗 A、F　过道 C、D</p>
              {[1, 2].slice(0, chosen.length > 1 ? 2 : 1).map((row) => (
                <div key={row} className="rail-seatpick-row">
                  <span className="rail-win">窗</span>
                  {layout.letters.map((l) => (
                    <span key={l} className="rail-seatpick-cell">
                      <button type="button" className={letters.includes(`${row}${l}`) ? 'on' : ''} style={letters.includes(`${row}${l}`) ? { background: ACCENT, borderColor: ACCENT } : undefined} onClick={() => toggleLetter(row, l)} data-testid={`rail-seat-${row}${l}`} aria-label={`${l}座${isWindow(l) ? '靠窗' : ''}`}>
                        {l}
                      </button>
                      {l === layout.aisleAfter && <span className="rail-aisle">过道</span>}
                    </span>
                  ))}
                  <span className="rail-win">窗</span>
                </div>
              ))}
              <p className="ph-note">如剩余席位不足，系统将自动为您分配席位。</p>
            </div>
          </Group>
        ) : (
          <div className="ph-note">该席别暂不支持在线选座，系统将自动分配座位。</div>
        )}
        <div className="ph-note">提交订单表示已阅读并同意《铁路旅客运输规程》及《购票须知》。</div>
      </Body>
      <div className="ph-footer">
        <span className="ph-footer-sum">
          订单总价 <Price value={total} color="#f26b1d" size="big" />
        </span>
        <Btn accent="#f26b1d" onClick={submit} testId="rail-submit">
          {ZH.submitOrder}
        </Btn>
      </div>
      <Dialog
        open={confirm}
        title="请核对以下信息"
        onClose={() => setConfirm(false)}
        actions={[
          { label: '返回修改', onClick: () => setConfirm(false) },
          { label: '确认', primary: true, onClick: place, testId: 'rail-confirm-ok' },
        ]}
      >
        <div className="rail-check">
          {zhDateLabel(t.date)} {t.no} {t.from} {t.depart} 开 → {t.to}
          {chosen.map((x) => (
            <div key={x.id}>
              {x.name} · {cls} · {x.type ?? '成人'}票
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

const COUNTRIES = ['英国', '美国', '加拿大', '澳大利亚', '新西兰', '爱尔兰', '法国', '德国', '意大利', '西班牙', '日本', '韩国', '新加坡'];

function AddPassenger() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [form, setForm] = useState<Partial<RailPassenger>>({ id_type: '中国居民身份证', type: '成人' });
  const [sheet, setSheet] = useState<'id' | 'country' | 'type' | null>(null);
  const existing = railPassengers(w, p.events);
  const set = (k: keyof RailPassenger, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const foreign = form.id_type === '护照' || form.id_type === '外国人永久居留身份证';
  const save = () => {
    const draft = { ...form, name: foreign ? normalizePassportName(form.name ?? '') : (form.name ?? '').trim(), id_no: (form.id_no ?? '').trim().toUpperCase() };
    const problems = passengerProblems(draft, existing);
    if (problems.length) {
      p.emit({ type: 'error', code: 'passenger_form', app: APP });
      return p.toast(problems[0]);
    }
    const id = `p_${recordsOf(p.events, 'rail_passenger').length + 1}`;
    p.write('rail_passenger', id, { ...draft, id });
    // The order page underneath ticks the new passenger.
    p.setState<string | null>(APP, 'lastAdded', id);
    p.toast('添加成功');
    nav.pop();
  };
  return (
    <div className="ph-col" data-testid="rail-add-passenger-form">
      <AppBar title="添加乘车人" onBack={nav.pop} />
      <Body>
        <Group>
          <Cell label="证件类型" value={form.id_type} onClick={() => setSheet('id')} testId="rail-id-type" />
          {foreign && <Cell label="国家/地区" value={form.country ?? <span className="ph-ph">请选择</span>} onClick={() => setSheet('country')} testId="rail-country" />}
          <Field label="姓名" value={form.name ?? ''} onChange={(v) => set('name', v)} placeholder={foreign ? '与证件上的姓名一致（英文大写）' : '请输入姓名'} testId="rail-pas-name" />
          <Field label="证件号码" value={form.id_no ?? ''} onChange={(v) => set('id_no', v)} placeholder="请输入证件号码" testId="rail-pas-no" />
          <Cell label="旅客类型" value={form.type} onClick={() => setSheet('type')} />
          <Field label="手机号码" value={form.phone ?? ''} onChange={(v) => set('phone', v.replace(/\D/g, '').slice(0, 11))} placeholder="选填，用于接收出行通知" type="tel" />
        </Group>
        <div className="ph-note">请准确填写乘车人信息，乘车时需出示与购票时一致的有效身份证件原件。</div>
        <div className="ph-pad">
          <Btn block accent={ACCENT} onClick={save} testId="rail-pas-save">
            {ZH.save}
          </Btn>
        </div>
      </Body>
      <Sheet open={sheet === 'id'} onClose={() => setSheet(null)} title="证件类型">
        {RAIL_ID_TYPES.map((x) => (
          <Cell key={x} label={x} value={form.id_type === x ? '✓' : ''} onClick={() => { set('id_type', x); setSheet(null); }} arrow={false} testId="rail-id-type-option" />
        ))}
      </Sheet>
      <Sheet open={sheet === 'country'} onClose={() => setSheet(null)} title="国家/地区">
        {COUNTRIES.map((x) => (
          <Cell key={x} label={x} value={form.country === x ? '✓' : ''} onClick={() => { set('country', x); setSheet(null); }} arrow={false} testId="rail-country-option" />
        ))}
      </Sheet>
      <Sheet open={sheet === 'type'} onClose={() => setSheet(null)} title="旅客类型">
        {RAIL_PASSENGER_TYPES.map((x) => (
          <Cell key={x} label={x} onClick={() => { set('type', x); setSheet(null); }} arrow={false} />
        ))}
      </Sheet>
    </div>
  );
}

function useOrder(id: string) {
  const p = usePhone();
  return recordsOf(p.events, 'rail_order').find((r) => r.id === id)?.data as Record<string, unknown> & { seats: string[]; passengers: string[] } | undefined;
}

function PayOrder({ id }: { id: string }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const o = useOrder(id);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  void tick;
  if (!o) return <Empty text="订单不存在" />;
  const left = Math.max(0, 30 * 60 - Math.floor((Date.now() - Number(o.placed_at ?? Date.now())) / 1000));
  const payNow = async () => {
    const r = await p.pay({ app: APP, title: `${o.train_no} ${o.seat_class} ${o.seats.length}张`, payee: '铁路出行', amount: Number(o.total) });
    if (!r) return;
    p.write('rail_order', id, { status: 'paid', pay_method: r.method, paid_at: Date.now() });
    p.sms(
      '10690000',
      `【铁路出行】订单${o.order_no}，${o.passengers.join('、')}您已购${zhMonthDay(String(o.date))}${o.train_no}次${o.seats.join('、')}号，${o.from}站${o.depart}开，${o.gate || '检票口请留意车站公告'}。`,
      { app: APP, screen: 'order', params: { id } },
    );
    nav.resetTo([{ name: 'order', params: { id, fresh: true } }]);
  };
  return (
    <div className="ph-col" data-testid="rail-pay-order">
      <AppBar title="订单待支付" onBack={nav.home} />
      <Body>
        <div className="rail-lock" style={{ background: ACCENT }}>
          <b>席位已锁定</b>
          <span>
            请在 <span data-testid="rail-countdown">{String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</span> 内完成支付，逾期将自动取消订单
          </span>
        </div>
        <OrderCard o={o} />
      </Body>
      <div className="ph-footer">
        <span className="ph-footer-sum">
          合计 <Price value={Number(o.total)} color="#f26b1d" size="big" />
        </span>
        <Btn
          kind="line"
          onClick={() => {
            p.write('rail_order', id, { status: 'cancelled' });
            p.toast('订单已取消');
            nav.home();
          }}
        >
          取消订单
        </Btn>
        <Btn accent="#f26b1d" onClick={payNow} testId="rail-pay">
          {ZH.payNow}
        </Btn>
      </div>
    </div>
  );
}

function OrderCard({ o }: { o: Record<string, unknown> & { seats: string[]; passengers: string[] } }) {
  return (
    <div className="rail-order-card" data-testid="rail-order-card">
      <div className="rail-confirm-od">
        <span>
          <b>{String(o.depart)}</b>
          {String(o.from)}
        </span>
        <span className="rail-confirm-no">
          {String(o.train_no)}
          <small>{zhDateLabel(String(o.date))}</small>
        </span>
        <span>
          <b>{String(o.arrive)}</b>
          {String(o.to)}
        </span>
      </div>
      {o.passengers.map((name, i) => (
        <div key={name + i} className="rail-order-pas">
          <b>{name}</b>
          <span>
            {String(o.seat_class)} · <b data-testid="rail-seat">{o.seats[i]}号</b>
          </span>
          <Price value={Number(o.price_each)} />
        </div>
      ))}
    </div>
  );
}

const STATUS_ZH: Record<string, string> = { unpaid: '待支付', paid: '已支付', refunded: '已退票', changed: '已改签', cancelled: '已取消' };

function RailOrders() {
  const p = usePhone();
  const nav = useAppNav(APP);
  const [tab, setTab] = useState<'go' | 'unpaid' | 'all'>('go');
  const orders = recordsOf(p.events, 'rail_order').reverse();
  const list = orders.filter((r) => (tab === 'go' ? r.data.status === 'paid' : tab === 'unpaid' ? r.data.status === 'unpaid' : true));
  return (
    <Body testId="rail-orders">
      <AppBar title="订单" />
      <Tabs
        accent={ACCENT}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'go', label: '未出行' },
          { id: 'unpaid', label: '待支付' },
          { id: 'all', label: '全部订单' },
        ]}
      />
      {list.length === 0 ? (
        <Empty icon="🎫" text="暂无订单" />
      ) : (
        list.map((r) => (
          <button key={r.id} type="button" className="rail-order-row" onClick={() => nav.push(r.data.status === 'unpaid' ? 'pay_order' : 'order', { id: r.id })} data-testid="rail-order-row" data-train={String(r.data.train_no)}>
            <span>
              <b>
                {String(r.data.from)} → {String(r.data.to)}
              </b>
              <small>
                {zhDateLabel(String(r.data.date))} {String(r.data.depart)} 开 · {String(r.data.train_no)}
              </small>
            </span>
            <span className={`rail-status rail-status-${String(r.data.status)}`}>{STATUS_ZH[String(r.data.status)] ?? ''}</span>
          </button>
        ))
      )}
    </Body>
  );
}

function OrderDetail({ id }: { id: string }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const o = useOrder(id);
  const [refund, setRefund] = useState(false);
  if (!o) return <Empty text="订单不存在" />;
  const status = String(o.status);
  const fee = refundFee(Number(o.total), p.clock.date, p.clock.time, String(o.date), String(o.depart));
  const doRefund = () => {
    setRefund(false);
    if (fee === null) return p.toast('已过开车时间，无法办理退票');
    const back = round2(Number(o.total) - fee);
    p.write('rail_order', id, { status: 'refunded', refund_fee: fee, refunded_at: Date.now() });
    p.write('payment', p.newId('payment', 'P'), { app: APP, title: `${o.train_no} 退票退款`, payee: '铁路出行', amount: back, method: String(o.pay_method ?? 'balance'), direction: 'in', status: 'paid' });
    p.sms('10690000', `【铁路出行】您好，${o.passengers.join('、')}已办理${zhMonthDay(String(o.date))}${o.train_no}次退票，应退票款${yuan(back)}元，退票费${yuan(fee)}元，将在1-7个工作日退回原支付账户。`);
    p.toast('退票成功');
  };
  return (
    <div className="ph-col" data-testid="rail-order-detail">
      <AppBar title="订单详情" onBack={nav.home} />
      <Body>
        <div className={`rail-order-status rail-status-${status}`} style={status === 'paid' ? { background: ACCENT } : undefined} data-testid="rail-order-status">
          <b>{status === 'paid' ? '支付成功' : STATUS_ZH[status]}</b>
          <small>订单号 {String(o.order_no)}</small>
        </div>
        <OrderCard o={o} />
        {status === 'paid' && (
          <div className="rail-gate" data-testid="rail-gate">
            <b>{String(o.gate || '检票口以车站公告为准')}</b>
            <small>电子客票，凭购票时所使用的有效身份证件原件检票乘车</small>
          </div>
        )}
        {status === 'refunded' && <div className="ph-note">已退票：退票费 ¥{yuan(Number(o.refund_fee ?? 0))}，票款将退回原支付账户。</div>}
        {status === 'changed' && <div className="ph-note">该车票已改签，请在订单列表中查看新车票。</div>}
      </Body>
      {status === 'paid' && (
        <div className="ph-footer ph-footer-actions">
          <Btn kind="line" onClick={() => setRefund(true)} testId="rail-refund">
            退票
          </Btn>
          <Btn kind="line" onClick={() => p.toast(ZH.notOpen)}>
            变更到站
          </Btn>
          <Btn
            kind="line"
            accent={ACCENT}
            testId="rail-change"
            onClick={() => {
              if (o.changed_from) return p.toast('该车票已改签过一次，不能再次改签');
              nav.push('change', { id });
            }}
          >
            改签
          </Btn>
        </div>
      )}
      <Dialog
        open={refund}
        title="退票确认"
        onClose={() => setRefund(false)}
        actions={[
          { label: '再想想', onClick: () => setRefund(false) },
          { label: '确认退票', primary: true, onClick: doRefund, testId: 'rail-refund-ok' },
        ]}
      >
        <div className="rail-refund" data-testid="rail-refund-dialog">
          <div>
            {o.train_no as string} {zhDateLabel(String(o.date))} {String(o.depart)} 开
          </div>
          <div>
            票价：¥{yuan(Number(o.total))}　退票费：¥{yuan(fee ?? 0)}
          </div>
          <div>
            <b>应退金额：¥{yuan(round2(Number(o.total) - (fee ?? 0)))}</b>
          </div>
          <small>{refundRateLabel(p.clock.date, p.clock.time, String(o.date), String(o.depart))}</small>
        </div>
      </Dialog>
    </div>
  );
}

function ChangeTrain({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const o = useOrder(id);
  const [date, setDate] = useState(String(o?.date ?? p.clock.date));
  const [pick, setPick] = useState<{ t: RailTrain; cls: RailSeatClass } | null>(null);
  const records = useMemo(() => recordsFrom(p.events), [p.events]);
  if (!o) return <Empty text="订单不存在" />;
  const options = changeOptions(w, { train_no: String(o.train_no), date: String(o.date), from: String(o.from), to: String(o.to) }, p.clock.date, p.clock.time).filter((t) => t.date === date);
  const count = o.passengers.length;
  const confirm = async () => {
    if (!pick) return;
    const { t, cls } = pick;
    setPick(null);
    const offer = t.seats.find((s) => s.class === cls)!;
    const diff = changeDifference(Number(o.total), round2(offer.price * count));
    let method = String(o.pay_method ?? 'balance');
    if (diff > 0) {
      const r = await p.pay({ app: APP, title: `改签补差价 ${t.no} ${cls}`, payee: '铁路出行', amount: diff });
      if (!r) return;
      method = r.method;
    }
    const newId = p.newId('rail_order', 'R');
    const pas = (o.passenger_ids as string[]).map((pid) => railPassengers(w, p.events).find((x) => x.id === pid)).filter((x): x is RailPassenger => !!x);
    const seats = assignSeats(t, cls, count, [], newId);
    p.write('rail_order', id, { status: 'changed', changed_to: newId });
    p.write('rail_order', newId, { ...railOrderData({ train: t, seatClass: cls, passengers: pas, seats, orderId: newId, orderNo: String(o.order_no), status: 'paid', changedFrom: String(o.order_id ?? id) }), pay_method: method });
    if (diff < 0) p.write('payment', p.newId('payment', 'P'), { app: APP, title: `${t.no} 改签退还差额`, payee: '铁路出行', amount: -diff, method, direction: 'in', status: 'paid' });
    p.sms('10690000', `【铁路出行】订单${String(o.order_no)}，您已改签${zhMonthDay(t.date)}${t.no}次${seats.join('、')}号，${t.from}站${t.depart}开，${t.gate ?? ''}。原车票已失效。`);
    p.toast('改签成功');
    nav.resetTo([{ name: 'order', params: { id: newId } }]);
  };
  return (
    <div className="ph-col" data-testid="rail-change-list">
      <AppBar title="改签" onBack={nav.pop} />
      <div className="ph-note ph-note-top">
        原车次 {String(o.train_no)} {zhDateLabel(String(o.date))} {String(o.depart)} 开 · {String(o.seat_class)} ¥{yuan(Number(o.total))}。改签后原车票失效；每张车票只能改签一次。
      </div>
      <div className="rail-daybar" style={{ background: ACCENT }}>
        <button type="button" onClick={() => daysBetween(p.clock.date, addDays(date, -1)) >= 0 && setDate(addDays(date, -1))}>
          ‹ 前一天
        </button>
        <span className="rail-daybar-date">{zhDateLabel(date)}</span>
        <button type="button" onClick={() => daysBetween(p.clock.date, addDays(date, 1)) < 15 && setDate(addDays(date, 1))}>
          后一天 ›
        </button>
      </div>
      <Body>
        {options.length === 0 ? (
          <Empty icon="🚄" text="当日没有可改签的车次" />
        ) : (
          options.map((t) => (
            <div key={t.no} className="rail-change-train" data-testid="rail-change-row" data-train={t.no}>
              <div className="rail-change-head">
                <b>{t.depart}</b> → <b>{t.arrive}</b> <span>{t.no}</span>
                <small>{zhDuration(spanMinutes(t.depart, t.arrive))}</small>
              </div>
              <div className="rail-change-seats">
                {t.seats.map((s) => {
                  const left = seatsLeft(t, s.class, records);
                  return (
                    <button key={s.class} type="button" disabled={left < count} onClick={() => setPick({ t, cls: s.class })} data-testid="rail-change-seat" data-class={s.class}>
                      {s.class}
                      <small>{left >= count ? `¥${yuan(s.price)} ${seatsLabel(left)}` : '无票'}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </Body>
      <Dialog
        open={!!pick}
        title="确认改签"
        onClose={() => setPick(null)}
        actions={[
          { label: ZH.cancel, onClick: () => setPick(null) },
          { label: '确认改签', primary: true, onClick: () => void confirm(), testId: 'rail-change-ok' },
        ]}
      >
        {pick && (
          <div className="rail-refund">
            <div>
              新车次：{pick.t.no} {zhDateLabel(pick.t.date)} {pick.t.depart} 开 · {pick.cls}
            </div>
            {(() => {
              const diff = changeDifference(Number(o.total), round2((pick.t.seats.find((s) => s.class === pick.cls)?.price ?? 0) * count));
              return <b>{diff > 0 ? `需补差价：¥${yuan(diff)}` : diff < 0 ? `退还差额：¥${yuan(-diff)}` : '票价相同，无需补差价'}</b>;
            })()}
          </div>
        )}
      </Dialog>
    </div>
  );
}
