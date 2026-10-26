/** 铁路出行 scenarios: a weekend ticket, two travellers with a passport, 改签 + 退票. */
import type { RailStation, ScenarioSpec } from '../types';
import { PASSPORT_FACT, PASSWORD_FACT, PROFILE, train, wallet } from './common';

export const RAIL_STATIONS: RailStation[] = [
  { name: '上海虹桥', city: '上海', pinyin: 'shang hai hong qiao' },
  { name: '上海', city: '上海', pinyin: 'shang hai' },
  { name: '上海南', city: '上海', pinyin: 'shang hai nan' },
  { name: '杭州东', city: '杭州', pinyin: 'hang zhou dong' },
  { name: '杭州', city: '杭州', pinyin: 'hang zhou' },
  { name: '杭州西', city: '杭州', pinyin: 'hang zhou xi' },
  { name: '北京南', city: '北京', pinyin: 'bei jing nan' },
  { name: '北京', city: '北京', pinyin: 'bei jing' },
  { name: '北京丰台', city: '北京', pinyin: 'bei jing feng tai' },
  { name: '天津', city: '天津', pinyin: 'tian jin' },
  { name: '天津西', city: '天津', pinyin: 'tian jin xi' },
  { name: '天津南', city: '天津', pinyin: 'tian jin nan' },
  { name: '南京南', city: '南京', pinyin: 'nan jing nan' },
  { name: '南京', city: '南京', pinyin: 'nan jing' },
  { name: '苏州', city: '苏州', pinyin: 'su zhou' },
  { name: '苏州北', city: '苏州', pinyin: 'su zhou bei' },
];

const SELF = { id: 'p_self', name: PROFILE.name, id_type: '护照' as const, id_no: PROFILE.passport_no, country: '英国', type: '成人' as const, phone: PROFILE.phone, self: true };

const HZ_STOPS = ['上海虹桥', '松江南', '嘉善南', '嘉兴南', '桐乡', '海宁西', '杭州东'];

// ---------------------------------------------------------------------------

