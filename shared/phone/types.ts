/**
 * 📱 Phone practice (手机练习, docs/PHONE_PRACTICE.md): simulated Chinese phone apps with
 * real-life tasks. A task is a SCENARIO SPEC — plain JSON, validated by `validateScenarioSpec`
 * — holding which apps it uses, the seeded world those apps render (stations, trains, shops,
 * cinemas, drivers…), the goal in English + Chinese, hints, and declarative goal conditions
 * the engine (engine.ts) checks against the phone's event log.
 *
 * The apps are fixed, trusted React components (frontend/src/phone/apps/…) that render a
 * scenario's world and emit events; nothing in a spec is code. Everything here is pure TS (no
 * DOM) so the Lab app can port it.
 *
 * Brands: every app is FICTIONAL (names, logos, colours — copy.ts) while its flows, layout,
 * copy and conventions follow the real Chinese apps of its kind.
 */

export const PHONE_SCHEMA_VERSION = 1;

/** The simulated apps. `sms` and `wallet` are system apps every scenario has. */
export const PHONE_APP_IDS = ['rail', 'ride', 'food', 'movie', 'dine', 'chat', 'wallet', 'sms'] as const;
export type PhoneAppId = (typeof PHONE_APP_IDS)[number];

export const PHONE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type PhoneDifficulty = (typeof PHONE_DIFFICULTIES)[number];

export interface Bilingual {
  en: string;
  zh: string;
}

/** A word the learner meets in the scenario (the finish summary offers "+ Add as card"). */
export interface PhoneVocab {
  hanzi: string;
  pinyin: string;
  english: string;
}

// ---------------------------------------------------------------------------
// Goal conditions (checked by engine.ts against records + events)
// ---------------------------------------------------------------------------

export type Scalar = string | number | boolean | null;

/**
 * A field test. A plain value means "equals" (for an array field: "contains it").
 * Operators combine (all must hold).
 */
export type Matcher =
  | Scalar
  | {
      eq?: Scalar;
      ne?: Scalar;
      in?: Scalar[];
      nin?: Scalar[];
      gt?: number | string;
      gte?: number | string;
      lt?: number | string;
      lte?: number | string;
      /** String field: contains this text. Array field: some element equals it. */
      contains?: string | number;
      /** Array field: every element matches. */
      every?: Matcher;
      /** Array field: at least one element matches. */
      some?: Matcher;
      /** Object field (or an array element under every / some): its fields match. */
      match?: Where;
      /** Array field: contains every one of these. */
      has_all?: Scalar[];
      /** Array or string length. */
      size?: number | { gte?: number; lte?: number };
      /** Field present (true) / absent or null (false). */
      exists?: boolean;
    };

/** Fields of a record / event by dotted path ("passengers.0" works too). */
export type Where = Record<string, Matcher>;

export type GoalCondition =
  /** A record of this kind (its latest version) matching `where`; `count` = how many must. */
  | { kind: 'record'; record: string; where?: Where; count?: number | { gte?: number; lte?: number } }
  /** An event of this type in the log matching `where`. */
  | { kind: 'event'; event: string; where?: Where; count?: number | { gte?: number; lte?: number } }
  | { kind: 'all_of'; conditions: GoalCondition[] }
  | { kind: 'any_of'; conditions: GoalCondition[] }
  | { kind: 'not'; condition: GoalCondition };

export interface ScenarioGoal {
  id: string;
  /** Shown in the task card's checklist and the summary. */
  label: Bilingual;
  condition: GoalCondition;
  /** A bonus ("window seat if possible"): not needed to finish. */
  optional?: boolean;
}

/** Something done wrong (wrong train, wrong date…): checked at the finish. */
export interface ScenarioMistake {
  id: string;
  label: Bilingual;
  when: GoalCondition;
}

/** One step of the 💡 hint: English first, then the Chinese to look for. */
export interface ScenarioHint {
  en: string;
  zh: string;
  /** Shown once this condition holds and the previous hints' `done` don't (optional). */
  done?: GoalCondition;
}

// ---------------------------------------------------------------------------
// Personas (Claude role-play, worker POST /api/phone/persona-reply)
// ---------------------------------------------------------------------------

export interface PersonaActionDef {
  /** snake_case, e.g. found_passenger, confirm_reservation. */
  name: string;
  /** When to emit it (goes into the persona's prompt). */
  description: string;
  /** Parameter names → what they hold (all strings). */
  params?: Record<string, string>;
}

