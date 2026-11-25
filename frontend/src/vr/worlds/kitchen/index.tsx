/**
 * 厨房 Kitchen — the reference VR world (docs/VR_WORLDS.md). Copy this folder to start a new world.
 *
 * Layout (metres, the floor at y 0): x −2.5 … 2.5, z −2.25 … 2.25. You start at z 1.25 facing the
 * back wall: the counter (炉子 hob on the left, 水槽 sink under the 窗户 window, cups / apples on the
 * right), the 冰箱 fridge in the back-right corner (milk and eggs inside), the 桌子 table in the
 * middle-left under the 灯 lamp, the 垃圾桶 bin front-right, the spice shelf (盐 / 糖) on the right wall.
 */
import type { WorldWord } from '@shared/vr-worlds';
import { defineWorld, type WorldObjectDef } from '../types';
import { KitchenScene } from './Scene';
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
  fridge: W('冰箱', 'bīngxiāng', 'fridge', '台', '冰 (bīng) ice + 箱 (xiāng) box: an "ice box".\nMachines take the measure word 台: 一台冰箱.\n在冰箱里 = in the fridge.', ['牛奶在冰箱里。', 'Niúnǎi zài bīngxiāng li.', 'The milk is in the fridge.']),
  table: W('桌子', 'zhuōzi', 'table', '张', '桌 (zhuō) table + 子 (zi), a noun ending.\nFlat things take 张: 一张桌子.\n在桌子上 = on the table.', ['杯子在桌子上。', 'Bēizi zài zhuōzi shang.', 'The cup is on the table.']),
  counter: W('台面', 'táimiàn', 'countertop', undefined, '台 (tái) platform + 面 (miàn) surface.\nIn a kitchen: the worktop (厨房台面).', ['台面上有一个碗。', 'Táimiàn shang yǒu yí gè wǎn.', 'There is a bowl on the countertop.']),
  sink: W('水槽', 'shuǐcáo', 'sink', '个', '水 (shuǐ) water + 槽 (cáo) trough.\nYou do the washing-up (洗碗, xǐ wǎn) in the 水槽.', ['把碗放进水槽里。', 'Bǎ wǎn fàngjìn shuǐcáo li.', 'Put the bowl in the sink.']),
  tap: W('水龙头', 'shuǐlóngtóu', 'tap', '个', '水 (shuǐ) water + 龙头 (lóngtóu) dragon head — old taps were shaped like dragons\' heads.\n打开水龙头 = turn on the tap; 关上水龙头 = turn it off.', ['请关上水龙头。', 'Qǐng guānshang shuǐlóngtóu.', 'Please turn off the tap.']),
  stove: W('炉子', 'lúzi', 'stove', '个', '炉 (lú) stove, furnace + 子 (zi).\n打开炉子 = turn the stove on; on a gas hob people also say 开火 (kāi huǒ).', ['锅在炉子上。', 'Guō zài lúzi shang.', 'The pot is on the stove.']),
  lamp: W('灯', 'dēng', 'lamp', '盏', '灯 (dēng) light, lamp — the 火 fire radical on the left.\n开灯 = turn on the light, 关灯 = turn it off.\nMeasure word 盏 (zhǎn): 一盏灯.', ['请把灯打开。', 'Qǐng bǎ dēng dǎkāi.', 'Please turn on the light.']),
  window: W('窗户', 'chuānghu', 'window', '扇', '窗 (chuāng) window + 户 (hu) door.\nDoors and windows take 扇 (shàn): 一扇窗户.', ['窗户外面有一棵树。', 'Chuānghu wàimiàn yǒu yì kē shù.', 'There is a tree outside the window.']),
  clock: W('钟', 'zhōng', 'clock', '个', '钟 (zhōng) clock, bell — the 钅 metal radical.\nA wall clock is 钟; a watch is 手表 (shǒubiǎo).\n几点钟？ = What time is it?', ['墙上有一个钟。', 'Qiáng shang yǒu yí gè zhōng.', 'There is a clock on the wall.']),
  bin: W('垃圾桶', 'lājītǒng', 'rubbish bin', '个', '垃圾 (lājī) rubbish + 桶 (tǒng) bucket.\n扔 (rēng) = to throw: 把它扔进垃圾桶里.', ['香蕉皮在垃圾桶里。', 'Xiāngjiāopí zài lājītǒng li.', 'The banana peel is in the bin.']),
  cup: W('杯子', 'bēizi', 'cup', '个', '杯 (bēi) cup + 子 (zi).\n杯 is also a measure word: 一杯水 = a glass of water.', ['我要一个杯子。', 'Wǒ yào yí gè bēizi.', 'I want a cup.']),
  bowl: W('碗', 'wǎn', 'bowl', '个', '碗 (wǎn) bowl — the 石 stone radical.\nAlso a measure word: 一碗米饭 = a bowl of rice. 洗碗 = do the dishes.', ['这个碗是蓝色的。', 'Zhège wǎn shì lánsè de.', 'This bowl is blue.']),
  plate: W('盘子', 'pánzi', 'plate', '个', '盘 (pán) plate, dish + 子 (zi).\n一盘菜 = a plate (a dish) of food.', ['盘子在桌子上。', 'Pánzi zài zhuōzi shang.', 'The plate is on the table.']),
  chopsticks: W('筷子', 'kuàizi', 'chopsticks', '双', '筷 (kuài) chopstick — the 竹 bamboo radical on top — + 子 (zi).\nThey come in pairs: 一双筷子 (yì shuāng kuàizi).', ['你会用筷子吗？', 'Nǐ huì yòng kuàizi ma?', 'Can you use chopsticks?']),
  spoon: W('勺子', 'sháozi', 'spoon', '把', '勺 (sháo) ladle, spoon + 子 (zi).\nThings held by a handle take 把: 一把勺子.', ['我用勺子喝汤。', 'Wǒ yòng sháozi hē tāng.', 'I drink soup with a spoon.']),
  knife: W('刀', 'dāo', 'knife', '把', '刀 (dāo) knife, blade — a drawing of a blade.\nMeasure word 把: 一把刀. 菜刀 (càidāo) = a kitchen cleaver.\n快 also means sharp: 这把刀很快.', ['小心，这把刀很快。', 'Xiǎoxīn, zhè bǎ dāo hěn kuài.', 'Careful, this knife is very sharp.']),
  apple: W('苹果', 'píngguǒ', 'apple', '个', '苹 (píng) apple + 果 (guǒ) fruit.\n果 is also in 水果 (shuǐguǒ) fruit.', ['我每天吃一个苹果。', 'Wǒ měitiān chī yí gè píngguǒ.', 'I eat an apple every day.']),
  banana: W('香蕉', 'xiāngjiāo', 'banana', '根', '香 (xiāng) fragrant + 蕉 (jiāo) plantain.\nLong thin things take 根 (gēn): 一根香蕉. A bunch: 一把香蕉.', ['这根香蕉很甜。', 'Zhè gēn xiāngjiāo hěn tián.', 'This banana is very sweet.']),
  milk: W('牛奶', 'niúnǎi', 'milk', '盒', '牛 (niú) cow + 奶 (nǎi) milk.\nA carton: 一盒牛奶 (盒 hé = box); a glass: 一杯牛奶.', ['冰箱里有牛奶吗？', 'Bīngxiāng li yǒu niúnǎi ma?', 'Is there milk in the fridge?']),
  egg: W('鸡蛋', 'jīdàn', 'egg', '个', '鸡 (jī) chicken + 蛋 (dàn) egg.\n蛋 is in many words: 鸭蛋 (duck egg), 蛋糕 (dàngāo, cake).', ['我早饭吃了两个鸡蛋。', 'Wǒ zǎofàn chīle liǎng gè jīdàn.', 'I had two eggs for breakfast.']),
  pot: W('锅', 'guō', 'pot', '口', '锅 (guō) pot, wok — the 钅 metal radical.\nPots take 口 (kǒu): 一口锅. 火锅 (huǒguō) = hotpot.', ['锅里有汤。', 'Guō li yǒu tāng.', 'There is soup in the pot.']),
  bread: W('面包', 'miànbāo', 'bread', '个', '面 (miàn) flour + 包 (bāo) bun.\nA loaf: 一个面包; a slice: 一片面包 (piàn).', ['我买了一个面包。', 'Wǒ mǎile yí gè miànbāo.', 'I bought a loaf of bread.']),
  board: W('砧板', 'zhēnbǎn', 'chopping board', '块', '砧 (zhēn) chopping block + 板 (bǎn) board.\nEveryday speech often says 菜板 (càibǎn). Flat pieces take 块: 一块砧板.', ['把面包放在砧板上。', 'Bǎ miànbāo fàng zài zhēnbǎn shang.', 'Put the bread on the chopping board.']),
  bottle: W('瓶子', 'píngzi', 'bottle', '个', '瓶 (píng) bottle + 子 (zi).\n瓶 is also the measure word: 一瓶水 = a bottle of water.', ['瓶子里有水。', 'Píngzi li yǒu shuǐ.', 'There is water in the bottle.']),
  basket: W('篮子', 'lánzi', 'basket', '个', '篮 (lán) basket — the 竹 bamboo radical on top (woven bamboo) — + 子 (zi).\n篮球 (lánqiú) = basketball.', ['篮子里有三个苹果。', 'Lánzi li yǒu sān gè píngguǒ.', 'There are three apples in the basket.']),
  chair: W('椅子', 'yǐzi', 'chair', '把', '椅 (yǐ) chair — the 木 wood radical — + 子 (zi).\nChairs take 把: 一把椅子.', ['请坐在椅子上。', 'Qǐng zuò zài yǐzi shang.', 'Please sit on the chair.']),
  salt: W('盐', 'yán', 'salt', undefined, '盐 (yán) salt — the 皿 dish radical at the bottom.\n放盐 = add salt; 咸 (xián) = salty.', ['汤里放一点儿盐。', 'Tāng li fàng yìdiǎnr yán.', 'Put a little salt in the soup.']),
  sugar: W('糖', 'táng', 'sugar', undefined, '糖 (táng) sugar — the 米 rice radical.\n糖 also means sweets / candy. 甜 (tián) = sweet.', ['你的咖啡要糖吗？', 'Nǐ de kāfēi yào táng ma?', 'Do you want sugar in your coffee?']),
};