export const railHangzhouSaturday: ScenarioSpec = {
  id: 'rail-hangzhou-saturday',
  version: 1,
  title: { en: 'A Saturday train to Hangzhou', zh: '周六去杭州' },
  difficulty: 'easy',
  apps: ['rail'],
  minutes: 5,
  situation: "You live in Shanghai and want a day trip to Hangzhou's West Lake this Saturday. Your passport is already saved in the rail app.",
  goal: {
    en: 'Book one second-class (二等座) seat for yourself on the earliest train from 上海虹桥 to 杭州东 that leaves after 9:00 on Saturday 31 October. A window seat if you can.',
    zh: '买一张10月31日（周六）上海虹桥到杭州东、9点以后最早的一趟车的二等座，最好靠窗。',
  },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '14:20',
  profile: PROFILE,
  wallet: wallet(),
  world: {
    rail: {
      stations: RAIL_STATIONS,
      passengers: [SELF],
      trains: [
        train('G7501', '2026-10-31', '上海虹桥', '杭州东', '07:45', '08:41', { 二等座: [73, 99], 一等座: [117, 8], 商务座: [219, 2] }, { gate: '检票口 A12', stops: HZ_STOPS }),
        train('D3125', '2026-10-31', '上海虹桥', '杭州东', '08:52', '09:58', { 二等座: [49.5, 36], 一等座: [79.5, 12], 无座: [49.5, 40] }, { gate: '检票口 B3', stops: HZ_STOPS }),
        train('K1805', '2026-10-31', '上海', '杭州', '09:03', '11:05', { 硬座: [24.5, 58], 硬卧: [69.5, 6], 无座: [24.5, 99] }, { gate: '检票口 4', stops: ['上海', '上海南', '松江', '嘉兴', '杭州'] }),
        train('G7311', '2026-10-31', '上海虹桥', '杭州东', '09:12', '10:05', { 二等座: [73, 14], 一等座: [117, 3], 商务座: [219, 0, 'waitlist'] }, { gate: '检票口 A8', stops: HZ_STOPS }),
        train('G1655', '2026-10-31', '上海虹桥', '杭州东', '09:30', '10:28', { 二等座: [73, 99], 一等座: [117, 21], 商务座: [219, 4] }, { gate: '检票口 A15', stops: HZ_STOPS }),
        train('G7371', '2026-10-31', '上海虹桥', '杭州西', '09:41', '10:52', { 二等座: [89, 26], 一等座: [143, 9] }, { gate: '检票口 B11' }),
        train('G7355', '2026-10-31', '上海虹桥', '杭州东', '10:05', '10:59', { 二等座: [73, 0, 'waitlist'], 一等座: [117, 6] }, { gate: '检票口 A3', stops: HZ_STOPS }),
        train('G7319', '2026-10-31', '上海虹桥', '杭州东', '10:36', '11:32', { 二等座: [73, 99], 一等座: [117, 30] }, { gate: '检票口 A10', stops: HZ_STOPS }),
        // The day before, for a wrong date.
        train('G7311', '2026-10-30', '上海虹桥', '杭州东', '09:12', '10:05', { 二等座: [73, 99], 一等座: [117, 15], 商务座: [219, 3] }, { gate: '检票口 A8', stops: HZ_STOPS }),
        train('G7501', '2026-10-30', '上海虹桥', '杭州东', '07:45', '08:41', { 二等座: [73, 99], 一等座: [117, 20] }, { gate: '检票口 A12', stops: HZ_STOPS }),
        train('G7311', '2026-11-01', '上海虹桥', '杭州东', '09:12', '10:05', { 二等座: [73, 40], 一等座: [117, 7] }, { gate: '检票口 A8', stops: HZ_STOPS }),
      ],
    },
  },
  goals: [
    {
      id: 'ticket',
      label: { en: 'A paid second-class ticket on the right train', zh: '已支付：正确车次的二等座' },
      condition: { kind: 'record', record: 'rail_order', where: { status: 'paid', train_no: 'G7311', date: '2026-10-31', seat_class: '二等座', passengers: { size: 1 } } },
    },
    {
      id: 'window',
      optional: true,
      label: { en: 'Bonus: a window seat (A or F)', zh: '加分：靠窗座位（A/F）' },
      condition: { kind: 'record', record: 'rail_order', where: { status: 'paid', train_no: 'G7311', window_count: { gte: 1 } } },
    },
  ],
  mistakes: [
    { id: 'date', label: { en: 'Booked a train on the wrong day', zh: '日期选错了' }, when: { kind: 'record', record: 'rail_order', where: { status: { in: ['paid', 'refunded'] }, date: { ne: '2026-10-31' } } } },
    {
      id: 'train',
      label: { en: 'Booked a different train (the first one after 9:00 was G7311 at 09:12)', zh: '车次选错了（9点以后最早的是G7311）' },
      when: { kind: 'record', record: 'rail_order', where: { status: { in: ['paid', 'refunded'] }, date: '2026-10-31', train_no: { ne: 'G7311' } } },
    },
    { id: 'class', label: { en: 'Booked a seat class other than 二等座', zh: '座位等级选错了' }, when: { kind: 'record', record: 'rail_order', where: { status: { in: ['paid', 'refunded'] }, seat_class: { ne: '二等座' } } } },
  ],
  hints: [
    { en: 'On the home tab, tap 出发地 and choose 上海虹桥, then tap 到达地 and choose 杭州东.', zh: '出发地：上海虹桥　到达地：杭州东' },
    { en: 'Tap the date and pick Saturday 31 October, then tap 查询车票 (search tickets).', zh: '选择日期：10月31日 周六 → 查询车票' },
    { en: 'The list is in departure order. The first train leaving after 09:00 is the one you want — tap it.', zh: '找9:00以后出发的第一趟车' },
    { en: 'Next to 二等座, tap 预订 (book).', zh: '二等座 → 预订' },
    { en: 'Tick yourself under 乘车人 (passenger). In 选座 (choose seat), A and F are 靠窗 (window). Then 提交订单.', zh: '勾选乘车人 → 选座：A或F靠窗 → 提交订单' },
    { en: 'Tap 立即支付 (pay now) and enter your pay password.', zh: '立即支付 → 输入支付密码' },
  ],
  vocab: [
    { hanzi: '出发地', pinyin: 'chūfādì', english: 'departure point' },
    { hanzi: '到达地', pinyin: 'dàodádì', english: 'destination' },
    { hanzi: '车次', pinyin: 'chēcì', english: 'train number' },
    { hanzi: '二等座', pinyin: 'èrděngzuò', english: 'second-class seat' },
    { hanzi: '余票', pinyin: 'yúpiào', english: 'tickets left' },
    { hanzi: '候补', pinyin: 'hòubǔ', english: 'waitlist' },
    { hanzi: '乘车人', pinyin: 'chéngchērén', english: 'passenger' },
    { hanzi: '靠窗', pinyin: 'kàochuāng', english: 'by the window' },
    { hanzi: '提交订单', pinyin: 'tíjiāo dìngdān', english: 'submit the order' },
    { hanzi: '检票口', pinyin: 'jiǎnpiàokǒu', english: 'ticket gate' },
    { hanzi: '历时', pinyin: 'lìshí', english: 'duration (of a journey)' },
  ],
};

