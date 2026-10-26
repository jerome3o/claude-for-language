/** 饭点外卖 scenarios: a bowl of noodles your way, lunch for three with 满减 + 红包, milk tea and the rider. */
import type { FoodAddress, FoodItem, FoodShop, ScenarioSpec } from '../types';
import { PASSWORD_FACT, PROFILE, wallet } from './common';

const OFFICE: FoodAddress = { id: 'addr_office', label: '公司', detail: '静安区南京西路1266号 恒隆广场', room: '22楼2205', name: 'Sam（先生）', phone: PROFILE.phone };

const SPICE = { name: '辣度', required: true, choices: [{ name: '不辣' }, { name: '微辣' }, { name: '中辣' }, { name: '特辣' }] };

const NOODLE: FoodItem = {
  id: 'lamian',
  name: '招牌牛肉拉面',
  price: 22,
  desc: '汤清肉烂，一清二白三红四绿',
  sales: 2860,
  emoji: '🍜',
  options: [
    SPICE,
    { name: '面型', required: true, choices: [{ name: '细面' }, { name: '二细' }, { name: '韭叶' }, { name: '宽面' }] },
    { name: '加料', required: false, multi: true, choices: [{ name: '加蛋', price: 2 }, { name: '加牛肉', price: 8 }, { name: '加面', price: 3 }] },
  ],
};

export const NOODLE_SHOP: FoodShop = {
  id: 'shop_lanzhou',
  name: '老兰家牛肉面（南京西路店）',
  category: '面食',
  rating: 4.7,
  monthly_sales: 3200,
  delivery_min: 28,
  delivery_fee: 3,
  min_order: 20,
  km: 1.1,
  packing_fee: 1,
  discounts: [{ threshold: 30, minus: 5 }, { threshold: 50, minus: 10 }],
  emoji: '🍜',
  menu: [
    { category: '招牌推荐', items: [NOODLE, { id: 'chaomian', name: '牛肉炒面', price: 26, sales: 940, emoji: '🍝', options: [SPICE] }] },
    { category: '凉菜', items: [{ id: 'liangban', name: '凉拌牛肉', price: 18, sales: 520, emoji: '🥩' }, { id: 'huanggua', name: '拍黄瓜', price: 8, sales: 760, emoji: '🥒' }] },
    {
      category: '小吃饮品',
      items: [
        { id: 'ludan', name: '卤蛋', price: 3, sales: 1500, emoji: '🥚' },
        { id: 'suanmei', name: '酸梅汤', price: 6, sales: 880, emoji: '🧃', options: [{ name: '温度', required: true, choices: [{ name: '冰' }, { name: '常温' }] }] },
        { id: 'roujiamo', name: '肉夹馍', price: 12, sales: 0, emoji: '🥙', sold_out: true },
      ],
    },
  ],
};

const OTHER_SHOPS: FoodShop[] = [
  {
    id: 'shop_dumpling',
    name: '喜饺子·手工水饺',
    category: '饺子',
    rating: 4.5,
    monthly_sales: 1800,
    delivery_min: 35,
    delivery_fee: 4,
    min_order: 25,
    km: 2.3,
    packing_fee: 1,
    discounts: [{ threshold: 40, minus: 6 }],
    emoji: '🥟',
    menu: [{ category: '水饺', items: [{ id: 'jiucai', name: '韭菜猪肉水饺（15个）', price: 24, emoji: '🥟' }, { id: 'sanxian', name: '三鲜水饺（15个）', price: 28, emoji: '🥟' }] }],
  },
  {
    id: 'shop_burger',
    name: '好堡堡汉堡',
    category: '快餐',
    rating: 4.3,
    monthly_sales: 5200,
    delivery_min: 30,
    delivery_fee: 2,
    min_order: 15,
    km: 0.8,
    discounts: [{ threshold: 35, minus: 7 }],
    emoji: '🍔',
    menu: [{ category: '汉堡', items: [{ id: 'chicken', name: '香辣鸡腿堡', price: 18, emoji: '🍔' }, { id: 'fries', name: '薯条（中）', price: 9, emoji: '🍟' }] }],
  },
];

