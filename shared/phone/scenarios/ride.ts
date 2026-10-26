/** 招手打车 scenarios: to the railway station, a pickup at the other gate, a lost power bank. */
import type { RideCarOffer, RidePoi, RideWorld, ScenarioSpec } from '../types';
import { PASSWORD_FACT, PROFILE, wallet } from './common';

const START = { name: '梧桐里酒店（静安寺店）', address: '静安区华山路218号' };

const POIS: RidePoi[] = [
  { id: 'hq_station', name: '上海虹桥站', address: '闵行区申贵路1500号', district: '闵行区', km: 18.6, kind: '火车站' },
  { id: 'hq_metro', name: '虹桥火车站（地铁站）', address: '地铁2号线/10号线/17号线', district: '闵行区', km: 18.4, kind: '地铁站' },
  { id: 'hq_airport_t2', name: '虹桥国际机场T2航站楼', address: '长宁区申达一路', district: '长宁区', km: 17.9, kind: '机场' },
  { id: 'hq_airport_t1', name: '虹桥国际机场T1航站楼', address: '长宁区迎宾二路', district: '长宁区', km: 15.2, kind: '机场' },
  { id: 'sh_station', name: '上海站', address: '静安区秣陵路303号', district: '静安区', km: 4.1, kind: '火车站' },
  { id: 'bund', name: '外滩', address: '黄浦区中山东一路', district: '黄浦区', km: 6.2, kind: '景点' },
  { id: 'bund_tunnel', name: '外滩观光隧道', address: '黄浦区中山东一路300号', district: '黄浦区', km: 6.0, kind: '景点' },
  { id: 'nanjing_rd', name: '南京东路步行街', address: '黄浦区南京东路', district: '黄浦区', km: 4.8, kind: '商圈' },
  { id: 'yuyuan', name: '豫园', address: '黄浦区福佑路168号', district: '黄浦区', km: 6.9, kind: '景点' },
  { id: 'pd_airport', name: '浦东国际机场T2航站楼', address: '浦东新区迎宾大道6000号', district: '浦东新区', km: 48.5, kind: '机场' },
  { id: 'hotel', name: '梧桐里酒店（静安寺店）', address: '静安区华山路218号', district: '静安区', km: 0.2, kind: '酒店' },
];

const CARS: RideCarOffer[] = [
  { type: '特惠快车', base: 11, per_km: 1.9, eta_min: 6, note: '价格更优惠' },
  { type: '快车', base: 14, per_km: 2.3, eta_min: 3, note: '准时出发' },
  { type: '专车', base: 20, per_km: 4.1, eta_min: 5, note: '舒适型 · 专业服务' },
  { type: '出租车', base: 16, per_km: 2.6, eta_min: 4, note: '打表计价' },
];

const DRIVER = { name: '王师傅', car: '白色 · 新能源轿车', plate: '沪A·D3K29', rating: 4.9, trips: 3862 };

function rideWorld(extra: Partial<RideWorld> = {}): RideWorld {
  return { start: START, pois: POIS, cars: CARS, driver: DRIVER, coupons: [{ id: 'c5', name: '快车立减券', amount: 5, car_type: '快车', min_price: 20 }], ...extra };
}

const RIDE_VOCAB = [
  { hanzi: '你要去哪儿', pinyin: 'nǐ yào qù nǎr', english: 'where are you going?' },
  { hanzi: '上车点', pinyin: 'shàngchēdiǎn', english: 'pickup point' },
  { hanzi: '目的地', pinyin: 'mùdìdì', english: 'destination' },
  { hanzi: '快车', pinyin: 'kuàichē', english: 'standard ride (ride-hailing)' },
  { hanzi: '呼叫', pinyin: 'hūjiào', english: 'to call (a car)' },
  { hanzi: '预估价', pinyin: 'yùgūjià', english: 'estimated price' },
  { hanzi: '车牌', pinyin: 'chēpái', english: 'number plate' },
  { hanzi: '司机', pinyin: 'sījī', english: 'driver' },
  { hanzi: '评价', pinyin: 'píngjià', english: 'to rate, review' },
];

