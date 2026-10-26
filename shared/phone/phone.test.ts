import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SCENARIOS,
  bundledScenario,
  checkCondition,
  durationBucket,
  goalStates,
  isComplete,
  matches,
  mistakesMade,
  nextHintIndex,
  phoneClock,
  recordsFrom,
  scenarioResult,
  seedEvents,
  snapshot,
  validateScenarioSpec,
  type PhoneEvent,
  type ScenarioSpec,
} from './index';
import { assignSeats, changeOptions, findTrain, passengerProblems, railOrderData, refundFee, searchStations, searchTrains, seatsLeft, seatsTogether, validChineseId } from './rail';
import { cartTotals, changeCart, foodOrderData, minOrderGap, optionProblems, pickedList, unitPrice, type CartLine } from './food';
import { movieOrderData, seatsAdjacent, singleGapProblem, soldSeats, toggleSeat } from './movie';
import { bestCoupon, estimatePrice, searchPois } from './ride';
import { amountKey, defaultMethod, transferProblem, walletBalances } from './wallet';
import { bookingProblems, queueTableFor, queueTicket } from './dine';
import { fakePersonaReply, normalizePersonaReply, personaSystemPrompt, personaUserTurn } from './persona';
import { zhDateLabel, zhDuration, spanMinutes } from './dates';

const scenario = (id: string): ScenarioSpec => {
  const s = bundledScenario(id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
};

let at = 1000;
const rec = (record: string, id: string, data: Record<string, unknown>): PhoneEvent => ({ type: 'record', record, id, data, at: at++ });
const ev = (type: string, extra: Record<string, unknown> = {}): PhoneEvent => ({ type, at: at++, ...extra });

describe('bundled scenarios', () => {
  it('has at least 12 scenarios with unique ids, each app with an easy one', () => {
    expect(BUNDLED_SCENARIOS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BUNDLED_SCENARIOS.map((s) => s.id)).size).toBe(BUNDLED_SCENARIOS.length);
    for (const app of ['rail', 'ride', 'food', 'chat', 'movie', 'dine']) {
      expect(BUNDLED_SCENARIOS.some((s) => s.apps[0] === app && s.difficulty === 'easy')).toBe(true);
    }
  });

  it.each(BUNDLED_SCENARIOS.map((s) => [s.id, s] as const))('%s passes validateScenarioSpec', (_id, s) => {
    expect(validateScenarioSpec(s)).toEqual([]);
  });

  it.each(BUNDLED_SCENARIOS.map((s) => [s.id, s] as const))('%s is not complete before anything happens', (_id, s) => {
    expect(isComplete(s, seedEvents(s, 0))).toBe(false);
  });

  it('keeps English out of the simulated UI data (world strings are Chinese or ids / numbers)', () => {
    for (const s of BUNDLED_SCENARIOS) {
      const strings: string[] = [];
      const walk = (v: unknown, key = '') => {
        if (typeof v === 'string') {
          if (!['id', 'contact', 'film', 'cinema', 'persona', 'app', 'to_id', 'kind', 'format', 'pinyin', 'original', 'cast', 'arrival_persona', 'rider_persona', 'type', 'label', 'from', 'status'].includes(key) && !/^(p_|addr_|shop_|tea_|c_|f_|s_|r_|trip_|hq_|rp|card)/.test(v)) strings.push(v);
        } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
      };
      walk(s.world);
      // Passport names (TAYLOR SAM) are Latin on the real forms too.
      const english = strings.filter((x) => /[A-Za-z]{4,}/.test(x) && !/[一-鿿]/.test(x) && !/^[A-Z ]+$/.test(x));
      expect(english, s.id).toEqual([]);
    }
  });
});