const LUNCH_SHOP: FoodShop = {
  id: 'shop_yang',
  name: '杨记家常菜',
  category: '快餐',
  rating: 4.6,
  monthly_sales: 4100,
  delivery_min: 32,
  delivery_fee: 4,
  min_order: 20,
  km: 1.6,
  packing_fee: 1.5,
  discounts: [{ threshold: 40, minus: 8 }, { threshold: 50, minus: 12 }],
  emoji: '🍱',
  menu: [
    {
      category: '盖饭',
      items: [
        { id: 'gongbao', name: '宫保鸡丁饭', price: 23, sales: 1320, emoji: '🍛', options: [{ name: '辣度', required: true, choices: [{ name: '不辣' }, { name: '微辣' }, { name: '中辣' }] }] },
        { id: 'yuxiang', name: '鱼香肉丝饭', price: 22, sales: 1104, emoji: '🍛' },
        { id: 'fanqie', name: '番茄炒蛋饭', price: 19, sales: 1530, emoji: '🍅' },
        { id: 'paigu', name: '红烧排骨饭', price: 28, sales: 0, emoji: '🍖', sold_out: true },
        { id: 'mapo', name: '麻婆豆腐饭', price: 18, sales: 860, emoji: '🍲', options: [{ name: '辣度', required: true, choices: [{ name: '微辣' }, { name: '中辣' }, { name: '特辣' }] }] },
      ],
    },
    { category: '汤 · 加饭', items: [{ id: 'tang', name: '紫菜蛋花汤', price: 6, emoji: '🥣' }, { id: 'mifan', name: '米饭', price: 2, emoji: '🍚' }] },
  ],
};

const FOOD_VOCAB_BASE = [
  { hanzi: '外卖', pinyin: 'wàimài', english: 'takeaway delivery' },
  { hanzi: '规格', pinyin: 'guīgé', english: 'options (size, spice…)' },
  { hanzi: '起送', pinyin: 'qǐsòng', english: 'minimum order for delivery' },
  { hanzi: '配送费', pinyin: 'pèisòngfèi', english: 'delivery fee' },
  { hanzi: '购物车', pinyin: 'gòuwùchē', english: 'shopping cart' },
  { hanzi: '去结算', pinyin: 'qù jiésuàn', english: 'go to checkout' },
];

export const foodBeefNoodles: ScenarioSpec = {
  id: 'food-beef-noodles',
  version: 1,
  title: { en: 'Beef noodles to the office', zh: '点一碗牛肉面' },
  difficulty: 'easy',
  apps: ['food'],
  minutes: 5,
  situation: "It's lunchtime at the office and it's raining. You fancy a bowl of Lanzhou beef noodles from the shop round the corner.",
  goal: {
    en: 'Order one 招牌牛肉拉面 from 老兰家牛肉面 — medium spicy (中辣), any noodle shape, with an extra egg (加蛋) — to your office. No coriander (不要香菜), and you don\'t need cutlery.',
    zh: '在老兰家牛肉面点一碗招牌牛肉拉面：中辣、加蛋，送到公司；不要香菜，不需要餐具。',
  },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '11:50',
  profile: PROFILE,
  wallet: wallet(),
  world: { food: { shops: [NOODLE_SHOP, ...OTHER_SHOPS], addresses: [OFFICE], red_packets: [{ id: 'rp3', name: '平台红包', amount: 3, threshold: 20 }] } },
  goals: [
    {
      id: 'noodles',
      label: { en: 'A paid order of 招牌牛肉拉面, 中辣 + 加蛋', zh: '已支付：招牌牛肉拉面，中辣，加蛋' },
      condition: {
        kind: 'record',
        record: 'food_order',
        where: { status: { nin: ['unpaid', 'cancelled'] }, shop_id: 'shop_lanzhou', lines: { some: { match: { item_id: 'lamian', options: { has_all: ['中辣', '加蛋'] } } } } },
      },
    },
    { id: 'office', label: { en: 'Delivered to the office', zh: '送到公司' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, address_id: 'addr_office' } } },
    { id: 'coriander', label: { en: 'Asked for no coriander', zh: '备注：不要香菜' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, note: { contains: '香菜' } } } },
    { id: 'cutlery', optional: true, label: { en: 'Bonus: no cutlery (无需餐具)', zh: '加分：无需餐具' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, cutlery: '无需餐具' } } },
  ],
  mistakes: [
    {
      id: 'spice',
      label: { en: 'Not medium spicy (中辣)', zh: '辣度选错了' },
      when: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, lines: { some: { match: { item_id: 'lamian', options: { some: { in: ['不辣', '微辣', '特辣'] } } } } } } },
    },
  ],
  hints: [
    { en: 'Tap the shop 老兰家牛肉面 (or search 牛肉面).', zh: '进店：老兰家牛肉面' },
    { en: 'Next to 招牌牛肉拉面 tap 选规格 (choose options): 中辣, a noodle shape, and 加蛋 under 加料. Then 加入购物车.', zh: '选规格：中辣、面型、加蛋 → 加入购物车' },
    { en: 'Tap 去结算 (checkout) on the cart bar.', zh: '去结算' },
    { en: 'Check the address is 公司. Under 备注 tap 不要香菜; under 餐具数量 choose 无需餐具.', zh: '地址：公司　备注：不要香菜　餐具：无需餐具' },
    { en: 'Tap 提交订单 and pay.', zh: '提交订单 → 支付' },
  ],
  vocab: [
    ...FOOD_VOCAB_BASE,
    { hanzi: '辣度', pinyin: 'làdù', english: 'spiciness' },
    { hanzi: '中辣', pinyin: 'zhōnglà', english: 'medium spicy' },
    { hanzi: '加料', pinyin: 'jiāliào', english: 'extra toppings' },
    { hanzi: '香菜', pinyin: 'xiāngcài', english: 'coriander' },
    { hanzi: '备注', pinyin: 'bèizhù', english: 'note, remarks' },
    { hanzi: '餐具', pinyin: 'cānjù', english: 'cutlery' },
  ],
};