export const rideHongqiaoStation: ScenarioSpec = {
  id: 'ride-hongqiao-station',
  version: 1,
  title: { en: 'A ride to the railway station', zh: '打车去火车站' },
  difficulty: 'easy',
  apps: ['ride'],
  minutes: 4,
  situation: "You're at your hotel in Jing'an with a suitcase and have a train to catch from Hongqiao railway station.",
  goal: {
    en: 'Take a 快车 from the hotel to 上海虹桥站 (the railway station — not the airport next door, not the metro station), pay, and rate the driver.',
    zh: '叫一辆快车从酒店去上海虹桥站（火车站，不是机场，也不是地铁站），付款并给司机评价。',
  },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '08:10',
  profile: PROFILE,
  wallet: wallet(),
  world: { ride: rideWorld() },
  goals: [
    { id: 'trip', label: { en: 'A paid 快车 trip to 上海虹桥站', zh: '已支付：快车去上海虹桥站' }, condition: { kind: 'record', record: 'ride_order', where: { to_id: 'hq_station', car_type: '快车', status: 'paid' } } },
    { id: 'rated', optional: true, label: { en: 'Bonus: rated the driver', zh: '加分：给司机评价' }, condition: { kind: 'record', record: 'ride_order', where: { to_id: 'hq_station', rating: { gte: 1 } } } },
  ],
  mistakes: [
    { id: 'airport', label: { en: 'Went to the airport instead of the railway station', zh: '去了机场，不是火车站' }, when: { kind: 'record', record: 'ride_order', where: { to_id: { in: ['hq_airport_t1', 'hq_airport_t2'] }, status: { ne: 'cancelled' } } } },
    { id: 'metro', label: { en: 'Picked the metro station (虹桥火车站 地铁站) — a long walk with a suitcase', zh: '选了地铁站' }, when: { kind: 'record', record: 'ride_order', where: { to_id: 'hq_metro', status: { ne: 'cancelled' } } } },
    { id: 'car', label: { en: 'Called another car type, not 快车', zh: '车型选错了' }, when: { kind: 'record', record: 'ride_order', where: { car_type: { ne: '快车' }, status: 'paid' } } },
  ],
  hints: [
    { en: 'Tap the 你要去哪儿 box (where are you going?).', zh: '点“你要去哪儿”' },
    { en: 'Type 虹桥站 (or say it with 🎤). Pick the result marked 火车站 — 上海虹桥站.', zh: '输入“虹桥站” → 选“上海虹桥站 火车站”' },
    { en: 'Tick only 快车, then tap 呼叫快车.', zh: '只勾选快车 → 呼叫快车' },
    { en: 'Wait for the driver; when the trip ends tap 去支付 and pay.', zh: '行程结束 → 去支付' },
    { en: 'Give stars and tap 提交评价 (submit).', zh: '打星 → 提交评价' },
  ],
  vocab: RIDE_VOCAB,
};

