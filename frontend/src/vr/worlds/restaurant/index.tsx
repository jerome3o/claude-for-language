/**
 * 饭馆 Restaurant — a small neighbourhood restaurant (docs/VR_WORLDS.md).
 *
 * Layout (metres, the floor at y 0): x −3 … 3, z −2.5 … 2.5, 3 m high. You start at z 1.7 facing the
 * back wall: the 收银台 till in the back-left corner (招财猫, the scan-to-pay 二维码, a 托盘 tray), the
 * 窗口 serving hatch in the middle of the back wall under the 菜单 menu board (the kitchen glows behind
 * it), the glass-door 冰箱 drinks fridge in the back-right corner (啤酒, 汽水). The big 圆桌 round table
 * with its 转盘 lazy Susan is in the middle-left — 鱼, 饺子, a 蒸笼 of 包子 on the turntable, bowls,
 * teacups and the 账单 bill round the edge — under a red 灯笼; the 方桌 square table on the right still
 * holds the last customers' plates, 剩菜 leftovers, chopsticks, the 茶壶 teapot and the condiments. The
 * 鱼缸 fish tank is on the right wall, the 电扇 fan high on the left wall, the 垃圾桶 bin by the window,
 * the 挂钩 coat hooks by the front door.
 */
import type { WorldColliderPart, WorldWord } from '@shared/vr-worlds';
import { defineWorld, type WorldObjectDef } from '../types';
import { RestaurantScene } from './Scene';
import * as M from './models';

const W = (hanzi: string, pinyin: string, english: string, measure: string | undefined, fun_facts: string, example: [string, string, string]): WorldWord => ({
  hanzi, pinyin, english, ...(measure ? { measure } : {}), fun_facts, example: { hanzi: example[0], pinyin: example[1], english: example[2] },
});
const V = (hanzi: string, pinyin: string, english: string): WorldWord => ({ hanzi, pinyin, english });

const OPEN = {
  closed: { verb: V('关上', 'guānshang', 'close'), label: V('关着', 'guānzhe', 'closed') },
  open: { verb: V('打开', 'dǎkāi', 'open'), label: V('开着', 'kāizhe', 'open') },
};
const SWITCH = {
  off: { verb: V('关上', 'guānshang', 'turn off'), label: V('关着', 'guānzhe', 'off') },
  on: { verb: V('打开', 'dǎkāi', 'turn on'), label: V('开着', 'kāizhe', 'on') },
};
const SPIN = {
  still: { verb: V('停下', 'tíngxia', 'stop'), label: V('停着', 'tíngzhe', 'still') },
  turning: { verb: V('转', 'zhuàn', 'turn'), label: V('转着', 'zhuànzhe', 'turning') },
};
const CALL = {
  off: { verb: V('取消', 'qǔxiāo', 'cancel'), label: V('待机', 'dàijī', 'on standby') },
  on: { verb: V('按', 'àn', 'press'), label: V('呼叫中', 'hūjiào zhōng', 'calling') },
};

