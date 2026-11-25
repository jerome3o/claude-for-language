/**
 * 街上 On the street — a street corner at dusk (docs/VR_WORLDS.md). Built on the kitchen's contract.
 *
 * Layout (metres, the ground at y 0): the road runs along X (z −3.5 … 0.5) with a zebra crossing at
 * x 0, the crossing button and the 红绿灯 on its pole on this side. You start on this side's pavement
 * (z 0.5 … 4) facing the road: the 便利店 behind you (its glass door at x 0, z 4; inside: the 柜台
 * with the 老板, the 货架 of snacks along the back, the 冰柜 of drinks on the right; the 取款机 in its
 * front), the 水果摊 on your left, the 煎饼 cart and the sorted bins on your right, the 路灯, a parked
 * 电动车 and a 汽车. Across the road: the 公交车站 (shelter, 长椅, 站牌) on the left, a 树 in a 花坛,
 * the 邮筒 and the 共享单车 on the right. Shop and brand names are all invented.
 */
import type { WorldWord } from '@shared/vr-worlds';
import { defineWorld, type WorldObjectDef } from '../types';
import { StreetScene } from './Scene';
import * as M from './models';

const W = (hanzi: string, pinyin: string, english: string, measure: string | undefined, fun_facts: string, example: [string, string, string]): WorldWord => ({
  hanzi, pinyin, english, ...(measure ? { measure } : {}), fun_facts, example: { hanzi: example[0], pinyin: example[1], english: example[2] },
});
const w = (hanzi: string, pinyin: string, english: string) => ({ hanzi, pinyin, english });

const OPEN = {
  closed: { verb: w('关上', 'guānshang', 'close'), label: w('关着', 'guānzhe', 'closed') },
  open: { verb: w('打开', 'dǎkāi', 'open'), label: w('开着', 'kāizhe', 'open') },
};
const SWITCH = {
  off: { verb: w('关上', 'guānshang', 'turn off'), label: w('关着', 'guānzhe', 'off') },
  on: { verb: w('打开', 'dǎkāi', 'turn on'), label: w('开着', 'kāizhe', 'on') },
};