describe('matchers and conditions', () => {
  it('compares values, lists and operators', () => {
    expect(matches('G7311', 'G7311')).toBe(true);
    expect(matches(['a', 'b'], 'b')).toBe(true);
    expect(matches(86, '86')).toBe(true);
    expect(matches('10:45', { gte: '10:30', lte: '11:00' })).toBe(true);
    expect(matches('11:05', { gte: '10:30', lte: '11:00' })).toBe(false);
    expect(matches(['中辣', '加蛋', '细面'], { has_all: ['中辣', '加蛋'] })).toBe(true);
    expect(matches(['中辣'], { has_all: ['中辣', '加蛋'] })).toBe(false);
    expect(matches('不要香菜，少辣', { contains: '香菜' })).toBe(true);
    expect(matches([{ name: 'x', options: ['少冰'] }], { some: { match: { name: 'x', options: '少冰' } } })).toBe(true);
    expect(matches(['A'], { size: 1 })).toBe(true);
    expect(matches(undefined, { exists: false })).toBe(true);
  });

  it('uses the latest version of each record', () => {
    const events = [rec('rail_order', 'o1', { status: 'paid', train_no: 'G1' }), rec('rail_order', 'o1', { status: 'refunded' })];
    const recs = recordsFrom(events);
    expect(recs).toHaveLength(1);
    expect(recs[0].data).toEqual({ status: 'refunded', train_no: 'G1' });
    expect(checkCondition({ kind: 'record', record: 'rail_order', where: { status: 'paid' } }, snapshot(events))).toBe(false);
  });

  it('combines conditions', () => {
    const s = snapshot([ev('persona.action', { persona: 'driver', action: 'found_passenger', params: { where: '北门' } })]);
    expect(checkCondition({ kind: 'event', event: 'persona.action', where: { 'params.where': { contains: '北' } } }, s)).toBe(true);
    expect(checkCondition({ kind: 'not', condition: { kind: 'event', event: 'persona.action' } }, s)).toBe(false);
    expect(checkCondition({ kind: 'any_of', conditions: [{ kind: 'record', record: 'transfer' }, { kind: 'event', event: 'persona.action' }] }, s)).toBe(true);
    expect(checkCondition({ kind: 'event', event: 'persona.action', count: 2 }, s)).toBe(false);
  });
});