const objects: WorldObjectDef[] = [
  // ── fixed (inspectable, not grabbable) ──
  {
    id: 'counter', word: WORDS.counter, material: 'stone', mass: 0, at: [-0.5, 0.45, -1.94], surface: true, model: M.CounterModel,
    collider: [
      { box: [3.9, 0.7, 0.62], offset: [0, -0.1, 0] },
      { box: [1.75, 0.2, 0.62], offset: [-1.075, 0.35, 0] },
      { box: [1.55, 0.2, 0.62], offset: [1.175, 0.35, 0] },
      { box: [0.6, 0.2, 0.12], offset: [0.1, 0.35, -0.25] },
      { box: [0.6, 0.2, 0.05], offset: [0.1, 0.35, 0.285] },
    ],
  },
  {
    id: 'sink', word: WORDS.sink, material: 'metal', mass: 0, at: [-0.4, 0.8, -1.905], model: M.SinkModel,
    collider: [
      { box: [0.58, 0.02, 0.43], offset: [0, -0.09, 0] },
      { box: [0.58, 0.19, 0.01], offset: [0, 0, 0.215] },
      { box: [0.58, 0.19, 0.01], offset: [0, 0, -0.215] },
      { box: [0.01, 0.19, 0.43], offset: [0.29, 0, 0] },
      { box: [0.01, 0.19, 0.43], offset: [-0.29, 0, 0] },
    ],
    inside: { min: [-0.28, -0.08, -0.2], max: [0.28, 0.12, 0.2] },
  },
  {
    id: 'tap', word: WORDS.tap, material: 'metal', mass: 0, at: [-0.4, 1.0, -2.17], model: M.TapModel,
    collider: { box: [0.06, 0.24, 0.18], offset: [0, 0.02, 0.05] },
    states: [{ key: 'water', initial: 'off', values: SWITCH }],
    loops: { 'water=on': 'water' },
  },
  {
    id: 'stove', word: WORDS.stove, material: 'metal', mass: 0, at: [-1.6, 0.915, -1.94], surface: true, model: M.StoveModel,
    collider: { box: [0.62, 0.03, 0.52] },
    states: [{ key: 'fire', initial: 'off', values: SWITCH }],
  },
  {
    id: 'fridge', word: WORDS.fridge, material: 'metal', mass: 0, at: [1.95, 0.9, -1.85], model: M.FridgeModel,
    collider: [
      { box: [0.72, 1.8, 0.04], offset: [0, 0, -0.355] },
      { box: [0.04, 1.8, 0.75], offset: [-0.34, 0, 0] },
      { box: [0.04, 1.8, 0.75], offset: [0.34, 0, 0] },
      { box: [0.72, 0.04, 0.75], offset: [0, 0.88, 0] },
      { box: [0.72, 0.08, 0.75], offset: [0, -0.86, 0] },
      { box: [0.64, 0.02, 0.66], offset: [0, 0.05, -0.02] },
      { box: [0.64, 0.02, 0.66], offset: [0, -0.4, -0.02] },
      { box: [0.72, 1.8, 0.05], offset: [0, 0, 0.4], when: { door: 'closed' } },
      { box: [0.05, 1.8, 0.72], offset: [-0.39, 0, 0.74], when: { door: 'open' } },
    ],
    inside: { min: [-0.32, -0.82, -0.33], max: [0.32, 0.86, 0.37] },
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  {
    id: 'table', word: WORDS.table, material: 'wood', mass: 0, at: [-0.7, 0.375, 0.1], surface: true, model: M.TableModel,
    collider: [
      { box: [1.3, 0.04, 0.8], offset: [0, 0.355, 0] },
      { box: [0.05, 0.71, 0.05], offset: [-0.59, -0.02, -0.34] },
      { box: [0.05, 0.71, 0.05], offset: [0.59, -0.02, -0.34] },
      { box: [0.05, 0.71, 0.05], offset: [-0.59, -0.02, 0.34] },
      { box: [0.05, 0.71, 0.05], offset: [0.59, -0.02, 0.34] },
    ],
  },
  {
    id: 'lamp', word: WORDS.lamp, material: 'metal', mass: 0, at: [-0.7, 2.05, 0.1], model: M.LampModel,
    collider: { box: [0.38, 0.2, 0.38] },
    states: [{ key: 'light', initial: 'off', values: SWITCH }],
  },
  { id: 'window', word: WORDS.window, material: 'glass', mass: 0, at: [-0.4, 1.6, -2.18], model: M.WindowModel, collider: { box: [1.0, 0.8, 0.1] } },
  { id: 'clock', word: WORDS.clock, material: 'plastic', mass: 0, at: [-2.47, 1.95, -0.6], model: M.ClockModel, collider: { box: [0.05, 0.32, 0.32] } },
  {
    id: 'bin', word: WORDS.bin, material: 'metal', mass: 0, at: [2.1, 0.3, 1.0], model: M.BinModel,
    collider: [
      { box: [0.34, 0.02, 0.34], offset: [0, -0.29, 0] },
      { box: [0.36, 0.6, 0.02], offset: [0, 0, 0.17] },
      { box: [0.36, 0.6, 0.02], offset: [0, 0, -0.17] },
      { box: [0.02, 0.6, 0.36], offset: [0.17, 0, 0] },
      { box: [0.02, 0.6, 0.36], offset: [-0.17, 0, 0] },
    ],
    inside: { min: [-0.16, -0.28, -0.16], max: [0.16, 0.34, 0.16] },
  },

  // ── grabbable ──
  { id: 'cup', word: WORDS.cup, tags: ['cup', 'dish'], material: 'ceramic', mass: 0.3, at: [0.25, 0.95, -1.85], model: M.CupModel, collider: { cylinder: [0.042, 0.095] } },
  { id: 'cup_2', word: WORDS.cup, tags: ['cup', 'dish'], material: 'ceramic', mass: 0.3, at: [0.42, 0.95, -1.98], model: M.Cup2Model, collider: { cylinder: [0.042, 0.095] } },
  { id: 'apple', word: WORDS.apple, tags: ['fruit', 'apple'], material: 'food', mass: 0.2, at: [0.85, 0.942, -1.84], model: M.Apple1, collider: { ball: 0.04 } },
  { id: 'apple_2', word: WORDS.apple, tags: ['fruit', 'apple'], material: 'food', mass: 0.2, at: [0.95, 0.942, -1.96], model: M.Apple2, collider: { ball: 0.04 } },
  { id: 'apple_3', word: WORDS.apple, tags: ['fruit', 'apple'], material: 'food', mass: 0.2, at: [1.05, 0.942, -1.84], model: M.Apple3, collider: { ball: 0.04 } },
  { id: 'banana', word: WORDS.banana, tags: ['fruit'], material: 'food', mass: 0.15, at: [1.25, 0.925, -1.92], yaw: 0.3, model: M.BananaModel, collider: { box: [0.2, 0.045, 0.06] } },
  { id: 'pot', word: WORDS.pot, tags: ['cookware'], material: 'metal', mass: 1.2, at: [-0.95, 0.962, -1.95], model: M.PotModel, collider: { cylinder: [0.125, 0.16], offset: [0, 0.02, 0] } },
  { id: 'board', word: WORDS.board, material: 'wood', mass: 0.8, at: [-2.15, 0.912, -1.95], surface: true, model: M.BoardModel, collider: { box: [0.36, 0.02, 0.24] } },
  { id: 'bread', word: WORDS.bread, tags: ['food'], material: 'food', mass: 0.4, at: [-2.15, 0.978, -1.95], model: M.BreadModel, collider: { box: [0.24, 0.11, 0.12] } },
  { id: 'knife', word: WORDS.knife, material: 'metal', mass: 0.2, at: [-2.15, 0.909, -1.72], model: M.KnifeModel, collider: { box: [0.24, 0.015, 0.032] } },
  { id: 'chopsticks', word: WORDS.chopsticks, material: 'wood', mass: 0.05, at: [0.05, 0.908, -1.75], model: M.ChopsticksModel, collider: { box: [0.24, 0.012, 0.03] } },
  { id: 'spoon', word: WORDS.spoon, material: 'metal', mass: 0.05, at: [0.1, 0.908, -1.68], model: M.SpoonModel, collider: { box: [0.16, 0.012, 0.04] } },
  { id: 'milk', word: WORDS.milk, tags: ['food'], material: 'paper', mass: 1, at: [1.85, 0.608, -1.9], model: M.MilkModel, collider: { box: [0.07, 0.19, 0.07] } },
  { id: 'egg', word: WORDS.egg, tags: ['food', 'egg'], material: 'food', mass: 0.06, at: [2.05, 0.993, -1.95], model: M.EggModel, collider: { cylinder: [0.024, 0.062] } },
  { id: 'egg_2', word: WORDS.egg, tags: ['food', 'egg'], material: 'food', mass: 0.06, at: [2.13, 0.993, -1.95], model: M.EggModel, collider: { cylinder: [0.024, 0.062] } },
  { id: 'bowl', word: WORDS.bowl, tags: ['dish'], material: 'ceramic', mass: 0.3, at: [-1.15, 0.787, 0.15], model: M.BowlModel, collider: { cylinder: [0.075, 0.07] } },
  { id: 'plate', word: WORDS.plate, tags: ['dish'], material: 'ceramic', mass: 0.4, at: [-0.55, 0.762, 0.32], surface: true, model: M.PlateModel, collider: { cylinder: [0.11, 0.02] } },
  { id: 'bottle', word: WORDS.bottle, material: 'glass', mass: 0.5, at: [-0.95, 0.862, -0.15], model: M.BottleModel, collider: { cylinder: [0.035, 0.22] } },
  {
    id: 'basket', word: WORDS.basket, tags: ['container'], material: 'cloth', mass: 0.5, at: [-0.27, 0.832, 0.1], model: M.BasketModel,
    collider: [
      { box: [0.34, 0.015, 0.26], offset: [0, -0.072, 0] },
      { box: [0.34, 0.16, 0.014], offset: [0, 0, 0.124] },
      { box: [0.34, 0.16, 0.014], offset: [0, 0, -0.124] },
      { box: [0.014, 0.16, 0.26], offset: [0.164, 0, 0] },
      { box: [0.014, 0.16, 0.26], offset: [-0.164, 0, 0] },
    ],
    inside: { min: [-0.16, -0.07, -0.12], max: [0.16, 0.13, 0.12] },
  },
  {
    id: 'chair', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, at: [-0.7, 0.452, 0.88], yaw: Math.PI, model: M.ChairModel,
    collider: [{ box: [0.44, 0.47, 0.46], offset: [0, -0.215, 0] }, { box: [0.44, 0.43, 0.04], offset: [0, 0.235, -0.21] }],
  },
  {
    id: 'chair_2', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, at: [-0.7, 0.452, -0.64], model: M.ChairModel,
    collider: [{ box: [0.44, 0.47, 0.46], offset: [0, -0.215, 0] }, { box: [0.44, 0.43, 0.04], offset: [0, 0.235, -0.21] }],
  },
  { id: 'salt', word: WORDS.salt, tags: ['spice'], material: 'glass', mass: 0.3, at: [2.36, 1.184, -0.6], model: M.SaltModel, collider: { cylinder: [0.04, 0.122] } },
  { id: 'sugar', word: WORDS.sugar, tags: ['spice'], material: 'glass', mass: 0.3, at: [2.36, 1.184, -0.3], model: M.SugarModel, collider: { cylinder: [0.04, 0.122] } },
];

export default defineWorld({
  id: 'kitchen',
  title_zh: '厨房',
  title_en: 'Kitchen',
  blurb: 'Open the fridge, set the table, light the stove — and throw a banana in the bin.',
  bounds: { min: [-2.5, 0, -2.25], max: [2.5, 2.7, 2.25] },
  spawn: { at: [0, 0, 1.25], yaw: 0 },
  lighting: 'indoor_day',
  shadowArea: 6,
  ambience: 'kitchen',
  Scene: KitchenScene,
  objects,
  zones: [],
  tasks: [
    { id: 'pick_apple', zh: '拿起一个苹果。', pinyin: 'Náqǐ yí gè píngguǒ.', en: 'Pick up an apple.', done: { holding: '#apple' } },
    { id: 'cup_on_table', zh: '把杯子放在桌子上。', pinyin: 'Bǎ bēizi fàng zài zhuōzi shang.', en: 'Put a cup on the table.', done: { on: '#cup', surface: 'table' } },
    { id: 'open_fridge', zh: '打开冰箱。', pinyin: 'Dǎkāi bīngxiāng.', en: 'Open the fridge.', done: { state: 'fridge', key: 'door', value: 'open' } },
    { id: 'milk_on_table', zh: '把牛奶拿出来，放在桌子上。', pinyin: 'Bǎ niúnǎi ná chūlai, fàng zài zhuōzi shang.', en: 'Take the milk out and put it on the table.', done: { on: 'milk', surface: 'table' } },
    { id: 'light_on', zh: '把灯打开。', pinyin: 'Bǎ dēng dǎkāi.', en: 'Turn on the light.', done: { state: 'lamp', key: 'light', value: 'on' } },
    { id: 'apples_in_basket', zh: '请把三个苹果放进篮子里。', pinyin: 'Qǐng bǎ sān gè píngguǒ fàngjìn lánzi li.', en: 'Please put three apples in the basket.', done: { count_in_zone: '#apple', zone: 'basket', n: 3 } },
    {
      id: 'pot_on_stove',
      zh: '先把锅放在炉子上，然后打开炉子。',
      pinyin: 'Xiān bǎ guō fàng zài lúzi shang, ránhòu dǎkāi lúzi.',
      en: 'First put the pot on the stove, then turn the stove on.',
      done: { sequence: [{ on: 'pot', surface: 'stove' }, { state: 'stove', key: 'fire', value: 'on' }] },
    },
    { id: 'banana_in_bin', zh: '把香蕉扔进垃圾桶里！', pinyin: 'Bǎ xiāngjiāo rēngjìn lājītǒng li!', en: 'Throw the banana into the bin!', done: { thrown_into: 'banana', zone: 'bin' } },
    { id: 'close_fridge', zh: '最后，关上冰箱。', pinyin: 'Zuìhòu, guānshang bīngxiāng.', en: 'Finally, close the fridge.', done: { state: 'fridge', key: 'door', value: 'closed' } },
  ],
});