export const foodTeamLunch: ScenarioSpec = {
  id: 'food-team-lunch',
  version: 1,
  title: { en: 'Lunch for three on a budget', zh: '三个人的午饭' },
  difficulty: 'medium',
  apps: ['food'],
  minutes: 7,
  situation: 'Two colleagues asked you to order lunch for the three of you from 杨记家常菜. The team budget is ¥60 including delivery.',
  goal: {
    en: 'Order three rice dishes (盖饭) from 杨记家常菜 — any three that are available — so the order reaches the ¥50 满减 (spend 50, save 12), use a 红包, and pay ¥60 or less in total, delivered to the office.',
    zh: '在杨记家常菜点三份盖饭，凑够满50减12，用上红包，实付不超过60元，送到公司。',
  },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '11:35',
  profile: PROFILE,
  wallet: wallet(),
  world: {
    food: {
      shops: [LUNCH_SHOP, NOODLE_SHOP, ...OTHER_SHOPS],
      addresses: [OFFICE],
      red_packets: [
        { id: 'rp4', name: '平台红包', amount: 4, threshold: 35 },
        { id: 'rp6', name: '平台红包', amount: 6, threshold: 45 },
        { id: 'rp10', name: '新人红包', amount: 10, threshold: 80 },
      ],
    },
  },
  goals: [
    {
      id: 'three',
      label: { en: 'Three 盖饭 from 杨记家常菜, paid', zh: '已支付：杨记家常菜三份盖饭' },
      condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, shop_id: 'shop_yang', main_count: { gte: 3 } } },
    },
    { id: 'manjian', label: { en: 'The 满50减12 discount applied', zh: '用上了满50减12' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, shop_id: 'shop_yang', discount: { gte: 12 } } } },
    { id: 'redpacket', label: { en: 'A 红包 used', zh: '用了红包' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, shop_id: 'shop_yang', red_packet: { gt: 0 } } } },
    { id: 'budget', label: { en: 'Paid ¥60 or less', zh: '实付不超过60元' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, shop_id: 'shop_yang', total: { lte: 60 } } } },
  ],
  mistakes: [
    { id: 'over', label: { en: 'Paid more than the ¥60 budget', zh: '超出了60元预算' }, when: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, total: { gt: 60 } } } },
  ],
  hints: [
    { en: 'Open 杨记家常菜. Some dishes need 规格 (spice level) first; 红烧排骨饭 is 已售罄 (sold out).', zh: '进店：杨记家常菜（红烧排骨饭已售罄）' },
    { en: 'Add three 盖饭. The cart bar shows how far you are from the next 满减.', zh: '加三份盖饭，看购物车提示“再买…可减…”' },
    { en: 'At checkout, check the 满减 line, then tap 红包 and pick the best one you can use.', zh: '结算页：满减 → 红包（选可用的）' },
    { en: 'Check 实付 is ¥60 or less, then 提交订单 and pay.', zh: '实付 ≤ 60元 → 提交订单' },
  ],
  vocab: [
    ...FOOD_VOCAB_BASE,
    { hanzi: '盖饭', pinyin: 'gàifàn', english: 'rice with a topping (rice bowl)' },
    { hanzi: '满减', pinyin: 'mǎnjiǎn', english: 'spend-and-save discount' },
    { hanzi: '红包', pinyin: 'hóngbāo', english: 'red packet (here: a coupon)' },
    { hanzi: '实付', pinyin: 'shífù', english: 'amount actually paid' },
    { hanzi: '已售罄', pinyin: 'yǐ shòuqìng', english: 'sold out' },
    { hanzi: '包装费', pinyin: 'bāozhuāngfèi', english: 'packaging fee' },
  ],
};

