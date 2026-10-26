/** 吃喝玩乐 scenarios: a queue number, a Saturday table when your time is full, a birthday room + the host. */
import type { DineRestaurant, ScenarioSpec } from '../types';
import { PROFILE, wallet } from './common';

const TIMES = ['11:00', '11:30', '12:00', '12:30', '13:00', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'];
const DATES = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];

const SHENGJIAN: DineRestaurant = {
  id: 'r_shengjian',
  name: '老弄堂生煎（静安寺店）',
  cuisine: '小吃快餐',
  rating: 4.5,
  scores: [4.6, 4.2, 4.3],
  avg_price: 28,
  district: '静安寺',
  address: '静安区愚园路112号',
  hours: '07:00-21:00',
  tags: ['排队中', '老字号', '人气榜第3名'],
  dishes: ['招牌生煎', '鲜肉小馄饨', '咖喱牛肉汤', '虾仁生煎'],
  reviews: [
    { user: '吃货***小白', stars: 5, text: '生煎底很脆，汤汁多，一口下去要小心烫！排队二十分钟值得。' },
    { user: '静安***阿姨', stars: 4, text: '味道一直稳定，就是人太多了，建议线上取号。' },
  ],
  queue: [
    { id: 'A', name: '小桌', min: 1, max: 2, waiting: 8, minutes: 20 },
    { id: 'B', name: '中桌', min: 3, max: 4, waiting: 5, minutes: 25 },
    { id: 'C', name: '大桌', min: 5, max: 8, waiting: 2, minutes: 30 },
  ],
  emoji: '🥟',
};

const BENBANG: DineRestaurant = {
  id: 'r_benbang',
  name: '弄堂人家·本帮菜（新天地店）',
  cuisine: '本帮江浙菜',
  rating: 4.7,
  scores: [4.8, 4.6, 4.7],
  avg_price: 135,
  district: '新天地',
  address: '黄浦区马当路245号 2楼',
  hours: '11:00-14:00 17:00-21:30',
  tags: ['可订座', '有包间', '本帮菜热门榜'],
  dishes: ['红烧肉', '油爆虾', '腌笃鲜', '八宝鸭', '蟹粉豆腐'],
  reviews: [
    { user: '上海***小王', stars: 5, text: '红烧肉浓油赤酱，很正宗。周末一定要提前订座。' },
    { user: '丽莎***', stars: 4, text: '环境不错，服务也热情，就是周六晚上真的很难订。' },
  ],
  booking: { dates: DATES, times: TIMES, full: ['2026-10-31 17:30', '2026-10-31 18:00', '2026-10-31 18:30', '2026-10-31 12:00'], max_people: 10, rooms: { min_people: 6, min_spend: 1500 } },
  queue: [
    { id: 'A', name: '小桌', min: 1, max: 2, waiting: 3, minutes: 15 },
    { id: 'B', name: '中桌', min: 3, max: 4, waiting: 6, minutes: 40 },
    { id: 'C', name: '大桌', min: 5, max: 10, waiting: 2, minutes: 45 },
  ],
  emoji: '🍖',
};

const SICHUAN: DineRestaurant = {
  id: 'r_sichuan',
  name: '川味小馆',
  cuisine: '川菜',
  rating: 4.4,
  scores: [4.5, 4.1, 4.2],
  avg_price: 75,
  district: '静安寺',
  address: '静安区常德路300号',
  hours: '11:00-22:00',
  tags: ['可订座', '辣'],
  dishes: ['水煮鱼', '回锅肉', '麻婆豆腐', '夫妻肺片'],
  reviews: [{ user: '无辣***不欢', stars: 4, text: '水煮鱼很够味，分量足。' }],
  booking: { dates: DATES, times: TIMES, full: [], max_people: 8 },
  emoji: '🌶️',
};

const YAJI: DineRestaurant = {
  id: 'r_yaji',
  name: '江南雅集·私房菜',
  cuisine: '淮扬菜',
  rating: 4.8,
  scores: [4.9, 4.8, 4.8],
  avg_price: 268,
  district: '新天地',
  address: '黄浦区太仓路181弄 3号',
  hours: '11:30-14:00 17:30-22:00',
  tags: ['可订座', '有包间', '适合聚会', '可带蛋糕'],
  dishes: ['蟹粉狮子头', '松鼠桂鱼', '大煮干丝', '清炖狮子头'],
  reviews: [{ user: '美食***家', stars: 5, text: '包间很安静，适合过生日。服务员还会帮忙准备长寿面！' }],
  booking: { dates: DATES, times: TIMES, full: ['2026-10-30 18:30'], max_people: 12, rooms: { min_people: 6, min_spend: 2000 } },
  emoji: '🥢',
  persona: 'host',
};

