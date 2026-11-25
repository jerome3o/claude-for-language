/**
 * 家 Apartment — a Chinese flat (docs/VR_WORLDS.md): a living room with its entry (玄关), a bedroom and a
 * bathroom joined by a short hallway.
 *
 * Plan (metres, the floor at y 0, x −4 … 4, z −3.4 … 3.4):
 *
 *     z −3.4 ┌──────────────────────┬────┬──────────────┐
 *            │ 卧室 bedroom          │走廊│ 卫生间 bathroom │
 *            │ bed · wardrobe · desk ▯    ▯ basin · washer │   ▯ = doorways
 *     z −0.6 ├──────────────────────┘    └──────────────┤
 *            │ 客厅 living room: sofa (back wall), coffee  │
 *            │ table, TV on the front wall, window on the  ▮ 门 front door (x 4)
 *            │ left wall, bookshelf; the entry (玄关) right │
 *     z  3.4 └────────────────────────────────────────────┘
 *
 * You start in the living room by the hallway, looking at the sofa. The walls never cast shadows (the
 * sun lights every room); two point lights: the floor lamp and the desk lamp.
 */
import type { WorldWord } from '@shared/vr-worlds';
import { defineWorld, type WorldObjectDef } from '../types';
import { HomeScene } from './Scene';
import * as M from './models';

const W = (hanzi: string, pinyin: string, english: string, measure: string | undefined, fun_facts: string, example: [string, string, string]): WorldWord => ({
  hanzi, pinyin, english, ...(measure ? { measure } : {}), fun_facts, example: { hanzi: example[0], pinyin: example[1], english: example[2] },
});
const w = (hanzi: string, pinyin: string, english: string): WorldWord => ({ hanzi, pinyin, english });

const OPEN = {
  closed: { verb: w('关上', 'guānshang', 'close'), label: w('关着', 'guānzhe', 'closed') },
  open: { verb: w('打开', 'dǎkāi', 'open'), label: w('开着', 'kāizhe', 'open') },
};
const SWITCH = {
  off: { verb: w('关上', 'guānshang', 'turn off'), label: w('关着', 'guānzhe', 'off') },
  on: { verb: w('打开', 'dǎkāi', 'turn on'), label: w('开着', 'kāizhe', 'on') },
};
const CURTAIN = {
  closed: { verb: w('拉上', 'lāshang', 'draw'), label: w('拉着', 'lāzhe', 'drawn') },
  open: { verb: w('拉开', 'lākāi', 'draw open'), label: w('开着', 'kāizhe', 'open') },
};
const LID = {
  closed: { verb: w('合上', 'héshang', 'close'), label: w('合着', 'hézhe', 'closed') },
  open: { verb: w('打开', 'dǎkāi', 'open'), label: w('开着', 'kāizhe', 'open') },
};