const SWEET = { name: '甜度', required: true, choices: [{ name: '全糖' }, { name: '七分糖' }, { name: '半糖' }, { name: '三分糖' }, { name: '不加糖' }] };
const ICE = { name: '温度', required: true, choices: [{ name: '正常冰' }, { name: '少冰' }, { name: '去冰' }, { name: '常温' }, { name: '热' }] };
const TOPPING = { name: '加料', required: false, multi: true, choices: [{ name: '珍珠', price: 2 }, { name: '椰果', price: 2 }, { name: '芋圆', price: 3 }] };

function teaShop(id: string, name: string, rating: number, mins: number, km: number, extra: Partial<FoodShop> = {}): FoodShop {
  return {
    id,
    name,
    category: '奶茶',
    rating,
    monthly_sales: 2000 + Math.round(rating * 300),
    delivery_min: mins,
    delivery_fee: 2,
    min_order: 15,
    km,
    packing_fee: 1,
    discounts: [{ threshold: 30, minus: 4 }],
    emoji: '🧋',
    menu: [
      {
        category: '人气推荐',
        items: [
          { id: `${id}_yzgl`, name: '杨枝甘露', price: 19, emoji: '🥭', options: [SWEET, ICE] },
          { id: `${id}_zhenzhu`, name: '珍珠奶茶', price: 15, emoji: '🧋', options: [SWEET, ICE, TOPPING] },
          { id: `${id}_ningmeng`, name: '暴打柠檬茶', price: 14, emoji: '🍋', options: [SWEET, ICE] },
        ],
      },
    ],
    ...extra,
  };
}

