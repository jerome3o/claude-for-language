/** 爆米花电影 scenarios: two seats tonight, the IMAX original-language show, a couple seat with popcorn. */
import type { MovieCinema, MovieFilm, MovieSeatMap, MovieShow, MovieWorld, ScenarioSpec } from '../types';
import { PASSWORD_FACT, PROFILE, wallet } from './common';

const FILMS: MovieFilm[] = [
  { id: 'f_star', title: '星河归途', genres: ['科幻', '冒险'], minutes: 132, score: 9.2, colors: ['#1d2b64', '#6a3093'], region: '中国大陆', cast: '主演：陈远 / 林小雨 / 周北', status: 'showing' },
  { id: 'f_granny', title: '外婆的小饭馆', genres: ['剧情', '喜剧', '家庭'], minutes: 108, score: 8.8, colors: ['#f7971e', '#d35400'], region: '中国大陆', cast: '主演：吴梅 / 张一凡', status: 'showing' },
  { id: 'f_harbor', title: '月光港湾', original: 'Moonlight Harbor', genres: ['爱情', '剧情'], minutes: 118, score: 8.6, colors: ['#134e5e', '#71b280'], region: '美国', cast: '主演：艾玛·黑尔 / 里奥·格兰特', status: 'showing' },
  { id: 'f_fog', title: '迷雾追踪', genres: ['悬疑', '犯罪'], minutes: 121, score: 8.1, colors: ['#232526', '#414345'], region: '中国香港', cast: '主演：梁子健 / 何若', status: 'showing' },
  { id: 'f_panda', title: '熊猫小队', genres: ['动画', '冒险'], minutes: 96, score: 0, colors: ['#56ab2f', '#a8e063'], region: '中国大陆', status: 'coming', release: '11月14日上映' },
];

const CINEMAS: MovieCinema[] = [
  { id: 'c_star', name: '星光影城（静安店）', address: '静安区南京西路1601号 5楼', km: 1.2, tags: ['IMAX厅', '杜比全景声', '小吃'] },
  { id: 'c_gold', name: '金色银幕影院（南京西路店）', address: '静安区南京西路388号 7楼', km: 2.4, tags: ['情侣座', '可停车', '小吃'] },
  { id: 'c_times', name: '时代国际影城（徐家汇店）', address: '徐汇区虹桥路1号 6楼', km: 4.6, tags: ['IMAX厅', '4K厅'] },
  { id: 'c_sea', name: '海上影城（五角场店）', address: '杨浦区淞沪路8号 4楼', km: 12.8, tags: ['IMAX厅', '可停车'] },
];

/** A deterministic seat map: `taken` = share of seats sold (0–1), couple seats along the last row. */
function seats(rows: number, cols: number, taken: number, seed: number, opts: { aisles?: number[]; couple?: boolean; soldCouple?: number[] } = {}): MovieSeatMap {
  let x = seed;
  const rnd = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  const sold: string[] = [];
  const couple: string[] = [];
  for (let r = 1; r <= rows; r++) {
    if (opts.couple && r === rows) {
      // The last row is couple seats: pairs 1-2, 3-4, …
      for (let c = 1; c < cols; c += 2) {
        couple.push(`${r}-${c}`);
        if ((opts.soldCouple ?? []).includes(c)) sold.push(`${r}-${c}`, `${r}-${c + 1}`);
      }
      continue;
    }
    // Centre seats sell first.
    for (let c = 1; c <= cols; c++) {
      const centre = 1 - Math.abs(c - (cols + 1) / 2) / cols - Math.abs(r - rows * 0.6) / rows / 2;
      if (rnd() < taken * (0.6 + centre)) sold.push(`${r}-${c}`);
    }
  }
  return { rows, cols, aisles_after: opts.aisles ?? [], missing: [`1-1`, `1-${cols}`], sold, couple };
}

function show(film: string, cinema: string, date: string, start: string, hall: string, format: MovieShow['format'], language: MovieShow['language'], price: number, map: MovieSeatMap): MovieShow {
  return { id: `s_${film.slice(2)}_${cinema.slice(2)}_${date.slice(5).replace('-', '')}_${start.replace(':', '')}`, film, cinema, date, start, hall, format, language, price, seats: map };
}

const SNACKS = [
  { id: 'single', name: '单人套餐', price: 29, desc: '爆米花（中）+ 可乐（中）' },
  { id: 'double', name: '双人套餐', price: 46, desc: '爆米花（大）+ 可乐（中）×2' },
  { id: 'popcorn', name: '爆米花（大）', price: 26, desc: '焦糖口味' },
];

function world(shows: MovieShow[]): MovieWorld {
  return { city: '上海', films: FILMS, cinemas: CINEMAS, shows, snacks: SNACKS };
}

