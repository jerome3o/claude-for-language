/**
 * 菜市场 Wet market — a covered market aisle (docs/VR_WORLDS.md; built on the kitchen's contract).
 *
 * Layout (metres, the floor at y 0): x −3.5 … 3.5, z −3 … 3. You start at z 2.3 looking down the
 * aisle (−z). Left: the 菜摊 vegetable stall (白菜, 茄子, 胡萝卜, 西红柿, 黄瓜, 辣椒, 土豆, 葱, 大蒜, a red
 * 塑料袋 and a hanging 秤 at its near end, the 价格牌 chalk board on the wall behind). Right: the 水果摊
 * fruit stall (西瓜, 葡萄, 草莓, 苹果 and one 烂苹果, 橙子, 梨, 香蕉, the 电子秤). Far end: the 豆腐摊
 * (豆腐, 鸡蛋, a 菜刀 on its board) with the 电风扇 beside it. Front right: the 干货摊 (花生, 红枣, the
 * 二维码 and the 钱箱), a bag of 大米 on the floor, the 买菜车. Front left: the 篮子 on the floor, the
 * 推车, the 垃圾桶; the 筐 by the fruit stall. Both scales weigh what's on them (weigh.ts).
 */
import type { WorldWord } from '@shared/vr-worlds';
import { defineWorld, type WorldObjectDef } from '../types';
import { MarketScene } from './Scene';
import * as M from './models';

const W = (hanzi: string, pinyin: string, english: string, measure: string | undefined, fun_facts: string, example: [string, string, string]): WorldWord => ({
  hanzi, pinyin, english, ...(measure ? { measure } : {}), fun_facts, example: { hanzi: example[0], pinyin: example[1], english: example[2] },
});

const OPEN = {
  closed: { verb: { hanzi: '关上', pinyin: 'guānshang', english: 'close' }, label: { hanzi: '关着', pinyin: 'guānzhe', english: 'closed' } },
  open: { verb: { hanzi: '打开', pinyin: 'dǎkāi', english: 'open' }, label: { hanzi: '开着', pinyin: 'kāizhe', english: 'open' } },
};
const SWITCH = {
  off: { verb: { hanzi: '关上', pinyin: 'guānshang', english: 'turn off' }, label: { hanzi: '关着', pinyin: 'guānzhe', english: 'off' } },
  on: { verb: { hanzi: '打开', pinyin: 'dǎkāi', english: 'turn on' }, label: { hanzi: '开着', pinyin: 'kāizhe', english: 'on' } },
};

