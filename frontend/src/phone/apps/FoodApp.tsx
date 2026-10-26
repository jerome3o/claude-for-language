/**
 * 饭点外卖 — a fictional food-delivery app with the delivery apps' flow: shops (★ / 月售 / 起送 /
 * 配送费 / 满减), a shop's menu (categories on the left, 选规格 with 必选 groups like 辣度 / 甜度),
 * the cart bar ("还差¥5起送", "再买¥8可减10"), 去结算 (收货地址 incl. 新增收货地址, 满减, 红包,
 * 备注 with quick tags like 不要香菜, 餐具数量), pay, and the order page (商家已接单 → 骑手已取餐
 * → 送达) where the rider may message you.
 */
import { useEffect, useMemo, useState } from 'react';
import { ZH, type FoodAddress, type FoodItem, type FoodShop, type FoodWorld } from '@shared/phone';
import { timeOf, minutesOf, yuan } from '@shared/phone/dates';
import { recordsOf } from '@shared/phone/engine';
import {
  cartCount,
  cartTotals,
  changeCart,
  DEFAULT_NOTE_TAGS,
  FOOD_CUTLERY,
  FOOD_STATUS_ZH,
  FOOD_TIMELINE,
  foodOrderData,
  minOrderGap,
  nextDiscount,
  bestDiscount,
  optionProblems,
  packingFee,
  pickedList,
  unitPrice,
  usableRedPackets,
  itemsTotal,
  type CartLine,
  type FoodStatus,
  type OptionPicks,
} from '@shared/phone/food';
import { addressLine, foodAddresses } from '@shared/phone/world';
import { validPhone } from '@shared/phone/rail';
import { useAppNav, useAppState, usePhone, type Screen } from '../runtime';
import { AppChat, usePersona } from '../persona';
import { AppBar, Body, Btn, Cell, Chip, Empty, Field, Group, Price, SearchBox, Sheet, Stars, Stepper, Tabs } from '../ui';

const APP = 'food' as const;
const ACCENT = '#f5b400';
const INK = '#222';

function useWorld(): FoodWorld {
  return usePhone().spec.world.food!;
}

function useCart(shopId: string) {
  return useAppState<CartLine[]>(APP, `cart:${shopId}`, []);
}

function useAddresses(): FoodAddress[] {
  const p = usePhone();
  return foodAddresses(useWorld().addresses, p.events);
}

function useSelectedAddress(): [FoodAddress | null, (id: string) => void] {
  const list = useAddresses();
  const [id, setId] = useAppState<string | null>(APP, 'address', null);
  const found = list.find((a) => a.id === id) ?? list[0] ?? null;
  return [found, (x: string) => setId(x)];
}

export function FoodApp({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'search':
      return <Search />;
    case 'shop':
      return <Shop shopId={String(screen.params.shop)} />;
    case 'checkout':
      return <Checkout shopId={String(screen.params.shop)} />;
    case 'addresses':
      return <Addresses fromCheckout={screen.params.from === 'checkout'} />;
    case 'address_add':
      return <AddAddress backToCheckout={screen.params.back === 'checkout'} />;
    case 'note':
      return <NoteEditor shopId={String(screen.params.shop)} />;
    case 'order':
      return <OrderPage id={String(screen.params.id)} />;
    case 'chat':
      return <RiderChat personaId={String(screen.params.persona)} context={String(screen.params.context ?? '')} />;
    default:
      return <FoodHome />;
  }
}

function ShopRow({ shop, onClick, match }: { shop: FoodShop; onClick: () => void; match?: string }) {
  return (
    <button type="button" className={`food-shop${shop.closed ? ' closed' : ''}`} onClick={onClick} data-testid="food-shop" data-shop={shop.id}>
      <span className="food-shop-pic">{shop.emoji ?? '🍱'}</span>
      <span className="food-shop-main">
        <b>{shop.name}</b>
        <span className="food-shop-meta">
          <span className="food-score">{shop.rating}分</span> 月售{shop.monthly_sales > 999 ? `${Math.floor(shop.monthly_sales / 1000)}000+` : shop.monthly_sales}
          <span className="food-shop-time">
            {shop.closed ? '休息中' : `${shop.delivery_min}分钟`} {shop.km}km
          </span>
        </span>
        <span className="food-shop-meta">
          起送¥{yuan(shop.min_order)} 配送¥{yuan(shop.delivery_fee)}
        </span>
        <span className="food-shop-tags">
          {(shop.discounts ?? []).map((d) => (
            <i key={d.threshold}>
              {yuan(d.threshold)}减{yuan(d.minus)}
            </i>
          ))}
          {shop.closed && <i className="food-closed-tag">本店休息中 · 明天10:00营业</i>}
        </span>
        {match && <small className="food-match">含：{match}</small>}
      </span>
    </button>
  );
}