export const rideNorthGate: ScenarioSpec = {
  id: 'ride-north-gate',
  version: 1,
  title: { en: 'The driver is at the wrong gate', zh: '司机在另一个门' },
  difficulty: 'medium',
  apps: ['ride'],
  minutes: 7,
  situation:
    "You're going to the Bund (外滩) for the evening. You're waiting at your hotel's NORTH entrance (北门) on 延安西路, wearing a red jacket. Drivers often go to the south entrance.",
  goal: {
    en: 'Call the cheapest car type to 外滩. When the driver messages you, tell him where you are (北门) and how to spot you, then finish and pay for the trip.',
    zh: '叫最便宜的车去外滩。司机发消息的时候，告诉他你在北门、穿红色外套，然后完成行程并付款。',
  },
  facts: [PASSWORD_FACT, { en: 'You are at the 北门 (north gate), on 延安西路, in a red jacket (红色外套).', zh: '你在北门（延安西路），穿红色外套' }],
  today: '2026-10-29',
  now: '18:40',
  profile: PROFILE,
  wallet: wallet(),
  personas: [
    {
      id: 'driver',
      name: '王师傅',
      role: 'A ride-hailing driver in Shanghai in his fifties, picking up a passenger at a hotel.',
      personality: 'Polite and practical, a little hurried; says 您 to passengers; short messages.',
      knows:
        'You drive a white car, plate 沪A·D3K29. You have arrived at 梧桐里酒店（静安寺店） on 华山路 and are waiting at the hotel\'s SOUTH entrance (南门), next to the bus stop, where you cannot stop for long. The hotel also has a NORTH entrance (北门) on 延安西路, two minutes away by car. The trip goes to 外滩.',
      aim: 'Find out which entrance the passenger is at and how to recognise them; then say you are coming.',
      opening: '您好，我到了，在南门公交站这边。您在哪个门呀？',
      actions: [
        {
          name: 'found_passenger',
          description: 'The learner has made clear which entrance they are at, so you can drive there and pick them up (say you are on your way).',
          params: { where: 'where the learner said they are, in Chinese (e.g. 北门)' },
        },
      ],
      fake_reply: '好的，我马上开到北门，两分钟到。',
      fake_action: { name: 'found_passenger', params: { where: '北门' } },
    },
  ],
  world: { ride: rideWorld({ driver: { ...DRIVER, persona: 'driver' }, arrival_persona: 'driver' }) },
  goals: [
    { id: 'cheap', label: { en: 'Called the cheapest car type (特惠快车) to 外滩', zh: '叫了最便宜的特惠快车去外滩' }, condition: { kind: 'record', record: 'ride_order', where: { to_id: 'bund', car_type: '特惠快车', status: { ne: 'cancelled' } } } },
    { id: 'found', label: { en: 'Told the driver you are at the north gate', zh: '告诉司机你在北门' }, condition: { kind: 'event', event: 'persona.action', where: { persona: 'driver', action: 'found_passenger', 'params.where': { contains: '北' } } } },
    { id: 'paid', label: { en: 'Trip finished and paid', zh: '行程结束并付款' }, condition: { kind: 'record', record: 'ride_order', where: { to_id: 'bund', status: 'paid' } } },
  ],
  mistakes: [
    { id: 'tunnel', label: { en: 'Picked 外滩观光隧道 (the sightseeing tunnel), not 外滩', zh: '选了外滩观光隧道' }, when: { kind: 'record', record: 'ride_order', where: { to_id: 'bund_tunnel', status: { ne: 'cancelled' } } } },
    { id: 'car', label: { en: 'Not the cheapest car type', zh: '不是最便宜的车型' }, when: { kind: 'record', record: 'ride_order', where: { to_id: 'bund', car_type: { ne: '特惠快车' }, status: { ne: 'cancelled' } } } },
  ],
  hints: [
    { en: 'Search 外滩 and pick the one marked 景点 at 中山东一路.', zh: '搜索“外滩” → 选中山东一路的外滩' },
    { en: 'Compare the 预估价 (estimates): tick only the cheapest and call it.', zh: '比较预估价，只勾选最便宜的车型' },
    { en: 'When 王师傅 messages, open the chat (💬 联系司机).', zh: '司机发消息 → 打开聊天' },
    { en: 'Tell him: 我在北门，延安西路这边，穿红色外套。', zh: '我在北门，延安西路这边，穿红色外套。' },
    { en: 'When the trip ends, pay (去支付).', zh: '行程结束 → 去支付' },
  ],
  vocab: [
    ...RIDE_VOCAB.slice(0, 6),
    { hanzi: '北门', pinyin: 'běimén', english: 'north gate / entrance' },
    { hanzi: '南门', pinyin: 'nánmén', english: 'south gate / entrance' },
    { hanzi: '外套', pinyin: 'wàitào', english: 'jacket, coat' },
    { hanzi: '马上', pinyin: 'mǎshàng', english: 'right away' },
    { hanzi: '公交站', pinyin: 'gōngjiāozhàn', english: 'bus stop' },
    { hanzi: '特惠', pinyin: 'tèhuì', english: 'special offer, discounted' },
  ],
};