export interface PhonePersona {
  id: string;
  /** How the contact shows in the chat header (王师傅, 张阿姨水果摊). */
  name: string;
  /** For the prompt: who they are, in English. */
  role: string;
  personality: string;
  /** What they know about the situation (the prompt; Chinese or English). */
  knows: string;
  /** What they want from the learner / how the chat should end. */
  aim?: string;
  /** Their first message, sent by the app when the chat opens or an event fires (no model call). */
  opening?: string;
  actions?: PersonaActionDef[];
  /** E2E / offline stand-in: user text containing any of these → `fake_action` (deterministic). */
  fake_reply?: string;
  fake_action?: { name: string; params?: Record<string, string> };
}

export interface PersonaMessage {
  from: 'me' | 'them';
  text: string;
}

export interface PersonaAction {
  name: string;
  params: Record<string, string>;
}

export interface PersonaReply {
  reply: string;
  /** One-line English of the reply (the bubble's 译). */
  english: string;
  actions: PersonaAction[];
}

// ---------------------------------------------------------------------------
// The shared profile + wallet
// ---------------------------------------------------------------------------

export interface PhoneProfile {
  /** The learner's name as on the passport (SWANNACK JEROME). */
  name: string;
  /** Chinese name, if any (for forms that ask for one). */
  name_zh?: string;
  passport_no: string;
  nationality: string;
  phone: string;
  gender?: '男' | '女';
}

export interface WalletCard {
  id: string;
  /** Fictional bank (城东银行). */
  bank: string;
  kind: '储蓄卡' | '信用卡';
  last4: string;
  balance: number;
}

export interface WalletSpec {
  /** 零钱 balance in yuan. */
  balance: number;
  cards: WalletCard[];
  /** Six digits; the task card shows it. */
  pay_password: string;
}

// ---------------------------------------------------------------------------
// App worlds
// ---------------------------------------------------------------------------

export interface RailStation {
  name: string; // 上海虹桥
  city: string; // 上海
  /** Full pinyin, no tones (shanghaihongqiao) — the station search matches it and its initials. */
  pinyin: string;
}

export const RAIL_SEAT_CLASSES = ['商务座', '一等座', '二等座', '软卧', '硬卧', '硬座', '无座'] as const;
export type RailSeatClass = (typeof RAIL_SEAT_CLASSES)[number];

export interface RailSeatOffer {
  class: RailSeatClass;
  price: number;
  /** Seats left (0 = 候补 only when `waitlist`). */
  left: number;
  waitlist?: boolean;
}

export interface RailTrain {
  no: string; // G7311
  date: string; // YYYY-MM-DD
  from: string; // station name
  to: string;
  depart: string; // HH:MM
  arrive: string; // HH:MM (next day when earlier than depart)
  seats: RailSeatOffer[];
  /** 检票口 shown after payment. */
  gate?: string;
  /** Intermediate stops (经停站) for the detail sheet. */
  stops?: string[];
}

export const RAIL_ID_TYPES = ['中国居民身份证', '护照', '外国人永久居留身份证', '港澳居民来往内地通行证', '台湾居民来往大陆通行证'] as const;
export type RailIdType = (typeof RAIL_ID_TYPES)[number];

export const RAIL_PASSENGER_TYPES = ['成人', '儿童', '学生'] as const;

export interface RailPassenger {
  id: string;
  name: string;
  id_type: RailIdType;
  id_no: string;
  /** For 护照 / 外国人永久居留身份证. */
  country?: string;
  type?: (typeof RAIL_PASSENGER_TYPES)[number];
  phone?: string;
  /** 本人 (the account holder). */
  self?: boolean;
}

/** An order the account already has (for 改签 / 退票 scenarios). */
export interface RailOrderSeed {
  id: string;
  train_no: string;
  date: string;
  seat_class: RailSeatClass;
  passengers: string[]; // passenger ids
  seats: string[]; // 05车07F
  price_each: number;
}

export interface RailWorld {
  stations: RailStation[];
  trains: RailTrain[];
  passengers: RailPassenger[];
  orders?: RailOrderSeed[];
  /** The account is logged out: submitting an order asks for 手机号 + 短信验证码 first. */
  logged_out?: boolean;
  /** Prefilled search (else the account's last search: blank). */
  default_from?: string;
  default_to?: string;
}

export interface RidePoi {
  id: string;
  name: string; // 上海虹桥站
  address: string;
  district?: string;
  /** Distance from the start, km (prices + ETA come from it). */
  km: number;
  /** Shown as a category chip (地铁站, 火车站, 机场, 酒店…). */
  kind?: string;
}