const WORDS = {
  roundTable: W('圆桌', 'yuánzhuō', 'round table', '张', '圆 (yuán) round + 桌 (zhuō) table.\nGroups eat at a 圆桌 so everyone can reach every dish.\nFlat things take 张: 一张圆桌.', ['我们坐圆桌吧。', 'Wǒmen zuò yuánzhuō ba.', "Let's sit at the round table."]),
  lazySusan: W('转盘', 'zhuànpán', 'lazy Susan', '个', '转 (zhuàn) turn, revolve + 盘 (pán) plate, tray.\n转一下转盘 = give it a turn so a dish comes to you.\nTurn it slowly — and not while someone is helping themselves.', ['请把转盘转一下。', 'Qǐng bǎ zhuànpán zhuàn yíxià.', 'Please turn the lazy Susan.']),
  squareTable: W('方桌', 'fāngzhuō', 'square table', '张', '方 (fāng) square + 桌 (zhuō) table.\n方 is also "place, direction": 地方 (dìfang), 东方 (dōngfāng).\nMeasure word 张: 一张方桌.', ['那张方桌还没收拾。', 'Nà zhāng fāngzhuō hái méi shōushi.', "That square table hasn't been cleared yet."]),
  cashier: W('收银台', 'shōuyíntái', 'cash desk', '个', '收 (shōu) receive + 银 (yín) silver, money + 台 (tái) counter.\n在收银台付钱 = pay at the cash desk; the cashier is the 收银员 (shōuyínyuán).\nIn restaurants people also just say 前台 (qiántái), the front desk.', ['请到收银台付钱。', 'Qǐng dào shōuyíntái fù qián.', 'Please pay at the cash desk.']),
  qr: W('二维码', 'èrwéimǎ', 'QR code', '个', '二 (èr) two + 维 (wéi) dimension + 码 (mǎ) code: a "two-dimensional code".\n扫二维码 (sǎo èrwéimǎ) = scan the QR code; 扫码付款 = scan to pay, how most people pay in China.\nYou\'ll also hear 扫一扫 (sǎo yi sǎo).', ['你可以扫这个二维码付钱。', 'Nǐ kěyǐ sǎo zhège èrwéimǎ fù qián.', 'You can scan this QR code to pay.']),
  menu: W('菜单', 'càidān', 'menu', '份', '菜 (cài) dish, vegetable + 单 (dān) list, sheet.\n点菜 (diǎn cài) = to order dishes; 看菜单 = look at the menu.\nMeasure word 份 (fèn), a copy: 一份菜单.', ['服务员，请给我们看一下菜单。', 'Fúwùyuán, qǐng gěi wǒmen kàn yíxià càidān.', 'Waiter, please let us see the menu.']),
  hatch: W('窗口', 'chuāngkǒu', 'serving hatch', '个', '窗 (chuāng) window + 口 (kǒu) opening.\nAny service window: 售票窗口 (ticket window), 三号窗口 (counter number 3).\nIn a restaurant kitchen it is also the 出菜口 (chūcàikǒu), where dishes come out.', ['菜在窗口，我去拿。', 'Cài zài chuāngkǒu, wǒ qù ná.', "The food is at the hatch, I'll get it."]),
  fridge: W('冰箱', 'bīngxiāng', 'fridge', '台', '冰 (bīng) ice + 箱 (xiāng) box: an "ice box".\nThe glass-door drinks fridge in a shop is also a 冰柜 (bīngguì).\n冰镇 (bīngzhèn) = chilled: 冰镇啤酒, ice-cold beer.', ['啤酒在冰箱里。', 'Píjiǔ zài bīngxiāng li.', 'The beer is in the fridge.']),
  lantern: W('灯笼', 'dēnglong', 'lantern', '个', '灯 (dēng) light + 笼 (long) cage, basket: a light in a cage.\nRed lanterns mean luck and celebration — hung everywhere at 春节 (Spring Festival).\n一个红灯笼; also 一盏灯笼 (zhǎn).', ['门口挂着两个红灯笼。', 'Ménkǒu guàzhe liǎng gè hóng dēnglong.', 'Two red lanterns hang by the door.']),
  fan: W('电扇', 'diànshàn', 'electric fan', '台', '电 (diàn) electric + 扇 (shàn) fan.\nAlso 电风扇 (diànfēngshàn); a hand fan is a 扇子 (shànzi).\n开电扇 / 关电扇 = turn the fan on / off.', ['太热了，把电扇打开吧。', 'Tài rè le, bǎ diànshàn dǎkāi ba.', "It's too hot, turn on the fan."]),
  bin: W('垃圾桶', 'lājītǒng', 'rubbish bin', '个', '垃圾 (lājī) rubbish + 桶 (tǒng) bucket.\n扔 (rēng) = to throw: 把它扔进垃圾桶里.\n垃圾分类 (lājī fēnlèi) = sorting rubbish for recycling.', ['垃圾桶在窗户下面。', 'Lājītǒng zài chuānghu xiàmiàn.', 'The bin is under the window.']),
  coatHook: W('挂钩', 'guàgōu', 'coat hook', '个', '挂 (guà) hang + 钩 (gōu) hook.\n把外套挂在挂钩上 = hang your coat on the hook.\n挂 is also "hang up" a call: 挂电话.', ['你可以把外套挂在挂钩上。', 'Nǐ kěyǐ bǎ wàitào guà zài guàgōu shang.', 'You can hang your coat on the hook.']),
  fishTank: W('鱼缸', 'yúgāng', 'fish tank', '个', '鱼 (yú) fish + 缸 (gāng) vat, big jar.\nMany restaurants keep live fish in a 鱼缸 — you pick the one you want cooked.\n金鱼 (jīnyú) = goldfish.', ['鱼缸里有三条金鱼。', 'Yúgāng li yǒu sān tiáo jīnyú.', 'There are three goldfish in the tank.']),
  teapot: W('茶壶', 'cháhú', 'teapot', '把', '茶 (chá) tea + 壶 (hú) pot, kettle.\nTeapots with a handle take 把: 一把茶壶. A pot of tea is 一壶茶.\n倒茶 (dào chá) = pour tea.', ['请把茶壶给我。', 'Qǐng bǎ cháhú gěi wǒ.', 'Please pass me the teapot.']),
  teacup: W('茶杯', 'chábēi', 'teacup', '个', '茶 (chá) tea + 杯 (bēi) cup.\nChinese teacups are small and have no handle.\nWhen someone pours your tea, tap the table with two fingers to say thanks.', ['我的茶杯空了。', 'Wǒ de chábēi kōng le.', 'My teacup is empty.']),
  bowl: W('碗', 'wǎn', 'bowl', '个', '碗 (wǎn) bowl — the 石 stone radical.\nAlso a measure word: 一碗米饭 = a bowl of rice. 洗碗 = do the dishes.\nHold your rice bowl up near your mouth when you eat — that is good manners.', ['这个碗是空的。', 'Zhège wǎn shì kōng de.', 'This bowl is empty.']),
  rice: W('米饭', 'mǐfàn', 'cooked rice', '碗', '米 (mǐ) rice grain + 饭 (fàn) cooked food, meal.\nUncooked rice is 米 or 大米; cooked rice is 米饭.\n一碗米饭 = a bowl of rice; 吃饭 = to eat (a meal).', ['我要两碗米饭。', 'Wǒ yào liǎng wǎn mǐfàn.', "I'd like two bowls of rice."]),
  chopsticks: W('筷子', 'kuàizi', 'chopsticks', '双', '筷 (kuài) chopstick — the 竹 bamboo radical on top — + 子 (zi).\nThey come in pairs: 一双筷子 (yì shuāng kuàizi). One stick: 一根筷子.\nNever stand chopsticks upright in rice: it looks like incense for the dead.', ['给我一双筷子，好吗？', 'Gěi wǒ yì shuāng kuàizi, hǎo ma?', 'Could you give me a pair of chopsticks?']),
  rest: W('筷架', 'kuàijià', 'chopstick rest', '个', '筷 (kuài) chopstick + 架 (jià) stand, rack.\nPut your chopsticks on the 筷架 between bites, not across your bowl.\n架 is also in 书架 (shūjià), a bookshelf.', ['把筷子放在筷架上。', 'Bǎ kuàizi fàng zài kuàijià shang.', 'Put the chopsticks on the chopstick rest.']),
  spoon: W('勺子', 'sháozi', 'spoon', '把', '勺 (sháo) ladle, spoon + 子 (zi).\nThe porcelain soup spoon is a 汤勺 (tāngsháo); things with a handle take 把: 一把勺子.\nEat soup dumplings with chopsticks AND a spoon underneath.', ['我用勺子喝汤。', 'Wǒ yòng sháozi hē tāng.', 'I drink soup with a spoon.']),
  plate: W('盘子', 'pánzi', 'plate', '个', '盘 (pán) plate, dish + 子 (zi).\n一盘菜 = a plate (a dish) of food; 空盘子 = an empty plate.\n光盘 (guāngpán) = a clean plate — eating everything up.', ['服务员把空盘子拿走了。', 'Fúwùyuán bǎ kōng pánzi ná zǒu le.', 'The waiter took the empty plates away.']),
  soy: W('酱油', 'jiàngyóu', 'soy sauce', '瓶', '酱 (jiàng) thick sauce, paste + 油 (yóu) oil — though there is no oil in it.\n生抽 (shēngchōu) is light soy sauce, 老抽 (lǎochōu) dark.\n一瓶酱油 = a bottle of soy sauce.', ['饺子要蘸酱油吗？', 'Jiǎozi yào zhàn jiàngyóu ma?', 'Do you dip the dumplings in soy sauce?']),
  vinegar: W('醋', 'cù', 'vinegar', '瓶', '醋 (cù) vinegar — the 酉 wine-jar radical, as in 酒 and 酱.\nIn the north, dumplings are dipped in dark vinegar.\n吃醋 (chī cù, "eat vinegar") also means to be jealous!', ['我吃饺子喜欢放醋。', 'Wǒ chī jiǎozi xǐhuan fàng cù.', 'I like vinegar with my dumplings.']),
  chilli: W('辣椒油', 'làjiāoyóu', 'chilli oil', '瓶', '辣椒 (làjiāo) chilli pepper + 油 (yóu) oil.\n辣 (là) = spicy hot; 不辣 (bú là) = not spicy.\nAsk for 微辣 (wēi là, mildly spicy) if you can\'t take the heat.', ['你要辣椒油吗？', 'Nǐ yào làjiāoyóu ma?', 'Do you want chilli oil?']),
  tissues: W('纸巾', 'zhǐjīn', 'tissues', '盒', '纸 (zhǐ) paper + 巾 (jīn) cloth, towel: a paper towel.\nRestaurants often charge for a 包 (bāo, pack) of tissues.\n一盒纸巾 = a box; one sheet is 一张纸巾.', ['请给我一张纸巾。', 'Qǐng gěi wǒ yì zhāng zhǐjīn.', 'Please give me a tissue.']),
  toothpicks: W('牙签', 'yáqiān', 'toothpicks', '盒', '牙 (yá) tooth + 签 (qiān) slip, little stick.\nOne toothpick is 一根牙签 (gēn); this holder is a 牙签盒.\nCover your mouth with your other hand when you use one — that is polite.', ['桌子上有牙签。', 'Zhuōzi shang yǒu yáqiān.', 'There are toothpicks on the table.']),
  steamer: W('蒸笼', 'zhēnglóng', 'bamboo steamer', '个', '蒸 (zhēng) to steam + 笼 (lóng) basket, cage.\n笼 is a measure word too: 一笼包子 = a steamer of buns.\n蒸 is in 蒸饺 (zhēngjiǎo), steamed dumplings.', ['蒸笼里有三个包子。', 'Zhēnglóng li yǒu sān gè bāozi.', 'There are three buns in the steamer.']),
  baozi: W('包子', 'bāozi', 'steamed bun', '个', '包 (bāo) to wrap + 子 (zi).\n肉包子 = a pork bun, 菜包子 = a vegetable bun; small soup-filled ones are 小笼包 (xiǎolóngbāo).\nA plain bun with no filling is a 馒头 (mántou).', ['我早上吃了两个包子。', 'Wǒ zǎoshang chīle liǎng gè bāozi.', 'I ate two buns this morning.']),
  dumplings: W('饺子', 'jiǎozi', 'dumplings', '盘', '饺 (jiǎo) dumpling — the 饣 food radical + 交 (jiāo) for the sound — + 子 (zi).\nBoiled: 水饺; pan-fried: 锅贴 (guōtiē). 包饺子 = to make dumplings.\nA plate of them: 一盘饺子.', ['这盘饺子是猪肉白菜的。', 'Zhè pán jiǎozi shì zhūròu báicài de.', 'This plate of dumplings is pork and cabbage.']),
  fish: W('鱼', 'yú', 'fish', '条', '鱼 (yú) fish — the bottom strokes were once its tail.\nLong things take 条: 一条鱼. This dish is 红烧鱼 (hóngshāoyú), fish braised in soy sauce.\n鱼 sounds like 余 (surplus): fish at New Year wishes you 年年有余.', ['这条鱼很好吃。', 'Zhè tiáo yú hěn hǎochī.', 'This fish is delicious.']),
  beer: W('啤酒', 'píjiǔ', 'beer', '瓶', '啤 (pí) is just the sound of "beer" + 酒 (jiǔ) alcohol.\n一瓶啤酒 = a bottle of beer; 干杯 (gānbēi) = cheers!\nAsk for it cold: 要冰的 (yào bīng de).', ['我们要两瓶啤酒。', 'Wǒmen yào liǎng píng píjiǔ.', "We'd like two bottles of beer."]),
  soda: W('汽水', 'qìshuǐ', 'soft drink', '瓶', '汽 (qì) steam, gas + 水 (shuǐ) water: fizzy water.\n饮料 (yǐnliào) is any drink; 果汁 (guǒzhī) is juice.\n汽 (gas) and 气 (air) sound the same — 汽 has the water radical.', ['孩子们想喝汽水。', 'Háizimen xiǎng hē qìshuǐ.', 'The children want soft drinks.']),
  bill: W('账单', 'zhàngdān', 'bill', '张', '账 (zhàng) account — the 贝 money radical + 单 (dān) list.\n服务员，买单！(mǎidān) is how you ask for the bill; 结账 (jiézhàng) = to settle it.\nSplitting it: AA制 (AA zhì).', ['请把账单给我。', 'Qǐng bǎ zhàngdān gěi wǒ.', 'Please give me the bill.']),
  tray: W('托盘', 'tuōpán', 'tray', '个', '托 (tuō) hold up on the palm + 盘 (pán) plate.\nWaiters carry dishes on a 托盘: 用托盘端菜.\n端 (duān) = carry something level with both hands.', ['服务员用托盘端菜。', 'Fúwùyuán yòng tuōpán duān cài.', 'The waiter carries dishes on a tray.']),
  leftovers: W('剩菜', 'shèngcài', 'leftovers', '盒', '剩 (shèng) left over + 菜 (cài) dish.\n打包 (dǎbāo) = box up the leftovers to take away; 剩饭 = leftover rice.\nFinishing everything is 光盘, a "clean plate".', ['剩菜可以打包吗？', 'Shèngcài kěyǐ dǎbāo ma?', 'Can we take the leftovers away?']),
  callButton: W('呼叫器', 'hūjiàoqì', 'call button', '个', '呼 (hū) call out + 叫 (jiào) call + 器 (qì) device.\nPress it and a waiter comes — or just call out 服务员 (fúwùyuán)!\nThe bell kind is a 服务铃 (fúwùlíng).', ['按一下呼叫器，服务员就来了。', 'Àn yíxià hūjiàoqì, fúwùyuán jiù lái le.', 'Press the call button and the waiter comes.']),
  luckyCat: W('招财猫', 'zhāocáimāo', 'lucky cat', '只', '招 (zhāo) beckon + 财 (cái) wealth + 猫 (māo) cat: a cat that waves money in.\nAnimals take 只: 一只猫.\nYou\'ll see one on many shop counters, its paw waving.', ['收银台上有一只招财猫。', 'Shōuyíntái shang yǒu yì zhī zhāocáimāo.', 'There is a lucky cat on the cash desk.']),
  chair: W('椅子', 'yǐzi', 'chair', '把', '椅 (yǐ) chair — the 木 wood radical — + 子 (zi).\nChairs take 把: 一把椅子. A stool without a back is a 凳子 (dèngzi).', ['请坐在这把椅子上。', 'Qǐng zuò zài zhè bǎ yǐzi shang.', 'Please sit on this chair.']),
};