const DINE_VOCAB = [
  { hanzi: '人均', pinyin: 'rénjūn', english: 'per person (average spend)' },
  { hanzi: '评分', pinyin: 'píngfēn', english: 'rating' },
  { hanzi: '口味', pinyin: 'kǒuwèi', english: 'taste' },
  { hanzi: '环境', pinyin: 'huánjìng', english: 'environment, setting' },
  { hanzi: '服务', pinyin: 'fúwù', english: 'service' },
  { hanzi: '营业时间', pinyin: 'yíngyè shíjiān', english: 'opening hours' },
];

export const dineQueueShengjian: ScenarioSpec = {
  id: 'dine-queue-shengjian',
  version: 1,
  title: { en: 'Take a queue number', zh: '线上排队取号' },
  difficulty: 'easy',
  apps: ['dine'],
  minutes: 3,
  situation: "You and a friend want 生煎 (pan-fried buns) for lunch. The famous place near 静安寺 always has a queue — you can take a number online and walk over.",
  goal: { en: 'Take an online queue number (排队取号) at 老弄堂生煎 for 2 people.', zh: '在老弄堂生煎线上排队取号，2位。' },
  facts: [],
  today: '2026-10-29',
  now: '11:40',
  profile: PROFILE,
  wallet: wallet(),
  world: { dine: { restaurants: [SHENGJIAN, BENBANG, SICHUAN] } },
  goals: [{ id: 'number', label: { en: 'A queue number for 2 at 老弄堂生煎', zh: '老弄堂生煎：2人的排队号' }, condition: { kind: 'record', record: 'dine_queue', where: { restaurant_id: 'r_shengjian', people: 2, status: 'waiting' } } }],
  mistakes: [{ id: 'people', label: { en: 'Took a number for the wrong number of people', zh: '人数选错了' }, when: { kind: 'record', record: 'dine_queue', where: { restaurant_id: 'r_shengjian', people: { ne: 2 } } } }],
  hints: [
    { en: 'Open 老弄堂生煎 from the list (or search 生煎).', zh: '搜索“生煎” → 老弄堂生煎' },
    { en: 'Tap 排队 (queue) at the bottom.', zh: '点“排队”' },
    { en: 'Choose 2人 (the app picks 小桌) and tap 立即取号 (take a number).', zh: '用餐人数：2人 → 立即取号' },
  ],
  vocab: [
    ...DINE_VOCAB,
    { hanzi: '排队', pinyin: 'páiduì', english: 'to queue' },
    { hanzi: '取号', pinyin: 'qǔhào', english: 'to take a (queue) number' },
    { hanzi: '小桌', pinyin: 'xiǎozhuō', english: 'small table' },
    { hanzi: '前方', pinyin: 'qiánfāng', english: 'ahead' },
    { hanzi: '过号', pinyin: 'guòhào', english: '(your) number has passed' },
  ],
};