export const RIDE_CAR_TYPES = ['特惠快车', '快车', '专车', '出租车'] as const;
export type RideCarType = (typeof RIDE_CAR_TYPES)[number];

export interface RideCarOffer {
  type: RideCarType;
  base: number;
  per_km: number;
  /** Minutes until a car arrives. */
  eta_min: number;
  /** Shown under the name (更便宜, 舒适型…). */
  note?: string;
}

export interface RideDriver {
  name: string; // 王师傅
  car: string; // 白色 · 大众朗逸 (generic model names are fine; no brand logos)
  plate: string; // 沪A·D3K29
  rating: number;
  trips: number;
  /** Persona the 联系司机 chat talks to. */
  persona?: string;
}

export interface RidePastTrip {
  id: string;
  date: string;
  time: string;
  from: string;
  to: string;
  car_type: RideCarType;
  price: number;
  driver: RideDriver;
}

export interface RideWorld {
  /** Where the learner is: 当前位置. */
  start: { name: string; address: string };
  pois: RidePoi[];
  cars: RideCarOffer[];
  driver: RideDriver;
  coupons?: Array<{ id: string; name: string; amount: number; car_type?: RideCarType; min_price?: number }>;
  trips?: RidePastTrip[];
  /** Persona whose `opening` arrives when the driver reaches the pickup point. */
  arrival_persona?: string;
}

export interface FoodOptionGroup {
  name: string; // 辣度
  required: boolean;
  /** More than one choice (加料). */
  multi?: boolean;
  choices: Array<{ name: string; price?: number }>;
}

export interface FoodItem {
  id: string;
  name: string;
  price: number;
  desc?: string;
  /** 月售. */
  sales?: number;
  options?: FoodOptionGroup[];
  sold_out?: boolean;
  /** Emoji shown as the dish picture. */
  emoji?: string;
}

export interface FoodShop {
  id: string;
  name: string;
  category: string; // 面食, 奶茶, 快餐…
  rating: number;
  monthly_sales: number;
  /** Minutes. */
  delivery_min: number;
  delivery_fee: number;
  min_order: number;
  km: number;
  /** 满减: threshold → minus (the best one that applies is used). */
  discounts?: Array<{ threshold: number; minus: number }>;
  /** 包装费 per item. */
  packing_fee?: number;
  /** 休息中. */
  closed?: boolean;
  emoji?: string;
  menu: Array<{ category: string; items: FoodItem[] }>;
  /** Persona of the shop's chat (联系商家). */
  persona?: string;
}

export interface FoodAddress {
  id: string;
  label?: '家' | '公司' | '学校';
  detail: string; // 静安区南京西路1266号 恒隆广场
  room?: string; // 22楼2205
  name: string;
  phone: string;
}

export interface FoodRedPacket {
  id: string;
  name: string; // 平台红包
  amount: number;
  threshold: number;
}

export interface FoodWorld {
  shops: FoodShop[];
  addresses: FoodAddress[];
  red_packets?: FoodRedPacket[];
  /** Persona whose `opening` arrives when the rider is close. */
  rider_persona?: string;
  /** Quick note chips under 备注. */
  note_tags?: string[];
}

export interface MovieFilm {
  id: string;
  title: string;
  /** Original title for a foreign film (shown as 原名). */
  original?: string;
  genres: string[];
  minutes: number;
  score: number;
  /** Poster gradient colours. */
  colors?: [string, string];
  region?: string; // 中国大陆, 美国
  cast?: string;
  status?: 'showing' | 'coming';
  /** 即将上映 date / wishes. */
  release?: string;
}

export interface MovieCinema {
  id: string;
  name: string;
  address: string;
  km: number;
  tags?: string[]; // IMAX厅, 杜比全景声, 可停车, 小吃
}

export interface MovieSeatMap {
  rows: number;
  cols: number;
  /** Columns after which there's an aisle gap (1-based). */
  aisles_after?: number[];
  /** "排-座" ids that don't exist (corners, steps). */
  missing?: string[];
  sold?: string[];
  /** Couple seats as left seat ids: the seat and the one to its right are one pair. */
  couple?: string[];
}

export interface MovieShow {
  id: string;
  film: string; // film id
  cinema: string; // cinema id
  date: string;
  start: string;
  hall: string; // 5号厅
  format: '2D' | '3D' | 'IMAX 2D' | 'IMAX 3D' | '杜比影院';
  language: '国语' | '英语' | '粤语' | '日语' | '原版';
  price: number;
  seats: MovieSeatMap;
}