const MOVIE_VOCAB = [
  { hanzi: '电影票', pinyin: 'diànyǐngpiào', english: 'cinema ticket' },
  { hanzi: '影院', pinyin: 'yǐngyuàn', english: 'cinema' },
  { hanzi: '场次', pinyin: 'chǎngcì', english: 'showing, screening' },
  { hanzi: '选座', pinyin: 'xuǎnzuò', english: 'choose seats' },
  { hanzi: '已售', pinyin: 'yǐshòu', english: 'sold' },
  { hanzi: '银幕', pinyin: 'yínmù', english: 'cinema screen' },
  { hanzi: '取票码', pinyin: 'qǔpiàomǎ', english: 'ticket pickup code' },
];

const TONIGHT = '2026-10-29';
const showsTonight = [
  show('f_star', 'c_star', TONIGHT, '18:20', '3号厅', '2D', '国语', 45, seats(9, 14, 0.5, 11, { aisles: [3, 11] })),
  show('f_star', 'c_star', TONIGHT, '19:10', 'IMAX厅', 'IMAX 2D', '国语', 75, seats(12, 18, 0.62, 12, { aisles: [4, 14] })),
  show('f_star', 'c_star', TONIGHT, '20:30', '5号厅', '2D', '国语', 45, seats(9, 14, 0.75, 13, { aisles: [3, 11] })),
  show('f_star', 'c_star', TONIGHT, '21:45', '3号厅', '2D', '国语', 39, seats(9, 14, 0.2, 14, { aisles: [3, 11] })),
  show('f_star', 'c_gold', TONIGHT, '19:40', '2号厅', '2D', '国语', 42, seats(8, 12, 0.55, 15, { aisles: [2, 10], couple: true, soldCouple: [1, 5] })),
  show('f_star', 'c_times', TONIGHT, '19:00', 'IMAX厅', 'IMAX 3D', '国语', 80, seats(12, 18, 0.5, 16, { aisles: [4, 14] })),
  show('f_granny', 'c_star', TONIGHT, '19:30', '6号厅', '2D', '国语', 39, seats(8, 12, 0.4, 17, { aisles: [2, 10] })),
  show('f_harbor', 'c_star', TONIGHT, '20:00', '2号厅', '2D', '英语', 45, seats(8, 12, 0.3, 18, { aisles: [2, 10] })),
];