const WORDS = {
  sofa: W('沙发', 'shāfā', 'sofa', '张', '沙发 is a sound loan from English "sofa": 沙 (shā) sand + 发 (fā).\nFlat furniture takes 张: 一张沙发.\n坐在沙发上 = sit on the sofa.', ['遥控器在沙发上。', 'Yáokòngqì zài shāfā shang.', 'The remote is on the sofa.']),
  coffee_table: W('茶几', 'chájī', 'coffee table', '张', '茶 (chá) tea + 几 (jī) small table — here 几 is jī, not jǐ (how many).\nThe low table in front of a sofa, where the tea goes.', ['茶几上有一杯茶。', 'Chájī shang yǒu yì bēi chá.', 'There is a cup of tea on the coffee table.']),
  tv: W('电视', 'diànshì', 'television', '台', '电 (diàn) electricity + 视 (shì) to look.\n看电视 = watch TV; 开电视 / 关电视 = turn it on / off.\nMachines take 台: 一台电视.', ['我们一起看电视吧。', 'Wǒmen yìqǐ kàn diànshì ba.', "Let's watch TV together."]),
  tv_cabinet: W('电视柜', 'diànshìguì', 'TV cabinet', '个', '电视 (diànshì) TV + 柜 (guì) cabinet.\n柜 is in many furniture words: 衣柜 wardrobe, 鞋柜 shoe cabinet, 书柜 bookcase.', ['电视在电视柜上。', 'Diànshì zài diànshìguì shang.', 'The TV is on the TV cabinet.']),
  bookshelf: W('书架', 'shūjià', 'bookshelf', '个', '书 (shū) book + 架 (jià) rack, frame.\n架 also: 衣架 (clothes hanger). 放回书架上 = put back on the shelf.', ['书架上有很多书。', 'Shūjià shang yǒu hěn duō shū.', 'There are many books on the bookshelf.']),
  floor_lamp: W('落地灯', 'luòdìdēng', 'floor lamp', '盏', '落地 (luòdì) standing on the floor (落 fall + 地 ground) + 灯 (dēng) lamp.\nLamps take 盏 (zhǎn): 一盏灯. 开灯 / 关灯 = lights on / off.', ['沙发旁边有一盏落地灯。', 'Shāfā pángbiān yǒu yì zhǎn luòdìdēng.', 'There is a floor lamp next to the sofa.']),
  curtains: W('窗帘', 'chuānglián', 'curtains', undefined, '窗 (chuāng) window + 帘 (lián) curtain — the 巾 cloth radical at the bottom.\n拉开窗帘 = open (draw back) the curtains; 拉上窗帘 = close them.', ['请拉开窗帘。', 'Qǐng lākāi chuānglián.', 'Please open the curtains.']),
  window: W('窗户', 'chuānghu', 'window', '扇', '窗 (chuāng) window + 户 (hu) door.\nDoors and windows take 扇 (shàn): 一扇窗户.', ['窗户外面有很多高楼。', 'Chuānghu wàimiàn yǒu hěn duō gāolóu.', 'There are many tall buildings outside the window.']),
  ac: W('空调', 'kōngtiáo', 'air conditioner', '台', '空 (kōng) air + 调 (tiáo) adjust — 调 is tiáo here, not diào.\n开空调 = turn on the AC; in winter it heats too (制热).', ['太热了，开空调吧。', 'Tài rè le, kāi kōngtiáo ba.', "It's too hot, let's turn on the AC."]),
  calendar: W('日历', 'rìlì', 'calendar', '本', '日 (rì) day + 历 (lì) calendar, record of time.\nA wall calendar: 挂历 (guàlì). 农历 = the lunar calendar.', ['墙上有一本日历。', 'Qiáng shang yǒu yì běn rìlì.', 'There is a calendar on the wall.']),
  door: W('门', 'mén', 'door', '扇', '门 (mén) door — a picture of a gateway.\n开门 / 关门 = open / close the door; 门口 = the doorway.\nMeasure word 扇: 一扇门.', ['请关门。', 'Qǐng guān mén.', 'Please close the door.']),
  shoe_cabinet: W('鞋柜', 'xiéguì', 'shoe cabinet', '个', '鞋 (xié) shoe + 柜 (guì) cabinet.\nIt stands by the front door: shoes off, slippers on.', ['鞋柜在门旁边。', 'Xiéguì zài mén pángbiān.', 'The shoe cabinet is next to the door.']),
  key_hook: W('挂钩', 'guàgōu', 'hook', '个', '挂 (guà) to hang + 钩 (gōu) hook.\n挂在挂钩上 = hang it on the hook.', ['钥匙挂在挂钩上。', 'Yàoshi guà zài guàgōu shang.', 'The keys hang on the hook.']),
  bin: W('垃圾桶', 'lājītǒng', 'rubbish bin', '个', '垃圾 (lājī) rubbish + 桶 (tǒng) bucket.\n扔垃圾 = throw out the rubbish; 扔进 = throw into.', ['把纸团扔进垃圾桶里。', 'Bǎ zhǐtuán rēngjìn lājītǒng li.', 'Throw the paper ball into the bin.']),
  remote: W('遥控器', 'yáokòngqì', 'remote control', '个', '遥 (yáo) distant + 控 (kòng) control + 器 (qì) device.\nShort: 遥控. 器 ends many gadget words: 充电器 charger.', ['遥控器在哪儿？', 'Yáokòngqì zài nǎr?', 'Where is the remote?']),
  book: W('书', 'shū', 'book', '本', '书 (shū) book, writing.\nBooks take 本 (běn): 一本书, 三本书. 看书 = read.', ['这本书很有意思。', 'Zhè běn shū hěn yǒu yìsi.', 'This book is very interesting.']),
  cushion: W('靠垫', 'kàodiàn', 'cushion', '个', '靠 (kào) to lean on + 垫 (diàn) pad, cushion.\nA cushion you lean against; a bed pillow is 枕头.', ['沙发上有两个靠垫。', 'Shāfā shang yǒu liǎng gè kàodiàn.', 'There are two cushions on the sofa.']),
  phone: W('手机', 'shǒujī', 'mobile phone', '部', '手 (shǒu) hand + 机 (jī) machine.\nMeasure word 部 or 个: 一部手机. 没电了 = the battery is dead.', ['我的手机没电了。', 'Wǒ de shǒujī méi diàn le.', 'My phone is out of battery.']),
  charger: W('充电器', 'chōngdiànqì', 'charger', '个', '充 (chōng) to fill + 电 (diàn) electricity + 器 (qì) device.\n充电 = to charge (a phone).', ['你有手机充电器吗？', 'Nǐ yǒu shǒujī chōngdiànqì ma?', 'Do you have a phone charger?']),
  teacup: W('茶杯', 'chábēi', 'teacup', '个', '茶 (chá) tea + 杯 (bēi) cup.\n杯 is also a measure word: 一杯茶 = a cup of tea.', ['茶杯里有热茶。', 'Chábēi li yǒu rè chá.', 'There is hot tea in the teacup.']),
  paper_ball: W('纸团', 'zhǐtuán', 'paper ball', '个', '纸 (zhǐ) paper + 团 (tuán) ball, lump.\n团 is also in 饭团 (rice ball).', ['地上有一个纸团。', 'Dì shang yǒu yí gè zhǐtuán.', 'There is a paper ball on the floor.']),
  keys: W('钥匙', 'yàoshi', 'keys', '把', '钥 (yào) key + 匙 (shi) key, spoon — read shi (neutral) here.\nKeys take 把: 一把钥匙.', ['我的钥匙不见了。', 'Wǒ de yàoshi bú jiàn le.', 'My keys have gone missing.']),
  slippers: W('拖鞋', 'tuōxié', 'slippers', '双', '拖 (tuō) to drag + 鞋 (xié) shoe — shoes you shuffle in.\nA pair: 一双拖鞋. Chinese homes: 换拖鞋 at the door.', ['进门要换拖鞋。', 'Jìn mén yào huàn tuōxié.', 'Change into slippers when you come in.']),
  umbrella: W('雨伞', 'yǔsǎn', 'umbrella', '把', '雨 (yǔ) rain + 伞 (sǎn) umbrella — 伞 looks like an open umbrella.\nThings with a handle take 把: 一把雨伞. 带伞 = take an umbrella.', ['下雨了，别忘了带雨伞。', 'Xià yǔ le, bié wàngle dài yǔsǎn.', "It's raining, don't forget your umbrella."]),
  plant: W('盆栽', 'pénzāi', 'potted plant', '盆', '盆 (pén) pot, basin + 栽 (zāi) to plant.\n盆 is also its measure word: 一盆花.\n浇水 (jiāo shuǐ) = to water.', ['这盆盆栽需要浇水了。', 'Zhè pén pénzāi xūyào jiāo shuǐ le.', 'This plant needs watering.']),
  watering_can: W('喷壶', 'pēnhú', 'watering can', '个', '喷 (pēn) to spray + 壶 (hú) pot, kettle.\n水壶 = kettle; 茶壶 = teapot.', ['用喷壶给花浇水。', 'Yòng pēnhú gěi huā jiāo shuǐ.', 'Water the flowers with the watering can.']),
  alarm_clock: W('闹钟', 'nàozhōng', 'alarm clock', '个', '闹 (nào) noisy + 钟 (zhōng) clock.\n闹钟响了 = the alarm went off; 定闹钟 = set the alarm.', ['我的闹钟每天早上七点响。', 'Wǒ de nàozhōng měitiān zǎoshang qī diǎn xiǎng.', 'My alarm clock rings at seven every morning.']),
  bed: W('床', 'chuáng', 'bed', '张', '床 (chuáng) bed — the 广 roof over 木 wood.\n起床 = get up; 上床 = go to bed. Measure word 张: 一张床.', ['我的床很舒服。', 'Wǒ de chuáng hěn shūfu.', 'My bed is very comfortable.']),
  pillow: W('枕头', 'zhěntou', 'pillow', '个', '枕 (zhěn) to rest the head on — the 木 wood radical (old pillows were wooden) — + 头 (tou).', ['枕头在床上。', 'Zhěntou zài chuáng shang.', 'The pillow is on the bed.']),
  blanket: W('被子', 'bèizi', 'quilt', '床', '被 (bèi) quilt — the 衤 clothing radical — + 子 (zi).\nIts measure word is 床: 一床被子. 盖被子 = cover yourself with the quilt.', ['冬天要盖厚被子。', 'Dōngtiān yào gài hòu bèizi.', 'In winter you need a thick quilt.']),
  wardrobe: W('衣柜', 'yīguì', 'wardrobe', '个', '衣 (yī) clothes + 柜 (guì) cabinet.\n衣服在衣柜里 = the clothes are in the wardrobe.', ['衣服在衣柜里。', 'Yīfu zài yīguì li.', 'The clothes are in the wardrobe.']),
  shirt: W('衬衫', 'chènshān', 'shirt', '件', '衬 (chèn) lining + 衫 (shān) shirt — both with the 衤 clothing radical.\nTops take 件: 一件衬衫.', ['这件衬衫很干净。', 'Zhè jiàn chènshān hěn gānjìng.', 'This shirt is very clean.']),
  trousers: W('裤子', 'kùzi', 'trousers', '条', '裤 (kù) trousers — the 衤 clothing radical — + 子 (zi).\nLong things take 条: 一条裤子. 穿裤子 = put on trousers.', ['这条裤子有点儿长。', 'Zhè tiáo kùzi yǒudiǎnr cháng.', 'These trousers are a bit long.']),
  socks: W('袜子', 'wàzi', 'socks', '双', '袜 (wà) sock — the 衤 clothing radical — + 子 (zi).\nA pair: 一双袜子 (双 = pair).', ['我找不到我的袜子。', 'Wǒ zhǎobudào wǒ de wàzi.', "I can't find my socks."]),
  nightstand: W('床头柜', 'chuángtóuguì', 'bedside table', '个', '床头 (chuángtóu) the head of the bed + 柜 (guì) cabinet.\n放在床头柜上 = put it on the bedside table.', ['闹钟在床头柜上。', 'Nàozhōng zài chuángtóuguì shang.', 'The alarm clock is on the bedside table.']),
  desk: W('书桌', 'shūzhuō', 'desk', '张', '书 (shū) book + 桌 (zhuō) table: a table for studying.\nFlat things take 张: 一张书桌.', ['书桌上有一台电脑。', 'Shūzhuō shang yǒu yì tái diànnǎo.', 'There is a computer on the desk.']),
  desk_lamp: W('台灯', 'táidēng', 'desk lamp', '盏', '台 (tái) table, stand + 灯 (dēng) lamp.\n一盏台灯. Compare 落地灯 (floor lamp).', ['书桌上有一盏台灯。', 'Shūzhuō shang yǒu yì zhǎn táidēng.', 'There is a lamp on the desk.']),
  chair: W('椅子', 'yǐzi', 'chair', '把', '椅 (yǐ) chair — the 木 wood radical — + 子 (zi).\nChairs take 把: 一把椅子.', ['请坐在椅子上。', 'Qǐng zuò zài yǐzi shang.', 'Please sit on the chair.']),
  laptop: W('笔记本电脑', 'bǐjìběn diànnǎo', 'laptop', '台', '笔记本 (bǐjìběn) notebook + 电脑 (diànnǎo) computer — 电 electric + 脑 brain.\nOften just 笔记本. Machines take 台: 一台笔记本电脑.', ['我用笔记本电脑工作。', 'Wǒ yòng bǐjìběn diànnǎo gōngzuò.', 'I work on a laptop.']),
  basin: W('洗手池', 'xǐshǒuchí', 'washbasin', '个', '洗手 (xǐ shǒu) wash your hands + 池 (chí) pool, basin.\n洗手间 = the toilet (the room).', ['洗手池在镜子下面。', 'Xǐshǒuchí zài jìngzi xiàmiàn.', 'The washbasin is under the mirror.']),
  tap: W('水龙头', 'shuǐlóngtóu', 'tap', '个', '水 (shuǐ) water + 龙头 (lóngtóu) dragon head — old taps were dragon-shaped.\n打开水龙头 / 关上水龙头 = turn the tap on / off.', ['请关上水龙头。', 'Qǐng guānshang shuǐlóngtóu.', 'Please turn off the tap.']),
  mirror: W('镜子', 'jìngzi', 'mirror', '面', '镜 (jìng) mirror — the 钅 metal radical (old mirrors were bronze) — + 子 (zi).\nFlat faces take 面: 一面镜子. 照镜子 = look in the mirror.', ['她在照镜子。', 'Tā zài zhào jìngzi.', 'She is looking in the mirror.']),
  towel: W('毛巾', 'máojīn', 'towel', '条', '毛 (máo) hair, fluff + 巾 (jīn) cloth.\nLong things take 条: 一条毛巾.', ['这条毛巾是干的。', 'Zhè tiáo máojīn shì gān de.', 'This towel is dry.']),
  toothbrush: W('牙刷', 'yáshuā', 'toothbrush', '把', '牙 (yá) tooth + 刷 (shuā) brush.\n刷牙 = brush your teeth (the same two characters, reversed!).', ['我每天用牙刷刷牙。', 'Wǒ měitiān yòng yáshuā shuā yá.', 'I brush my teeth with a toothbrush every day.']),
  toothpaste: W('牙膏', 'yágāo', 'toothpaste', '支', '牙 (yá) tooth + 膏 (gāo) paste, cream.\nA tube: 一支牙膏 (支 for long thin things).', ['牙膏快用完了。', 'Yágāo kuài yòngwán le.', 'The toothpaste is almost used up.']),
  cup: W('杯子', 'bēizi', 'cup', '个', '杯 (bēi) cup + 子 (zi).\nIn the bathroom: 漱口杯 (shùkǒubēi), the cup for rinsing your mouth.', ['牙刷在杯子里。', 'Yáshuā zài bēizi li.', 'The toothbrush is in the cup.']),
  washer: W('洗衣机', 'xǐyījī', 'washing machine', '台', '洗 (xǐ) wash + 衣 (yī) clothes + 机 (jī) machine.\n洗衣服 = do the laundry. Machines take 台.', ['把衣服放进洗衣机里。', 'Bǎ yīfu fàngjìn xǐyījī li.', 'Put the clothes in the washing machine.']),
  laundry_basket: W('脏衣篮', 'zāngyīlán', 'laundry basket', '个', '脏 (zāng) dirty + 衣 (yī) clothes + 篮 (lán) basket.\n脏衣服 = dirty clothes; 干净 (gānjìng) = clean.', ['脏衣服在脏衣篮里。', 'Zāng yīfu zài zāngyīlán li.', 'The dirty clothes are in the laundry basket.']),
  toilet: W('马桶', 'mǎtǒng', 'toilet', '个', '马 (mǎ) horse + 桶 (tǒng) bucket — the old word for a chamber pot.\nThe room is 卫生间 (wèishēngjiān) or 厕所 (cèsuǒ).', ['卫生间里有马桶和洗手池。', 'Wèishēngjiān li yǒu mǎtǒng hé xǐshǒuchí.', 'There is a toilet and a washbasin in the bathroom.']),
};