const WORDS = {
  zebra: W('斑马线', 'bānmǎxiàn', 'zebra crossing', '条', '斑马 (bānmǎ) zebra + 线 (xiàn) line: the white stripes look like a zebra.\n走斑马线 = cross at the zebra crossing. Road signs say 人行横道 (rénxíng héngdào).', ['过马路要走斑马线。', 'Guò mǎlù yào zǒu bānmǎxiàn.', 'Cross the road at the zebra crossing.']),
  traffic_light: W('红绿灯', 'hónglǜdēng', 'traffic light', '个', '红 (hóng) red + 绿 (lǜ) green + 灯 (dēng) light.\n红灯停，绿灯行 = stop on red, go on green. 闯红灯 (chuǎng hóngdēng) = run a red light.', ['前面有一个红绿灯。', 'Qiánmiàn yǒu yí gè hónglǜdēng.', 'There is a traffic light ahead.']),
  button: W('按钮', 'ànniǔ', 'button', '个', '按 (àn) press + 钮 (niǔ) knob, button.\n按 is also the verb: 按一下 = press it once. 过街请按 = press to cross.', ['请按一下这个按钮。', 'Qǐng àn yíxià zhège ànniǔ.', 'Please press this button.']),
  street_lamp: W('路灯', 'lùdēng', 'street lamp', '盏', '路 (lù) road + 灯 (dēng) lamp.\nLamps take 盏 (zhǎn): 一盏路灯. 灯亮了 = the light has come on.', ['天黑了，路灯亮了。', 'Tiān hēi le, lùdēng liàng le.', 'It got dark and the street lights came on.']),
  bus_stop: W('公交车站', 'gōngjiāo chēzhàn', 'bus stop', '个', '公交 (gōngjiāo) public transport + 车站 (chēzhàn) stop, station.\nIn speech often just 车站 or 公交站. 坐公交 = take the bus.', ['公交车站就在马路对面。', 'Gōngjiāo chēzhàn jiù zài mǎlù duìmiàn.', 'The bus stop is just across the road.']),
  bus_sign: W('站牌', 'zhànpái', 'bus stop sign', '个', '站 (zhàn) stop + 牌 (pái) sign, board.\nIt lists the routes: 18路 (shíbā lù) = the number 18 bus.', ['看看站牌上有几路车。', 'Kànkan zhànpái shang yǒu jǐ lù chē.', 'Let\'s see which buses are on the stop sign.']),
  bench: W('长椅', 'chángyǐ', 'bench', '张', '长 (cháng) long + 椅 (yǐ) chair: a long seat.\n长 is cháng (long) here, not zhǎng (to grow).', ['他坐在长椅上等车。', 'Tā zuò zài chángyǐ shang děng chē.', 'He sits on the bench waiting for the bus.']),
  shop: W('便利店', 'biànlìdiàn', 'convenience store', '家', '便利 (biànlì) convenient + 店 (diàn) shop.\nShops take 家 (jiā): 一家便利店. Many are open 24 hours (24小时营业).', ['楼下有一家便利店。', 'Lóuxià yǒu yì jiā biànlìdiàn.', 'There is a convenience store downstairs.']),
  door: W('门', 'mén', 'door', '扇', '门 (mén) a picture of a two-leaf door.\nDoors take 扇 (shàn): 一扇门. 开门 / 关门 also mean a shop opens / closes. 门口 = the doorway, just outside.', ['便利店的门开着。', 'Biànlìdiàn de mén kāizhe.', 'The shop door is open.']),
  counter: W('柜台', 'guìtái', 'counter', '个', '柜 (guì) cabinet + 台 (tái) platform, stand.\nYou pay at the counter: 在柜台付钱. A cashier is 收银员 (shōuyínyuán).', ['请到柜台付钱。', 'Qǐng dào guìtái fù qián.', 'Please pay at the counter.']),
  shopkeeper: W('老板', 'lǎobǎn', 'shop owner', '位', '老 (lǎo) old — here just a friendly prefix — + 板 (bǎn).\nAnyone running a shop or stall is called 老板: 老板，多少钱？ = How much is it? Polite measure word 位.', ['便利店的老板很热情。', 'Biànlìdiàn de lǎobǎn hěn rèqíng.', 'The shop owner is very friendly.']),
  shelf: W('货架', 'huòjià', 'shelf', '个', '货 (huò) goods + 架 (jià) rack, frame.\nA bookshelf is 书架 (shūjià).', ['方便面在货架上。', 'Fāngbiànmiàn zài huòjià shang.', 'The instant noodles are on the shelf.']),
  drinks_fridge: W('冰柜', 'bīngguì', 'drinks fridge', '台', '冰 (bīng) ice + 柜 (guì) cabinet.\nA shop\'s glass-door fridge or a chest freezer; the one at home is 冰箱 (bīngxiāng).', ['冰柜里有很多饮料。', 'Bīngguì li yǒu hěn duō yǐnliào.', 'There are lots of drinks in the drinks fridge.']),
  atm: W('取款机', 'qǔkuǎnjī', 'cash machine', '台', '取 (qǔ) take + 款 (kuǎn) money, a sum + 机 (jī) machine.\nAlso 自动取款机 or just ATM. 取钱 = get money out.', ['我去取款机取点儿钱。', 'Wǒ qù qǔkuǎnjī qǔ diǎnr qián.', 'I\'m going to the cash machine to get some money.']),
  fruit_stall: W('水果摊', 'shuǐguǒtān', 'fruit stall', '个', '水果 (shuǐguǒ) fruit + 摊 (tān) stall.\n摆摊 (bǎi tān) = set up a stall. Prices are per 斤 (jīn) = half a kilo.', ['路边有一个水果摊。', 'Lùbiān yǒu yí gè shuǐguǒtān.', 'There is a fruit stall by the road.']),
  cart: W('推车', 'tuīchē', 'cart', '辆', '推 (tuī) push + 车 (chē) vehicle.\nA street-food cart; also a trolley or a pram (婴儿车). Vehicles take 辆 (liàng).', ['卖煎饼的推车在路边。', 'Mài jiānbing de tuīchē zài lùbiān.', 'The cart selling jianbing is by the road.']),
  recycle_bin: W('可回收垃圾桶', 'kěhuíshōu lājītǒng', 'recycling bin', '个', '可 (kě) can + 回收 (huíshōu) recycle + 垃圾桶 (lājītǒng) bin.\nChinese cities sort rubbish (垃圾分类): blue 可回收物 recyclables, green 厨余垃圾 food waste, grey 其他垃圾 other waste, red 有害垃圾 hazardous.', ['塑料瓶要扔进可回收垃圾桶。', 'Sùliàopíng yào rēngjìn kěhuíshōu lājītǒng.', 'Plastic bottles go in the recycling bin.']),
  food_bin: W('厨余垃圾桶', 'chúyú lājītǒng', 'food waste bin', '个', '厨余 (chúyú) kitchen leftovers + 垃圾桶 (lājītǒng) bin.\nThe green bin: peel, leftovers, tea leaves. Bones that are too hard go in 其他垃圾.', ['香蕉皮要扔进厨余垃圾桶。', 'Xiāngjiāopí yào rēngjìn chúyú lājītǒng.', 'Banana peel goes in the food waste bin.']),
  other_bin: W('垃圾桶', 'lājītǒng', 'rubbish bin', '个', '垃圾 (lājī) rubbish + 桶 (tǒng) bucket.\nThis grey one says 其他垃圾 (qítā lājī) "other waste": what can\'t be recycled, like used tissues.', ['请把垃圾扔进垃圾桶。', 'Qǐng bǎ lājī rēngjìn lājītǒng.', 'Please throw rubbish into the bin.']),
  post_box: W('邮筒', 'yóutǒng', 'post box', '个', '邮 (yóu) post + 筒 (tǒng) tube, cylinder.\nChinese post boxes are green (邮政 = the post office). 寄信 = send a letter.', ['我把信放进了邮筒。', 'Wǒ bǎ xìn fàngjìnle yóutǒng.', 'I put the letter in the post box.']),
  tree: W('树', 'shù', 'tree', '棵', '树 (shù) tree — the 木 wood radical on the left.\nTrees take 棵 (kē): 一棵树. 树叶 = leaves.', ['路边有很多树。', 'Lùbiān yǒu hěn duō shù.', 'There are lots of trees along the road.']),
  planter: W('花坛', 'huātán', 'flower bed', '个', '花 (huā) flower + 坛 (tán) a raised terrace.\nThe raised flower beds along Chinese streets and squares.', ['花坛里有很多花。', 'Huātán li yǒu hěn duō huā.', 'There are lots of flowers in the flower bed.']),
  ebike: W('电动车', 'diàndòngchē', 'e-bike', '辆', '电动 (diàndòng) electric + 车 (chē) vehicle: the electric scooters everywhere in Chinese cities.\nYou ride (骑 qí) it, and wear a helmet (戴头盔).', ['他骑电动车上班。', 'Tā qí diàndòngchē shàngbān.', 'He rides an e-bike to work.']),
  car: W('汽车', 'qìchē', 'car', '辆', '汽 (qì) steam, gas + 车 (chē) vehicle.\nIn speech often just 车: 开车 = drive. 停车 = park.', ['路边停着一辆汽车。', 'Lùbiān tíngzhe yí liàng qìchē.', 'A car is parked by the road.']),

  newspaper: W('报纸', 'bàozhǐ', 'newspaper', '份', '报 (bào) report + 纸 (zhǐ) paper.\n看报纸 = read the paper. Measure word 份 (fèn), or 张 for one sheet.', ['爷爷每天早上看报纸。', 'Yéye měitiān zǎoshang kàn bàozhǐ.', 'Grandpa reads the paper every morning.']),
  leaflet: W('传单', 'chuándān', 'leaflet', '张', '传 (chuán) pass on + 单 (dān) a sheet, a list.\n发传单 = hand out leaflets (new shops do it at the door).', ['门口有人在发传单。', 'Ménkǒu yǒu rén zài fā chuándān.', 'Someone is handing out leaflets at the door.']),
  wallet: W('钱包', 'qiánbāo', 'wallet', '个', '钱 (qián) money + 包 (bāo) bag.\n丢 (diū) = lose: 我的钱包丢了. 捡到 (jiǎndào) = find something someone dropped.', ['我的钱包丢了！', 'Wǒ de qiánbāo diū le!', 'I\'ve lost my wallet!']),
  ball: W('皮球', 'píqiú', 'ball', '个', '皮 (pí) skin, leather, rubber + 球 (qiú) ball.\nA child\'s rubber ball. 踢球 = kick a ball, 扔球 = throw a ball.', ['小孩儿在玩皮球。', 'Xiǎoháir zài wán píqiú.', 'The kids are playing with a ball.']),
  umbrella: W('雨伞', 'yǔsǎn', 'umbrella', '把', '雨 (yǔ) rain + 伞 (sǎn) umbrella — 伞 looks like an open umbrella.\nHandled things take 把: 一把雨伞. 打伞 = hold up an umbrella.', ['下雨了，快打开雨伞。', 'Xià yǔ le, kuài dǎkāi yǔsǎn.', 'It\'s raining, quick, open the umbrella.']),
  parcel: W('快递', 'kuàidì', 'parcel', '个', '快 (kuài) fast + 递 (dì) hand over, deliver: express delivery — and the parcel itself.\n取快递 = pick up a parcel. The courier is 快递员.', ['你的快递到了。', 'Nǐ de kuàidì dào le.', 'Your parcel has arrived.']),
  frisbee: W('飞盘', 'fēipán', 'frisbee', '个', '飞 (fēi) fly + 盘 (pán) plate, dish: a flying plate.\n玩飞盘 = play frisbee; 扔 (rēng) = throw, 接 (jiē) = catch.', ['我们去公园玩飞盘吧。', 'Wǒmen qù gōngyuán wán fēipán ba.', 'Let\'s go and play frisbee in the park.']),
  plastic_bottle: W('塑料瓶', 'sùliàopíng', 'plastic bottle', '个', '塑料 (sùliào) plastic + 瓶 (píng) bottle.\nEmpty ones are recyclable (可回收). A bottle of water = 一瓶水.', ['这个塑料瓶是空的。', 'Zhège sùliàopíng shì kōng de.', 'This plastic bottle is empty.']),
  can: W('易拉罐', 'yìlāguàn', 'drink can', '个', '易 (yì) easy + 拉 (lā) pull + 罐 (guàn) can, jar: an "easy-pull can" — the ring pull.\nA can of cola = 一罐可乐.', ['地上有一个易拉罐。', 'Dì shang yǒu yí gè yìlāguàn.', 'There is a can on the ground.']),
  banana_peel: W('香蕉皮', 'xiāngjiāopí', 'banana peel', '块', '香蕉 (xiāngjiāo) banana + 皮 (pí) skin, peel.\nPeel is food waste: 厨余垃圾. 剥 (bāo) = to peel.', ['小心，地上有香蕉皮！', 'Xiǎoxīn, dì shang yǒu xiāngjiāopí!', 'Careful, there\'s a banana peel on the ground!']),
  orange: W('橙子', 'chéngzi', 'orange', '个', '橙 (chéng) orange — the 木 tree radical — + 子 (zi).\n橙色 = the colour orange. A tangerine is 橘子 (júzi).', ['这些橙子很甜。', 'Zhèxiē chéngzi hěn tián.', 'These oranges are very sweet.']),
  watermelon: W('西瓜', 'xīguā', 'watermelon', '个', '西 (xī) west + 瓜 (guā) melon: it came from the west.\nA slice is 一块西瓜. Bought by the 斤 at the stall.', ['夏天吃西瓜最舒服。', 'Xiàtiān chī xīguā zuì shūfu.', 'Eating watermelon in summer is the best.']),
  bag: W('袋子', 'dàizi', 'bag', '个', '袋 (dài) bag, pouch + 子 (zi).\n塑料袋 = plastic bag, 纸袋 = paper bag. Shops ask 要袋子吗？ = Do you want a bag?', ['老板，给我一个袋子。', 'Lǎobǎn, gěi wǒ yí gè dàizi.', 'Excuse me, could I have a bag?']),
  jianbing: W('煎饼', 'jiānbing', 'jianbing', '个', '煎 (jiān) pan-fry + 饼 (bǐng) a flat cake: a thin crepe with egg, folded round a crispy cracker.\nThe classic street breakfast; in Tianjin 煎饼果子, counted 一套 (tào).', ['我早饭吃了一个煎饼。', 'Wǒ zǎofàn chīle yí gè jiānbing.', 'I had a jianbing for breakfast.']),
  water: W('矿泉水', 'kuàngquánshuǐ', 'mineral water', '瓶', '矿 (kuàng) mineral + 泉 (quán) spring + 水 (shuǐ) water.\n一瓶矿泉水 = a bottle of water. 冰的 = cold, 常温的 = room temperature.', ['我要一瓶矿泉水。', 'Wǒ yào yì píng kuàngquánshuǐ.', 'I\'d like a bottle of mineral water.']),
  tea: W('绿茶', 'lǜchá', 'green tea', '瓶', '绿 (lǜ) green + 茶 (chá) tea.\nIn a shop: bottled iced tea. 红茶 (hóngchá) "red tea" is black tea.', ['冰柜里有绿茶吗？', 'Bīngguì li yǒu lǜchá ma?', 'Is there green tea in the fridge?']),
  noodles: W('方便面', 'fāngbiànmiàn', 'instant noodles', '桶', '方便 (fāngbiàn) convenient + 面 (miàn) noodles.\nA cup is 一桶 (tǒng), a packet 一包 (bāo). 泡面 (pàomiàn) means the same.', ['我晚上吃了一桶方便面。', 'Wǒ wǎnshang chīle yì tǒng fāngbiànmiàn.', 'I had a cup of instant noodles in the evening.']),
  crisps: W('薯片', 'shǔpiàn', 'crisps', '包', '薯 (shǔ) potato + 片 (piàn) slice, flake.\nA bag: 一包薯片. Flavours: 番茄味 tomato, 原味 plain.', ['这包薯片是番茄味的。', 'Zhè bāo shǔpiàn shì fānqiéwèi de.', 'This bag of crisps is tomato flavour.']),
  biscuits: W('饼干', 'bǐnggān', 'biscuits', '盒', '饼 (bǐng) cake + 干 (gān) dry: a dry little cake.\nA box: 一盒饼干 (盒 hé = box).', ['我买了一盒饼干。', 'Wǒ mǎile yì hé bǐnggān.', 'I bought a box of biscuits.']),
  cone: W('锥桶', 'zhuītǒng', 'traffic cone', '个', '锥 (zhuī) cone, awl + 桶 (tǒng) bucket.\nThe formal word is 交通锥 (jiāotōngzhuī). They mark roadworks (施工).', ['路上放着一个锥桶。', 'Lù shang fàngzhe yí gè zhuītǒng.', 'There is a traffic cone on the road.']),
  helmet: W('头盔', 'tóukuī', 'helmet', '个', '头 (tóu) head + 盔 (kuī) helmet.\n戴 (dài) = wear (hats, helmets, glasses): 戴头盔. Riders must wear one.', ['骑电动车要戴头盔。', 'Qí diàndòngchē yào dài tóukuī.', 'You must wear a helmet on an e-bike.']),
  bike: W('共享单车', 'gòngxiǎng dānchē', 'shared bike', '辆', '共享 (gòngxiǎng) share + 单车 (dānchē) bicycle (单 single).\nScan the code to unlock it: 扫码开锁. The general word for a bicycle is 自行车 (zìxíngchē).', ['我骑共享单车去地铁站。', 'Wǒ qí gòngxiǎng dānchē qù dìtiězhàn.', 'I ride a shared bike to the metro station.']),
};