// The round table's centre and where things sit round its edge (angle 0 = towards the door, +z).
const RT: [number, number] = [-0.9, -0.5];
const TOP = 0.76; // the tablecloth
const SUSAN = 0.81; // the lazy Susan's glass
const edge = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Math.round((RT[0] + Math.sin(a) * r) * 1000) / 1000, Math.round((RT[1] + Math.cos(a) * r) * 1000) / 1000];
};
const onRound = (deg: number, r: number, halfH: number): [number, number, number] => {
  const [x, z] = edge(deg, r);
  return [x, Math.round((TOP + halfH + 0.002) * 1000) / 1000, z];
};
const onSusan = (dx: number, dz: number, halfH: number): [number, number, number] => [RT[0] + dx, Math.round((SUSAN + halfH + 0.002) * 1000) / 1000, RT[1] + dz];
// The square table: centre and top.
const ST: [number, number] = [1.35, 0.55];
const onSquare = (dx: number, dz: number, halfH: number): [number, number, number] => [Math.round((ST[0] + dx) * 1000) / 1000, Math.round((0.75 + halfH + 0.002) * 1000) / 1000, Math.round((ST[1] + dz) * 1000) / 1000];
// The till's top (y 1.0) and the fridge's lower shelf (y 0.71).
const TILL = 1.0;
const SHELF = 0.71;