/** The kitchen-style chair collider: seat block + back. */
const CHAIR = [{ box: [0.44, 0.47, 0.46] as [number, number, number], offset: [0, -0.215, 0] as [number, number, number] }, { box: [0.44, 0.43, 0.04] as [number, number, number], offset: [0, 0.235, -0.21] as [number, number, number] }];

const objects: WorldObjectDef[] = [
  // ── living room: fixed ──
  { id: 'sofa', word: WORDS.sofa, material: 'cloth', mass: 0, at: [-2.1, 0.225, -0.12], surface: true, model: M.SofaModel, collider: { box: [1.6, 0.45, 0.7] } },
  {
    id: 'coffee_table', word: WORDS.coffee_table, material: 'wood', mass: 0, at: [-2.1, 0.21, 1.05], surface: true, model: M.CoffeeTableModel,
    collider: [
      { box: [1.1, 0.04, 0.6], offset: [0, 0.19, 0] },
      { box: [0.05, 0.38, 0.05], offset: [-0.5, 0, -0.25] },
      { box: [0.05, 0.38, 0.05], offset: [0.5, 0, -0.25] },
      { box: [0.05, 0.38, 0.05], offset: [-0.5, 0, 0.25] },
      { box: [0.05, 0.38, 0.05], offset: [0.5, 0, 0.25] },
      { box: [1.0, 0.02, 0.5], offset: [0, -0.13, 0] },
    ],
  },
  { id: 'tv_cabinet', word: WORDS.tv_cabinet, material: 'wood', mass: 0, at: [-2.1, 0.25, 3.19], yaw: Math.PI, surface: true, model: M.TvCabinetModel, collider: { box: [1.8, 0.5, 0.42] } },
  {
    id: 'tv', word: WORDS.tv, material: 'plastic', mass: 0, at: [-2.1, 0.892, 3.2], yaw: Math.PI, model: M.TvModel, collider: { box: [1.2, 0.78, 0.2] },
    states: [{ key: 'power', initial: 'off', values: SWITCH }],
    loops: { 'power=on': 'tv-chatter' },
  },
  {
    id: 'bookshelf', word: WORDS.bookshelf, material: 'wood', mass: 0, at: [-0.3, 0.9, -0.39], model: M.BookshelfModel,
    collider: [
      { box: [0.02, 1.8, 0.32], offset: [-0.44, 0, 0] },
      { box: [0.02, 1.8, 0.32], offset: [0.44, 0, 0] },
      { box: [0.9, 1.8, 0.02], offset: [0, 0, -0.15] },
      ...M.SHELF_BOARDS.map((y) => ({ box: [0.86, 0.02, 0.3] as [number, number, number], offset: [0, y, 0.01] as [number, number, number] })),
    ],
    inside: { min: [-0.43, -0.88, -0.14], max: [0.43, 0.88, 0.16] },
  },
  {
    id: 'floor_lamp', word: WORDS.floor_lamp, material: 'metal', mass: 0, at: [-3.55, 0.8, -0.25], model: M.FloorLampModel,
    collider: [{ cylinder: [0.16, 0.03], offset: [0, -0.785, 0] }, { box: [0.03, 1.3, 0.03], offset: [0, -0.12, 0] }, { cylinder: [0.21, 0.28], offset: [0, 0.65, 0] }],
    states: [{ key: 'light', initial: 'off', values: SWITCH }],
  },
  { id: 'window', word: WORDS.window, material: 'glass', mass: 0, at: [-3.95, 1.5, 1.2], yaw: Math.PI / 2, model: M.LivingWindowModel, collider: { box: [1.6, 1.3, 0.1] } },
  {
    id: 'curtains', word: WORDS.curtains, material: 'cloth', mass: 0, at: [-3.8, 1.45, 1.2], yaw: Math.PI / 2, model: M.CurtainsModel,
    collider: [
      { box: [2.0, 1.7, 0.08], when: { curtain: 'closed' } },
      { box: [0.36, 1.7, 0.08], offset: [-0.82, 0, 0], when: { curtain: 'open' } },
      { box: [0.36, 1.7, 0.08], offset: [0.82, 0, 0], when: { curtain: 'open' } },
    ],
    states: [{ key: 'curtain', initial: 'closed', values: CURTAIN }],
  },
  {
    id: 'ac', word: WORDS.ac, material: 'plastic', mass: 0, at: [-3.89, 2.3, 2.75], yaw: Math.PI / 2, model: M.AcModel, collider: { box: [0.9, 0.3, 0.22] },
    states: [{ key: 'power', initial: 'off', values: SWITCH }],
    loops: { 'power=on': 'ac-hum' },
  },
  { id: 'calendar', word: WORDS.calendar, material: 'paper', mass: 0, at: [2.6, 1.5, -0.54], model: M.CalendarModel, collider: { box: [0.3, 0.42, 0.02] } },
  {
    id: 'door', word: WORDS.door, material: 'wood', mass: 0, at: [3.975, 1.03, 1.6], model: M.FrontDoorModel,
    collider: [
      { box: [0.05, 2.05, 0.9], when: { door: 'closed' } },
      { box: [0.9, 2.05, 0.05], offset: [-0.45, 0, -0.45], when: { door: 'open' } },
    ],
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  { id: 'shoe_cabinet', word: WORDS.shoe_cabinet, material: 'wood', mass: 0, at: [3.81, 0.45, 0.2], yaw: -Math.PI / 2, surface: true, model: M.ShoeCabinetModel, collider: { box: [1.0, 0.9, 0.38] } },
  {
    id: 'key_hook', word: WORDS.key_hook, material: 'wood', mass: 0, at: [3.955, 1.4, 2.5], yaw: -Math.PI / 2, surface: true, model: M.KeyHookModel,
    collider: [{ box: [0.32, 0.03, 0.09] }, { box: [0.32, 0.03, 0.012], offset: [0, 0.02, 0.039] }],
  },
  {
    id: 'bin', word: WORDS.bin, material: 'plastic', mass: 0, at: [-0.6, 0.3, 0.3], model: M.BinModel,
    collider: [
      { box: [0.34, 0.02, 0.34], offset: [0, -0.29, 0] },
      { box: [0.36, 0.6, 0.02], offset: [0, 0, 0.17] },
      { box: [0.36, 0.6, 0.02], offset: [0, 0, -0.17] },
      { box: [0.02, 0.6, 0.36], offset: [0.17, 0, 0] },
      { box: [0.02, 0.6, 0.36], offset: [-0.17, 0, 0] },
    ],
    inside: { min: [-0.16, -0.28, -0.16], max: [0.16, 0.34, 0.16] },
  },

  // ── living room: things to pick up ──
  { id: 'remote', word: WORDS.remote, material: 'plastic', mass: 0.15, at: [-2.35, 0.433, 1.0], model: M.RemoteModel, collider: { box: [0.05, 0.022, 0.17] } },
  { id: 'book', word: WORDS.book, tags: ['book'], material: 'paper', mass: 0.4, at: [-1.8, 0.437, 1.15], yaw: 0.2, model: M.Book1, collider: { box: [0.15, 0.03, 0.21] } },
  { id: 'book_2', word: WORDS.book, tags: ['book'], material: 'paper', mass: 0.4, at: [-2.1, 0.467, 0.0], yaw: -0.3, model: M.Book2, collider: { box: [0.15, 0.03, 0.21] } },
  { id: 'book_3', word: WORDS.book, tags: ['book'], material: 'paper', mass: 0.4, at: [-0.7, 0.017, 1.9], yaw: 0.6, model: M.Book3, collider: { box: [0.15, 0.03, 0.21] } },
  { id: 'book_4', word: WORDS.book, tags: ['book'], material: 'paper', mass: 0.4, at: [-1.35, 0.517, 3.12], model: M.Book4, collider: { box: [0.15, 0.03, 0.21] } },
  { id: 'cushion', word: WORDS.cushion, tags: ['cushion'], material: 'cloth', mass: 0.4, at: [-2.75, 0.522, 0.0], yaw: 0.15, model: M.Cushion1, collider: { box: [0.38, 0.14, 0.38] } },
  { id: 'cushion_2', word: WORDS.cushion, tags: ['cushion'], material: 'cloth', mass: 0.4, at: [-1.45, 0.522, 0.0], yaw: -0.2, model: M.Cushion2, collider: { box: [0.38, 0.14, 0.38] } },
  { id: 'phone', word: WORDS.phone, material: 'glass', mass: 0.2, at: [-1.75, 0.457, 0.1], yaw: 0.3, model: M.PhoneModel, collider: { box: [0.075, 0.01, 0.155] } },
  { id: 'charger', word: WORDS.charger, material: 'plastic', mass: 0.1, at: [-2.85, 0.522, 3.1], model: M.ChargerModel, collider: { box: [0.05, 0.04, 0.05] } },
  { id: 'teacup', word: WORDS.teacup, material: 'ceramic', mass: 0.2, at: [-2.55, 0.457, 1.2], model: M.TeacupModel, collider: { cylinder: [0.04, 0.07] } },
  { id: 'paper_ball', word: WORDS.paper_ball, tags: ['rubbish'], material: 'paper', mass: 0.02, at: [-1.3, 0.036, 2.25], model: M.PaperBall1, collider: { ball: 0.034 } },
  { id: 'paper_ball_2', word: WORDS.paper_ball, tags: ['rubbish'], material: 'paper', mass: 0.02, at: [-3.25, 0.036, 0.55], model: M.PaperBall2, collider: { ball: 0.034 } },
  { id: 'keys', word: WORDS.keys, material: 'metal', mass: 0.1, at: [-1.7, 0.432, 0.88], yaw: 0.4, model: M.KeysModel, collider: { box: [0.09, 0.02, 0.05] } },
  { id: 'slippers', word: WORDS.slippers, material: 'plastic', mass: 0.4, at: [-2.6, 0.027, 0.45], yaw: 0.1, model: M.SlippersModel, collider: { box: [0.24, 0.05, 0.27] } },
  { id: 'umbrella', word: WORDS.umbrella, material: 'cloth', mass: 0.5, at: [3.72, 0.43, 2.95], model: M.UmbrellaModel, collider: { cylinder: [0.035, 0.85] } },
  { id: 'plant', word: WORDS.plant, material: 'ceramic', mass: 4, at: [-3.6, 0.3, 3.0], model: M.PlantModel, collider: { cylinder: [0.17, 0.6] } },
  { id: 'watering_can', word: WORDS.watering_can, material: 'metal', mass: 0.6, at: [-3.55, 0.1, 2.35], yaw: Math.PI / 2, model: M.WateringCanModel, collider: { box: [0.28, 0.2, 0.12] } },
  { id: 'alarm_clock', word: WORDS.alarm_clock, material: 'metal', mass: 0.3, at: [-2.05, 0.472, 1.25], model: M.AlarmClockModel, collider: { box: [0.11, 0.1, 0.06] } },

  // ── bedroom ──
  { id: 'bed', word: WORDS.bed, material: 'cloth', mass: 0, at: [-2.97, 0.275, -2.15], surface: true, model: M.BedModel, collider: { box: [1.9, 0.55, 1.5] } },
  { id: 'nightstand', word: WORDS.nightstand, material: 'wood', mass: 0, at: [-3.72, 0.25, -1.13], yaw: Math.PI / 2, surface: true, model: M.NightstandModel, collider: { box: [0.45, 0.5, 0.4] } },
  {
    id: 'wardrobe', word: WORDS.wardrobe, material: 'wood', mass: 0, at: [-1.2, 1.0, -3.1], model: M.WardrobeModel,
    collider: [
      { box: [1.4, 2.0, 0.02], offset: [0, 0, -0.29] },
      { box: [0.02, 2.0, 0.6], offset: [-0.69, 0, 0] },
      { box: [0.02, 2.0, 0.6], offset: [0.69, 0, 0] },
      { box: [1.4, 0.03, 0.6], offset: [0, 0.985, 0] },
      { box: [1.4, 0.08, 0.6], offset: [0, -0.96, 0] },
      { box: [0.02, 1.9, 0.56], offset: [0, 0.01, -0.01] },
      { box: [0.67, 0.02, 0.54], offset: [0.345, 0, -0.02] },
      { box: [1.4, 1.92, 0.03], offset: [0, 0, 0.285], when: { door: 'closed' } },
      { box: [0.7, 1.92, 0.05], offset: [-0.35, 0, 0.27], when: { door: 'open' } },
    ],
    inside: { min: [-0.68, -0.92, -0.28], max: [0.68, 0.97, 0.27] },
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  {
    id: 'desk', word: WORDS.desk, material: 'wood', mass: 0, at: [-1.0, 0.375, -0.925], surface: true, model: M.DeskModel,
    collider: [
      { box: [1.1, 0.04, 0.55], offset: [0, 0.355, 0] },
      { box: [0.05, 0.71, 0.05], offset: [-0.5, -0.02, -0.22] },
      { box: [0.05, 0.71, 0.05], offset: [0.5, -0.02, -0.22] },
      { box: [0.05, 0.71, 0.05], offset: [-0.5, -0.02, 0.22] },
      { box: [0.05, 0.71, 0.05], offset: [0.5, -0.02, 0.22] },
    ],
  },
  {
    id: 'desk_lamp', word: WORDS.desk_lamp, material: 'metal', mass: 0, at: [-0.58, 0.952, -0.78], model: M.DeskLampModel, collider: { box: [0.16, 0.4, 0.16] },
    states: [{ key: 'light', initial: 'off', values: SWITCH }],
  },
  { id: 'pillow', word: WORDS.pillow, material: 'cloth', mass: 0.6, at: [-3.55, 0.612, -2.15], model: M.PillowModel, collider: { box: [0.35, 0.12, 0.6] } },
  { id: 'blanket', word: WORDS.blanket, material: 'cloth', mass: 2, at: [-2.45, 0.602, -2.15], model: M.BlanketModel, collider: { box: [0.5, 0.1, 1.3] } },
  { id: 'shirt', word: WORDS.shirt, tags: ['shirt', 'clothes'], material: 'cloth', mass: 0.25, at: [-1.03, 1.038, -3.08], model: M.ShirtModel, collider: { box: [0.28, 0.05, 0.24] } },
  { id: 'trousers', word: WORDS.trousers, tags: ['clothes'], material: 'cloth', mass: 0.4, at: [-0.7, 1.043, -3.08], model: M.TrousersModel, collider: { box: [0.26, 0.06, 0.24] } },
  { id: 'socks', word: WORDS.socks, tags: ['clothes'], material: 'cloth', mass: 0.08, at: [-0.85, 0.108, -3.05], model: M.SocksModel, collider: { box: [0.14, 0.05, 0.12] } },
  { id: 'chair', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, at: [-1.0, 0.452, -1.45], model: M.ChairModel, collider: CHAIR },
  {
    id: 'laptop', word: WORDS.laptop, material: 'plastic', mass: 1.5, at: [-1.1, 0.762, -0.92], model: M.LaptopModel, collider: { box: [0.32, 0.02, 0.22] },
    states: [{ key: 'lid', initial: 'closed', values: LID }],
  },

  // ── bathroom ──
  {
    id: 'basin', word: WORDS.basin, material: 'ceramic', mass: 0, at: [2.35, 0.872, -3.12], model: M.BasinModel,
    collider: [
      { box: [0.44, 0.02, 0.34], offset: [0, -0.06, 0] },
      { box: [0.44, 0.14, 0.015], offset: [0, 0, 0.1625] },
      { box: [0.44, 0.14, 0.015], offset: [0, 0, -0.1625] },
      { box: [0.015, 0.14, 0.34], offset: [0.2125, 0, 0] },
      { box: [0.015, 0.14, 0.34], offset: [-0.2125, 0, 0] },
    ],
    inside: { min: [-0.2, -0.05, -0.15], max: [0.2, 0.07, 0.15] },
  },
  {
    id: 'tap', word: WORDS.tap, material: 'metal', mass: 0, at: [2.35, 0.97, -3.33], model: M.TapModel, collider: { box: [0.06, 0.34, 0.2], offset: [0, 0, 0.07] },
    states: [{ key: 'water', initial: 'off', values: SWITCH }],
    loops: { 'water=on': 'water' },
  },
  { id: 'mirror', word: WORDS.mirror, material: 'glass', mass: 0, at: [2.45, 1.55, -3.385], model: M.MirrorModel, collider: { box: [0.7, 0.85, 0.03] } },
  {
    id: 'toilet', word: WORDS.toilet, material: 'ceramic', mass: 0, at: [3.55, 0.375, -3.075], model: M.ToiletModel,
    collider: [{ box: [0.38, 0.42, 0.52], offset: [0, -0.165, 0.065] }, { box: [0.4, 0.4, 0.18], offset: [0, 0.155, -0.225] }],
  },
  {
    id: 'washer', word: WORDS.washer, material: 'metal', mass: 0, at: [3.65, 0.425, -1.5], yaw: -Math.PI / 2, model: M.WasherModel,
    collider: [
      { box: [0.6, 0.04, 0.6], offset: [0, 0.405, 0] },
      { box: [0.6, 0.1, 0.6], offset: [0, -0.375, 0] },
      { box: [0.6, 0.85, 0.04], offset: [0, 0, -0.28] },
      { box: [0.04, 0.85, 0.6], offset: [-0.28, 0, 0] },
      { box: [0.04, 0.85, 0.6], offset: [0.28, 0, 0] },
      { box: [0.6, 0.205, 0.04], offset: [0, 0.3025, 0.28] },
      { box: [0.6, 0.11, 0.04], offset: [0, -0.27, 0.28] },
      { box: [0.52, 0.42, 0.04], offset: [0, -0.0075, 0.31], when: { door: 'closed' } },
      { box: [0.04, 0.42, 0.52], offset: [-0.28, -0.0075, 0.57], when: { door: 'open' } },
    ],
    inside: { min: [-0.25, -0.32, -0.25], max: [0.25, 0.19, 0.29] },
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  {
    id: 'laundry_basket', word: WORDS.laundry_basket, tags: ['container'], material: 'plastic', mass: 1, at: [3.68, 0.2, -0.92], model: M.LaundryBasketModel,
    collider: [
      { box: [0.4, 0.02, 0.32], offset: [0, -0.19, 0] },
      { box: [0.4, 0.38, 0.015], offset: [0, 0, 0.1525] },
      { box: [0.4, 0.38, 0.015], offset: [0, 0, -0.1525] },
      { box: [0.015, 0.38, 0.32], offset: [0.1925, 0, 0] },
      { box: [0.015, 0.38, 0.32], offset: [-0.1925, 0, 0] },
    ],
    inside: { min: [-0.18, -0.18, -0.14], max: [0.18, 0.2, 0.14] },
  },
  { id: 'shirt_2', word: WORDS.shirt, tags: ['shirt', 'clothes', 'dirty'], material: 'cloth', mass: 0.25, at: [3.6, 0.048, -0.92], model: M.DirtyShirtModel, collider: { box: [0.18, 0.05, 0.16] } },
  { id: 'socks_2', word: WORDS.socks, tags: ['clothes', 'dirty'], material: 'cloth', mass: 0.08, at: [3.79, 0.048, -0.9], model: M.DirtySocksModel, collider: { box: [0.12, 0.05, 0.1] } },
  { id: 'towel', word: WORDS.towel, material: 'cloth', mass: 0.3, at: [3.65, 0.883, -1.5], yaw: Math.PI / 2, model: M.TowelModel, collider: { box: [0.3, 0.06, 0.22] } },
  { id: 'toothbrush', word: WORDS.toothbrush, material: 'plastic', mass: 0.02, at: [2.75, 0.812, -2.97], model: M.ToothbrushModel, collider: { box: [0.19, 0.02, 0.025] } },
  { id: 'toothpaste', word: WORDS.toothpaste, material: 'plastic', mass: 0.1, at: [2.73, 0.8195, -3.06], model: M.ToothpasteModel, collider: { box: [0.17, 0.035, 0.045] } },
  { id: 'cup', word: WORDS.cup, material: 'plastic', mass: 0.1, at: [2.82, 0.852, -3.22], model: M.BathCupModel, collider: { cylinder: [0.035, 0.1] } },
];

export default defineWorld({
  id: 'home',
  title_zh: '家',
  title_en: 'Apartment',
  blurb: 'Living room, bedroom and bathroom: turn on the TV, put the slippers by the door, do the laundry.',
  bounds: { min: [-4, 0, -3.4], max: [4, 2.7, 3.4] },
  spawn: { at: [0.9, 0, 2.6], yaw: 0.5 },
  lighting: 'indoor_day',
  shadowArea: 9,
  ambience: 'apartment',
  Scene: HomeScene,
  objects,
  zones: [
    { id: 'living_room', word: w('客厅', 'kètīng', 'living room'), min: [-3.95, 0, -0.55], max: [3.95, 2.7, 3.35] },
    { id: 'bedroom', word: w('卧室', 'wòshì', 'bedroom'), min: [-3.95, 0, -3.35], max: [0.35, 2.7, -0.65] },
    { id: 'hallway', word: w('走廊', 'zǒuláng', 'hallway'), min: [0.45, 0, -3.35], max: [1.65, 2.7, -0.6] },
    { id: 'bathroom', word: w('卫生间', 'wèishēngjiān', 'bathroom'), min: [1.75, 0, -3.35], max: [3.95, 2.7, -0.65] },
    { id: 'doorway', word: w('门口', 'ménkǒu', 'doorway'), min: [3.15, 0, 1.1], max: [3.98, 0.4, 2.2] },
  ],
  tasks: [
    { id: 'pick_remote', zh: '拿起遥控器。', pinyin: 'Náqǐ yáokòngqì.', en: 'Pick up the remote control.', done: { holding: 'remote' } },
    { id: 'tv_on', zh: '打开电视。', pinyin: 'Dǎkāi diànshì.', en: 'Turn on the TV.', done: { state: 'tv', key: 'power', value: 'on' } },
    { id: 'remote_on_sofa', zh: '把遥控器放在沙发上。', pinyin: 'Bǎ yáokòngqì fàng zài shāfā shang.', en: 'Put the remote on the sofa.', done: { on: 'remote', surface: 'sofa' } },
    { id: 'open_curtains', zh: '拉开窗帘。', pinyin: 'Lākāi chuānglián.', en: 'Open the curtains.', done: { state: 'curtains', key: 'curtain', value: 'open' } },
    { id: 'ac_on', zh: '太热了，打开空调吧。', pinyin: 'Tài rè le, dǎkāi kōngtiáo ba.', en: "It's too hot — turn on the air conditioner.", done: { state: 'ac', key: 'power', value: 'on' } },
    { id: 'slippers_door', zh: '把拖鞋放在门口。', pinyin: 'Bǎ tuōxié fàng zài ménkǒu.', en: 'Put the slippers by the door.', done: { in_zone: 'slippers', zone: 'doorway' }, hint: ['slippers', 'door'] },
    { id: 'keys_hook', zh: '把钥匙挂在门旁边的挂钩上。', pinyin: 'Bǎ yàoshi guà zài mén pángbiān de guàgōu shang.', en: 'Hang the keys on the hook next to the door.', done: { on: 'keys', surface: 'key_hook' } },
    { id: 'books_back', zh: '把三本书放回书架上。', pinyin: 'Bǎ sān běn shū fànghuí shūjià shang.', en: 'Put three books back on the bookshelf.', done: { count_in_zone: '#book', zone: 'bookshelf', n: 3 }, hint: ['#book', 'bookshelf'] },
    { id: 'rubbish_bin', zh: '把纸团扔进垃圾桶里！', pinyin: 'Bǎ zhǐtuán rēngjìn lājītǒng li!', en: 'Throw a paper ball into the bin!', done: { thrown_into: '#rubbish', zone: 'bin' } },
    {
      id: 'alarm_bedroom',
      zh: '去卧室，把闹钟放在床头柜上。',
      pinyin: 'Qù wòshì, bǎ nàozhōng fàng zài chuángtóuguì shang.',
      en: 'Go to the bedroom and put the alarm clock on the bedside table.',
      done: { sequence: [{ player_in: 'bedroom' }, { on: 'alarm_clock', surface: 'nightstand' }] },
      hint: ['alarm_clock', 'nightstand'],
    },
    {
      id: 'shirt_on_bed',
      zh: '打开衣柜，把衬衫拿出来，放在床上。',
      pinyin: 'Dǎkāi yīguì, bǎ chènshān ná chūlai, fàng zài chuáng shang.',
      en: 'Open the wardrobe, take the shirt out and put it on the bed.',
      done: { sequence: [{ state: 'wardrobe', key: 'door', value: 'open' }, { on: '#shirt', surface: 'bed' }] },
      hint: ['wardrobe', 'shirt', 'bed'],
    },
    {
      id: 'laundry',
      zh: '先打开洗衣机，把脏衣服放进去，然后关上。',
      pinyin: 'Xiān dǎkāi xǐyījī, bǎ zāng yīfu fàng jìnqu, ránhòu guānshang.',
      en: 'First open the washing machine, put the dirty clothes in, then close it.',
      done: { sequence: [{ state: 'washer', key: 'door', value: 'open' }, { count_in_zone: '#dirty', zone: 'washer', n: 2 }, { state: 'washer', key: 'door', value: 'closed' }] },
      hint: ['washer', '#dirty'],
    },
  ],
});