export const rideLostItem: ScenarioSpec = {
  id: 'ride-lost-item',
  version: 1,
  title: { en: 'Left something in the car', zh: '东西落在车上了' },
  difficulty: 'hard',
  apps: ['ride'],
  minutes: 8,
  situation:
    'Last night you took a 快车 from the Bund back to your hotel, and this morning you realise your white power bank (充电宝) is missing — it must have slipped out of your pocket on the back seat.',
  goal: {
    en: "Find last night's trip in the app, contact the driver, describe what you lost, and arrange for him to bring it back to your hotel (front desk / lobby) at a time that suits you both.",
    zh: '在App里找到昨晚的行程，联系司机，说明你丢了什么，约好时间请他送回酒店前台。',
  },
  facts: [{ en: 'Your hotel: 梧桐里酒店（静安寺店）, 华山路218号. You are out until 18:00 today; the front desk (前台) is open 24 hours.', zh: '酒店：梧桐里酒店（静安寺店），华山路218号。你今天18点前不在，前台24小时有人。' }],
  today: '2026-10-29',
  now: '09:30',
  profile: PROFILE,
  wallet: wallet(),
  personas: [
    {
      id: 'lost_driver',
      name: '李师傅',
      role: 'A ride-hailing driver in Shanghai in his forties who drove the learner last night.',
      personality: 'Friendly and helpful but busy; he drives all day and needs a clear place and time.',
      knows:
        'Last night (28 Oct, about 21:40) you drove a passenger from 外滩 to 梧桐里酒店（静安寺店）, 华山路218号. This morning you found a white power bank (充电宝) on the back seat. You are working in 徐汇区 today. You could bring it to the hotel at lunchtime (12:00–13:00) or in the evening after 19:00. You will leave it at the hotel\'s front desk (前台) if the passenger is not there; you need the passenger\'s name for the front desk.',
      aim: 'Check the item is theirs (ask what it looks like), then agree a place and time to return it.',
      actions: [
        {
          name: 'arrange_return',
          description: 'You and the learner have agreed where and when you will bring the power bank back (both a place and a time are settled).',
          params: { place: 'the agreed place, in Chinese', time: 'the agreed time, in Chinese' },
        },
      ],
      fake_reply: '没问题，我中午十二点半送到酒店前台。',
      fake_action: { name: 'arrange_return', params: { place: '酒店前台', time: '中午12点半' } },
    },
  ],
  world: {
    ride: rideWorld({
      trips: [
        { id: 'trip_last_night', date: '2026-10-28', time: '21:40', from: '外滩', to: '梧桐里酒店（静安寺店）', car_type: '快车', price: 31.6, driver: { name: '李师傅', car: '黑色 · 新能源轿车', plate: '沪A·F7M15', rating: 4.8, trips: 5127, persona: 'lost_driver' } },
        { id: 'trip_older', date: '2026-10-26', time: '10:15', from: '上海站', to: '梧桐里酒店（静安寺店）', car_type: '出租车', price: 24, driver: { name: '赵师傅', car: '绿色 · 出租车', plate: '沪B·T8826', rating: 4.7, trips: 9021 } },
      ],
    }),
  },
  goals: [
    {
      id: 'arranged',
      label: { en: 'Arranged with the driver to return it to the hotel', zh: '和司机约好送回酒店' },
      condition: {
        kind: 'any_of',
        conditions: ['酒店', '前台', '大堂', '华山路'].map((w) => ({ kind: 'event' as const, event: 'persona.action', where: { persona: 'lost_driver', action: 'arrange_return', 'params.place': { contains: w } } })),
      },
    },
  ],
  mistakes: [],
  hints: [
    { en: 'Open the menu (☰ top left) → 我的行程 (my trips).', zh: '☰ → 我的行程' },
    { en: "Open last night's trip (外滩 → 梧桐里酒店) and tap 物品遗失 / 联系司机.", zh: '打开昨晚的行程 → 物品遗失' },
    { en: 'Say what you lost: 师傅您好，我昨晚坐您的车，把一个白色的充电宝落在后座了。', zh: '我昨晚坐您的车，把一个白色的充电宝落在后座了。' },
    { en: 'Agree a time and the place: e.g. 您能中午送到酒店前台吗？我叫Sam。', zh: '您能中午送到酒店前台吗？' },
  ],
  vocab: [
    { hanzi: '充电宝', pinyin: 'chōngdiànbǎo', english: 'power bank' },
    { hanzi: '落', pinyin: 'là', english: 'to leave behind (by mistake)' },
    { hanzi: '后座', pinyin: 'hòuzuò', english: 'back seat' },
    { hanzi: '物品遗失', pinyin: 'wùpǐn yíshī', english: 'lost item' },
    { hanzi: '行程', pinyin: 'xíngchéng', english: 'trip, itinerary' },
    { hanzi: '前台', pinyin: 'qiántái', english: 'front desk, reception' },
    { hanzi: '送回', pinyin: 'sònghuí', english: 'to bring back' },
    { hanzi: '师傅', pinyin: 'shīfu', english: 'master (polite address for a driver)' },
  ],
};

export const RIDE_SCENARIOS: ScenarioSpec[] = [rideHongqiaoStation, rideNorthGate, rideLostItem];