const WORDS = {
  // the stalls and what's on them
  vegStall: W('菜摊', 'càitān', 'vegetable stall', '个', '菜 (cài) vegetables, also "a dish" + 摊 (tān) stall, a spread-out pitch.\n摊 is in 摆摊 (bǎi tān) = to set up a stall, and 地摊 (dìtān) = a stall on the ground.', ['菜摊上的白菜很新鲜。', 'Càitān shang de báicài hěn xīnxiān.', 'The cabbage on the vegetable stall is very fresh.']),
  fruitStall: W('水果摊', 'shuǐguǒtān', 'fruit stall', '个', '水果 (shuǐguǒ) fruit — literally "water fruit" — + 摊 (tān) stall.\n水果店 (diàn) is a fruit shop with walls and a door.', ['水果摊在菜摊对面。', 'Shuǐguǒtān zài càitān duìmiàn.', 'The fruit stall is opposite the vegetable stall.']),
  tofuStall: W('豆腐摊', 'dòufutān', 'tofu stall', '个', '豆腐 (dòufu) tofu + 摊 (tān) stall.\nTofu stalls usually sell 豆浆 (dòujiāng, soy milk) and eggs too.', ['我每天早上去豆腐摊买豆腐。', 'Wǒ měitiān zǎoshang qù dòufutān mǎi dòufu.', 'Every morning I go to the tofu stall to buy tofu.']),
  dryStall: W('干货摊', 'gānhuòtān', 'dry goods stall', '个', '干 (gān) dry + 货 (huò) goods + 摊 (tān) stall.\n干货 = dried food: nuts, dates, beans, mushrooms. 粮油 (liángyóu) = grain and oil.', ['干货摊上有花生和红枣。', 'Gānhuòtān shang yǒu huāshēng hé hóngzǎo.', 'The dry goods stall has peanuts and red dates.']),
  scale: W('电子秤', 'diànzǐchèng', 'electronic scale', '台', '电子 (diànzǐ) electronic + 秤 (chèng) scale.\nMarket scales show 斤 (jīn): one 斤 is half a kilo, and prices are per 斤.\n称 (chēng) is the verb "to weigh": 帮我称一下 = weigh it for me.', ['把西瓜放在电子秤上。', 'Bǎ xīguā fàng zài diànzǐchèng shang.', 'Put the watermelon on the electronic scale.']),
  hangingScale: W('秤', 'chèng', 'scale', '台', '秤 (chèng) a weighing scale — the 禾 grain radical: grain was what got weighed.\nDon\'t mix it up with 称 (chēng), the verb: 用秤称一称 = weigh it on the scale.\n公平秤 = the market\'s public "fair scale" for checking a vendor\'s weight.', ['这个秤准不准？', 'Zhège chèng zhǔn bu zhǔn?', 'Is this scale accurate?']),
  priceBoard: W('价格牌', 'jiàgépái', 'price board', '块', '价格 (jiàgé) price + 牌 (pái) board, sign.\nPrices are said per 斤: 三块五一斤 = 3.5 yuan for half a kilo.', ['价格牌上写着三块五一斤。', 'Jiàgépái shang xiězhe sān kuài wǔ yì jīn.', 'The price board says three fifty a jin.']),
  qr: W('二维码', 'èrwéimǎ', 'QR code', '个', '二维 (èrwéi) two-dimensional + 码 (mǎ) code.\n扫码 (sǎo mǎ) = scan the code — how almost everyone pays at a market now.\n付钱 / 付款 (fù qián / fù kuǎn) = to pay.', ['请扫这个二维码付钱。', 'Qǐng sǎo zhège èrwéimǎ fù qián.', 'Please scan this QR code to pay.']),
  cashBox: W('钱箱', 'qiánxiāng', 'cash box', '个', '钱 (qián) money + 箱 (xiāng) box.\nVendors still keep coins and small notes for 找钱 (zhǎo qián) = giving change.', ['老板把钱放进钱箱里。', 'Lǎobǎn bǎ qián fàngjìn qiánxiāng li.', 'The stall owner puts the money into the cash box.']),
  fan: W('电风扇', 'diànfēngshàn', 'electric fan', '台', '电 (diàn) electric + 风 (fēng) wind + 扇 (shàn) fan.\n扇 is 4th tone as a noun; as a verb "to fan" it is shān.\nMachines take 台: 一台电风扇.', ['天太热了，打开电风扇吧。', 'Tiān tài rè le, dǎkāi diànfēngshàn ba.', 'It\'s too hot — turn on the fan.']),
  bulb: W('灯泡', 'dēngpào', 'light bulb', '个', '灯 (dēng) lamp + 泡 (pào) bubble: a light "bubble".\n灯泡坏了 = the bulb has gone. A bare bulb over a stall is a market classic.', ['这个灯泡很亮。', 'Zhège dēngpào hěn liàng.', 'This light bulb is very bright.']),
  awning: W('遮阳棚', 'zhēyángpéng', 'awning', '个', '遮 (zhē) to cover, shade + 阳 (yáng) sun + 棚 (péng) shed, canopy.\nIt keeps both sun and rain off: 遮阳 = to shade from the sun.', ['遮阳棚下面很凉快。', 'Zhēyángpéng xiàmiàn hěn liángkuai.', 'It\'s nice and cool under the awning.']),
  bin: W('垃圾桶', 'lājītǒng', 'rubbish bin', '个', '垃圾 (lājī) rubbish + 桶 (tǒng) bucket.\n扔 (rēng) = to throw: 把它扔进垃圾桶里. 扔掉 = to throw away.', ['请把烂菜扔进垃圾桶里。', 'Qǐng bǎ làn cài rēngjìn lājītǒng li.', 'Please throw the rotten vegetables into the bin.']),
  cart: W('推车', 'tuīchē', 'hand cart', '辆', '推 (tuī) to push + 车 (chē) vehicle.\nVehicles take 辆 (liàng): 一辆推车. Vendors bring their stock in on these at dawn.', ['推车上有很多白菜。', 'Tuīchē shang yǒu hěn duō báicài.', 'There are lots of cabbages on the cart.']),
  crate: W('筐', 'kuāng', 'crate', '个', '筐 (kuāng) a basket or crate — the 竹 bamboo radical: they used to be woven bamboo.\nAlso a measure word: 一筐苹果 = a crate of apples.', ['筐里有五个水果。', 'Kuāng li yǒu wǔ gè shuǐguǒ.', 'There are five pieces of fruit in the crate.']),
  trolley: W('买菜车', 'mǎicàichē', 'shopping trolley', '辆', '买菜 (mǎi cài) to buy groceries + 车 (chē) cart.\nThe two-wheeled tartan trolley every grandma pulls to the market.', ['奶奶拉着买菜车去菜市场。', 'Nǎinai lāzhe mǎicàichē qù càishìchǎng.', 'Grandma pulls her shopping trolley to the market.']),
  bag: W('塑料袋', 'sùliàodài', 'plastic bag', '个', '塑料 (sùliào) plastic + 袋 (dài) bag.\n要袋子吗？ (Do you want a bag?) — 袋 is also a measure word: 一袋大米.', ['要塑料袋吗？', 'Yào sùliàodài ma?', 'Do you want a plastic bag?']),
  basket: W('篮子', 'lánzi', 'basket', '个', '篮 (lán) basket — the 竹 bamboo radical on top — + 子 (zi).\n菜篮子 (càilánzi) = a shopping basket for groceries.', ['篮子里有三根黄瓜。', 'Lánzi li yǒu sān gēn huángguā.', 'There are three cucumbers in the basket.']),

  // vegetables
  cabbage: W('白菜', 'báicài', 'napa cabbage', '棵', '白 (bái) white + 菜 (cài) vegetable: the pale "white vegetable".\nPlants take 棵 (kē): 一棵白菜. In the north it was THE winter vegetable.', ['一棵白菜两块钱。', 'Yì kē báicài liǎng kuài qián.', 'One cabbage is two yuan.']),
  tomato: W('西红柿', 'xīhóngshì', 'tomato', '个', '西 (xī) west + 红 (hóng) red + 柿 (shì) persimmon: the "western red persimmon".\nIn the south people say 番茄 (fānqié). 西红柿炒鸡蛋 is a home-cooking classic.', ['西红柿炒鸡蛋很好吃。', 'Xīhóngshì chǎo jīdàn hěn hǎochī.', 'Tomato and egg stir-fry is delicious.']),
  cucumber: W('黄瓜', 'huángguā', 'cucumber', '根', '黄 (huáng) yellow + 瓜 (guā) melon, gourd — they turn yellow when overripe.\nLong thin things take 根 (gēn): 三根黄瓜.', ['我要三根黄瓜。', 'Wǒ yào sān gēn huángguā.', 'I want three cucumbers.']),
  potato: W('土豆', 'tǔdòu', 'potato', '个', '土 (tǔ) earth + 豆 (dòu) bean: the "earth bean".\nThe formal word is 马铃薯 (mǎlíngshǔ). 土豆丝 = shredded potato stir-fry.', ['土豆多少钱一斤？', 'Tǔdòu duōshao qián yì jīn?', 'How much are potatoes per jin?']),
  carrot: W('胡萝卜', 'húluóbo', 'carrot', '根', '胡 (hú) foreign, from the west + 萝卜 (luóbo) radish: the "foreign radish".\n萝卜 alone is the big white radish. Measure 根: 一根胡萝卜.', ['胡萝卜对眼睛好。', 'Húluóbo duì yǎnjing hǎo.', 'Carrots are good for your eyes.']),
  scallion: W('葱', 'cōng', 'spring onion', '把', '葱 (cōng) spring onion — the 艹 grass radical on top.\nA bunch is 一把葱 (yì bǎ cōng); 葱花 (cōnghuā) = chopped spring onion.\nVendors often throw in a few for free: 送你一把葱.', ['老板送了我一把葱。', 'Lǎobǎn sòngle wǒ yì bǎ cōng.', 'The stall owner gave me a bunch of spring onions for free.']),
  garlic: W('大蒜', 'dàsuàn', 'garlic', '头', '大 (dà) big + 蒜 (suàn) garlic. In speech often just 蒜.\nA head of garlic is 一头大蒜 (头 tóu = head); a clove is 一瓣 (bàn).', ['我买了一头大蒜。', 'Wǒ mǎile yì tóu dàsuàn.', 'I bought a head of garlic.']),
  chili: W('辣椒', 'làjiāo', 'chilli pepper', '个', '辣 (là) spicy + 椒 (jiāo) pepper.\n辣 is the taste; 不辣 = not spicy. Sichuan pepper is 花椒 (huājiāo).', ['这个辣椒很辣。', 'Zhège làjiāo hěn là.', 'This chilli is very hot.']),
  eggplant: W('茄子', 'qiézi', 'eggplant', '根', '茄 (qié) eggplant + 子 (zi).\nThe long Chinese kind takes 根 (gēn); a round one 个. 拍照说"茄子" = say "cheese".', ['这根茄子很长。', 'Zhè gēn qiézi hěn cháng.', 'This eggplant is very long.']),

  // fruit
  watermelon: W('西瓜', 'xīguā', 'watermelon', '个', '西 (xī) west + 瓜 (guā) melon: it came along the Silk Road from the west.\nIn summer stalls sell it whole or 切开 (qiēkāi, cut open).', ['夏天吃西瓜最舒服。', 'Xiàtiān chī xīguā zuì shūfu.', 'Eating watermelon in summer is the best.']),
  grapes: W('葡萄', 'pútao', 'grapes', '串', '葡萄 (pútao) — a loanword from Central Asia; neither character is used alone.\nA bunch is 一串 (chuàn): 一串葡萄. 吃葡萄不吐葡萄皮 is a famous tongue twister.', ['这串葡萄很甜。', 'Zhè chuàn pútao hěn tián.', 'This bunch of grapes is very sweet.']),
  strawberries: W('草莓', 'cǎoméi', 'strawberry', '盒', '草 (cǎo) grass + 莓 (méi) berry.\nSold in punnets: 一盒草莓 (盒 hé = box).', ['一盒草莓二十块。', 'Yì hé cǎoméi èrshí kuài.', 'A punnet of strawberries is twenty yuan.']),
  apple: W('苹果', 'píngguǒ', 'apple', '个', '苹 (píng) apple + 果 (guǒ) fruit.\n苹 sounds like 平 (peace): apples are given at Christmas Eve, 平安夜.', ['苹果三块五一斤。', 'Píngguǒ sān kuài wǔ yì jīn.', 'Apples are three fifty a jin.']),
  rottenApple: W('烂苹果', 'làn píngguǒ', 'rotten apple', '个', '烂 (làn) rotten, mushy, worn out + 苹果 (píngguǒ) apple.\n烂了 = it\'s gone bad; also 坏了 (huài le). 烂 has the 火 fire radical: "cooked to mush".', ['这个烂苹果不能吃了。', 'Zhège làn píngguǒ bù néng chī le.', 'This rotten apple can\'t be eaten any more.']),
  orange: W('橙子', 'chéngzi', 'orange', '个', '橙 (chéng) orange — the 木 tree radical — + 子 (zi).\n橙色 = the colour orange. A mandarin is 橘子 (júzi).', ['我想买两个橙子。', 'Wǒ xiǎng mǎi liǎng gè chéngzi.', 'I\'d like to buy two oranges.']),
  pear: W('梨', 'lí', 'pear', '个', '梨 (lí) pear — 利 on top of the 木 tree radical.\nDon\'t cut a pear to share: 分梨 (fēn lí) sounds like 分离 (fēnlí) = to part.', ['这个梨很甜。', 'Zhège lí hěn tián.', 'This pear is very sweet.']),
  banana: W('香蕉', 'xiāngjiāo', 'banana', '把', '香 (xiāng) fragrant + 蕉 (jiāo) plantain.\nOne banana is 一根香蕉; a bunch is 一把香蕉 (yì bǎ).', ['我买了一把香蕉。', 'Wǒ mǎile yì bǎ xiāngjiāo.', 'I bought a bunch of bananas.']),

  // tofu, eggs, dry goods, tools
  tofu: W('豆腐', 'dòufu', 'tofu', '块', '豆 (dòu) bean + 腐 (fu) curdled, soft.\nA block is 一块豆腐 (yí kuài). 麻婆豆腐 = mapo tofu.', ['我要一块豆腐。', 'Wǒ yào yí kuài dòufu.', 'I\'d like one block of tofu.']),
  egg: W('鸡蛋', 'jīdàn', 'egg', '个', '鸡 (jī) chicken + 蛋 (dàn) egg.\nAt the market eggs are sold by weight: 鸡蛋多少钱一斤？', ['鸡蛋多少钱一斤？', 'Jīdàn duōshao qián yì jīn?', 'How much are eggs per jin?']),
  cleaver: W('菜刀', 'càidāo', 'cleaver', '把', '菜 (cài) vegetables, food + 刀 (dāo) knife: the one big knife of a Chinese kitchen.\nThings with a handle take 把: 一把菜刀. 快 also means sharp.', ['小心，菜刀很快。', 'Xiǎoxīn, càidāo hěn kuài.', 'Careful, the cleaver is very sharp.']),
  peanuts: W('花生', 'huāshēng', 'peanut', '袋', '花 (huā) flower + 生 (shēng) to grow: the plant\'s flowers push the pods into the ground.\n一袋花生 = a bag of peanuts. 花生米 = shelled peanuts.', ['我喜欢吃花生。', 'Wǒ xǐhuan chī huāshēng.', 'I like eating peanuts.']),
  dates: W('红枣', 'hóngzǎo', 'red date', '袋', '红 (hóng) red + 枣 (zǎo) jujube.\n早 (zǎo, early) sounds the same: 早生贵子 — dates are a wedding gift.', ['红枣很甜。', 'Hóngzǎo hěn tián.', 'Red dates are very sweet.']),
  rice: W('大米', 'dàmǐ', 'rice', '袋', '大 (dà) big + 米 (mǐ) hulled grain: uncooked rice.\nCooked rice is 米饭 (mǐfàn). A sack: 一袋大米 (yí dài).', ['一袋大米十斤。', 'Yí dài dàmǐ shí jīn.', 'One bag of rice is ten jin.']),
};