/**
 * A disc (the round table's top, the lazy Susan) as seven boxes in strips: a small box — a chopstick
 * rest, chopsticks — fell straight through a wide flat cylinder collider in Rapier, never through boxes.
 */
function discParts(r: number, h: number, y: number): WorldColliderPart[] {
  const strips: Array<[number, number]> = [[1 / 3, 0.6], [0.6, 0.8], [0.8, 1]];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const parts: WorldColliderPart[] = [{ box: [round(2 * r), h, round((2 * r) / 3)], offset: [0, y, 0] }];
  for (const [a, b] of strips) {
    const m = (a + b) / 2;
    const w = round(2 * r * Math.sqrt(1 - m * m));
    for (const side of [-1, 1]) parts.push({ box: [w, h, round((b - a) * r)], offset: [0, y, round(side * m * r)] });
  }
  return parts;
}

const CHAIR_COLLIDER = [{ box: [0.44, 0.47, 0.46] as [number, number, number], offset: [0, -0.215, 0] as [number, number, number] }, { box: [0.44, 0.43, 0.04] as [number, number, number], offset: [0, 0.235, -0.21] as [number, number, number] }];
const chairAt = (deg: number): { at: [number, number, number]; yaw: number } => {
  const [x, z] = edge(deg, 1.02);
  const a = (deg * Math.PI) / 180;
  return { at: [x, 0.452, z], yaw: Math.atan2(-Math.sin(a), -Math.cos(a)) };
};