export const movieTonightTwo: ScenarioSpec = {
  id: 'movie-tonight-two',
  version: 1,
  title: { en: 'Two seats for tonight', zh: '今晚看电影' },
  difficulty: 'easy',
  apps: ['movie'],
  minutes: 5,
  situation: "A friend wants to see the new sci-fi film 星河归途 with you tonight after dinner. 星光影城 is closest to you.",
  goal: {
    en: 'Buy two tickets for 星河归途 tonight at 星光影城（静安店）, at a showing that starts at 19:00 or later, sitting next to each other.',
    zh: '买两张今晚星光影城（静安店）《星河归途》的票，19:00以后开场，两个座位挨着。',
  },
  facts: [PASSWORD_FACT],
  today: TONIGHT,
  now: '16:30',
  profile: PROFILE,
  wallet: wallet(),
  world: { movie: world(showsTonight) },
  goals: [
    {
      id: 'tickets',
      label: { en: 'Two paid tickets for 星河归途 at 星光影城, tonight from 19:00', zh: '已支付：今晚19点以后星光影城《星河归途》两张' },
      condition: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_star', cinema_id: 'c_star', date: TONIGHT, start: { gte: '19:00' }, seat_count: 2 } },
    },
    { id: 'together', label: { en: 'The two seats are side by side', zh: '两个座位挨着' }, condition: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_star', adjacent: true } } },
  ],
  mistakes: [
    { id: 'early', label: { en: 'The showing starts before 19:00', zh: '场次在19:00以前' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', start: { lt: '19:00' } } } },
    { id: 'cinema', label: { en: 'Another cinema', zh: '影院选错了' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', cinema_id: { ne: 'c_star' } } } },
  ],
  hints: [
    { en: 'On 正在热映 (now showing) tap 购票 (buy) next to 星河归途.', zh: '正在热映 → 星河归途 → 购票' },
    { en: 'Today is selected. Tap 星光影城（静安店）.', zh: '选择影院：星光影城（静安店）' },
    { en: 'Pick a showing at 19:00 or later (any 版本 / hall).', zh: '选19:00以后的场次' },
    { en: 'Tap two free seats next to each other (grey = 已售 sold). Don\'t leave a single empty seat beside them. Then 确认选座.', zh: '选两个挨着的空座 → 确认选座' },
    { en: 'Check the order and 立即支付.', zh: '确认订单 → 立即支付' },
  ],
  vocab: [...MOVIE_VOCAB, { hanzi: '正在热映', pinyin: 'zhèngzài rèyìng', english: 'now showing' }, { hanzi: '开场', pinyin: 'kāichǎng', english: '(a showing) starts' }],
};

const TOMORROW = '2026-10-30';
const showsTomorrow = [
  show('f_harbor', 'c_star', TOMORROW, '14:30', 'IMAX厅', 'IMAX 2D', '英语', 68, seats(12, 18, 0.35, 21, { aisles: [4, 14] })),
  show('f_harbor', 'c_times', TOMORROW, '13:50', 'IMAX厅', 'IMAX 2D', '英语', 59, seats(12, 18, 0.3, 22, { aisles: [4, 14] })),
  show('f_harbor', 'c_sea', TOMORROW, '13:00', 'IMAX厅', 'IMAX 2D', '英语', 49, seats(12, 18, 0.2, 23, { aisles: [4, 14] })),
  show('f_harbor', 'c_gold', TOMORROW, '15:20', '1号厅', '2D', '国语', 39, seats(8, 12, 0.25, 24, { aisles: [2, 10], couple: true })),
  show('f_harbor', 'c_star', TOMORROW, '16:40', '2号厅', '2D', '英语', 45, seats(8, 12, 0.3, 25, { aisles: [2, 10] })),
  show('f_harbor', 'c_times', TOMORROW, '19:30', 'IMAX厅', 'IMAX 2D', '英语', 79, seats(12, 18, 0.6, 26, { aisles: [4, 14] })),
  show('f_harbor', 'c_times', TOMORROW, '11:10', 'IMAX厅', 'IMAX 2D', '英语', 49, seats(12, 18, 0.15, 27, { aisles: [4, 14] })),
  show('f_star', 'c_star', TOMORROW, '14:00', 'IMAX厅', 'IMAX 2D', '国语', 75, seats(12, 18, 0.5, 28, { aisles: [4, 14] })),
];

export const movieImaxEnglish: ScenarioSpec = {
  id: 'movie-imax-english',
  version: 1,
  title: { en: 'IMAX in the original language', zh: '看IMAX原版' },
  difficulty: 'medium',
  apps: ['movie'],
  minutes: 7,
  situation: "Tomorrow (Friday) afternoon you're free and want to see the American film 月光港湾 (Moonlight Harbor) in IMAX — in English, not dubbed. You don't want to travel more than 5 km.",
  goal: {
    en: 'Buy one ticket for 月光港湾 tomorrow afternoon (starting 12:00–18:00), IMAX, English-language version, at the cheapest such showing within 5 km.',
    zh: '买一张明天下午（12:00–18:00开场）《月光港湾》IMAX英语原版的票，选5公里以内最便宜的场次。',
  },
  facts: [PASSWORD_FACT],
  today: TONIGHT,
  now: '20:15',
  profile: PROFILE,
  wallet: wallet(),
  world: { movie: world(showsTomorrow) },
  goals: [
    {
      id: 'ticket',
      label: { en: 'A paid IMAX English ticket for 月光港湾 tomorrow afternoon', zh: '已支付：明天下午《月光港湾》IMAX英语版' },
      condition: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_harbor', date: TOMORROW, format: { contains: 'IMAX' }, language: '英语', start: { gte: '12:00', lte: '18:00' }, seat_count: 1 } },
    },
    {
      id: 'cheapest',
      label: { en: 'The cheapest one within 5 km', zh: '5公里内最便宜的场次' },
      condition: { kind: 'record', record: 'movie_order', where: { status: 'paid', show_id: 's_harbor_times_1030_1350' } },
    },
  ],
  mistakes: [
    { id: 'dubbed', label: { en: 'Bought the dubbed (国语) version', zh: '买了国语配音版' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_harbor', language: '国语' } } },
    { id: 'far', label: { en: 'The cinema is more than 5 km away', zh: '影院超过5公里' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', cinema_km: { gt: 5 } } } },
    { id: 'notimax', label: { en: 'Not an IMAX showing', zh: '不是IMAX场次' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_harbor', format: { nin: ['IMAX 2D', 'IMAX 3D'] } } } },
  ],
  hints: [
    { en: 'Tap 月光港湾, then 特惠购票. Switch the date to 明天 (tomorrow).', zh: '月光港湾 → 特惠购票 → 明天' },
    { en: 'Filter by 特色 → IMAX厅. Each cinema shows its distance (km) and lowest price.', zh: '筛选：特色 → IMAX厅；看距离和价格' },
    { en: 'Open the cinemas within 5 km and compare the afternoon showings marked IMAX and 英语.', zh: '比较5公里内下午的“IMAX 2D 英语”场次' },
    { en: 'Choose one seat and pay.', zh: '选一个座位 → 支付' },
  ],
  vocab: [
    ...MOVIE_VOCAB,
    { hanzi: '原版', pinyin: 'yuánbǎn', english: 'original-language version' },
    { hanzi: '国语', pinyin: 'guóyǔ', english: 'Mandarin (dubbed)' },
    { hanzi: '英语', pinyin: 'yīngyǔ', english: 'English' },
    { hanzi: '特色', pinyin: 'tèsè', english: 'special feature' },
    { hanzi: '公里', pinyin: 'gōnglǐ', english: 'kilometre' },
  ],
};

const SATURDAY = '2026-10-31';
const showsSaturday = [
  show('f_granny', 'c_gold', SATURDAY, '18:10', '2号厅', '2D', '国语', 45, seats(8, 12, 0.7, 31, { aisles: [2, 10], couple: true, soldCouple: [1, 3, 5, 7, 9, 11] })),
  show('f_granny', 'c_gold', SATURDAY, '19:30', '2号厅', '2D', '国语', 49, seats(8, 12, 0.55, 32, { aisles: [2, 10], couple: true, soldCouple: [1, 5, 9] })),
  show('f_granny', 'c_gold', SATURDAY, '21:20', '3号厅', '2D', '国语', 42, seats(8, 12, 0.35, 33, { aisles: [2, 10], couple: true, soldCouple: [3] })),
  show('f_granny', 'c_star', SATURDAY, '19:00', '6号厅', '2D', '国语', 45, seats(8, 12, 0.5, 34, { aisles: [2, 10] })),
  show('f_star', 'c_gold', SATURDAY, '20:00', '1号厅', '2D', '国语', 49, seats(8, 12, 0.6, 35, { aisles: [2, 10], couple: true, soldCouple: [1] })),
];

export const movieCouplePopcorn: ScenarioSpec = {
  id: 'movie-couple-popcorn',
  version: 1,
  title: { en: 'Date night: a couple seat and popcorn', zh: '约会：情侣座加爆米花' },
  difficulty: 'hard',
  apps: ['movie'],
  minutes: 7,
  situation: 'Saturday evening is date night. Your partner wants to see the comedy 外婆的小饭馆 in a 情侣座 (a double "love seat") — only 金色银幕影院 has them.',
  goal: {
    en: 'Book a 情侣座 for 外婆的小饭馆 at 金色银幕影院 on Saturday evening (from 18:00), and add the 双人套餐 (popcorn + two cokes) to the order.',
    zh: '买周六晚上（18:00以后）金色银幕影院《外婆的小饭馆》的情侣座，并加一份双人套餐。',
  },
  facts: [PASSWORD_FACT],
  today: TONIGHT,
  now: '12:00',
  profile: PROFILE,
  wallet: wallet(),
  world: { movie: world(showsSaturday) },
  goals: [
    {
      id: 'couple',
      label: { en: 'A paid couple seat for 外婆的小饭馆 on Saturday evening', zh: '已支付：周六晚上《外婆的小饭馆》情侣座' },
      condition: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_granny', cinema_id: 'c_gold', date: SATURDAY, start: { gte: '18:00' }, couple: true, seat_count: 2 } },
    },
    { id: 'snack', label: { en: 'The 双人套餐 added', zh: '加了双人套餐' }, condition: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_granny', snacks: '双人套餐' } } },
  ],
  mistakes: [
    { id: 'normal', label: { en: 'Normal seats, not a 情侣座', zh: '买的是普通座，不是情侣座' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', film_id: 'f_granny', couple: false } } },
    { id: 'day', label: { en: 'Not Saturday', zh: '日期不是周六' }, when: { kind: 'record', record: 'movie_order', where: { status: 'paid', date: { ne: SATURDAY } } } },
  ],
  hints: [
    { en: '外婆的小饭馆 → 特惠购票 → switch the date to Saturday (周六).', zh: '外婆的小饭馆 → 特惠购票 → 周六' },
    { en: 'Open 金色银幕影院 and pick an evening showing.', zh: '金色银幕影院 → 晚上的场次' },
    { en: 'The pink pairs in the back row are 情侣座 — one tap takes both seats. If all are sold, try another showing.', zh: '最后一排粉色的是情侣座' },
    { en: 'On 确认订单, add 双人套餐 under 小食, then pay.', zh: '确认订单 → 小食：双人套餐 → 支付' },
  ],
  vocab: [...MOVIE_VOCAB, { hanzi: '情侣座', pinyin: 'qínglǚzuò', english: 'couple seat' }, { hanzi: '套餐', pinyin: 'tàocān', english: 'set meal, combo' }, { hanzi: '爆米花', pinyin: 'bàomǐhuā', english: 'popcorn' }, { hanzi: '小食', pinyin: 'xiǎoshí', english: 'snacks' }],
};

export const MOVIE_SCENARIOS: ScenarioSpec[] = [movieTonightTwo, movieImaxEnglish, movieCouplePopcorn];