/** Stalls are drawn facing +z: their yaw turns them to the aisle. */
const FACE_PLUS_X = Math.PI / 2;
const FACE_MINUS_X = -Math.PI / 2;

const hollow = (w: number, h: number, d: number, t = 0.012): WorldObjectDef['collider'] => [
  { box: [w, t, d], offset: [0, -h / 2 + t / 2, 0] },
  { box: [w, h, t], offset: [0, 0, d / 2 - t / 2] },
  { box: [w, h, t], offset: [0, 0, -d / 2 + t / 2] },
  { box: [t, h, d], offset: [w / 2 - t / 2, 0, 0] },
  { box: [t, h, d], offset: [-w / 2 + t / 2, 0, 0] },
];

const objects: WorldObjectDef[] = [
  // ── fixed (inspectable, not grabbable) ──
  { id: 'veg_stall', word: WORDS.vegStall, material: 'wood', mass: 0, at: [-1.85, 0.425, -0.85], yaw: FACE_PLUS_X, surface: true, model: M.VegStallModel, collider: { box: [2.3, 0.85, 0.9] } },
  { id: 'fruit_stall', word: WORDS.fruitStall, material: 'wood', mass: 0, at: [1.85, 0.425, -0.85], yaw: FACE_MINUS_X, surface: true, model: M.FruitStallModel, collider: { box: [2.3, 0.85, 0.9] } },
  { id: 'tofu_stall', word: WORDS.tofuStall, material: 'stone', mass: 0, at: [0, 0.425, -2.45], surface: true, model: M.TofuStallModel, collider: { box: [2.0, 0.85, 0.8] } },
  { id: 'dry_stall', word: WORDS.dryStall, material: 'metal', mass: 0, at: [1.85, 0.4, 1.5], yaw: FACE_MINUS_X, surface: true, model: M.DryStallModel, collider: { box: [1.4, 0.8, 0.9] } },
  { id: 'scale', word: WORDS.scale, material: 'metal', mass: 0, at: [1.63, 0.88, -0.25], yaw: FACE_MINUS_X, surface: true, model: M.ScaleModel, collider: { box: [0.3, 0.06, 0.26] } },
  {
    id: 'hanging_scale', word: WORDS.hangingScale, material: 'metal', mass: 0, at: [-1.6, 1.2, 0.18], yaw: FACE_PLUS_X, surface: true, model: M.HangingScaleModel,
    collider: [
      { box: [0.3, 0.012, 0.3], offset: [0, -0.018, 0] },
      { box: [0.3, 0.04, 0.012], offset: [0, 0, 0.144] },
      { box: [0.3, 0.04, 0.012], offset: [0, 0, -0.144] },
      { box: [0.012, 0.04, 0.3], offset: [0.144, 0, 0] },
      { box: [0.012, 0.04, 0.3], offset: [-0.144, 0, 0] },
    ],
  },
  { id: 'price_board', word: WORDS.priceBoard, material: 'wood', mass: 0, at: [-3.45, 1.6, -0.85], yaw: FACE_PLUS_X, model: M.PriceBoardModel, collider: { box: [1.1, 0.7, 0.04] } },
  { id: 'qr', word: WORDS.qr, material: 'plastic', mass: 0, at: [1.52, 0.92, 1.95], yaw: FACE_MINUS_X, model: M.QrModel, collider: { box: [0.18, 0.24, 0.04] } },
  {
    id: 'cash_box', word: WORDS.cashBox, material: 'metal', mass: 0, at: [1.62, 0.84, 1.55], yaw: FACE_MINUS_X, model: M.CashBoxModel,
    collider: { box: [0.26, 0.08, 0.2] },
    states: [{ key: 'lid', initial: 'closed', values: OPEN }],
  },
  {
    id: 'fan', word: WORDS.fan, material: 'plastic', mass: 0, at: [-1.2, 0.7, -2.55], model: M.FanModel,
    collider: { box: [0.3, 1.4, 0.3] },
    states: [{ key: 'power', initial: 'off', values: SWITCH }],
    loops: { 'power=on': 'fan' },
  },
  {
    id: 'bulb', word: WORDS.bulb, material: 'glass', mass: 0, at: [0, 2.45, -0.9], model: M.BulbModel,
    collider: { box: [0.1, 0.16, 0.1] },
    states: [{ key: 'light', initial: 'on', values: SWITCH }],
  },
  { id: 'awning', word: WORDS.awning, material: 'cloth', mass: 0, at: [-1.75, 2.25, -0.85], model: M.AwningVegModel, collider: { box: [1.2, 0.06, 2.5] } },
  { id: 'awning_2', word: WORDS.awning, material: 'cloth', mass: 0, at: [1.75, 2.25, -0.85], model: M.AwningFruitModel, collider: { box: [1.2, 0.06, 2.5] } },
  {
    id: 'bin', word: WORDS.bin, material: 'plastic', mass: 0, at: [-1.15, 0.33, 0.75], model: M.BinModel,
    collider: hollow(0.38, 0.66, 0.38, 0.02),
    inside: { min: [-0.17, -0.31, -0.17], max: [0.17, 0.4, 0.17] },
  },
  { id: 'cart', word: WORDS.cart, material: 'metal', mass: 0, at: [-2.2, 0.27, 1.5], surface: true, model: M.CartModel, collider: { box: [0.62, 0.54, 1.0] } },
  {
    id: 'crate', word: WORDS.crate, material: 'plastic', mass: 0, at: [1.1, 0.155, 0.55], model: M.CrateModel,
    collider: hollow(0.5, 0.3, 0.36, 0.02),
    inside: { min: [-0.23, -0.13, -0.16], max: [0.23, 0.22, 0.16] },
  },
  {
    id: 'trolley', word: WORDS.trolley, material: 'cloth', mass: 0, at: [0.85, 0.32, 1.9], model: M.TrolleyModel,
    collider: hollow(0.34, 0.6, 0.28, 0.02),
    inside: { min: [-0.15, -0.28, -0.12], max: [0.15, 0.32, 0.12] },
  },

  // ── grabbable: vegetables (the 菜摊's front strip, counter top 0.85) ──
  { id: 'cabbage', word: WORDS.cabbage, tags: ['vegetable'], material: 'food', mass: 1.2, at: [-1.66, 0.928, -1.8], model: M.CabbageModel, collider: { box: [0.15, 0.15, 0.34] } },
  { id: 'eggplant', word: WORDS.eggplant, tags: ['vegetable'], material: 'food', mass: 0.25, at: [-1.78, 0.881, -1.42], model: M.EggplantModel, collider: { box: [0.055, 0.055, 0.24] } },
  { id: 'carrot', word: WORDS.carrot, tags: ['vegetable', 'carrot'], material: 'food', mass: 0.12, at: [-1.57, 0.87, -1.5], model: M.CarrotModel, collider: { box: [0.17, 0.034, 0.034] } },
  { id: 'carrot_2', word: WORDS.carrot, tags: ['vegetable', 'carrot'], material: 'food', mass: 0.12, at: [-1.57, 0.87, -1.42], model: M.CarrotModel, collider: { box: [0.17, 0.034, 0.034] } },
  { id: 'tomato', word: WORDS.tomato, tags: ['vegetable', 'tomato'], material: 'food', mass: 0.15, at: [-1.72, 0.891, -1.08], model: M.Tomato1, collider: { ball: 0.038 } },
  { id: 'tomato_2', word: WORDS.tomato, tags: ['vegetable', 'tomato'], material: 'food', mass: 0.15, at: [-1.63, 0.891, -1.02], model: M.Tomato2, collider: { ball: 0.038 } },
  { id: 'tomato_3', word: WORDS.tomato, tags: ['vegetable', 'tomato'], material: 'food', mass: 0.15, at: [-1.63, 0.891, -1.13], model: M.Tomato3, collider: { ball: 0.038 } },
  { id: 'cucumber', word: WORDS.cucumber, tags: ['vegetable', 'cucumber'], material: 'food', mass: 0.2, at: [-1.79, 0.87, -0.7], model: M.CucumberModel, collider: { box: [0.034, 0.034, 0.21] } },
  { id: 'cucumber_2', word: WORDS.cucumber, tags: ['vegetable', 'cucumber'], material: 'food', mass: 0.2, at: [-1.745, 0.87, -0.7], model: M.CucumberModel, collider: { box: [0.034, 0.034, 0.21] } },
  { id: 'cucumber_3', word: WORDS.cucumber, tags: ['vegetable', 'cucumber'], material: 'food', mass: 0.2, at: [-1.7, 0.87, -0.7], model: M.CucumberModel, collider: { box: [0.034, 0.034, 0.21] } },
  { id: 'cucumber_4', word: WORDS.cucumber, tags: ['vegetable', 'cucumber'], material: 'food', mass: 0.2, at: [-1.655, 0.87, -0.7], model: M.CucumberModel, collider: { box: [0.034, 0.034, 0.21] } },
  { id: 'chili', word: WORDS.chili, tags: ['vegetable'], material: 'food', mass: 0.02, at: [-1.56, 0.864, -0.7], model: M.ChiliModel, collider: { box: [0.022, 0.022, 0.11] } },
  { id: 'potato', word: WORDS.potato, tags: ['vegetable', 'potato'], material: 'food', mass: 0.2, at: [-1.76, 0.884, -0.38], model: M.Potato1, collider: { box: [0.085, 0.062, 0.068] } },
  { id: 'potato_2', word: WORDS.potato, tags: ['vegetable', 'potato'], material: 'food', mass: 0.2, at: [-1.65, 0.884, -0.38], yaw: 0.6, model: M.Potato2, collider: { box: [0.085, 0.062, 0.068] } },
  { id: 'potato_3', word: WORDS.potato, tags: ['vegetable', 'potato'], material: 'food', mass: 0.2, at: [-1.54, 0.884, -0.38], yaw: -0.4, model: M.Potato1, collider: { box: [0.085, 0.062, 0.068] } },
  { id: 'scallion', word: WORDS.scallion, tags: ['vegetable'], material: 'food', mass: 0.1, at: [-2.05, 0.868, -0.3], model: M.ScallionModel, collider: { box: [0.04, 0.03, 0.36] } },
  { id: 'garlic', word: WORDS.garlic, tags: ['vegetable'], material: 'food', mass: 0.05, at: [-2.08, 0.878, 0.05], model: M.GarlicModel, collider: { cylinder: [0.03, 0.05] } },
  {
    id: 'bag', word: WORDS.bag, tags: ['container'], material: 'plastic', mass: 0.1, at: [-1.64, 0.983, -0.05], model: M.BagModel,
    collider: [
      { box: [0.24, 0.01, 0.16], offset: [0, -0.125, 0] },
      { box: [0.24, 0.26, 0.012], offset: [0, 0, 0.075] },
      { box: [0.24, 0.26, 0.012], offset: [0, 0, -0.075] },
      { box: [0.012, 0.26, 0.16], offset: [0.115, 0, 0] },
      { box: [0.012, 0.26, 0.16], offset: [-0.115, 0, 0] },
    ],
    inside: { min: [-0.11, -0.12, -0.07], max: [0.11, 0.14, 0.07] },
  },

  // ── grabbable: fruit (the 水果摊's front strip) ──
  { id: 'watermelon', word: WORDS.watermelon, tags: ['fruit'], material: 'food', mass: 4, at: [1.65, 0.963, -1.75], model: M.WatermelonModel, collider: { cylinder: [0.12, 0.22] } },
  { id: 'grapes', word: WORDS.grapes, tags: ['fruit'], material: 'food', mass: 0.4, at: [1.6, 0.893, -1.4], model: M.GrapesModel, collider: { box: [0.16, 0.08, 0.11] } },
  { id: 'strawberries', word: WORDS.strawberries, tags: ['fruit'], material: 'plastic', mass: 0.3, at: [1.62, 0.886, -1.18], model: M.StrawberriesModel, collider: { box: [0.15, 0.065, 0.1] } },
  { id: 'apple', word: WORDS.apple, tags: ['fruit', 'apple'], material: 'food', mass: 0.2, at: [1.55, 0.893, -0.95], model: M.Apple1, collider: { ball: 0.04 } },
  { id: 'apple_2', word: WORDS.apple, tags: ['fruit', 'apple'], material: 'food', mass: 0.2, at: [1.65, 0.893, -0.95], model: M.Apple2, collider: { ball: 0.04 } },
  { id: 'rotten_apple', word: WORDS.rottenApple, tags: ['rotten'], material: 'food', mass: 0.18, at: [1.76, 0.893, -0.87], model: M.RottenAppleModel, collider: { ball: 0.04 } },
  { id: 'orange', word: WORDS.orange, tags: ['fruit', 'orange'], material: 'food', mass: 0.2, at: [1.55, 0.891, -0.65], model: M.OrangeModel, collider: { ball: 0.038 } },
  { id: 'orange_2', word: WORDS.orange, tags: ['fruit', 'orange'], material: 'food', mass: 0.2, at: [1.65, 0.891, -0.65], model: M.OrangeModel, collider: { ball: 0.038 } },
  { id: 'pear', word: WORDS.pear, tags: ['fruit'], material: 'food', mass: 0.22, at: [1.77, 0.903, -0.6], model: M.PearModel, collider: { cylinder: [0.035, 0.1] } },
  { id: 'banana', word: WORDS.banana, tags: ['fruit'], material: 'food', mass: 0.6, at: [1.62, 0.888, 0.12], model: M.BananaBunchModel, collider: { box: [0.2, 0.07, 0.15] } },

  // ── grabbable: the 豆腐摊 (counter top 0.85, the board 0.88) ──
  { id: 'tofu', word: WORDS.tofu, tags: ['tofu'], material: 'food', mass: 0.4, at: [-0.55, 0.878, -2.25], model: M.TofuModel, collider: { box: [0.11, 0.05, 0.11] } },
  { id: 'tofu_2', word: WORDS.tofu, tags: ['tofu'], material: 'food', mass: 0.4, at: [-0.38, 0.878, -2.25], model: M.TofuModel, collider: { box: [0.11, 0.05, 0.11] } },
  { id: 'egg', word: WORDS.egg, tags: ['egg'], material: 'food', mass: 0.06, at: [0.45, 0.884, -2.22], model: M.EggModel, collider: { cylinder: [0.024, 0.062] } },
  { id: 'egg_2', word: WORDS.egg, tags: ['egg'], material: 'food', mass: 0.06, at: [0.53, 0.884, -2.22], model: M.EggModel, collider: { cylinder: [0.024, 0.062] } },
  { id: 'cleaver', word: WORDS.cleaver, material: 'metal', mass: 0.6, at: [0.0, 0.893, -2.28], model: M.CleaverModel, collider: { box: [0.28, 0.02, 0.09] } },

  // ── grabbable: dry goods ──
  { id: 'peanuts', word: WORDS.peanuts, tags: ['dry'], material: 'paper', mass: 0.5, at: [1.6, 0.878, 1.2], model: M.PeanutsModel, collider: { box: [0.1, 0.15, 0.08] } },
  { id: 'dates', word: WORDS.dates, tags: ['dry'], material: 'paper', mass: 0.5, at: [1.6, 0.868, 1.0], model: M.DatesModel, collider: { box: [0.1, 0.13, 0.08] } },
  { id: 'rice', word: WORDS.rice, tags: ['dry'], material: 'cloth', mass: 2.5, at: [1.15, 0.053, 2.4], yaw: 0.3, model: M.RiceModel, collider: { box: [0.3, 0.1, 0.2] } },

  // ── grabbable: the shopping basket, on the floor by the aisle ──
  {
    id: 'basket', word: WORDS.basket, tags: ['container'], material: 'plastic', mass: 0.5, at: [-0.7, 0.083, 1.5], model: M.BasketModel,
    collider: [
      { box: [0.34, 0.015, 0.26], offset: [0, -0.072, 0] },
      { box: [0.34, 0.16, 0.014], offset: [0, 0, 0.124] },
      { box: [0.34, 0.16, 0.014], offset: [0, 0, -0.124] },
      { box: [0.014, 0.16, 0.26], offset: [0.164, 0, 0] },
      { box: [0.014, 0.16, 0.26], offset: [-0.164, 0, 0] },
    ],
    inside: { min: [-0.16, -0.07, -0.12], max: [0.16, 0.13, 0.12] },
  },
];