export const dineBookSaturday: ScenarioSpec = {
  id: 'dine-book-saturday',
  version: 1,
  title: { en: 'A Saturday dinner booking', zh: '周六订座' },
  difficulty: 'medium',
  apps: ['dine'],
  minutes: 6,
  situation: "Your parents are visiting and you're taking them and your partner (4 people in all) for Shanghainese food on Saturday evening. You'd like 18:30.",
  goal: {
    en: 'Book a table for 4 at 弄堂人家·本帮菜 on Saturday 31 October at 18:30 — or, if that is full, the closest later time — in the main hall (大厅), under your name and phone number.',
    zh: '在弄堂人家·本帮菜订周六（10月31日）18:30四位的座位，如果订满了就选最近的更晚时间；坐大厅，用你的名字和手机号。',
  },
  facts: [{ en: `Name: Taylor 先生 (Mr Taylor), phone ${PROFILE.phone}.`, zh: `联系人：Taylor 先生　手机：${PROFILE.phone}` }],
  today: '2026-10-29',
  now: '10:15',
  profile: PROFILE,
  wallet: wallet(),
  world: { dine: { restaurants: [BENBANG, SICHUAN, SHENGJIAN] } },
  goals: [
    {
      id: 'booked',
      label: { en: 'A table for 4 on Saturday at the closest time to 18:30 (not earlier)', zh: '周六4位，18:30或最近的更晚时间' },
      condition: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_benbang', date: '2026-10-31', time: '19:00', people: 4, status: { ne: 'cancelled' } } },
    },
    { id: 'hall', label: { en: 'In the main hall (大厅)', zh: '大厅' }, condition: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_benbang', area: '大厅', status: { ne: 'cancelled' } } } },
    { id: 'contact', label: { en: 'Under your phone number', zh: '留了你的手机号' }, condition: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_benbang', phone: PROFILE.phone, status: { ne: 'cancelled' } } } },
  ],
  mistakes: [
    { id: 'early', label: { en: 'Booked earlier than 18:30', zh: '订的时间比18:30早' }, when: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_benbang', date: '2026-10-31', time: { lt: '18:30' } } } },
    { id: 'late', label: { en: 'Booked a later time than needed (19:00 was free)', zh: '时间太晚了（19:00还有位）' }, when: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_benbang', date: '2026-10-31', time: { gt: '19:00' } } } },
    { id: 'date', label: { en: 'Wrong day', zh: '日期选错了' }, when: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_benbang', date: { ne: '2026-10-31' } } } },
  ],
  hints: [
    { en: 'Open 弄堂人家·本帮菜 and tap 订座 (book a table).', zh: '弄堂人家·本帮菜 → 订座' },
    { en: 'Pick 周六 10月31日 and 4人. Times marked 已满 (full) can\'t be chosen.', zh: '日期：周六　人数：4人（“已满”不能选）' },
    { en: '18:30 is full — pick the next free time after it. Leave 位置 on 大厅.', zh: '18:30已满 → 选后面最近的时间；位置：大厅' },
    { en: 'Fill in 联系人 (Taylor, tick 先生) and 手机号, then 提交订座.', zh: '联系人、先生、手机号 → 提交订座' },
  ],
  vocab: [
    ...DINE_VOCAB,
    { hanzi: '订座', pinyin: 'dìngzuò', english: 'to book a table' },
    { hanzi: '已满', pinyin: 'yǐ mǎn', english: 'full' },
    { hanzi: '大厅', pinyin: 'dàtīng', english: 'main hall' },
    { hanzi: '包间', pinyin: 'bāojiān', english: 'private room' },
    { hanzi: '联系人', pinyin: 'liánxìrén', english: 'contact person' },
    { hanzi: '到店', pinyin: 'dào diàn', english: 'to arrive at the restaurant' },
  ],
};

export const dineBirthdayRoom: ScenarioSpec = {
  id: 'dine-birthday-room',
  version: 1,
  title: { en: 'A birthday dinner in a private room', zh: '包间里的生日饭' },
  difficulty: 'hard',
  apps: ['dine'],
  minutes: 10,
  situation: "It's your friend 小雨's birthday on Friday. Six of you are going to a smart 淮扬菜 restaurant, and you want a private room and something birthday-ish when the main courses are done.",
  goal: {
    en: 'Book a private room (包间) for 6 at 江南雅集·私房菜 on Friday 30 October at 19:00. Then message the restaurant to ask if they can provide a birthday cake, and arrange whatever they can do for the birthday.',
    zh: '在江南雅集·私房菜订10月30日（周五）19:00的包间，6位。然后联系商家，问能不能准备生日蛋糕，并约好他们能为生日做的安排。',
  },
  facts: [{ en: `Name: Taylor 先生, phone ${PROFILE.phone}. The birthday girl is 小雨.`, zh: `联系人：Taylor 先生　手机：${PROFILE.phone}　过生日的是小雨` }],
  today: '2026-10-29',
  now: '13:20',
  profile: PROFILE,
  wallet: wallet(),
  personas: [
    {
      id: 'host',
      name: '江南雅集·小周',
      role: 'The front-of-house manager at an upmarket Huaiyang restaurant in Shanghai, answering customers through the restaurant guide app.',
      personality: 'Warm, polite and professional (uses 您, 好的呢, 没问题的); keeps messages short.',
      knows:
        'The restaurant does NOT bake or sell birthday cakes. Customers may bring their own cake: you keep it in the fridge, bring it to the room with candles after the main courses, and lend a cake knife and plates for free. For a birthday guest the kitchen gives a free bowl of 长寿面 (longevity noodles). Private rooms seat 6–12, minimum spend ¥2000. There is a cake shop, 甜甜屋蛋糕, two minutes away on 太仓路 that can deliver to the restaurant if ordered a day ahead. If the customer has a booking, you can see it.',
      aim: 'Understand what the customer wants for the birthday and confirm a clear arrangement (what, and when you will bring it out).',
      actions: [
        {
          name: 'confirm_request',
          description: 'You have confirmed a concrete birthday arrangement with the learner (e.g. they bring a cake and you serve it with candles after the main course, and/or the free 长寿面).',
          params: { arrangement: 'what was agreed, in Chinese' },
        },
      ],
      fake_reply: '没问题的，您带蛋糕过来，我们放冰箱，主菜上完以后点好蜡烛送进包间，再送一碗长寿面。',
      fake_action: { name: 'confirm_request', params: { arrangement: '客人自带蛋糕，主菜后送进包间，送长寿面' } },
    },
  ],
  world: { dine: { restaurants: [YAJI, BENBANG, SICHUAN] } },
  goals: [
    {
      id: 'room',
      label: { en: 'A private room for 6 on Friday at 19:00', zh: '周五19:00包间，6位' },
      condition: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_yaji', date: '2026-10-30', time: '19:00', people: 6, area: '包间', status: { ne: 'cancelled' } } },
    },
    { id: 'arranged', label: { en: 'Arranged the birthday surprise with the restaurant', zh: '和商家约好了生日的安排' }, condition: { kind: 'event', event: 'persona.action', where: { persona: 'host', action: 'confirm_request' } } },
  ],
  mistakes: [
    { id: 'hall', label: { en: 'Booked the main hall, not a private room', zh: '订的是大厅，不是包间' }, when: { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_yaji', area: '大厅' } } },
    { id: 'time', label: { en: 'Not Friday 19:00', zh: '时间不对（应是周五19:00）' }, when: { kind: 'any_of', conditions: [{ kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_yaji', date: { ne: '2026-10-30' } } }, { kind: 'record', record: 'dine_booking', where: { restaurant_id: 'r_yaji', time: { ne: '19:00' } } }] } },
  ],
  hints: [
    { en: 'Open 江南雅集·私房菜 → 订座. Choose 周五 10月30日, 19:00, 6人.', zh: '订座：10月30日 周五，19:00，6人' },
    { en: 'Set 位置 to 包间 (note the 最低消费 — minimum spend). Fill in your name and phone, then 提交订座.', zh: '位置：包间 → 填联系人 → 提交订座' },
    { en: 'On the restaurant page tap 💬 咨询 (ask the shop).', zh: '商家页面 → 咨询' },
    { en: 'Ask: 你好，我订了周五晚上七点的包间，是朋友过生日。请问你们可以准备生日蛋糕吗？', zh: '请问你们可以准备生日蛋糕吗？' },
    { en: "If they can't, agree their alternative: e.g. 那我自己带蛋糕，麻烦你们主菜上完以后拿进来，可以吗？", zh: '那我自己带蛋糕，麻烦主菜上完以后拿进来，可以吗？' },
  ],
  vocab: [
    ...DINE_VOCAB.slice(0, 2),
    { hanzi: '包间', pinyin: 'bāojiān', english: 'private room' },
    { hanzi: '最低消费', pinyin: 'zuìdī xiāofèi', english: 'minimum spend' },
    { hanzi: '生日蛋糕', pinyin: 'shēngrì dàngāo', english: 'birthday cake' },
    { hanzi: '长寿面', pinyin: 'chángshòumiàn', english: 'longevity noodles' },
    { hanzi: '蜡烛', pinyin: 'làzhú', english: 'candle' },
    { hanzi: '自带', pinyin: 'zìdài', english: 'to bring one\'s own' },
    { hanzi: '咨询', pinyin: 'zīxún', english: 'to ask, consult' },
    { hanzi: '主菜', pinyin: 'zhǔcài', english: 'main course' },
  ],
};

export const DINE_SCENARIOS: ScenarioSpec[] = [dineQueueShengjian, dineBookSaturday, dineBirthdayRoom];