function FoodHome() {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const [tab, setTab] = useAppState<'home' | 'orders' | 'me'>(APP, 'tab', 'home');
  const [sort, setSort] = useState<'all' | 'sales' | 'km' | 'rating'>('all');
  const [cat, setCat] = useState<string | null>(null);
  const [addr] = useSelectedAddress();
  const shops = [...w.shops]
    .filter((s) => !cat || (cat === '甜点饮品' ? s.category === '奶茶' : s.category !== '奶茶'))
    .sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || (sort === 'sales' ? b.monthly_sales - a.monthly_sales : sort === 'km' ? a.km - b.km : sort === 'rating' ? b.rating - a.rating : 0));
  return (
    <div className="ph-col food" data-testid="food-home">
      {tab === 'home' && (
        <Body>
          <div className="food-top" style={{ background: ACCENT }}>
            <button type="button" className="food-addr" onClick={() => nav.push('addresses')} data-testid="food-addr">
              📍 {addr ? `${addr.label ?? ''} ${addr.detail}` : '请选择收货地址'} ▾
            </button>
            <button type="button" className="food-search-fake" onClick={() => nav.push('search')} data-testid="food-search-open">
              🔍 搜索商家、商品名称
            </button>
          </div>
          <div className="food-cats">
            {[
              ['美食', '🍜'],
              ['甜点饮品', '🧋'],
              ['超市便利', '🛒'],
              ['蔬菜水果', '🥬'],
              ['看病买药', '💊'],
              ['跑腿代购', '🛵'],
              ['早餐', '🥟'],
              ['夜宵', '🍢'],
            ].map(([name, icon], i) => (
              <button key={name} type="button" className={cat === name ? 'on' : ''} onClick={() => (i < 2 ? setCat(cat === name ? null : name) : p.toast(ZH.notOpen))}>
                <span>{icon}</span>
                {name}
              </button>
            ))}
          </div>
          <div className="food-banner">新用户专享 · 下单立减红包已放入账户</div>
          <div className="ph-chips ph-chips-bar">
            {(
              [
                ['all', '综合排序'],
                ['sales', '销量最高'],
                ['km', '距离最近'],
                ['rating', '评分最高'],
              ] as const
            ).map(([id, label]) => (
              <Chip key={id} on={sort === id} accent={INK} onClick={() => setSort(id)}>
                {label}
              </Chip>
            ))}
          </div>
          {shops.map((s) => (
            <ShopRow key={s.id} shop={s} onClick={() => nav.push('shop', { shop: s.id })} />
          ))}
        </Body>
      )}
      {tab === 'orders' && <FoodOrders />}
      {tab === 'me' && (
        <Body>
          <AppBar title="我的" />
          <Group>
            <Cell icon="📍" label="我的地址" onClick={() => nav.push('addresses')} />
            <Cell icon="🧧" label="红包卡券" value={`${(w.red_packets ?? []).length}个`} onClick={() => p.toast('结算时可选择使用')} />
            <Cell icon="⭐" label="我的收藏" onClick={() => p.toast(ZH.notOpen)} />
            <Cell icon="🎧" label="客服中心" onClick={() => p.toast(ZH.notOpen)} />
          </Group>
        </Body>
      )}
      <div className="ph-tabbar">
        {(
          [
            ['home', '首页', '🏠'],
            ['orders', '订单', '📄'],
            ['me', '我的', '👤'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} style={tab === id ? { color: INK } : undefined} onClick={() => setTab(id)} data-testid={`food-tab-${id}`}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Search() {
  const w = useWorld();
  const nav = useAppNav(APP);
  const [q, setQ] = useState('');
  const t = q.trim();
  const hits = t
    ? w.shops
        .map((s) => {
          const dish = s.menu.flatMap((c) => c.items).find((i) => i.name.includes(t));
          return s.name.includes(t) || s.category.includes(t) || dish ? { s, match: dish?.name } : null;
        })
        .filter((x): x is { s: FoodShop; match: string | undefined } => !!x)
    : [];
  return (
    <div className="ph-col food" data-testid="food-search">
      <AppBar title="" onBack={nav.pop} />
      <div className="ph-pad">
        <SearchBox value={q} onChange={setQ} placeholder="搜索商家、商品名称" autoFocus mic testId="food-search-input" />
      </div>
      <Body>
        {t ? (
          hits.length ? (
            hits.map(({ s, match }) => <ShopRow key={s.id} shop={s} match={match} onClick={() => nav.push('shop', { shop: s.id })} />)
          ) : (
            <Empty icon="🔍" text="没有找到相关商家" />
          )
        ) : (
          <>
            <div className="ph-section-title">热门搜索</div>
            <div className="ph-chips">
              {['牛肉面', '奶茶', '杨枝甘露', '盖饭', '饺子', '汉堡'].map((k) => (
                <Chip key={k} onClick={() => setQ(k)}>
                  {k}
                </Chip>
              ))}
            </div>
          </>
        )}
      </Body>
    </div>
  );
}

function Shop({ shopId }: { shopId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const shop = w.shops.find((s) => s.id === shopId)!;
  const [cart, setCart] = useCart(shopId);
  const [tab, setTab] = useState<'menu' | 'reviews' | 'info'>('menu');
  const [cat, setCat] = useState(0);
  const [spec, setSpec] = useState<FoodItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const gap = minOrderGap(shop, cart);
  const goods = itemsTotal(cart) + packingFee(shop, cart);
  const next = nextDiscount(shop, goods);
  const got = bestDiscount(shop, goods);
  const add = (item: FoodItem) => {
    if (shop.closed) return p.toast('商家休息中，暂不接单');
    if (item.sold_out) return p.toast('该商品已售罄');
    if (item.options?.length) return setSpec(item);
    setCart((c) => changeCart(c, item, [], item.price, 1));
  };
  const qtyOf = (item: FoodItem) => cart.filter((l) => l.item_id === item.id).reduce((n, l) => n + l.qty, 0);
  return (
    <div className="ph-col food" data-testid="food-shop-page" data-shop={shop.id}>
      <AppBar title="" onBack={nav.pop} right={<button type="button" className="ph-bar-icon" onClick={() => p.toast('已收藏')} aria-label="收藏">☆</button>} />
      <div className="food-shop-head">
        <span className="food-shop-pic big">{shop.emoji ?? '🍱'}</span>
        <span>
          <b>{shop.name}</b>
          <small>
            <span className="food-score">{shop.rating}分</span> 月售{shop.monthly_sales} · 约{shop.delivery_min}分钟 · 距离{shop.km}km
          </small>
          <span className="food-shop-tags">
            {(shop.discounts ?? []).map((d) => (
              <i key={d.threshold}>
                满{yuan(d.threshold)}减{yuan(d.minus)}
              </i>
            ))}
          </span>
        </span>
      </div>
      {shop.closed && <div className="food-closed-bar">本店休息中，明天10:00开始营业，可以先看看其他商家</div>}
      <Tabs
        accent={INK}
        value={tab}
        onChange={setTab}
        items={[
          { id: 'menu', label: '点菜' },
          { id: 'reviews', label: '评价' },
          { id: 'info', label: '商家' },
        ]}
      />
      {tab === 'menu' && (
        <div className="food-menu">
          <div className="food-menu-cats">
            {shop.menu.map((c, i) => (
              <button key={c.category} type="button" className={i === cat ? 'on' : ''} onClick={() => setCat(i)}>
                {c.category}
              </button>
            ))}
          </div>
          <div className="food-menu-items">
            <div className="food-menu-title">{shop.menu[cat]?.category}</div>
            {shop.menu[cat]?.items.map((item) => (
              <div key={item.id} className={`food-item${item.sold_out ? ' soldout' : ''}`} data-testid="food-item" data-item={item.id}>
                <span className="food-item-pic">{item.emoji ?? '🍽'}</span>
                <span className="food-item-main">
                  <b>{item.name}</b>
                  {item.desc && <small>{item.desc}</small>}
                  <small>月售{item.sales ?? 0}</small>
                  <span className="food-item-foot">
                    <Price value={item.price} color="#f53d3d" />
                    {item.sold_out ? (
                      <span className="food-soldout">已售罄</span>
                    ) : item.options?.length ? (
                      <button type="button" className="food-spec-btn" style={{ background: ACCENT }} onClick={() => add(item)} data-testid="food-spec-open">
                        选规格{qtyOf(item) > 0 && <i className="wx-badge">{qtyOf(item)}</i>}
                      </button>
                    ) : (
                      <span className="food-qty">
                        {qtyOf(item) > 0 && (
                          <>
                            <button type="button" aria-label="减少" onClick={() => setCart((c) => changeCart(c, item, [], item.price, -1))}>
                              −
                            </button>
                            <span>{qtyOf(item)}</span>
                          </>
                        )}
                        <button type="button" className="food-plus" style={{ background: ACCENT }} aria-label="加入购物车" onClick={() => add(item)} data-testid="food-add">
                          ＋
                        </button>
                      </span>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'reviews' && (
        <Body>
          <div className="food-review">
            <Stars value={5} /> <b>吃***货</b>
            <p>分量很足，送得也快，汤还是热的！</p>
          </div>
          <div className="food-review">
            <Stars value={4} /> <b>上班***族</b>
            <p>味道不错，就是中午人多要等一会儿。</p>
          </div>
        </Body>
      )}
      {tab === 'info' && (
        <Body>
          <Group>
            <Cell label="商家地址" value="静安区（距您约1公里）" />
            <Cell label="营业时间" value="10:00-21:30" />
            <Cell label="配送服务" value="由饭点专送提供配送" />
          </Group>
        </Body>
      )}
      <div className="food-cartbar-wrap">
        {cart.length > 0 && (next || got) && <div className="food-discount-tip">{next ? `再买¥${yuan(next.gap)}可减${yuan(next.minus)}` : `已满${yuan(got!.threshold)}减${yuan(got!.minus)}`}</div>}
        <div className="food-cartbar">
          <button type="button" className="food-cart-icon" onClick={() => cart.length && setCartOpen(true)} data-testid="food-cart" aria-label="购物车">
            🛒{cartCount(cart) > 0 && <i className="wx-badge">{cartCount(cart)}</i>}
          </button>
          <span className="food-cart-sum">
            {cart.length ? <Price value={itemsTotal(cart)} /> : <span className="ph-muted">未选购商品</span>}
            <small>另需配送费¥{yuan(shop.delivery_fee)}</small>
          </span>
          <button
            type="button"
            className="food-checkout"
            disabled={cart.length === 0 || gap > 0 || !!shop.closed}
            style={cart.length && gap === 0 && !shop.closed ? { background: ACCENT, color: INK } : undefined}
            onClick={() => nav.push('checkout', { shop: shop.id })}
            data-testid="food-checkout"
          >
            {shop.closed ? '休息中' : cart.length === 0 ? `¥${yuan(shop.min_order)}起送` : gap > 0 ? `还差¥${yuan(gap)}起送` : '去结算'}
          </button>
        </div>
      </div>
      {spec && <SpecSheet item={spec} onClose={() => setSpec(null)} onAdd={(opts, price) => { setCart((c) => changeCart(c, spec, opts, price, 1)); setSpec(null); }} />}
      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title="已选商品">
        {cart.map((l) => {
          const item = shop.menu.flatMap((c) => c.items).find((i) => i.id === l.item_id)!;
          return (
            <div key={l.key} className="food-cart-line" data-testid="food-cart-line">
              <span>
                <b>{l.name}</b>
                {l.options.length > 0 && <small>{l.options.join('/')}</small>}
              </span>
              <Price value={l.price * l.qty} />
              <Stepper value={l.qty} min={0} onChange={(n) => setCart((c) => changeCart(c, item, l.options, l.price, n - l.qty))} />
            </div>
          );
        })}
        <button type="button" className="food-clear" onClick={() => { setCart([]); setCartOpen(false); }}>
          🗑 清空购物车
        </button>
      </Sheet>
    </div>
  );
}

function SpecSheet({ item, onClose, onAdd }: { item: FoodItem; onClose: () => void; onAdd: (options: string[], price: number) => void }) {
  const p = usePhone();
  const [picks, setPicks] = useState<OptionPicks>({});
  const toggle = (group: string, name: string, multi?: boolean) =>
    setPicks((cur) => {
      const now = cur[group] ?? [];
      if (multi) return { ...cur, [group]: now.includes(name) ? now.filter((x) => x !== name) : [...now, name] };
      return { ...cur, [group]: now[0] === name ? [] : [name] };
    });
  const price = unitPrice(item, picks);
  return (
    <Sheet open onClose={onClose} title={item.name} testId="food-spec-sheet">
      {(item.options ?? []).map((g) => (
        <div key={g.name} className="food-spec-group">
          <div className="food-spec-name">
            {g.name}
            {g.required ? <i className="food-required">必选</i> : <small>{g.multi ? '可多选' : '可选'}</small>}
          </div>
          <div className="ph-chips">
            {g.choices.map((c) => (
              <Chip key={c.name} on={(picks[g.name] ?? []).includes(c.name)} accent="#e09b00" onClick={() => toggle(g.name, c.name, g.multi)} testId="food-spec-choice">
                {c.name}
                {c.price ? ` +¥${yuan(c.price)}` : ''}
              </Chip>
            ))}
          </div>
        </div>
      ))}
      <div className="food-spec-foot">
        <span>
          <Price value={price} color="#f53d3d" size="big" />
          <small>{pickedList(item, picks).join('，') || '请选择规格'}</small>
        </span>
        <Btn
          accent={ACCENT}
          style={{ color: INK }}
          testId="food-spec-add"
          onClick={() => {
            const problems = optionProblems(item, picks);
            if (problems.length) {
              p.emit({ type: 'error', code: 'food_options', app: APP });
              return p.toast(problems[0]);
            }
            onAdd(pickedList(item, picks), price);
          }}
        >
          加入购物车
        </Btn>
      </div>
    </Sheet>
  );
}

interface CheckoutExtras {
  note: string;
  tags: string[];
  cutlery: string | null;
  redPacket: string | null | undefined;
  time: string | null;
}

function useExtras(shopId: string) {
  return useAppState<CheckoutExtras>(APP, `extras:${shopId}`, { note: '', tags: [], cutlery: null, redPacket: undefined, time: null });
}

function Checkout({ shopId }: { shopId: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const shop = w.shops.find((s) => s.id === shopId)!;
  const [cart, setCart] = useCart(shopId);
  const [extras, setExtras] = useExtras(shopId);
  const [addr] = useSelectedAddress();
  const [sheet, setSheet] = useState<'red' | 'cutlery' | 'time' | null>(null);
  const totals = cartTotals(shop, cart, w.red_packets, extras.redPacket);
  const goods = Math.round((totals.items + totals.packing - totals.discount) * 100) / 100;
  const usable = usableRedPackets(w.red_packets, goods);
  const eta = timeOf(minutesOf(p.clock.time) + shop.delivery_min);
  const submit = async () => {
    if (!addr) return p.toast('请选择收货地址');
    if (!extras.cutlery) {
      p.emit({ type: 'error', code: 'cutlery', app: APP });
      return p.toast('请选择餐具数量');
    }
    const id = p.newId('food_order', 'F');
    const data = foodOrderData({ shop, cart, totals, note: extras.note, noteTags: extras.tags, cutlery: extras.cutlery, address: addr, orderId: id, status: 'unpaid' });
    p.write('food_order', id, { ...data, deliver_at: extras.time ?? eta });
    const r = await p.pay({ app: APP, title: shop.name, payee: '饭点外卖', amount: totals.total });
    if (!r) {
      p.toast('订单待支付，可在订单页继续支付');
      nav.resetTo([{ name: 'order', params: { id } }]);
      return;
    }
    p.write('food_order', id, { status: 'paid', paid_at: Date.now(), pay_method: r.method });
    setCart([]);
    setExtras({ note: '', tags: [], cutlery: null, redPacket: undefined, time: null });
    nav.resetTo([{ name: 'order', params: { id } }]);
  };
  return (
    <div className="ph-col food" data-testid="food-checkout-page">
      <AppBar title="提交订单" onBack={nav.pop} />
      <Body>
        <button type="button" className="food-checkout-addr" onClick={() => nav.push('addresses', { from: 'checkout' })} data-testid="food-checkout-addr">
          {addr ? (
            <>
              <b>
                {addr.label && <i className="ph-tag">{addr.label}</i>}
                {addressLine(addr)}
              </b>
              <small>
                {addr.name} {addr.phone}
              </small>
            </>
          ) : (
            <b>＋ 请添加收货地址</b>
          )}
          <span className="ph-cell-arrow">›</span>
        </button>
        <Group>
          <Cell label="立即送出" value={extras.time ? `预计 ${extras.time} 送达` : `大约 ${eta} 送达`} onClick={() => setSheet('time')} />
        </Group>
        <Group title={shop.name}>
          {cart.map((l) => (
            <div key={l.key} className="food-co-line">
              <span>
                <b>{l.name}</b>
                {l.options.length > 0 && <small>{l.options.join('/')}</small>}
              </span>
              <span>×{l.qty}</span>
              <Price value={l.price * l.qty} />
            </div>
          ))}
          <Cell label="包装费" value={`¥${yuan(totals.packing)}`} />
          <Cell label="配送费" value={`¥${yuan(totals.delivery)}`} />
          {totals.discount > 0 && <Cell label={<span><i className="food-tag-red">减</i> 满减优惠</span>} value={<span className="food-red">-¥{yuan(totals.discount)}</span>} testId="food-discount" />}
          <Cell
            label={<span><i className="food-tag-red">红</i> 红包</span>}
            value={<span className={totals.red_packet ? 'food-red' : 'ph-muted'}>{totals.red_packet ? `-¥${yuan(totals.red_packet)}` : usable.length ? `${usable.length}个可用` : '暂无可用'}</span>}
            onClick={() => setSheet('red')}
            testId="food-red-packet"
          />
          <div className="food-co-total">
            已优惠¥{yuan(totals.discount + totals.red_packet)}　小计 <Price value={totals.total} size="big" />
          </div>
        </Group>
        <Group>
          <Cell label="备注" value={[...extras.tags, extras.note].filter(Boolean).join('，') || <span className="ph-ph">口味、偏好等要求</span>} onClick={() => nav.push('note', { shop: shopId })} testId="food-note" />
          <Cell label="餐具数量" value={extras.cutlery ?? <span className="food-red">请选择</span>} onClick={() => setSheet('cutlery')} testId="food-cutlery" />
          <Cell label="发票" value="本单不支持开发票" arrow={false} />
        </Group>
      </Body>
      <div className="ph-footer">
        <span className="ph-footer-sum">
          实付 <Price value={totals.total} size="big" color="#f53d3d" />
          <small>已优惠¥{yuan(totals.discount + totals.red_packet)}</small>
        </span>
        <Btn accent={ACCENT} style={{ color: INK }} onClick={() => void submit()} testId="food-submit">
          {ZH.submitOrder}
        </Btn>
      </div>
      <Sheet open={sheet === 'red'} onClose={() => setSheet(null)} title="选择红包" testId="food-red-sheet">
        {(w.red_packets ?? []).map((r) => {
          const ok = goods >= r.threshold;
          const on = totals.red_packet_id === r.id;
          return (
            <button key={r.id} type="button" className={`food-rp${ok ? '' : ' off'}${on ? ' on' : ''}`} disabled={!ok} onClick={() => { setExtras((e) => ({ ...e, redPacket: r.id })); setSheet(null); }} data-testid="food-rp-option">
              <span className="food-rp-amount">
                ¥<b>{yuan(r.amount)}</b>
              </span>
              <span>
                <b>{r.name}</b>
                <small>满{yuan(r.threshold)}可用{ok ? '' : ` · 还差¥${yuan(Math.round((r.threshold - goods) * 100) / 100)}`}</small>
              </span>
              <span>{on ? '✓' : ''}</span>
            </button>
          );
        })}
        <Cell label="不使用红包" value={extras.redPacket === null ? '✓' : ''} arrow={false} onClick={() => { setExtras((e) => ({ ...e, redPacket: null })); setSheet(null); }} />
      </Sheet>
      <Sheet open={sheet === 'cutlery'} onClose={() => setSheet(null)} title="餐具数量" testId="food-cutlery-sheet">
        <div className="ph-note">为减少资源浪费，请按需选择餐具数量</div>
        {FOOD_CUTLERY.map((c) => (
          <Cell key={c} label={c === '无需餐具' ? '🌱 无需餐具' : c} value={extras.cutlery === c ? '✓' : ''} arrow={false} onClick={() => { setExtras((e) => ({ ...e, cutlery: c })); setSheet(null); }} testId="food-cutlery-option" />
        ))}
      </Sheet>
      <Sheet open={sheet === 'time'} onClose={() => setSheet(null)} title="选择送达时间">
        {[0, 20, 40, 60, 80].map((m) => {
          const t = timeOf(minutesOf(eta) + m);
          return <Cell key={m} label={m === 0 ? `立即送出（约${t}）` : t} arrow={false} onClick={() => { setExtras((e) => ({ ...e, time: m === 0 ? null : t })); setSheet(null); }} />;
        })}
      </Sheet>
    </div>
  );
}

function NoteEditor({ shopId }: { shopId: string }) {
  const w = useWorld();
  const nav = useAppNav(APP);
  const [extras, setExtras] = useExtras(shopId);
  const [tags, setTags] = useState(extras.tags);
  const [note, setNote] = useState(extras.note);
  return (
    <div className="ph-col food" data-testid="food-note-page">
      <AppBar
        title="添加备注"
        onBack={nav.pop}
        right={
          <button type="button" className="ph-bar-text" onClick={() => { setExtras((e) => ({ ...e, tags, note: note.trim() })); nav.pop(); }} data-testid="food-note-done">
            完成
          </button>
        }
      />
      <Body className="ph-pad">
        <div className="food-note-box">
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 50))} placeholder="请输入口味、偏好等要求，不支持额外加菜哦" lang="zh-CN" data-testid="food-note-text" />
          <small>{note.length}/50</small>
        </div>
        <div className="ph-section-title">快捷标签</div>
        <div className="ph-chips">
          {(w.note_tags ?? DEFAULT_NOTE_TAGS).map((t) => (
            <Chip key={t} on={tags.includes(t)} accent="#e09b00" onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))} testId="food-note-tag">
              {t}
            </Chip>
          ))}
        </div>
      </Body>
    </div>
  );
}

function Addresses({ fromCheckout }: { fromCheckout: boolean }) {
  const nav = useAppNav(APP);
  const list = useAddresses();
  const [addr, select] = useSelectedAddress();
  return (
    <div className="ph-col food" data-testid="food-addresses">
      <AppBar title="选择收货地址" onBack={nav.pop} />
      <Body>
        {list.length === 0 && <Empty icon="📍" text="还没有收货地址" />}
        {list.map((a) => (
          <button key={a.id} type="button" className={`food-addr-row${addr?.id === a.id ? ' on' : ''}`} onClick={() => { select(a.id); nav.pop(); }} data-testid="food-addr-row" data-addr={a.id}>
            <span>
              <b>
                {a.label && <i className="ph-tag">{a.label}</i>}
                {addressLine(a)}
              </b>
              <small>
                {a.name} {a.phone}
              </small>
            </span>
            <span>{addr?.id === a.id ? '✓' : ''}</span>
          </button>
        ))}
      </Body>
      <div className="ph-footer">
        <Btn block accent={ACCENT} style={{ color: INK }} onClick={() => nav.push('address_add', fromCheckout ? { back: 'checkout' } : {})} testId="food-addr-add">
          ＋ 新增收货地址
        </Btn>
      </div>
    </div>
  );
}

function AddAddress({ backToCheckout }: { backToCheckout: boolean }) {
  const p = usePhone();
  const nav = useAppNav(APP);
  const [, select] = useSelectedAddress();
  const [f, setF] = useState({ name: '', title: '先生', phone: '', detail: '', room: '', label: '' as '' | '家' | '公司' | '学校' });
  const save = () => {
    const problem = !f.detail.trim() ? '请填写收货地址' : !f.room.trim() ? '请填写门牌号' : !f.name.trim() ? '请填写联系人' : !validPhone(f.phone) ? ZH.badPhone : null;
    if (problem) {
      p.emit({ type: 'error', code: 'address_form', app: APP });
      return p.toast(problem);
    }
    const id = `addr_${recordsOf(p.events, 'food_address').length + 1}`;
    p.write('food_address', id, { id, detail: f.detail.trim(), room: f.room.trim(), name: `${f.name.trim()}（${f.title}）`, phone: f.phone, label: f.label || undefined });
    select(id);
    p.toast('保存成功');
    nav.pop();
    // Added from the checkout: straight back to it with the new address chosen.
    if (backToCheckout) nav.pop();
  };
  return (
    <div className="ph-col food" data-testid="food-address-form">
      <AppBar title="新增收货地址" onBack={nav.pop} />
      <Body>
        <Group>
          <Field label="收货地址" value={f.detail} onChange={(v) => setF({ ...f, detail: v })} placeholder="小区/写字楼/学校等" mic testId="food-addr-detail" />
          <Field label="门牌号" value={f.room} onChange={(v) => setF({ ...f, room: v })} placeholder="例：3号楼1202室" testId="food-addr-room" />
          <Field label="联系人" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="请填写收货人的姓名" testId="food-addr-name" />
          <div className="ph-field">
            <span className="ph-field-label" />
            <span className="ph-chips">
              {['先生', '女士'].map((t) => (
                <Chip key={t} on={f.title === t} accent="#e09b00" onClick={() => setF({ ...f, title: t })}>
                  {t}
                </Chip>
              ))}
            </span>
          </div>
          <Field label="手机号" value={f.phone} onChange={(v) => setF({ ...f, phone: v.replace(/\D/g, '').slice(0, 11) })} placeholder="请填写收货手机号" type="tel" testId="food-addr-phone" />
          <div className="ph-field">
            <span className="ph-field-label">标签</span>
            <span className="ph-chips">
              {(['家', '公司', '学校'] as const).map((t) => (
                <Chip key={t} on={f.label === t} accent="#e09b00" onClick={() => setF({ ...f, label: f.label === t ? '' : t })} testId="food-addr-label">
                  {t}
                </Chip>
              ))}
            </span>
          </div>
        </Group>
      </Body>
      <div className="ph-footer">
        <Btn block accent={ACCENT} style={{ color: INK }} onClick={save} testId="food-addr-save">
          保存地址
        </Btn>
      </div>
    </div>
  );
}

const STEP_MS: Partial<Record<FoodStatus, number>> = { paid: 2000, accepted: 2500, cooking: 3500, picked_up: 3000, delivering: 4000 };

function OrderPage({ id }: { id: string }) {
  const p = usePhone();
  const w = useWorld();
  const nav = useAppNav(APP);
  const r = recordsOf(p.events, 'food_order').find((x) => x.id === id);
  const o = r?.data;
  const status = o?.status as FoodStatus | undefined;
  const rider = usePersona(w.rider_persona);
  const dropped = p.events.find((e) => e.type === 'persona.action' && e.persona === w.rider_persona && e.action === 'drop_off');
  useEffect(() => {
    if (!status || !STEP_MS[status]) return;
    // The rider at the gate waits for an answer before the order can be delivered.
    if (status === 'delivering' && w.rider_persona && !dropped) return;
    const t = window.setTimeout(() => {
      const next = FOOD_TIMELINE[FOOD_TIMELINE.indexOf(status) + 1];
      if (!next) return;
      p.write('food_order', id, { status: next });
      if (next === 'accepted') p.notify({ app: APP, title: '商家已接单', body: `${String(o!.shop)}正在为您备餐`, open: { app: APP, screen: 'order', params: { id } } });
      if (next === 'picked_up') p.notify({ app: APP, title: '骑手已取餐', body: '骑手正在火速赶来，请保持电话畅通', open: { app: APP, screen: 'order', params: { id } } });
      if (next === 'delivering' && w.rider_persona) {
        rider.start();
        const opening = rider.persona?.opening;
        if (opening) p.notify({ app: APP, title: rider.persona!.name, body: opening, open: { app: APP, screen: 'chat', params: { persona: w.rider_persona } } });
      }
      if (next === 'delivered') p.notify({ app: APP, title: '订单已送达', body: dropped ? `您的外卖已放在${String((dropped.params as Record<string, string>)?.place ?? '指定位置')}，祝您用餐愉快` : '祝您用餐愉快，记得给骑手好评哦' });
    }, status === 'delivering' && dropped ? 2500 : STEP_MS[status]);
    return () => window.clearTimeout(t);
    // The status (and the rider's answer) move the order on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, !!dropped, id]);
  const unread = rider.lines.filter((l) => l.from === 'them').length;
  if (!o) return <Empty text="订单不存在" />;
  const lines = o.lines as Array<{ name: string; qty: number; options: string[] }>;
  const idx = FOOD_TIMELINE.indexOf(status!);
  const context = `外卖订单：${String(o.shop)}，送到${String(o.address)}；状态：${FOOD_STATUS_ZH[status!]}`;
  return (
    <div className="ph-col food" data-testid="food-order" data-status={status}>
      <AppBar title="订单详情" onBack={nav.home} />
      <Body>
        <div className="food-order-head" style={{ background: ACCENT }}>
          <b data-testid="food-order-status">{FOOD_STATUS_ZH[status!]}</b>
          {status !== 'delivered' && status !== 'unpaid' && <small>预计{String(o.deliver_at ?? '')}送达</small>}
          {status === 'unpaid' && (
            <Btn
              small
              kind="line"
              testId="food-pay-again"
              onClick={async () => {
                const res = await p.pay({ app: APP, title: String(o.shop), payee: '饭点外卖', amount: Number(o.total) });
                if (res) p.write('food_order', id, { status: 'paid', paid_at: Date.now(), pay_method: res.method });
              }}
            >
              去支付
            </Btn>
          )}
        </div>
        {idx >= 0 && (
          <div className="food-timeline">
            {FOOD_TIMELINE.map((s, i) => (
              <span key={s} className={i <= idx ? 'on' : ''}>
                <i />
                {FOOD_STATUS_ZH[s].replace('订单', '')}
              </span>
            ))}
          </div>
        )}
        {['picked_up', 'delivering', 'delivered'].includes(String(status)) && (
          <div className="food-rider" data-testid="food-rider">
            <span className="food-rider-av">🛵</span>
            <span>
              <b>{rider.persona?.name ?? '骑手小王'}</b>
              <small>饭点专送</small>
            </span>
            <button type="button" onClick={() => (w.rider_persona ? nav.push('chat', { persona: w.rider_persona, context }) : p.toast('骑手正在送餐中，请稍后'))} data-testid="food-rider-chat">
              💬{unread > 0 && <i className="wx-badge">{unread}</i>}
            </button>
            <button type="button" onClick={() => p.toast('正在通过隐私号码呼叫…对方正在通话中')}>📞</button>
          </div>
        )}
        <Group title={String(o.shop)}>
          {lines.map((l, i) => (
            <div key={i} className="food-co-line">
              <span>
                <b>{l.name}</b>
                {l.options.length > 0 && <small>{l.options.join('/')}</small>}
              </span>
              <span>×{l.qty}</span>
            </div>
          ))}
          <Cell label="实付" value={<Price value={Number(o.total)} />} arrow={false} />
        </Group>
        <Group title="配送信息">
          <Cell label="收货地址" value={String(o.address)} arrow={false} />
          <Cell label="备注" value={String(o.note || '无')} arrow={false} />
          <Cell label="餐具" value={String(o.cutlery)} arrow={false} />
          <Cell label="订单号" value={id.replace('F', '2610290')} arrow={false} />
        </Group>
      </Body>
    </div>
  );
}

function RiderChat({ personaId, context }: { personaId: string; context: string }) {
  const nav = useAppNav(APP);
  const p = usePhone();
  const name = p.spec.personas?.find((x) => x.id === personaId)?.name ?? '骑手';
  return <AppChat personaId={personaId} title={name} subtitle="饭点专送" context={context} accent="#e09b00" avatar="骑" onBack={nav.pop} quick={['好的，谢谢', '我马上下来', '放门口就行', '麻烦快一点']} />;
}

function FoodOrders() {
  const p = usePhone();
  const nav = useAppNav(APP);
  const list = useMemo(() => recordsOf(p.events, 'food_order').reverse(), [p.events]);
  return (
    <Body testId="food-orders">
      <AppBar title="订单" />
      {list.length === 0 ? (
        <Empty icon="🥡" text="还没有订单，快去点一份吧" />
      ) : (
        list.map((r) => (
          <button key={r.id} type="button" className="food-order-row" onClick={() => nav.push('order', { id: r.id })} data-testid="food-order-row">
            <span>
              <b>{String(r.data.shop)}</b>
              <small>{(r.data.lines as Array<{ name: string; qty: number }>).map((l) => `${l.name}×${l.qty}`).join('，')}</small>
            </span>
            <span>
              <small>{FOOD_STATUS_ZH[r.data.status as FoodStatus]}</small>
              <Price value={Number(r.data.total)} />
            </span>
          </button>
        ))
      )}
    </Body>
  );
}