export const foodMilkTeaRider: ScenarioSpec = {
  id: 'food-milk-tea-rider',
  version: 1,
  title: { en: 'Milk tea at home, and a message from the rider', zh: '在家点奶茶' },
  difficulty: 'hard',
  apps: ['food'],
  minutes: 10,
  situation:
    "It's Saturday afternoon at your flat. You fancy a 杨枝甘露. Your usual shop is closed today. Your home address isn't saved in the app yet. You're about to jump in the shower.",
  goal: {
    en: "Order a 杨枝甘露 with less ice (少冰) and half sugar (半糖) from a shop rated 4.7 or higher that delivers within 30 minutes, to your flat. When the rider messages you, you're in the shower — ask him to leave it with the security guard at the gate.",
    zh: '从评分4.7以上、30分钟内送达的店点一杯杨枝甘露：少冰、半糖，送到家。骑手联系你的时候你在洗澡，请他放在小区门卫那里。',
  },
  facts: [
    { en: 'Your flat: 静安区愚园路68弄 梧桐公寓, building 3, flat 1202 (3号楼1202室).', zh: '家：静安区愚园路68弄 梧桐公寓 3号楼1202室' },
    { en: `Name on the order: Sam; phone ${PROFILE.phone}.`, zh: `联系人：Sam　手机：${PROFILE.phone}` },
    PASSWORD_FACT,
  ],
  today: '2026-10-31',
  now: '15:10',
  profile: PROFILE,
  wallet: wallet(),
  personas: [
    {
      id: 'rider',
      name: '骑手小李',
      role: 'A food-delivery rider in his twenties delivering a milk tea to a residential compound in Shanghai.',
      personality: 'Cheerful, in a hurry (more orders waiting), polite; short messages.',
      knows:
        "You are at the gate of 梧桐公寓 (愚园路68弄). The security guard (保安 / 门卫) won't let delivery scooters into the compound. You can leave the drink with the guard at the gate (门卫室), or wait 5 minutes for the customer to come down, or hang it on the gate rack. The order is one 杨枝甘露.",
      aim: 'Hand the order over: either the customer comes down, or they tell you where to leave it.',
      opening: '您好，我是饭点骑手小李，您的外卖到小区门口了，保安不让电动车进去，您方便下来拿一下吗？',
      actions: [
        {
          name: 'drop_off',
          description: 'The learner has told you where to leave the order (or that they will come down); say you have done it.',
          params: { place: 'where you will leave it, in Chinese (e.g. 门卫室)' },
        },
      ],
      fake_reply: '好的，我放在门卫室了，您记得来拿哦。',
      fake_action: { name: 'drop_off', params: { place: '门卫室' } },
    },
  ],
  world: {
    food: {
      shops: [
        teaShop('tea_usual', '茶语时光（愚园路店）', 4.9, 20, 0.6, { closed: true }),
        teaShop('tea_fresh', '一杯鲜果茶', 4.8, 28, 1.5),
        teaShop('tea_slow', '慢慢喝奶茶', 4.5, 25, 1.2),
        teaShop('tea_sweet', '甜心饮品屋', 4.7, 45, 3.8),
        NOODLE_SHOP,
      ],
      addresses: [OFFICE],
      rider_persona: 'rider',
    },
  },
  goals: [
    {
      id: 'tea',
      label: { en: 'A paid 杨枝甘露 (少冰, 半糖) from a 4.7+ shop delivering in 30 min', zh: '已支付：杨枝甘露（少冰、半糖），4.7分以上、30分钟内送达的店' },
      condition: {
        kind: 'record',
        record: 'food_order',
        where: { status: { nin: ['unpaid', 'cancelled'] }, shop_rating: { gte: 4.7 }, shop_minutes: { lte: 30 }, lines: { some: { match: { name: '杨枝甘露', options: { has_all: ['少冰', '半糖'] } } } } },
      },
    },
    { id: 'home', label: { en: 'Delivered to your flat (saved as a new address)', zh: '送到家（新地址）' }, condition: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, address: { contains: '愚园路68弄' } } } },
    {
      id: 'guard',
      label: { en: 'Asked the rider to leave it with the guard', zh: '请骑手放在门卫那里' },
      condition: {
        kind: 'any_of',
        conditions: ['门卫', '保安', '门口'].map((w) => ({ kind: 'event' as const, event: 'persona.action', where: { persona: 'rider', action: 'drop_off', 'params.place': { contains: w } } })),
      },
    },
  ],
  mistakes: [
    { id: 'shop', label: { en: 'Ordered from a shop rated under 4.7 or slower than 30 minutes', zh: '店铺不符合要求（评分或送达时间）' }, when: { kind: 'any_of', conditions: [{ kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, shop_rating: { lt: 4.7 } } }, { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, shop_minutes: { gt: 30 } } }] } },
    { id: 'office', label: { en: 'Sent it to the office instead of home', zh: '送到了公司' }, when: { kind: 'record', record: 'food_order', where: { status: { nin: ['unpaid', 'cancelled'] }, address_id: 'addr_office' } } },
  ],
  hints: [
    { en: 'Search 杨枝甘露 or open the 奶茶 category. Compare each shop\'s rating (分) and time (分钟). 茶语时光 is 休息中 (closed).', zh: '搜索“杨枝甘露”，看评分和送达时间' },
    { en: 'In the shop, 选规格: 温度 = 少冰, 甜度 = 半糖, then add to the cart and 去结算.', zh: '选规格：少冰、半糖' },
    { en: 'Tap the address → 新增收货地址 (add address): 地址, 门牌号 (3号楼1202室), 联系人, 手机号, label 家. Save and choose it.', zh: '新增收货地址：门牌号 3号楼1202室，标签 家' },
    { en: 'Submit and pay. Then wait on the order page for the rider.', zh: '提交订单 → 等骑手' },
    { en: 'Reply to the rider: 我在洗澡，麻烦你放在门卫那里吧，谢谢！', zh: '我在洗澡，麻烦你放在门卫那里吧，谢谢！' },
  ],
  vocab: [
    ...FOOD_VOCAB_BASE.slice(0, 3),
    { hanzi: '少冰', pinyin: 'shǎo bīng', english: 'less ice' },
    { hanzi: '半糖', pinyin: 'bàn táng', english: 'half sugar' },
    { hanzi: '休息中', pinyin: 'xiūxi zhōng', english: 'closed (resting) now' },
    { hanzi: '收货地址', pinyin: 'shōuhuò dìzhǐ', english: 'delivery address' },
    { hanzi: '门牌号', pinyin: 'ménpáihào', english: 'house / flat number' },
    { hanzi: '骑手', pinyin: 'qíshǒu', english: 'delivery rider' },
    { hanzi: '门卫', pinyin: 'ménwèi', english: 'gatekeeper, security guard' },
    { hanzi: '小区', pinyin: 'xiǎoqū', english: 'residential compound' },
  ],
};

export const FOOD_SCENARIOS: ScenarioSpec[] = [foodBeefNoodles, foodTeamLunch, foodMilkTeaRider];