// ---------------------------------------------------------------------------

const BJ_TJ = '2026-11-01';

export const railFriendPassport: ScenarioSpec = {
  id: 'rail-friend-passport',
  version: 1,
  title: { en: 'Two tickets to Tianjin with a friend', zh: '和朋友去天津' },
  difficulty: 'medium',
  apps: ['rail', 'sms'],
  minutes: 9,
  situation: "You're in Beijing. Your friend Anna is visiting from the UK and you'll take her to Tianjin on Sunday. You're logged out of the rail app, and Anna isn't saved as a passenger yet.",
  goal: {
    en: 'Book two second-class seats from 北京南 to 天津 on Sunday 1 November, on a train leaving between 10:00 and 11:00 — for you and Anna. Sit together, with one of you by the window.',
    zh: '买两张11月1日（周日）北京南到天津、10点到11点之间出发的二等座：你和Anna，两个人坐在一起，其中一个靠窗。',
  },
  facts: [
    PASSPORT_FACT,
    { en: "Anna's passport: SMITH ANNA, No. 533812940, United Kingdom (英国).", zh: 'Anna的护照：SMITH ANNA，533812940，英国' },
    { en: `Your phone number: ${PROFILE.phone} (the login code arrives by SMS).`, zh: `手机号：${PROFILE.phone}` },
    PASSWORD_FACT,
  ],
  today: '2026-10-29',
  now: '21:05',
  profile: PROFILE,
  wallet: wallet(),
  world: {
    rail: {
      stations: RAIL_STATIONS,
      passengers: [SELF],
      logged_out: true,
      trains: [
        train('C2005', BJ_TJ, '北京南', '天津', '06:52', '07:25', { 二等座: [54.5, 99], 一等座: [88, 30] }, { gate: '检票口 13' }),
        train('C2015', BJ_TJ, '北京南', '天津', '09:20', '09:53', { 二等座: [54.5, 12], 一等座: [88, 9] }, { gate: '检票口 13' }),
        train('G205', BJ_TJ, '北京南', '天津西', '09:58', '10:36', { 二等座: [54.5, 33], 一等座: [93, 5], 商务座: [174.5, 2] }, { gate: '检票口 7' }),
        train('C2023', BJ_TJ, '北京南', '天津', '10:12', '10:45', { 二等座: [54.5, 46], 一等座: [88, 14] }, { gate: '检票口 14', stops: ['北京南', '武清', '天津'] }),
        train('C2027', BJ_TJ, '北京南', '天津', '10:40', '11:13', { 二等座: [54.5, 3], 一等座: [88, 0, 'waitlist'] }, { gate: '检票口 14', stops: ['北京南', '天津'] }),
        train('G153', BJ_TJ, '北京南', '天津南', '10:50', '11:20', { 二等座: [54.5, 20] }, { gate: '检票口 5' }),
        train('C2035', BJ_TJ, '北京南', '天津', '11:08', '11:41', { 二等座: [54.5, 99], 一等座: [88, 22] }, { gate: '检票口 13' }),
        train('K1301', BJ_TJ, '北京', '天津', '10:30', '12:05', { 硬座: [16.5, 70], 无座: [16.5, 99] }, { gate: '检票口 2' }),
        train('C2023', '2026-10-31', '北京南', '天津', '10:12', '10:45', { 二等座: [54.5, 60], 一等座: [88, 20] }, { gate: '检票口 14' }),
      ],
    },
  },
  goals: [
    {
      id: 'tickets',
      label: { en: 'A paid order: 2 × 二等座, 北京南 → 天津, Sunday, leaving 10:00–11:00', zh: '已支付：周日北京南→天津，10–11点出发，二等座两张' },
      condition: {
        kind: 'record',
        record: 'rail_order',
        where: { status: 'paid', from: '北京南', to: '天津', date: BJ_TJ, depart: { gte: '10:00', lte: '11:00' }, seat_class: '二等座', passengers: { size: 2 } },
      },
    },
    {
      id: 'anna',
      label: { en: "Anna is on the ticket with her real passport number", zh: 'Anna的护照信息正确' },
      condition: { kind: 'record', record: 'rail_order', where: { status: 'paid', date: BJ_TJ, passenger_nos: { has_all: ['533812940', PROFILE.passport_no] } } },
    },
    {
      id: 'together',
      optional: true,
      label: { en: 'Bonus: sitting together, one by the window', zh: '加分：两人坐在一起，有一个靠窗' },
      condition: { kind: 'record', record: 'rail_order', where: { status: 'paid', date: BJ_TJ, together: true, window_count: { gte: 1 } } },
    },
  ],
  mistakes: [
    {
      id: 'station',
      label: { en: 'Booked to another Tianjin station (天津西 / 天津南 are not 天津站)', zh: '到站选错了（天津西/天津南不是天津站）' },
      when: { kind: 'record', record: 'rail_order', where: { status: { in: ['paid', 'refunded'] }, to: { in: ['天津西', '天津南'] } } },
    },
    {
      id: 'time',
      label: { en: 'The train leaves outside 10:00–11:00', zh: '出发时间不在10点到11点之间' },
      when: {
        kind: 'any_of',
        conditions: [
          { kind: 'record', record: 'rail_order', where: { status: { in: ['paid', 'refunded'] }, depart: { lt: '10:00' } } },
          { kind: 'record', record: 'rail_order', where: { status: { in: ['paid', 'refunded'] }, depart: { gt: '11:00' } } },
        ],
      },
    },
    {
      id: 'passport',
      label: { en: "Saved Anna with a wrong passport number", zh: 'Anna的护照号码填错了' },
      when: { kind: 'record', record: 'rail_passenger', where: { self: { ne: true }, id_no: { ne: '533812940' } } },
    },
  ],
  hints: [
    { en: 'Search 北京南 → 天津 for Sunday 1 November (11月1日 周日), then 查询车票.', zh: '北京南 → 天津，11月1日 周日' },
    { en: 'Pick a train leaving between 10:00 and 11:00 that goes to 天津 (not 天津西 / 天津南) and has enough 二等座, then 预订.', zh: '10:00–11:00出发、到天津站、二等座还有票' },
    { en: 'The app asks you to log in: enter your phone number, tap 获取验证码 (get code), open the SMS (信息) and type the six digits.', zh: '登录：手机号 → 获取验证码 → 输入短信里的验证码' },
    { en: 'Under 乘车人 tap 添加乘车人. 证件类型 = 护照, 国家/地区 = 英国, then her name as on the passport and the number.', zh: '添加乘车人：证件类型 护照，国家/地区 英国，姓名，证件号码' },
    { en: 'Tick both passengers. In 选座 pick two seats side by side — D and F, or A and B (A and F are windows).', zh: '勾选两位乘车人 → 选座：D+F 或 A+B' },
    { en: 'Submit the order (提交订单) and pay.', zh: '提交订单 → 立即支付' },
  ],
  vocab: [
    { hanzi: '登录', pinyin: 'dēnglù', english: 'to log in' },
    { hanzi: '验证码', pinyin: 'yànzhèngmǎ', english: 'verification code' },
    { hanzi: '获取', pinyin: 'huòqǔ', english: 'to get, obtain' },
    { hanzi: '添加', pinyin: 'tiānjiā', english: 'to add' },
    { hanzi: '证件类型', pinyin: 'zhèngjiàn lèixíng', english: 'type of ID document' },
    { hanzi: '护照', pinyin: 'hùzhào', english: 'passport' },
    { hanzi: '证件号码', pinyin: 'zhèngjiàn hàomǎ', english: 'ID number' },
    { hanzi: '国家', pinyin: 'guójiā', english: 'country' },
    { hanzi: '选座', pinyin: 'xuǎnzuò', english: 'choose a seat' },
    { hanzi: '过道', pinyin: 'guòdào', english: 'aisle' },
  ],
};