export interface MovieWorld {
  city: string;
  films: MovieFilm[];
  cinemas: MovieCinema[];
  shows: MovieShow[];
  snacks?: Array<{ id: string; name: string; price: number; desc?: string }>;
}

export interface DineQueueTable {
  id: string; // A / B / C
  name: string; // 小桌
  min: number;
  max: number;
  waiting: number;
  minutes: number;
}

export interface DineRestaurant {
  id: string;
  name: string;
  cuisine: string; // 本帮菜
  rating: number;
  /** 口味 / 环境 / 服务. */
  scores?: [number, number, number];
  avg_price: number;
  district: string;
  address: string;
  hours: string;
  tags?: string[];
  dishes?: string[]; // 推荐菜
  reviews?: Array<{ user: string; stars: number; text: string }>;
  /** 排队取号 (absent = no online queue). */
  queue?: DineQueueTable[];
  /** 订座 (absent = no booking). */
  booking?: {
    dates: string[];
    times: string[];
    /** "YYYY-MM-DD HH:MM" slots already full. */
    full?: string[];
    max_people: number;
    rooms?: { min_people: number; min_spend: number };
  };
  emoji?: string;
  persona?: string;
}

export interface DineWorld {
  restaurants: DineRestaurant[];
}

export interface ChatContact {
  id: string;
  name: string;
  /** Avatar colour + the character drawn on it. */
  color?: string;
  initial?: string;
  persona?: string;
  /** A business account (shows 商家 badge). */
  business?: boolean;
}

export interface ChatSeedMessage {
  from: 'me' | 'them';
  kind?: 'text' | 'transfer' | 'red_packet' | 'mini_program' | 'image' | 'system';
  text?: string;
  amount?: number;
  /** For a mini_program card: which app it opens. */
  app?: PhoneAppId;
  time?: string; // HH:MM or 昨天
  /** A red packet they sent that is still unopened. */
  opened?: boolean;
}

export interface ChatThread {
  contact: string;
  messages: ChatSeedMessage[];
  unread?: number;
  pinned?: boolean;
}

export interface ChatQrCode {
  id: string;
  /** The payee's name on the 付款 screen. */
  payee: string;
  /** What is printed above the code at the stall (收款码 / 加好友). */
  label: string;
  kind: 'pay' | 'contact';
  /** Fixed amount (a 收款码 with an amount), else typed. */
  amount?: number;
}

export interface ChatWorld {
  me: { name: string; id: string };
  contacts: ChatContact[];
  threads: ChatThread[];
  /** What 扫一扫 can see (the camera shows these codes; tap one to scan it). */
  qr_codes?: ChatQrCode[];
}

export interface PhoneWorld {
  rail?: RailWorld;
  ride?: RideWorld;
  food?: FoodWorld;
  movie?: MovieWorld;
  dine?: DineWorld;
  chat?: ChatWorld;
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

export interface ScenarioSpec {
  id: string;
  version: number;
  title: Bilingual;
  difficulty: PhoneDifficulty;
  /** The apps the task is about (the list's icons; the first is where it usually starts). */
  apps: PhoneAppId[];
  /** One-paragraph situation (English) — the task card's top line. */
  situation: string;
  goal: Bilingual;
  /** Facts the learner needs (your passport number, the pay password…). */
  facts?: Bilingual[];
  /** Simulated date + time on the phone. */
  today: string; // YYYY-MM-DD
  now: string; // HH:MM
  profile: PhoneProfile;
  wallet: WalletSpec;
  world: PhoneWorld;
  personas?: PhonePersona[];
  goals: ScenarioGoal[];
  mistakes?: ScenarioMistake[];
  hints: ScenarioHint[];
  vocab: PhoneVocab[];
  /** Rough minutes for a learner at HSK 3. */
  minutes?: number;
}

// ---------------------------------------------------------------------------
// Runtime: the event log
// ---------------------------------------------------------------------------

/** A record write: the latest `data` per (record, id) is what goals see. */
export interface PhoneRecordEvent {
  type: 'record';
  record: string; // rail_order, ride_order, food_order, movie_order, dine_booking, dine_queue, transfer, qr_payment…
  id: string;
  data: Record<string, unknown>;
  at: number;
  [key: string]: unknown;
}

export interface PhoneSimpleEvent {
  type: string; // app.open, hint, persona.message, persona.action, error, pay.failed…
  at: number;
  [key: string]: unknown;
}

export type PhoneEvent = PhoneRecordEvent | PhoneSimpleEvent;

export interface PhoneRecord {
  record: string;
  id: string;
  data: Record<string, unknown>;
  at: number;
}