describe('validateScenarioSpec', () => {
  it('reports broken references and conditions', () => {
    const s = structuredClone(scenario('rail-hangzhou-saturday')) as ScenarioSpec;
    s.world.rail!.trains[0].from = '火星站';
    s.goals[0].condition = { kind: 'record', record: 'rocket_order' } as never;
    s.wallet.pay_password = '12';
    const problems = validateScenarioSpec(s);
    expect(problems.some((p) => p.includes('world.rail.trains[0].from'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown record "rocket_order"'))).toBe(true);
    expect(problems.some((p) => p.startsWith('wallet.pay_password'))).toBe(true);
  });

  it('requires the world of every app and the persona a goal waits for', () => {
    const s = structuredClone(scenario('ride-north-gate')) as ScenarioSpec;
    s.personas![0].actions = [];
    delete s.personas![0].fake_action;
    const problems = validateScenarioSpec({ ...s, apps: ['ride', 'movie'] });
    expect(problems).toContain('world.movie: required because apps includes "movie"');
    expect(problems.some((p) => p.includes('has no action "found_passenger"'))).toBe(true);
    expect(validateScenarioSpec('nope')).toEqual(['spec: must be an object']);
  });
});

describe('rail', () => {
  const s = scenario('rail-hangzhou-saturday');
  const world = s.world.rail!;

  it('finds stations by 汉字, pinyin and 简拼', () => {
    expect(searchStations(world.stations, '虹桥').map((x) => x.name)).toEqual(['上海虹桥']);
    expect(searchStations(world.stations, 'hangzhoud').map((x) => x.name)).toEqual(['杭州东']);
    expect(searchStations(world.stations, 'shhq').map((x) => x.name)).toEqual(['上海虹桥']);
  });

  it('lists the day\'s trains in departure order; a city search includes every station', () => {
    expect(searchTrains(world, '上海虹桥', '杭州东', '2026-10-31').map((t) => t.no)).toEqual(['G7501', 'D3125', 'G7311', 'G1655', 'G7355', 'G7319']);
    expect(searchTrains(world, '上海', '杭州', '2026-10-31').map((t) => t.no)).toContain('K1805');
    expect(searchTrains(world, '上海虹桥', '杭州东', '2026-10-31', { highSpeedOnly: true, availableOnly: true }).map((t) => t.no)).not.toContain('K1805');
  });

  it('assigns window seats when chosen and counts seats left', () => {
    const t = findTrain(world, 'G7311', '2026-10-31')!;
    const seats = assignSeats(t, '二等座', 1, ['F'], 'x1');
    expect(seats[0]).toMatch(/^0[4-8]车\d\dF$/);
    expect(assignSeats(t, '二等座', 2, [], 'x1').every((x) => !/[AF]$/.test(x))).toBe(true);
    expect(seatsTogether(['05车07D', '05车07F'])).toBe(true);
    expect(seatsTogether(['05车07C', '05车07D'])).toBe(false);
    const order = rec('rail_order', 'r1', railOrderData({ train: t, seatClass: '二等座', passengers: world.passengers, seats, orderId: 'r1', orderNo: 'E1', status: 'paid' }));
    expect(seatsLeft(t, '二等座', recordsFrom([order]))).toBe(13);
  });

  it('checks passengers like the real form', () => {
    expect(passengerProblems({ id_type: '护照', name: 'SMITH ANNA', id_no: '533812940' })).toEqual(['请选择国家/地区']);
    expect(passengerProblems({ id_type: '护照', name: '', id_no: '1', country: '英国' })).toEqual(['请输入姓名', '请输入正确的证件号码']);
    expect(passengerProblems({ id_type: '护照', name: 'X Y', id_no: world.passengers[0].id_no, country: '英国' }, world.passengers)).toContain('该乘车人已存在，请勿重复添加');
    expect(validChineseId('11010519491231002X')).toBe(true);
    expect(validChineseId('110105194912310021')).toBe(false);
  });

  it('charges the real 退票 fee by hours before departure', () => {
    expect(refundFee(134.5, '2026-10-29', '16:00', '2026-10-30', '18:30')).toBe(13); // 26.5 h → 10 %, rounded down to 0.5
    expect(refundFee(134.5, '2026-10-29', '16:00', '2026-10-30', '08:00')).toBe(26.5); // 16 h → 20 %
    expect(refundFee(73, '2026-10-20', '10:00', '2026-10-31', '09:12')).toBe(0); // ≥ 8 days
    expect(refundFee(30, '2026-10-29', '10:00', '2026-10-31', '12:00')).toBe(2); // 5 % = 1.5 → at least 2
    expect(refundFee(73, '2026-10-31', '10:00', '2026-10-31', '09:12')).toBeNull();
  });

  it('offers 改签 trains on the same route only', () => {
    const w = scenario('rail-change-refund').world.rail!;
    const opts = changeOptions(w, { train_no: 'G7012', date: '2026-10-30', from: '上海虹桥', to: '南京南' }, '2026-10-29', '16:00');
    expect(opts.map((t) => t.no)).toEqual(['G7022', 'G7036', 'G7048', 'G7062', 'G7080', 'D3011']);
  });

  it('formats durations and dates', () => {
    expect(zhDuration(spanMinutes('09:12', '10:05'))).toBe('0小时53分');
    expect(zhDateLabel('2026-10-31')).toBe('10月31日 周六');
  });
});

describe('food', () => {
  const shop = scenario('food-beef-noodles').world.food!.shops[0];
  const noodle = shop.menu[0].items[0];

  it('needs the required 规格 and prices the extras', () => {
    expect(optionProblems(noodle, {})).toEqual(['请选择辣度', '请选择面型']);
    const picks = { 辣度: ['中辣'], 面型: ['细面'], 加料: ['加蛋'] };
    expect(optionProblems(noodle, picks)).toEqual([]);
    expect(unitPrice(noodle, picks)).toBe(24);
    expect(pickedList(noodle, picks)).toEqual(['中辣', '细面', '加蛋']);
  });

  it('adds up 起送, 满减, 红包, 包装费 and 配送费', () => {
    let cart: CartLine[] = [];
    cart = changeCart(cart, noodle, ['中辣', '细面', '加蛋'], 24, 1);
    expect(minOrderGap(shop, cart)).toBe(0);
    expect(cartTotals(shop, cart, [{ id: 'rp3', name: '平台红包', amount: 3, threshold: 20 }])).toMatchObject({ items: 24, packing: 1, discount: 0, red_packet: 3, total: 25 });
    cart = changeCart(cart, noodle, ['中辣', '细面', '加蛋'], 24, 1);
    expect(cartTotals(shop, cart)).toMatchObject({ items: 48, packing: 2, discount: 10, total: 43 });
    cart = changeCart(cart, noodle, ['中辣', '细面', '加蛋'], 24, -2);
    expect(cart).toEqual([]);
  });
});

describe('movie seat map', () => {
  const map = { rows: 3, cols: 8, aisles_after: [], sold: ['2-1'], couple: ['3-1', '3-3'] };
  const sold = new Set(map.sold);

  it('refuses a lone empty seat beside the selection and caps at 4', () => {
    expect(singleGapProblem(map, sold, ['2-3'])).toBe('座位旁边不要留下单个空座哦'); // 2-2 left alone between sold 2-1 and 2-3
    expect(singleGapProblem(map, sold, ['2-2', '2-3'])).toBeNull();
    expect(singleGapProblem(map, sold, ['1-5', '1-6'])).toBeNull();
    let sel: string[] = [];
    for (const id of ['1-1', '1-2', '1-3', '1-4']) sel = toggleSeat(map, sold, sel, id).selected;
    expect(toggleSeat(map, sold, sel, '1-5').problem).toBe('一次最多选择4个座位');
  });

  it('takes couple seats in pairs and knows side-by-side seats', () => {
    expect(toggleSeat(map, sold, [], '3-2').selected).toEqual(['3-1', '3-2']);
    expect(toggleSeat(map, sold, ['3-1', '3-2'], '3-1').selected).toEqual([]);
    expect(seatsAdjacent(map, ['1-4', '1-5'])).toBe(true);
    expect(seatsAdjacent({ ...map, aisles_after: [4] }, ['1-4', '1-5'])).toBe(false);
  });
});

describe('ride, wallet, dine', () => {
  it('estimates prices and finds POIs', () => {
    const w = scenario('ride-hongqiao-station').world.ride!;
    expect(estimatePrice(w.cars[1], 18.6)).toBe(56.8);
    expect(searchPois(w.pois, '虹桥站')[0].id).toBe('hq_station');
    expect(bestCoupon(w.coupons, '快车', 56.8)?.amount).toBe(5);
    expect(bestCoupon(w.coupons, '特惠快车', 56.8)).toBeNull();
  });

  it('keeps wallet balances from the log and the amount pad rules', () => {
    const s = scenario('chat-landlord');
    const events = [rec('payment', 'pay1', { amount: 100, method: 'balance', direction: 'out', status: 'paid' })];
    expect(walletBalances(s.wallet, events).balance).toBe(400);
    expect(defaultMethod(s.wallet, events, 6500)).toBe('card1');
    expect(amountKey('18', '.')).toBe('18.');
    expect(amountKey('18.55', '5')).toBe('18.55');
    expect(amountKey('0', '7')).toBe('7');
    expect(transferProblem(250, 'red_packet')).toBe('单个红包金额不可超过200元');
    expect(transferProblem(18.5, 'transfer')).toBeNull();
  });

  it('picks the queue table and checks a booking', () => {
    const r = scenario('dine-queue-shengjian').world.dine!.restaurants[0];
    const t = queueTableFor(r.queue!, 2)!;
    expect(t.id).toBe('A');
    expect(queueTicket(t, 0)).toMatchObject({ number: 'A027', ahead: 8 });
    const b = scenario('dine-book-saturday').world.dine!.restaurants[0];
    expect(bookingProblems(b, { date: '2026-10-31', time: '18:30', people: 4, name: 'Taylor', phone: '13916582047' })).toEqual(['该时段已订满，请选择其他时间']);
    expect(bookingProblems(b, { date: '2026-10-31', time: '19:00', people: 4, area: '包间', name: 'Taylor', phone: '13916582047' })).toEqual(['包间6人起订']);
  });
});

describe('persona', () => {
  const s = scenario('ride-north-gate');
  const p = s.personas![0];

  it('builds a prompt with the role, facts, safety rule and actions', () => {
    const sys = personaSystemPrompt(s, p);
    expect(sys).toContain('王师傅');
    expect(sys).toContain('招手打车');
    expect(sys).toContain('found_passenger');
    expect(sys).toContain('personal data');
    expect(personaUserTurn(p, [{ from: 'them', text: '您在哪个门？' }, { from: 'me', text: '我在北门' }], '订单：特惠快车')).toContain('Learner: 我在北门');
  });

  it('keeps only declared actions and params', () => {
    const r = normalizePersonaReply({ reply: '好的，马上到。', english: 'OK', actions: [{ name: 'found_passenger', params: { where: '北门', evil: 'x' } }, { name: 'refund_everything' }] }, p);
    expect(r.actions).toEqual([{ name: 'found_passenger', params: { where: '北门' } }]);
    expect(() => normalizePersonaReply({ reply: 'OK', english: '', actions: [] }, p)).toThrow();
  });

  it('has a deterministic stand-in', () => {
    expect(fakePersonaReply(p, [{ from: 'me', text: 'hello' }]).actions).toEqual([]);
    expect(fakePersonaReply(p, [{ from: 'me', text: '我在北门' }]).actions).toEqual([{ name: 'found_passenger', params: { where: '北门' } }]);
  });
});

// ---------------------------------------------------------------------------
// Each scenario's goals hold on the log its golden path writes (record shapes from the builders the apps use).
// ---------------------------------------------------------------------------

describe('golden paths complete every scenario', () => {
  it('rail-hangzhou-saturday', () => {
    const s = scenario('rail-hangzhou-saturday');
    const w = s.world.rail!;
    const t = findTrain(w, 'G7311', '2026-10-31')!;
    const seats = assignSeats(t, '二等座', 1, ['F'], 'R001');
    const events = [rec('rail_order', 'R001', railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0]], seats, orderId: 'R001', orderNo: 'E1', status: 'paid' }))];
    expect(isComplete(s, events)).toBe(true);
    expect(goalStates(s, events).every((g) => g.done)).toBe(true);
    expect(mistakesMade(s, events)).toEqual([]);
    const wrong = [rec('rail_order', 'R002', railOrderData({ train: findTrain(w, 'G7311', '2026-10-30')!, seatClass: '二等座', passengers: [w.passengers[0]], seats, orderId: 'R002', orderNo: 'E2', status: 'paid' }))];
    expect(isComplete(s, wrong)).toBe(false);
    expect(mistakesMade(s, wrong).map((m) => m.id)).toEqual(['date']);
  });

  it('rail-friend-passport', () => {
    const s = scenario('rail-friend-passport');
    const w = s.world.rail!;
    const anna = { id: 'p2', name: 'SMITH ANNA', id_type: '护照' as const, id_no: '533812940', country: '英国' };
    const t = findTrain(w, 'C2023', '2026-11-01')!;
    const seats = assignSeats(t, '二等座', 2, ['D', 'F'], 'R001');
    const events = [rec('rail_passenger', 'p2', anna), rec('rail_order', 'R001', railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0], anna], seats, orderId: 'R001', orderNo: 'E1', status: 'paid' }))];
    expect(goalStates(s, events).map((g) => [g.goal.id, g.done])).toEqual([['tickets', true], ['anna', true], ['together', true]]);
  });

  it('rail-change-refund', () => {
    const s = scenario('rail-change-refund');
    const w = s.world.rail!;
    const seed = seedEvents(s, 0);
    expect(seed).toHaveLength(2);
    const t = findTrain(w, 'G7062', '2026-10-30')!;
    const events = [
      ...seed,
      rec('rail_order', 'o1', { status: 'changed' }),
      rec('rail_order', 'R001', railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0]], seats: ['05车03A'], orderId: 'R001', orderNo: 'E9', status: 'paid', changedFrom: 'o1' })),
      rec('rail_order', 'o2', { status: 'refunded', refund_fee: 13 }),
    ];
    expect(isComplete(s, events)).toBe(true);
    expect(mistakesMade(s, events)).toEqual([]);
  });

  it('ride scenarios', () => {
    const s1 = scenario('ride-hongqiao-station');
    expect(isComplete(s1, [rec('ride_order', 'D1', { to_id: 'hq_station', car_type: '快车', status: 'paid', rating: 5 })])).toBe(true);
    const s2 = scenario('ride-north-gate');
    const e2 = [rec('ride_order', 'D1', { to_id: 'bund', car_type: '特惠快车', status: 'accepted' }), ev('persona.action', { persona: 'driver', action: 'found_passenger', params: { where: '北门' } }), rec('ride_order', 'D1', { status: 'paid' })];
    expect(isComplete(s2, e2)).toBe(true);
    const s3 = scenario('ride-lost-item');
    expect(isComplete(s3, [ev('persona.action', { persona: 'lost_driver', action: 'arrange_return', params: { place: '酒店前台', time: '中午' } })])).toBe(true);
  });

  it('food scenarios', () => {
    const s1 = scenario('food-beef-noodles');
    const shop = s1.world.food!.shops[0];
    const noodle = shop.menu[0].items[0];
    const cart = changeCart([], noodle, ['中辣', '细面', '加蛋'], 24, 1);
    const data = foodOrderData({ shop, cart, totals: cartTotals(shop, cart), note: '', noteTags: ['不要香菜'], cutlery: '无需餐具', address: s1.world.food!.addresses[0], orderId: 'F001', status: 'paid' });
    expect(isComplete(s1, [rec('food_order', 'F001', data)])).toBe(true);
    expect(goalStates(s1, [rec('food_order', 'F001', data)]).every((g) => g.done)).toBe(true);

    const s2 = scenario('food-team-lunch');
    const lunch = s2.world.food!.shops[0];
    const [gongbao, yuxiang, fanqie] = lunch.menu[0].items;
    let c: CartLine[] = changeCart([], gongbao, ['微辣'], 23, 1);
    c = changeCart(c, yuxiang, [], 22, 1);
    c = changeCart(c, fanqie, [], 19, 1);
    const totals = cartTotals(lunch, c, s2.world.food!.red_packets);
    expect(totals).toMatchObject({ discount: 12, red_packet: 6, total: 54.5 });
    expect(isComplete(s2, [rec('food_order', 'F001', foodOrderData({ shop: lunch, cart: c, totals, note: '', noteTags: [], cutlery: '3份', address: s2.world.food!.addresses[0], orderId: 'F001', status: 'paid' }))])).toBe(true);
    const noRed = cartTotals(lunch, c, s2.world.food!.red_packets, null);
    expect(noRed.total).toBe(60.5);

    const s3 = scenario('food-milk-tea-rider');
    const tea = s3.world.food!.shops.find((x) => x.id === 'tea_fresh')!;
    const yzgl = tea.menu[0].items[0];
    const tc = changeCart([], yzgl, ['半糖', '少冰'], 19, 1);
    const home = { id: 'addr_1', label: '家', detail: '静安区愚园路68弄 梧桐公寓', room: '3号楼1202室' };
    const e3 = [
      rec('food_address', 'addr_1', { ...home, name: 'Sam', phone: '13916582047' }),
      rec('food_order', 'F001', foodOrderData({ shop: tea, cart: tc, totals: cartTotals(tea, tc), note: '', noteTags: [], cutlery: '无需餐具', address: home, orderId: 'F001', status: 'paid' })),
      ev('persona.action', { persona: 'rider', action: 'drop_off', params: { place: '门卫室' } }),
    ];
    expect(isComplete(s3, e3)).toBe(true);
  });

  it('movie scenarios', () => {
    const s1 = scenario('movie-tonight-two');
    const w1 = s1.world.movie!;
    const show = w1.shows.find((x) => x.start === '21:45')!;
    const sold = soldSeats(show);
    // Two free seats side by side that leave no lone gap.
    let pair: string[] | null = null;
    for (let r = 1; r <= show.seats.rows && !pair; r++)
      for (let c = 2; c < show.seats.cols && !pair; c++) {
        const ids = [`${r}-${c}`, `${r}-${c + 1}`];
        if (ids.some((i) => sold.has(i)) || !seatsAdjacent(show.seats, ids) || singleGapProblem(show.seats, sold, ids)) continue;
        pair = ids;
      }
    expect(pair).not.toBeNull();
    expect(isComplete(s1, [rec('movie_order', 'M1', movieOrderData({ world: w1, show, seatIds: pair!, snacks: [], orderId: 'M1', status: 'paid' }))])).toBe(true);

    const s2 = scenario('movie-imax-english');
    const w2 = s2.world.movie!;
    const best = w2.shows.find((x) => x.id === 's_harbor_times_1030_1350')!;
    const free = [...Array(best.seats.cols).keys()].map((c) => `6-${c + 1}`).find((id) => !soldSeats(best).has(id))!;
    expect(isComplete(s2, [rec('movie_order', 'M1', movieOrderData({ world: w2, show: best, seatIds: [free], snacks: [], orderId: 'M1', status: 'paid' }))])).toBe(true);

    const s3 = scenario('movie-couple-popcorn');
    const w3 = s3.world.movie!;
    const eve = w3.shows.find((x) => x.start === '19:30')!;
    const couple = eve.seats.couple!.find((id) => !soldSeats(eve).has(id))!;
    const ids = toggleSeat(eve.seats, soldSeats(eve), [], couple).selected;
    expect(ids).toHaveLength(2);
    const data = movieOrderData({ world: w3, show: eve, seatIds: ids, snacks: [{ name: '双人套餐', price: 46, qty: 1 }], orderId: 'M1', status: 'paid' });
    expect(isComplete(s3, [rec('movie_order', 'M1', data)])).toBe(true);
  });

  it('dine scenarios', () => {
    expect(isComplete(scenario('dine-queue-shengjian'), [rec('dine_queue', 'Q1', { restaurant_id: 'r_shengjian', people: 2, table_id: 'A', status: 'waiting' })])).toBe(true);
    expect(isComplete(scenario('dine-book-saturday'), [rec('dine_booking', 'B1', { restaurant_id: 'r_benbang', date: '2026-10-31', time: '19:00', people: 4, area: '大厅', phone: '13916582047', status: 'pending' })])).toBe(true);
    expect(
      isComplete(scenario('dine-birthday-room'), [
        rec('dine_booking', 'B1', { restaurant_id: 'r_yaji', date: '2026-10-30', time: '19:00', people: 6, area: '包间', status: 'confirmed' }),
        ev('persona.action', { persona: 'host', action: 'confirm_request', params: { arrangement: '自带蛋糕' } }),
      ]),
    ).toBe(true);
  });

  it('chat scenarios', () => {
    expect(isComplete(scenario('chat-pay-back'), [rec('transfer', 'T1', { to_id: 'xiaolin', kind: 'transfer', amount: 86, note: '饭钱' })])).toBe(true);
    expect(isComplete(scenario('chat-fruit-qr'), [rec('qr_payment', 'Q1', { qr_id: 'stall_pay', amount: 18.5 }), rec('red_packet_opened', 'xiaolin-1', { from_id: 'xiaolin', amount: 16.8 })])).toBe(true);
    expect(isComplete(scenario('chat-landlord'), [ev('persona.action', { persona: 'landlord', action: 'agree_early', params: { time: '周五下午两点' } }), rec('transfer', 'T1', { to_id: 'landlord', kind: 'transfer', amount: 6500, note: '押金' })])).toBe(true);
  });
});

describe('hints, results, clock', () => {
  const s = scenario('rail-hangzhou-saturday');

  it('offers hints in order and skips ones already done', () => {
    expect(nextHintIndex(s, [], 0)).toBe(0);
    expect(nextHintIndex(s, [], 2)).toBe(2);
    expect(nextHintIndex(s, [], s.hints.length)).toBeNull();
  });

  it('summarises a play', () => {
    const events = [ev('hint', { index: 0 }), ev('error', { code: 'pay_password' })];
    const r = scenarioResult(s, events, 0, 185_000);
    expect(r).toMatchObject({ success: false, hints_used: 1, slips: 1, duration_ms: 185_000, bonus_total: 1 });
    expect(durationBucket(185_000)).toBe('2-5m');
  });

  it('runs the phone clock from the scenario time', () => {
    expect(phoneClock(s, 0, 61_000)).toEqual({ date: '2026-10-29', time: '14:21', minutes: 14 * 60 + 21 });
    expect(phoneClock({ today: '2026-10-29', now: '23:59' }, 0, 120_000).date).toBe('2026-10-30');
  });
});