// ---------------------------------------------------------------------------

const NJ_DAY = '2026-10-30';

export const railChangeRefund: ScenarioSpec = {
  id: 'rail-change-refund',
  version: 1,
  title: { en: 'Plans changed: 改签 and 退票', zh: '行程有变：改签和退票' },
  difficulty: 'hard',
  apps: ['rail'],
  minutes: 10,
  situation:
    "Tomorrow (Friday) you have a day trip to Nanjing booked: G7012 at 08:00 there and G7037 at 18:30 back. Your meeting has just moved to 2 pm, and you've decided to stay the night in Nanjing.",
  goal: {
    en: 'Change (改签) the 08:00 ticket to a train that leaves after 10:30 and still reaches 南京南 by 13:00, and refund (退票) the 18:30 ticket back to Shanghai.',
    zh: '把早上8点的车票改签到10:30以后出发、13:00前到南京南的车；再把晚上18:30回上海的票退掉。',
  },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '16:00',
  profile: PROFILE,
  wallet: wallet(),
  world: {
    rail: {
      stations: RAIL_STATIONS,
      passengers: [SELF],
      orders: [
        { id: 'o1', train_no: 'G7012', date: NJ_DAY, seat_class: '二等座', passengers: ['p_self'], seats: ['06车09A'], price_each: 134.5 },
        { id: 'o2', train_no: 'G7037', date: NJ_DAY, seat_class: '二等座', passengers: ['p_self'], seats: ['04车13F'], price_each: 134.5 },
      ],
      trains: [
        train('G7012', NJ_DAY, '上海虹桥', '南京南', '08:00', '09:15', { 二等座: [134.5, 12], 一等座: [229, 6] }, { gate: '检票口 B9' }),
        train('G7022', NJ_DAY, '上海虹桥', '南京南', '09:30', '10:42', { 二等座: [134.5, 40], 一等座: [229, 8] }, { gate: '检票口 B6' }),
        train('G7036', NJ_DAY, '上海虹桥', '南京南', '10:20', '11:35', { 二等座: [134.5, 0, 'waitlist'], 一等座: [229, 5] }, { gate: '检票口 B4' }),
        train('G7048', NJ_DAY, '上海虹桥', '南京南', '10:45', '11:58', { 二等座: [134.5, 0, 'waitlist'], 一等座: [229, 7], 商务座: [438, 1] }, { gate: '检票口 B12' }),
        train('G7062', NJ_DAY, '上海虹桥', '南京南', '11:35', '12:50', { 二等座: [134.5, 18], 一等座: [229, 9] }, { gate: '检票口 B2' }),
        train('G7080', NJ_DAY, '上海虹桥', '南京南', '12:20', '13:33', { 二等座: [134.5, 60], 一等座: [229, 20] }, { gate: '检票口 B7' }),
        train('D3011', NJ_DAY, '上海虹桥', '南京南', '11:02', '13:20', { 二等座: [94.5, 30] }, { gate: '检票口 A1' }),
        train('G7037', NJ_DAY, '南京南', '上海虹桥', '18:30', '19:45', { 二等座: [134.5, 9], 一等座: [229, 2] }, { gate: '检票口 6' }),
        train('G7041', NJ_DAY, '南京南', '上海虹桥', '19:10', '20:22', { 二等座: [134.5, 30] }, { gate: '检票口 3' }),
      ],
    },
  },
  goals: [
    {
      id: 'changed',
      label: { en: 'The 08:00 ticket changed to a train leaving after 10:30 and arriving by 13:00', zh: '早上的票已改签：10:30以后出发，13:00前到达' },
      condition: { kind: 'record', record: 'rail_order', where: { status: 'paid', changed_from: 'o1', depart: { gte: '10:30' }, arrive: { lte: '13:00' } } },
    },
    {
      id: 'refunded',
      label: { en: 'The 18:30 ticket back to Shanghai refunded', zh: '晚上回上海的票已退' },
      condition: { kind: 'record', record: 'rail_order', where: { order_id: 'o2', status: 'refunded' } },
    },
  ],
  mistakes: [
    { id: 'refund_wrong', label: { en: 'Refunded the morning ticket instead of changing it', zh: '把早上的票退了（应该改签）' }, when: { kind: 'record', record: 'rail_order', where: { order_id: 'o1', status: 'refunded' } } },
    {
      id: 'late',
      label: { en: 'The new train arrives after 13:00', zh: '新车次13:00以后才到' },
      when: { kind: 'record', record: 'rail_order', where: { changed_from: 'o1', status: 'paid', arrive: { gt: '13:00' } } },
    },
    {
      id: 'early',
      label: { en: 'The new train leaves before 10:30', zh: '新车次10:30以前就出发' },
      when: { kind: 'record', record: 'rail_order', where: { changed_from: 'o1', status: 'paid', depart: { lt: '10:30' } } },
    },
  ],
  hints: [
    { en: 'Open the 订单 (orders) tab: your two tickets are under 未出行 (not travelled yet).', zh: '订单 → 未出行' },
    { en: 'Open the G7012 order and tap 改签 (change ticket).', zh: '打开G7012的订单 → 改签' },
    { en: 'Find a train between 10:30 and 13:00 with seats left. If 二等座 is sold out, 一等座 is fine — pay the difference.', zh: '10:30以后出发、13:00前到的车；二等座没票可以选一等座' },
    { en: 'Confirm the change (确认改签) and pay any 差价 (price difference).', zh: '确认改签 → 支付差价' },
    { en: 'Back in 订单, open G7037 and tap 退票 (refund). Read the 退票费 (refund fee) and confirm.', zh: '打开G7037 → 退票 → 确认退票' },
  ],
  vocab: [
    { hanzi: '改签', pinyin: 'gǎiqiān', english: 'to change a ticket (to another train)' },
    { hanzi: '退票', pinyin: 'tuìpiào', english: 'to refund a ticket' },
    { hanzi: '退票费', pinyin: 'tuìpiàofèi', english: 'refund fee' },
    { hanzi: '差价', pinyin: 'chājià', english: 'price difference' },
    { hanzi: '未出行', pinyin: 'wèi chūxíng', english: 'not travelled yet' },
    { hanzi: '一等座', pinyin: 'yīděngzuò', english: 'first-class seat' },
    { hanzi: '原车次', pinyin: 'yuán chēcì', english: 'original train' },
    { hanzi: '开车前', pinyin: 'kāichē qián', english: 'before departure' },
  ],
};

export const RAIL_SCENARIOS: ScenarioSpec[] = [railHangzhouSaturday, railFriendPassport, railChangeRefund];