const steamerAt = onSusan(-0.15, -0.19, 0.04);

const objects: WorldObjectDef[] = [
  // ── fixed (inspectable, not grabbable) ──
  {
    id: 'round_table', word: WORDS.roundTable, material: 'wood', mass: 0, at: [RT[0], 0.38, RT[1]], surface: true, model: M.RoundTableModel,
    collider: [...discParts(0.75, 0.04, 0.36), { cylinder: [0.07, 0.68], offset: [0, -0.02, 0] }, { cylinder: [0.32, 0.04], offset: [0, -0.36, 0] }],
  },
  {
    id: 'lazy_susan', word: WORDS.lazySusan, material: 'glass', mass: 0, at: [RT[0], 0.785, RT[1]], surface: true, model: M.LazySusanModel,
    collider: discParts(0.42, 0.05, 0),
    states: [{ key: 'spin', initial: 'still', values: SPIN }],
  },
  {
    id: 'square_table', word: WORDS.squareTable, material: 'wood', mass: 0, at: [ST[0], 0.375, ST[1]], surface: true, model: M.SquareTableModel,
    collider: [
      { box: [0.9, 0.04, 0.9], offset: [0, 0.355, 0] },
      { box: [0.05, 0.71, 0.05], offset: [-0.39, -0.02, -0.39] },
      { box: [0.05, 0.71, 0.05], offset: [0.39, -0.02, -0.39] },
      { box: [0.05, 0.71, 0.05], offset: [-0.39, -0.02, 0.39] },
      { box: [0.05, 0.71, 0.05], offset: [0.39, -0.02, 0.39] },
    ],
  },
  { id: 'cashier', word: WORDS.cashier, material: 'wood', mass: 0, at: [-2.15, 0.5, -2.05], surface: true, model: M.CashierModel, collider: { box: [1.5, 1.0, 0.6] } },
  { id: 'menu_board', word: WORDS.menu, material: 'wood', mass: 0, at: [0.4, 2.3, -2.47], model: M.MenuBoardModel, collider: { box: [1.7, 0.75, 0.05] } },
  { id: 'hatch', word: WORDS.hatch, material: 'metal', mass: 0, at: [0.4, 1.0, -2.37], surface: true, model: M.HatchModel, collider: { box: [1.5, 0.04, 0.26] } },
  {
    id: 'fridge', word: WORDS.fridge, material: 'glass', mass: 0, at: [2.45, 0.95, -2.1], model: M.FridgeModel,
    collider: [
      { box: [0.72, 1.9, 0.04], offset: [0, 0, -0.33] },
      { box: [0.04, 1.9, 0.7], offset: [-0.34, 0, 0] },
      { box: [0.04, 1.9, 0.7], offset: [0.34, 0, 0] },
      { box: [0.72, 0.04, 0.7], offset: [0, 0.93, 0] },
      { box: [0.72, 0.1, 0.7], offset: [0, -0.9, 0] },
      { box: [0.64, 0.02, 0.6], offset: [0, -0.25, -0.02] },
      { box: [0.64, 0.02, 0.6], offset: [0, 0.3, -0.02] },
      { box: [0.72, 1.9, 0.04], offset: [0, 0, 0.37], when: { door: 'closed' } },
      { box: [0.05, 1.9, 0.72], offset: [-0.39, 0, 0.73], when: { door: 'open' } },
    ],
    inside: { min: [-0.32, -0.85, -0.31], max: [0.32, 0.91, 0.35] },
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  { id: 'lantern', word: WORDS.lantern, material: 'cloth', mass: 0, at: [RT[0], 2.3, RT[1]], model: M.Lantern1, collider: { box: [0.42, 0.5, 0.42] } },
  { id: 'lantern_2', word: WORDS.lantern, material: 'cloth', mass: 0, at: [ST[0], 2.3, ST[1]], model: M.Lantern2, collider: { box: [0.42, 0.5, 0.42] } },
  {
    id: 'fan', word: WORDS.fan, material: 'plastic', mass: 0, at: [-2.84, 2.25, -0.25], model: M.FanModel,
    collider: { box: [0.3, 0.44, 0.44] },
    states: [{ key: 'power', initial: 'off', values: SWITCH }],
    loops: { 'power=on': 'fan' },
  },
  {
    id: 'bin', word: WORDS.bin, material: 'plastic', mass: 0, at: [-2.6, 0.3, 1.3], model: M.BinModel,
    collider: [
      { box: [0.34, 0.02, 0.34], offset: [0, -0.29, 0] },
      { box: [0.36, 0.6, 0.02], offset: [0, 0, 0.17] },
      { box: [0.36, 0.6, 0.02], offset: [0, 0, -0.17] },
      { box: [0.02, 0.6, 0.36], offset: [0.17, 0, 0] },
      { box: [0.02, 0.6, 0.36], offset: [-0.17, 0, 0] },
    ],
    inside: { min: [-0.16, -0.28, -0.16], max: [0.16, 0.34, 0.16] },
  },
  { id: 'coat_hook', word: WORDS.coatHook, material: 'wood', mass: 0, at: [-1.4, 1.75, 2.45], model: M.CoatHookModel, collider: { box: [0.6, 0.12, 0.09] } },
  { id: 'fish_tank', word: WORDS.fishTank, material: 'glass', mass: 0, at: [2.75, 0.68, -0.1], model: M.FishTankModel, collider: { box: [0.42, 1.36, 1.0] } },

  // ── on the round table (bowls, teacups, the bill…) and its lazy Susan (dishes) ──
  { id: 'bowl', word: WORDS.bowl, tags: ['bowl', 'dish'], material: 'ceramic', mass: 0.25, at: onRound(30, 0.58, 0.0325), model: M.Bowl1, collider: { cylinder: [0.07, 0.065] } },
  { id: 'bowl_2', word: WORDS.bowl, tags: ['bowl', 'dish'], material: 'ceramic', mass: 0.25, at: onRound(-60, 0.58, 0.0325), model: M.Bowl2, collider: { cylinder: [0.07, 0.065] } },
  { id: 'rest', word: WORDS.rest, material: 'ceramic', mass: 0.03, at: onRound(48, 0.66, 0.01), yaw: -0.85, model: M.ChopstickRestModel, collider: { box: [0.06, 0.02, 0.024] } },
  { id: 'rest_2', word: WORDS.rest, material: 'ceramic', mass: 0.03, at: onRound(-42, 0.66, 0.01), yaw: 0.75, model: M.ChopstickRestModel, collider: { box: [0.06, 0.02, 0.024] } },
  { id: 'spoon', word: WORDS.spoon, material: 'ceramic', mass: 0.05, at: onRound(12, 0.66, 0.015), yaw: 1.3, model: M.SpoonModel, collider: { box: [0.13, 0.03, 0.045] } },
  { id: 'rice', word: WORDS.rice, tags: ['food'], material: 'ceramic', mass: 0.35, at: onRound(-18, 0.6, 0.0425), model: M.RiceModel, collider: { cylinder: [0.065, 0.085] } },
  { id: 'teacup', word: WORDS.teacup, tags: ['teacup', 'dish'], material: 'ceramic', mass: 0.1, at: onRound(115, 0.6, 0.025), model: M.TeacupModel, collider: { cylinder: [0.035, 0.05] } },
  { id: 'teacup_2', word: WORDS.teacup, tags: ['teacup', 'dish'], material: 'ceramic', mass: 0.1, at: onRound(150, 0.6, 0.025), model: M.TeacupModel, collider: { cylinder: [0.035, 0.05] } },
  { id: 'teacup_3', word: WORDS.teacup, tags: ['teacup', 'dish'], material: 'ceramic', mass: 0.1, at: onRound(185, 0.6, 0.025), model: M.TeacupModel, collider: { cylinder: [0.035, 0.05] } },
  { id: 'toothpicks', word: WORDS.toothpicks, material: 'wood', mass: 0.05, at: onRound(212, 0.62, 0.0325), model: M.ToothpicksModel, collider: { cylinder: [0.024, 0.065] } },
  {
    id: 'call_button', word: WORDS.callButton, material: 'plastic', mass: 0.1, at: onRound(240, 0.6, 0.02), model: M.CallButtonModel,
    collider: { cylinder: [0.045, 0.04] },
    states: [{ key: 'call', initial: 'off', values: CALL }],
    loops: { 'call=on': 'callbell' },
  },
  { id: 'bill', word: WORDS.bill, material: 'paper', mass: 0.05, at: onRound(82, 0.6, 0.006), yaw: 0.4, model: M.BillModel, collider: { box: [0.11, 0.012, 0.16] } },
  { id: 'fish', word: WORDS.fish, tags: ['food'], material: 'ceramic', mass: 0.8, at: onSusan(0.19, 0.0, 0.025), yaw: 0.35, model: M.FishModel, collider: { box: [0.32, 0.05, 0.2] } },
  { id: 'dumplings', word: WORDS.dumplings, tags: ['food'], material: 'ceramic', mass: 0.6, at: onSusan(-0.17, 0.15, 0.02), model: M.DumplingsModel, collider: { cylinder: [0.11, 0.04] } },
  {
    id: 'steamer', word: WORDS.steamer, tags: ['container'], material: 'wood', mass: 0.4, at: steamerAt, model: M.SteamerModel,
    collider: [
      { box: [0.24, 0.012, 0.24], offset: [0, -0.034, 0] },
      { box: [0.24, 0.07, 0.012], offset: [0, 0.005, 0.114] },
      { box: [0.24, 0.07, 0.012], offset: [0, 0.005, -0.114] },
      { box: [0.012, 0.07, 0.24], offset: [0.114, 0.005, 0] },
      { box: [0.012, 0.07, 0.24], offset: [-0.114, 0.005, 0] },
    ],
    inside: { min: [-0.105, -0.028, -0.105], max: [0.105, 0.07, 0.105] },
  },
  { id: 'baozi', word: WORDS.baozi, tags: ['food', 'baozi'], material: 'food', mass: 0.08, at: [steamerAt[0] - 0.048, steamerAt[1] - 0.028 + 0.0245, steamerAt[2] - 0.03], model: M.BaoziModel, collider: { cylinder: [0.034, 0.045] } },
  { id: 'baozi_2', word: WORDS.baozi, tags: ['food', 'baozi'], material: 'food', mass: 0.08, at: [steamerAt[0] + 0.048, steamerAt[1] - 0.028 + 0.0245, steamerAt[2] - 0.03], model: M.BaoziModel, collider: { cylinder: [0.034, 0.045] } },
  { id: 'baozi_3', word: WORDS.baozi, tags: ['food', 'baozi'], material: 'food', mass: 0.08, at: [steamerAt[0], steamerAt[1] - 0.028 + 0.0245, steamerAt[2] + 0.05], model: M.BaoziModel, collider: { cylinder: [0.034, 0.045] } },

  // ── on the square table: the last customers' things ──
  { id: 'teapot', word: WORDS.teapot, material: 'ceramic', mass: 0.6, at: onSquare(-0.22, 0.08, 0.06), yaw: 0.5, model: M.TeapotModel, collider: { cylinder: [0.075, 0.12] } },
  { id: 'plate', word: WORDS.plate, tags: ['plate', 'dish'], material: 'ceramic', mass: 0.35, at: onSquare(0.2, -0.2, 0.01), model: M.Plate1, collider: { cylinder: [0.11, 0.02] } },
  { id: 'plate_2', word: WORDS.plate, tags: ['plate', 'dish'], material: 'ceramic', mass: 0.35, at: onSquare(0.22, 0.12, 0.01), model: M.Plate2, collider: { cylinder: [0.11, 0.02] } },
  { id: 'leftovers', word: WORDS.leftovers, tags: ['food'], material: 'paper', mass: 0.25, at: onSquare(0.0, -0.05, 0.035), yaw: 0.2, model: M.LeftoversModel, collider: { box: [0.13, 0.07, 0.1] } },
  { id: 'chopsticks', word: WORDS.chopsticks, tags: ['chopsticks'], material: 'wood', mass: 0.04, at: onSquare(-0.1, 0.3, 0.006), model: M.ChopsticksModel, collider: { box: [0.24, 0.012, 0.03] } },
  { id: 'chopsticks_2', word: WORDS.chopsticks, tags: ['chopsticks'], material: 'wood', mass: 0.04, at: onSquare(-0.08, 0.345, 0.006), model: M.ChopsticksModel, collider: { box: [0.24, 0.012, 0.03] } },
  { id: 'chopsticks_3', word: WORDS.chopsticks, tags: ['chopsticks'], material: 'wood', mass: 0.04, at: onSquare(-0.06, 0.39, 0.006), model: M.ChopsticksModel, collider: { box: [0.24, 0.012, 0.03] } },
  { id: 'tissues', word: WORDS.tissues, material: 'paper', mass: 0.15, at: onSquare(0.28, -0.38, 0.04), model: M.TissuesModel, collider: { box: [0.2, 0.08, 0.11] } },
  { id: 'soy', word: WORDS.soy, tags: ['condiment'], material: 'glass', mass: 0.4, at: onSquare(-0.36, -0.3, 0.09), model: M.SoyModel, collider: { cylinder: [0.03, 0.18] } },
  { id: 'vinegar', word: WORDS.vinegar, tags: ['condiment'], material: 'glass', mass: 0.4, at: onSquare(-0.27, -0.37, 0.09), model: M.VinegarModel, collider: { cylinder: [0.03, 0.18] } },
  { id: 'chilli', word: WORDS.chilli, tags: ['condiment'], material: 'glass', mass: 0.3, at: onSquare(-0.37, -0.2, 0.0375), model: M.ChilliModel, collider: { cylinder: [0.032, 0.075] } },

  // ── on the till ──
  { id: 'lucky_cat', word: WORDS.luckyCat, material: 'ceramic', mass: 0.5, at: [-2.72, TILL + 0.087, -2.08], yaw: 0.35, model: M.LuckyCatModel, collider: { box: [0.12, 0.17, 0.1] } },
  { id: 'qr_stand', word: WORDS.qr, material: 'plastic', mass: 0.15, at: [-2.0, TILL + 0.067, -1.88], yaw: 0.3, model: M.QrStandModel, collider: { box: [0.1, 0.13, 0.05] } },
  {
    id: 'tray', word: WORDS.tray, tags: ['container'], material: 'plastic', mass: 0.4, at: [-1.68, TILL + 0.02, -2.02], surface: true, model: M.TrayModel,
    collider: [
      { box: [0.42, 0.012, 0.3], offset: [0, -0.012, 0] },
      { box: [0.42, 0.036, 0.012], offset: [0, 0.006, 0.144] },
      { box: [0.42, 0.036, 0.012], offset: [0, 0.006, -0.144] },
      { box: [0.012, 0.036, 0.3], offset: [0.204, 0.006, 0] },
      { box: [0.012, 0.036, 0.3], offset: [-0.204, 0.006, 0] },
    ],
    inside: { min: [-0.2, -0.008, -0.14], max: [0.2, 0.1, 0.14] },
  },

  // ── in the fridge (lower shelf) ──
  { id: 'beer', word: WORDS.beer, tags: ['beer', 'drink'], material: 'glass', mass: 0.6, at: [2.3, SHELF + 0.127, -2.14], model: M.BeerModel, collider: { cylinder: [0.033, 0.25] } },
  { id: 'beer_2', word: WORDS.beer, tags: ['beer', 'drink'], material: 'glass', mass: 0.6, at: [2.42, SHELF + 0.127, -2.14], model: M.BeerModel, collider: { cylinder: [0.033, 0.25] } },
  { id: 'soda', word: WORDS.soda, tags: ['drink'], material: 'glass', mass: 0.45, at: [2.58, SHELF + 0.102, -2.14], model: M.SodaModel, collider: { cylinder: [0.03, 0.2] } },

  // ── chairs: two at the round table, two at the square one ──
  { id: 'chair', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, ...chairAt(30), model: M.ChairModel, collider: CHAIR_COLLIDER },
  { id: 'chair_2', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, ...chairAt(-60), model: M.ChairModel, collider: CHAIR_COLLIDER },
  { id: 'chair_3', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, at: [ST[0], 0.452, ST[1] + 0.68], yaw: Math.PI, model: M.ChairModel, collider: CHAIR_COLLIDER },
  { id: 'chair_4', word: WORDS.chair, tags: ['furniture'], material: 'wood', mass: 4, at: [ST[0], 0.452, ST[1] - 0.68], yaw: 0, model: M.ChairModel, collider: CHAIR_COLLIDER },
];

export default defineWorld({
  id: 'restaurant',
  title_zh: '饭馆',
  title_en: 'Restaurant',
  blurb: 'Turn the lazy Susan, set out chopsticks, fetch a cold beer — and take the bill to the till.',
  bounds: { min: [-3, 0, -2.5], max: [3, 3, 2.5] },
  spawn: { at: [0.2, 0, 1.75], yaw: 0.12 },
  lighting: 'indoor_warm',
  shadowArea: 7,
  ambience: 'restaurant',
  Scene: RestaurantScene,
  objects,
  zones: [],
  tasks: [
    { id: 'pick_teapot', zh: '拿起茶壶。', pinyin: 'Náqǐ cháhú.', en: 'Pick up the teapot.', done: { holding: 'teapot' } },
    { id: 'teapot_on_susan', zh: '把茶壶放在转盘上。', pinyin: 'Bǎ cháhú fàng zài zhuànpán shang.', en: 'Put the teapot on the lazy Susan.', done: { on: 'teapot', surface: 'lazy_susan' } },
    { id: 'turn_susan', zh: '转一下转盘。', pinyin: 'Zhuàn yíxià zhuànpán.', en: 'Give the lazy Susan a turn.', done: { state: 'lazy_susan', key: 'spin', value: 'turning' } },
    { id: 'fan_on', zh: '太热了，把电扇打开。', pinyin: 'Tài rè le, bǎ diànshàn dǎkāi.', en: "It's too hot — turn on the fan.", done: { state: 'fan', key: 'power', value: 'on' } },
    {
      id: 'chopsticks_bowls',
      zh: '给每个碗配一双筷子。',
      pinyin: 'Gěi měi gè wǎn pèi yì shuāng kuàizi.',
      en: 'Give each bowl a pair of chopsticks.',
      done: { all_of: [{ near: '#chopsticks', to: 'bowl', within: 0.28 }, { near: '#chopsticks', to: 'bowl_2', within: 0.28 }] },
      hint: ['#chopsticks', '#bowl'],
    },
    {
      id: 'beer',
      zh: '打开冰箱，拿一瓶啤酒。',
      pinyin: 'Dǎkāi bīngxiāng, ná yì píng píjiǔ.',
      en: 'Open the fridge and take out a bottle of beer.',
      done: { sequence: [{ state: 'fridge', key: 'door', value: 'open' }, { holding: '#beer' }] },
    },
    { id: 'cups_on_tray', zh: '请把三个茶杯放进托盘里。', pinyin: 'Qǐng bǎ sān gè chábēi fàngjìn tuōpán li.', en: 'Please put three teacups on the tray.', done: { count_in_zone: '#teacup', zone: 'tray', n: 3 } },
    { id: 'plate_to_hatch', zh: '把空盘子放到窗口。', pinyin: 'Bǎ kōng pánzi fàngdào chuāngkǒu.', en: 'Put an empty plate in the serving hatch.', done: { on: '#plate', surface: 'hatch' } },
    { id: 'leftovers_in_bin', zh: '把剩菜扔进垃圾桶里！', pinyin: 'Bǎ shèngcài rēngjìn lājītǒng li!', en: 'Throw the leftovers into the bin!', done: { thrown_into: 'leftovers', zone: 'bin' } },
    {
      id: 'bill_to_till',
      zh: '先按一下呼叫器，然后把账单拿到收银台。',
      pinyin: 'Xiān àn yíxià hūjiàoqì, ránhòu bǎ zhàngdān nádào shōuyíntái.',
      en: 'First press the call button, then take the bill to the cash desk.',
      done: { sequence: [{ state: 'call_button', key: 'call', value: 'on' }, { on: 'bill', surface: 'cashier' }] },
    },
    { id: 'close_fridge', zh: '最后，关上冰箱。', pinyin: 'Zuìhòu, guānshang bīngxiāng.', en: 'Finally, close the fridge.', done: { state: 'fridge', key: 'door', value: 'closed' } },
  ],
});