const BIN_WALLS = [
  { box: [0.42, 0.02, 0.38] as [number, number, number], offset: [0, -0.44, 0] as [number, number, number] },
  { box: [0.44, 0.9, 0.02] as [number, number, number], offset: [0, 0, 0.19] as [number, number, number] },
  { box: [0.44, 0.9, 0.02] as [number, number, number], offset: [0, 0, -0.19] as [number, number, number] },
  { box: [0.02, 0.9, 0.4] as [number, number, number], offset: [0.21, 0, 0] as [number, number, number] },
  { box: [0.02, 0.9, 0.4] as [number, number, number], offset: [-0.21, 0, 0] as [number, number, number] },
];
const BIN_INSIDE = { min: [-0.2, -0.43, -0.18] as [number, number, number], max: [0.2, 0.5, 0.18] as [number, number, number] };

const objects: WorldObjectDef[] = [
  // ── the crossing ──
  { id: 'zebra', word: WORDS.zebra, material: 'stone', mass: 0, at: [0, 0.004, -1.5], model: M.ZebraModel, collider: { box: [2.6, 0.008, 3.9] } },
  {
    id: 'traffic_light', word: WORDS.traffic_light, material: 'metal', mass: 0, at: [1.55, 1.6, 0.72], model: M.TrafficLightModel,
    collider: [{ cylinder: [0.06, 3.2] }, { box: [0.28, 0.56, 0.2], offset: [0, 0.75, -0.08] }],
  },
  {
    id: 'button', word: WORDS.button, material: 'plastic', mass: 0, at: [1.55, 1.1, 0.83], model: M.ButtonModel, collider: { box: [0.14, 0.22, 0.1] },
    states: [{
      key: 'signal', initial: 'red', values: {
        red: { verb: w('等', 'děng', 'wait'), label: w('红灯', 'hóngdēng', 'red light') },
        green: { verb: w('按', 'àn', 'press'), label: w('绿灯', 'lǜdēng', 'green light') },
      },
    }],
    loops: { 'signal=green': 'crossing' },
  },
  {
    id: 'street_lamp', word: WORDS.street_lamp, material: 'metal', mass: 0, at: [-3.4, 2.2, 0.82], model: M.StreetLampModel,
    collider: [{ cylinder: [0.07, 4.4] }, { box: [0.5, 0.14, 0.24], offset: [0, 2.0, -0.85] }],
    states: [{ key: 'light', initial: 'off', values: SWITCH }],
  },

  // ── the bus stop, across the road ──
  {
    id: 'bus_stop', word: WORDS.bus_stop, material: 'metal', mass: 0, at: [-3.0, 1.3, -5.8], model: M.BusShelterModel,
    collider: [
      { box: [3.3, 0.1, 1.5], offset: [0, 1.2, 0.1] },
      { box: [3.2, 2.0, 0.05], offset: [0, 0, -0.6] },
      { box: [0.05, 2.0, 1.1], offset: [-1.6, 0, -0.05] },
      { box: [0.08, 2.5, 0.08], offset: [1.58, -0.05, 0.72] },
      { box: [0.08, 2.5, 0.08], offset: [-1.58, -0.05, 0.72] },
    ],
  },
  {
    id: 'bus_sign', word: WORDS.bus_sign, material: 'metal', mass: 0, at: [-1.15, 1.3, -3.95], model: M.BusSignModel,
    collider: [{ cylinder: [0.04, 2.6] }, { box: [0.62, 0.95, 0.07], offset: [0, 0.65, 0] }],
  },
  {
    id: 'bench', word: WORDS.bench, material: 'wood', mass: 0, at: [-3.0, 0.42, -6.0], model: M.BenchModel,
    collider: [
      { box: [1.7, 0.06, 0.42] },
      { box: [1.7, 0.36, 0.07], offset: [0, 0.27, -0.2] },
      { box: [0.07, 0.39, 0.38], offset: [-0.75, -0.225, 0] },
      { box: [0.07, 0.39, 0.38], offset: [0.75, -0.225, 0] },
    ],
  },
  {
    id: 'tree', word: WORDS.tree, material: 'wood', mass: 0, at: [1.1, 1.6, -5.5], model: M.TreeModel,
    collider: [{ cylinder: [0.12, 3.2] }, { ball: 1.05, offset: [0, 1.75, 0] }],
  },
  {
    id: 'planter', word: WORDS.planter, material: 'stone', mass: 0, at: [1.1, 0.2, -5.5], model: M.PlanterModel,
    collider: [
      { box: [1.4, 0.4, 0.12], offset: [0, 0, 0.64] }, { box: [1.4, 0.4, 0.12], offset: [0, 0, -0.64] },
      { box: [0.12, 0.4, 1.16], offset: [0.64, 0, 0] }, { box: [0.12, 0.4, 1.16], offset: [-0.64, 0, 0] },
      { box: [1.16, 0.3, 1.16], offset: [0, -0.05, 0] },
    ],
  },
  { id: 'post_box', word: WORDS.post_box, material: 'metal', mass: 0, at: [2.4, 0.62, -4.15], model: M.PostBoxModel, collider: { box: [0.48, 1.24, 0.42] } },

  // ── the convenience shop ──
  { id: 'shop', word: WORDS.shop, material: 'metal', mass: 0, at: [0, 3.3, 3.93], model: M.ShopSignModel, collider: { box: [5.3, 0.62, 0.14] } },
  {
    id: 'shop_door', word: WORDS.door, material: 'glass', mass: 0, at: [0, 1.06, 4.0], model: M.ShopDoorModel,
    collider: [
      { box: [1.0, 2.1, 0.06], when: { door: 'closed' } },
      { box: [0.06, 2.1, 1.0], offset: [-0.47, 0, 0.5], when: { door: 'open' } },
    ],
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  { id: 'counter', word: WORDS.counter, material: 'wood', mass: 0, at: [-1.75, 0.475, 5.4], surface: true, model: M.CounterModel, collider: { box: [0.6, 0.95, 1.6] } },
  { id: 'shopkeeper', word: WORDS.shopkeeper, material: 'cloth', mass: 0, at: [-2.25, 0.85, 5.4], yaw: Math.PI / 2, model: M.ShopkeeperModel, collider: { box: [0.5, 1.7, 0.32] } },
  {
    id: 'shelf', word: WORDS.shelf, material: 'metal', mass: 0, at: [0.6, 0.9, 6.7], yaw: Math.PI, model: M.ShelfModel,
    collider: [
      { box: [2.0, 1.8, 0.03], offset: [0, 0, -0.21] },
      { box: [0.03, 1.8, 0.45], offset: [-0.985, 0, 0] }, { box: [0.03, 1.8, 0.45], offset: [0.985, 0, 0] },
      { box: [1.94, 0.03, 0.42], offset: [0, -0.8, 0.01] }, { box: [1.94, 0.03, 0.42], offset: [0, -0.32, 0.01] },
      { box: [1.94, 0.03, 0.42], offset: [0, 0.16, 0.01] }, { box: [1.94, 0.03, 0.42], offset: [0, 0.64, 0.01] },
    ],
  },
  {
    id: 'drinks_fridge', word: WORDS.drinks_fridge, material: 'metal', mass: 0, at: [2.25, 0.95, 5.2], model: M.ShopFridgeModel,
    collider: [
      { box: [0.04, 1.9, 0.8], offset: [0.28, 0, 0] },
      { box: [0.6, 1.9, 0.04], offset: [0, 0, 0.38] }, { box: [0.6, 1.9, 0.04], offset: [0, 0, -0.38] },
      { box: [0.6, 0.06, 0.8], offset: [0, 0.92, 0] }, { box: [0.6, 0.12, 0.8], offset: [0, -0.89, 0] },
      { box: [0.52, 0.02, 0.72], offset: [0.02, -0.45, 0] }, { box: [0.52, 0.02, 0.72], offset: [0.02, 0.05, 0] }, { box: [0.52, 0.02, 0.72], offset: [0.02, 0.5, 0] },
      { box: [0.04, 1.9, 0.8], offset: [-0.3, 0, 0], when: { door: 'closed' } },
      { box: [0.8, 1.9, 0.04], offset: [-0.7, 0, 0.42], when: { door: 'open' } },
    ],
    inside: { min: [-0.27, -0.83, -0.36], max: [0.26, 0.89, 0.36] },
    states: [{ key: 'door', initial: 'closed', values: OPEN }],
  },
  { id: 'atm', word: WORDS.atm, material: 'metal', mass: 0, at: [2.15, 0.85, 3.86], model: M.AtmModel, collider: { box: [0.72, 1.7, 0.28] } },

  // ── this side of the road ──
  {
    id: 'fruit_stall', word: WORDS.fruit_stall, material: 'wood', mass: 0, at: [-4.7, 0.42, 2.7], model: M.FruitStallModel,
    collider: [
      { box: [1.7, 0.05, 0.85], offset: [0, 0.355, 0] },
      { box: [0.05, 0.78, 0.05], offset: [-0.8, -0.03, -0.38] }, { box: [0.05, 0.78, 0.05], offset: [0.8, -0.03, -0.38] },
      { box: [0.05, 0.78, 0.05], offset: [-0.8, -0.03, 0.38] }, { box: [0.05, 0.78, 0.05], offset: [0.8, -0.03, 0.38] },
      // the two crates' rims (oranges on the right, the watermelon on the left)
      { box: [0.5, 0.08, 0.02], offset: [0.35, 0.42, 0.2] }, { box: [0.5, 0.08, 0.02], offset: [0.35, 0.42, -0.2] },
      { box: [0.02, 0.08, 0.42], offset: [0.6, 0.42, 0] }, { box: [0.02, 0.08, 0.42], offset: [0.1, 0.42, 0] },
      { box: [0.5, 0.08, 0.02], offset: [-0.55, 0.42, 0.2] }, { box: [0.5, 0.08, 0.02], offset: [-0.55, 0.42, -0.2] },
      { box: [0.02, 0.08, 0.42], offset: [-0.3, 0.42, 0] }, { box: [0.02, 0.08, 0.42], offset: [-0.8, 0.42, 0] },
      // the awning's poles and roof
      { box: [0.04, 2.04, 0.04], offset: [-0.85, 0.6, -0.42] }, { box: [0.04, 2.04, 0.04], offset: [0.85, 0.6, -0.42] },
      { box: [1.9, 0.04, 1.1], offset: [0, 1.64, 0.05] },
    ],
  },
  {
    id: 'cart', word: WORDS.cart, material: 'metal', mass: 0, at: [4.6, 0.5, 2.7], model: M.CartModel,
    collider: [
      { box: [1.3, 0.9, 0.7] },
      { cylinder: [0.26, 0.02], offset: [-0.15, 0.46, 0] },
      { box: [0.04, 0.8, 0.04], offset: [-0.66, 0.85, -0.36] }, { box: [0.04, 0.8, 0.04], offset: [0.66, 0.85, -0.36] },
      { box: [1.4, 0.05, 0.8], offset: [0, 1.25, 0] },
    ],
    states: [{ key: 'fire', initial: 'on', values: { on: SWITCH.on, off: SWITCH.off } }],
    loops: { 'fire=on': 'sizzle' },
  },
  { id: 'recycle_bin', word: WORDS.recycle_bin, material: 'plastic', mass: 0, at: [2.5, 0.45, 1.05], model: M.RecycleBinModel, collider: BIN_WALLS, inside: BIN_INSIDE },
  { id: 'food_bin', word: WORDS.food_bin, material: 'plastic', mass: 0, at: [3.0, 0.45, 1.05], model: M.FoodBinModel, collider: BIN_WALLS, inside: BIN_INSIDE },
  { id: 'other_bin', word: WORDS.other_bin, material: 'plastic', mass: 0, at: [3.5, 0.45, 1.05], model: M.OtherBinModel, collider: BIN_WALLS, inside: BIN_INSIDE },
  {
    id: 'ebike', word: WORDS.ebike, material: 'plastic', mass: 0, at: [-2.9, 0.55, 1.6], model: M.EbikeModel,
    collider: [
      { box: [0.32, 0.75, 1.55], offset: [0, -0.175, 0] },
      { box: [0.72, 0.3, 0.16], offset: [0, 0.4, -0.66] },
      { box: [0.42, 0.36, 0.38], offset: [0, 0.39, 0.58] },
    ],
  },
  {
    id: 'car', word: WORDS.car, material: 'metal', mass: 0, at: [4.3, 0.75, -0.42], model: M.CarModel,
    collider: [{ box: [4.0, 0.68, 1.76], offset: [0, -0.33, 0] }, { box: [2.3, 0.62, 1.6], offset: [-0.25, 0.37, 0] }],
  },

  // ── things to pick up ──
  { id: 'newspaper', word: WORDS.newspaper, tags: ['paper'], material: 'paper', mass: 0.2, at: [-0.9, 0.009, 1.1], yaw: 0.4, model: M.NewspaperModel, collider: { box: [0.32, 0.014, 0.42] } },
  { id: 'leaflet', word: WORDS.leaflet, tags: ['paper'], material: 'paper', mass: 0.01, at: [-0.9, 0.004, 3.2], yaw: -0.3, model: M.LeafletModel, collider: { box: [0.15, 0.006, 0.21] } },
  { id: 'wallet', word: WORDS.wallet, material: 'cloth', mass: 0.15, at: [-3.35, 0.463, -6.0], yaw: 0.3, model: M.WalletModel, collider: { box: [0.11, 0.022, 0.09] } },
  { id: 'umbrella', word: WORDS.umbrella, material: 'cloth', mass: 0.4, at: [-2.55, 0.488, -5.98], model: M.UmbrellaModel, collider: { box: [0.86, 0.07, 0.07] }, states: [{ key: 'open', initial: 'closed', values: { closed: { verb: w('合上', 'héshang', 'close'), label: w('合着', 'hézhe', 'closed') }, open: OPEN.open } }] },
  { id: 'ball', word: WORDS.ball, tags: ['toy'], material: 'plastic', mass: 0.3, at: [-3.3, 0.112, 3.5], model: M.BallModel, collider: { ball: 0.11 } },
  { id: 'parcel', word: WORDS.parcel, material: 'paper', mass: 1.5, at: [-1.3, 0.131, 2.15], yaw: 0.2, model: M.ParcelModel, collider: { box: [0.36, 0.26, 0.28] } },
  { id: 'frisbee', word: WORDS.frisbee, tags: ['toy'], material: 'plastic', mass: 0.17, at: [3.7, 0.016, -5.7], model: M.FrisbeeModel, collider: { cylinder: [0.135, 0.03] } },
  { id: 'plastic_bottle', word: WORDS.plastic_bottle, tags: ['rubbish', 'recyclable'], material: 'plastic', mass: 0.05, at: [0.95, 0.106, 1.55], model: M.PlasticBottleModel, collider: { cylinder: [0.033, 0.21] } },
  { id: 'can', word: WORDS.can, tags: ['rubbish', 'recyclable'], material: 'metal', mass: 0.05, at: [2.95, 0.062, -4.65], model: M.CanModel, collider: { cylinder: [0.033, 0.122] } },
  { id: 'banana_peel', word: WORDS.banana_peel, tags: ['rubbish'], material: 'food', mass: 0.05, at: [-3.8, 0.011, 1.75], yaw: 0.7, model: M.BananaPeelModel, collider: { box: [0.16, 0.02, 0.12] } },
  { id: 'orange', word: WORDS.orange, tags: ['fruit', 'orange'], material: 'food', mass: 0.2, at: [-4.45, 0.843, 2.62], model: M.OrangeModel, collider: { ball: 0.04 } },
  { id: 'orange_2', word: WORDS.orange, tags: ['fruit', 'orange'], material: 'food', mass: 0.2, at: [-4.3, 0.843, 2.64], model: M.OrangeModel, collider: { ball: 0.04 } },
  { id: 'orange_3', word: WORDS.orange, tags: ['fruit', 'orange'], material: 'food', mass: 0.2, at: [-4.42, 0.843, 2.78], model: M.OrangeModel, collider: { ball: 0.04 } },
  { id: 'orange_4', word: WORDS.orange, tags: ['fruit', 'orange'], material: 'food', mass: 0.2, at: [-4.27, 0.843, 2.8], model: M.OrangeModel, collider: { ball: 0.04 } },
  { id: 'watermelon', word: WORDS.watermelon, tags: ['fruit'], material: 'food', mass: 3.5, at: [-5.25, 0.927, 2.7], model: M.WatermelonModel, collider: { ball: 0.125 } },
  {
    id: 'bag', word: WORDS.bag, tags: ['container'], material: 'paper', mass: 0.1, at: [-4.8, 0.913, 2.65], model: M.BagModel,
    collider: [
      { box: [0.24, 0.01, 0.15], offset: [0, -0.105, 0] },
      { box: [0.26, 0.22, 0.01], offset: [0, 0, 0.075] }, { box: [0.26, 0.22, 0.01], offset: [0, 0, -0.075] },
      { box: [0.01, 0.22, 0.16], offset: [0.125, 0, 0] }, { box: [0.01, 0.22, 0.16], offset: [-0.125, 0, 0] },
    ],
    inside: { min: [-0.12, -0.1, -0.07], max: [0.12, 0.14, 0.07] },
  },
  { id: 'jianbing', word: WORDS.jianbing, tags: ['food'], material: 'food', mass: 0.25, at: [4.45, 0.997, 2.7], model: M.JianbingModel, collider: { box: [0.18, 0.05, 0.12] } },
  { id: 'water', word: WORDS.water, tags: ['drink'], material: 'plastic', mass: 0.55, at: [2.2, 1.122, 5.0], model: M.WaterModel, collider: { cylinder: [0.033, 0.22] } },
  { id: 'tea', word: WORDS.tea, tags: ['drink'], material: 'plastic', mass: 0.55, at: [2.2, 1.122, 5.32], model: M.TeaModel, collider: { cylinder: [0.033, 0.22] } },
  { id: 'noodles', word: WORDS.noodles, tags: ['snack'], material: 'paper', mass: 0.12, at: [0.2, 0.652, 6.65], model: M.Noodles1, collider: { cylinder: [0.055, 0.11] } },
  { id: 'noodles_2', word: WORDS.noodles, tags: ['snack'], material: 'paper', mass: 0.12, at: [0.36, 0.652, 6.65], model: M.Noodles2, collider: { cylinder: [0.055, 0.11] } },
  { id: 'crisps', word: WORDS.crisps, tags: ['snack'], material: 'plastic', mass: 0.08, at: [0.9, 1.197, 6.65], model: M.CrispsModel, collider: { box: [0.18, 0.24, 0.07] } },
  { id: 'biscuits', word: WORDS.biscuits, tags: ['snack'], material: 'paper', mass: 0.2, at: [1.3, 1.107, 6.65], model: M.BiscuitsModel, collider: { box: [0.2, 0.06, 0.14] } },
  { id: 'cone', word: WORDS.cone, material: 'plastic', mass: 1.5, at: [-5.3, 0.362, 0.0], model: M.ConeModel, collider: { cylinder: [0.17, 0.72] } },
  { id: 'helmet', word: WORDS.helmet, material: 'plastic', mass: 0.4, at: [-2.9, 0.817, 1.8], model: M.HelmetModel, collider: { cylinder: [0.12, 0.13] } },
  {
    id: 'bike', word: WORDS.bike, material: 'metal', mass: 15, at: [4.7, 0.501, -5.6], model: M.BikeModel, collider: { box: [1.65, 1.0, 0.5] },
    states: [{ key: 'lock', initial: 'locked', values: { locked: { verb: w('锁上', 'suǒshang', 'lock'), label: w('锁着', 'suǒzhe', 'locked') }, unlocked: { verb: w('开锁', 'kāisuǒ', 'unlock'), label: w('没锁', 'méi suǒ', 'unlocked') } } }],
  },
];

export default defineWorld({
  id: 'street',
  title_zh: '街上',
  title_en: 'On the street',
  blurb: 'A street corner at dusk: press the button, cross on green, sort the rubbish and hand in a lost wallet.',
  bounds: { min: [-6.5, 0, -7], max: [6.5, 5, 7] },
  spawn: { at: [-0.3, 0, 3.0], yaw: 0.1 },
  lighting: 'outdoor_evening',
  shadowArea: 15,
  ambience: 'city',
  Scene: StreetScene,
  objects,
  zones: [
    { id: 'far_side', word: { hanzi: '对面', pinyin: 'duìmiàn', english: 'the other side' }, min: [-6.5, 0, -7], max: [6.5, 3, -3.6] },
    { id: 'bus_stop_area', min: [-4.5, 0, -6.4], max: [-1.5, 3, -4.4] },
    { id: 'bike_spot', min: [-1.45, 0, -6.4], max: [0.2, 2, -4.3] },
    { id: 'shop_entrance', word: { hanzi: '门口', pinyin: 'ménkǒu', english: 'doorway' }, min: [-1.2, 0, 3.0], max: [1.2, 1.5, 3.98] },
  ],
  tasks: [
    { id: 'pick_newspaper', zh: '把地上的报纸捡起来。', pinyin: 'Bǎ dì shang de bàozhǐ jiǎn qǐlai.', en: 'Pick the newspaper up off the ground.', done: { holding: 'newspaper' } },
    { id: 'bottle_recycle', zh: '把塑料瓶放进可回收垃圾桶里。', pinyin: 'Bǎ sùliàopíng fàngjìn kěhuíshōu lājītǒng li.', en: 'Put the plastic bottle in the recycling bin.', done: { in_zone: 'plastic_bottle', zone: 'recycle_bin' } },
    { id: 'lamp_on', zh: '天快黑了，把路灯打开吧。', pinyin: 'Tiān kuài hēi le, bǎ lùdēng dǎkāi ba.', en: 'It\'s getting dark — turn on the street lamp.', done: { state: 'street_lamp', key: 'light', value: 'on' } },
    { id: 'oranges_bag', zh: '请把三个橙子放进袋子里。', pinyin: 'Qǐng bǎ sān gè chéngzi fàngjìn dàizi li.', en: 'Please put three oranges in the bag.', done: { count_in_zone: '#orange', zone: 'bag', n: 3 } },
    { id: 'press_button', zh: '按一下过马路的按钮。', pinyin: 'Àn yíxià guò mǎlù de ànniǔ.', en: 'Press the button for the crossing.', done: { state: 'button', key: 'signal', value: 'green' } },
    {
      id: 'cross_road',
      zh: '等绿灯，然后过马路。',
      pinyin: 'Děng lǜdēng, ránhòu guò mǎlù.',
      en: 'Wait for the green light, then cross the road.',
      done: { sequence: [{ state: 'button', key: 'signal', value: 'green' }, { player_in: 'far_side' }] },
      hint: ['zebra', 'button'],
    },
    { id: 'go_bus_stop', zh: '去公交车站等车。', pinyin: 'Qù gōngjiāo chēzhàn děng chē.', en: 'Go to the bus stop and wait for the bus.', done: { player_in: 'bus_stop_area' }, hint: ['bus_stop', 'bench'] },
    { id: 'open_umbrella', zh: '要下雨了，打开雨伞吧。', pinyin: 'Yào xià yǔ le, dǎkāi yǔsǎn ba.', en: 'It\'s going to rain — open the umbrella.', done: { state: 'umbrella', key: 'open', value: 'open' } },
    { id: 'park_bike', zh: '把共享单车停在公交车站旁边。', pinyin: 'Bǎ gòngxiǎng dānchē tíng zài gōngjiāo chēzhàn pángbiān.', en: 'Park the shared bike next to the bus stop.', done: { in_zone: 'bike', zone: 'bike_spot' }, hint: ['bike', 'bus_sign'] },
    {
      id: 'return_wallet',
      zh: '先打开便利店的门，然后把钱包交给老板。',
      pinyin: 'Xiān dǎkāi biànlìdiàn de mén, ránhòu bǎ qiánbāo jiāo gěi lǎobǎn.',
      en: 'First open the shop door, then hand the wallet in to the shop owner.',
      done: { sequence: [{ state: 'shop_door', key: 'door', value: 'open' }, { on: 'wallet', surface: 'counter' }] },
      hint: ['shop_door', 'wallet', 'counter', 'shopkeeper'],
    },
    { id: 'peel_throw', zh: '把香蕉皮扔进绿色的厨余垃圾桶里！', pinyin: 'Bǎ xiāngjiāopí rēngjìn lǜsè de chúyú lājītǒng li!', en: 'Throw the banana peel into the green food waste bin!', done: { thrown_into: 'banana_peel', zone: 'food_bin' } },
    { id: 'parcel_door', zh: '最后，把快递放在便利店门口。', pinyin: 'Zuìhòu, bǎ kuàidì fàng zài biànlìdiàn ménkǒu.', en: 'Finally, put the parcel by the shop door.', done: { in_zone: 'parcel', zone: 'shop_entrance' } },
  ],
});