export default defineWorld({
  id: 'market',
  title_zh: '菜市场',
  title_en: 'Wet market',
  blurb: 'Weigh a watermelon, bag two tomatoes, buy tofu, pay by QR — and throw the rotten apple out.',
  bounds: { min: [-3.5, 0, -3], max: [3.5, 3.2, 3] },
  spawn: { at: [0, 0, 2.3], yaw: 0 },
  lighting: 'indoor_warm',
  shadowArea: 7.5,
  ambience: 'market',
  Scene: MarketScene,
  objects,
  zones: [
    { id: 'tofu_front', word: WORDS.tofuStall, min: [-1.0, 0, -2.05], max: [1.0, 2.6, -1.1] },
  ],
  tasks: [
    { id: 'pick_tomato', zh: '拿起一个西红柿。', pinyin: 'Náqǐ yí gè xīhóngshì.', en: 'Pick up a tomato.', done: { holding: '#tomato' } },
    { id: 'melon_on_scale', zh: '把西瓜放在电子秤上。', pinyin: 'Bǎ xīguā fàng zài diànzǐchèng shang.', en: 'Put the watermelon on the electronic scale.', done: { on: 'watermelon', surface: 'scale' } },
    { id: 'tomatoes_in_bag', zh: '把两个西红柿放进塑料袋里。', pinyin: 'Bǎ liǎng gè xīhóngshì fàngjìn sùliàodài li.', en: 'Put two tomatoes into the plastic bag.', done: { count_in_zone: '#tomato', zone: 'bag', n: 2 } },
    { id: 'fan_on', zh: '太热了，打开电风扇。', pinyin: 'Tài rè le, dǎkāi diànfēngshàn.', en: 'It\'s too hot — turn on the fan.', done: { state: 'fan', key: 'power', value: 'on' } },
    { id: 'cucumbers_in_basket', zh: '买三根黄瓜，把它们放进篮子里。', pinyin: 'Mǎi sān gēn huángguā, bǎ tāmen fàngjìn lánzi li.', en: 'Buy three cucumbers: put them in the basket.', done: { count_in_zone: '#cucumber', zone: 'basket', n: 3 } },
    {
      id: 'weigh_potato',
      zh: '先把土豆放在秤上，然后放进塑料袋里。',
      pinyin: 'Xiān bǎ tǔdòu fàng zài chèng shang, ránhòu fàngjìn sùliàodài li.',
      en: 'First put a potato on the hanging scale, then put it in the plastic bag.',
      done: { sequence: [{ on: '#potato', surface: 'hanging_scale' }, { in_zone: '#potato', zone: 'bag' }] },
      hint: ['#potato', 'hanging_scale'],
    },
    {
      id: 'buy_tofu',
      zh: '去豆腐摊，拿一块豆腐。',
      pinyin: 'Qù dòufutān, ná yí kuài dòufu.',
      en: 'Go to the tofu stall and pick up a block of tofu.',
      done: { all_of: [{ player_in: 'tofu_front' }, { holding: '#tofu' }] },
      hint: ['tofu_stall', '#tofu'],
    },
    { id: 'egg_in_basket', zh: '把鸡蛋小心地放进篮子里。', pinyin: 'Bǎ jīdàn xiǎoxīn de fàngjìn lánzi li.', en: 'Carefully put an egg into the basket.', done: { in_zone: '#egg', zone: 'basket' } },
    {
      id: 'pay',
      zh: '先看看二维码，然后打开钱箱。',
      pinyin: 'Xiān kànkan èrwéimǎ, ránhòu dǎkāi qiánxiāng.',
      en: 'First look at the QR code, then open the cash box.',
      done: { sequence: [{ performed: 'inspect', target: 'qr' }, { state: 'cash_box', key: 'lid', value: 'open' }] },
      hint: ['qr', 'cash_box'],
    },
    { id: 'fruit_in_crate', zh: '把五个水果放进筐里。', pinyin: 'Bǎ wǔ gè shuǐguǒ fàngjìn kuāng li.', en: 'Put five pieces of fruit into the crate.', done: { count_in_zone: '#fruit', zone: 'crate', n: 5 } },
    { id: 'throw_rotten_apple', zh: '把烂苹果扔进垃圾桶里！', pinyin: 'Bǎ làn píngguǒ rēngjìn lājītǒng li!', en: 'Throw the rotten apple into the bin!', done: { thrown_into: 'rotten_apple', zone: 'bin' } },
  ],
});
