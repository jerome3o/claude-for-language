/**
 * 机场 Airport — a VR world (docs/VR_WORLDS.md): a departures hall you check in, go through security,
 * find your gate and get a coffee in.
 *
 * Layout (metres, the floor at y 0): the hall is x −6 … 6, z −5 … 5, 4.6 m high. You start at z 4.2
 * by the exit doors (出口), facing the glass wall onto the apron (−Z), where a 云雀航空 plane waits at
 * the jet bridge. On the left: the information desk (问询处) with a bell, the lost-property box
 * (失物招领), a bench with your passport, boarding pass, ID card and backpack, then the check-in
 * counter (柜台) with the luggage scale (秤) and the conveyor belt (传送带) behind it. In the middle:
 * the departures board (显示屏) hanging high; behind it security — the divest table with your pockets'
 * things, grey trays (托盘), the x-ray machine (安检机) whose belt runs, the walk-through detector
 * (安检门) and a bin (垃圾桶). At the back right: gate 12 (登机口) with two rows of seats (座位). On the
 * right: the newsstand (报刊架), a vending machine (自动售货机) and the café's bar (吧台) with an
 * espresso machine (咖啡机) and cups of coffee. Your two suitcases and a trolley wait by the doors.
 *
 * Airlines, flights, the airport and the café are invented (云雀航空 Skylark Air, 星湖国际机场, 豆香咖啡).
 */
import type { WorldWord } from '@shared/vr-worlds';
import { defineWorld, type WorldObjectDef } from '../types';
import { AirportScene } from './Scene';
import * as M from './models';

const W = (hanzi: string, pinyin: string, english: string, measure: string | undefined, fun_facts: string, example: [string, string, string]): WorldWord => ({
  hanzi, pinyin, english, ...(measure ? { measure } : {}), fun_facts, example: { hanzi: example[0], pinyin: example[1], english: example[2] },
});

const SWITCH = {
  off: { verb: { hanzi: '关上', pinyin: 'guānshang', english: 'turn off' }, label: { hanzi: '关着', pinyin: 'guānzhe', english: 'off' } },
  on: { verb: { hanzi: '打开', pinyin: 'dǎkāi', english: 'turn on' }, label: { hanzi: '开着', pinyin: 'kāizhe', english: 'on' } },
};
/** The same two values, listed on → off (a machine that starts running: "use" turns it off first). */
const SWITCH_ON_FIRST = { on: SWITCH.on, off: SWITCH.off };

const WORDS = {
  counter: W('柜台', 'guìtái', 'counter', '个', '柜 (guì) cabinet + 台 (tái) platform, stand.\nThe counter where staff serve you: 值机柜台 = check-in counter, 服务柜台 = service desk.\n在柜台上 = on the counter.', ['请把护照放在柜台上。', 'Qǐng bǎ hùzhào fàng zài guìtái shang.', 'Please put your passport on the counter.']),
  scale: W('秤', 'chèng', 'scale', '台', '秤 (chèng) scale, steelyard — the 禾 grain radical: grain was what got weighed.\nDon\'t mix it up with 称 (chēng) to weigh: 称一下行李 = weigh the luggage.\nA bathroom scale is 体重秤 (tǐzhòngchèng).', ['这台秤显示二十公斤。', 'Zhè tái chèng xiǎnshì èrshí gōngjīn.', 'This scale shows twenty kilos.']),
  conveyor: W('传送带', 'chuánsòngdài', 'conveyor belt', '条', '传 (chuán) pass on + 送 (sòng) send + 带 (dài) belt, band.\nThe belt that carries checked bags away; at arrivals your bag comes back on a 行李转盘 (carousel).\n打开传送带 = switch the belt on.', ['行李在传送带上。', 'Xíngli zài chuánsòngdài shang.', 'The luggage is on the conveyor belt.']),
  board: W('显示屏', 'xiǎnshìpíng', 'display screen', '块', '显示 (xiǎnshì) to show + 屏 (píng) screen.\nAt the airport the departures board is the 航班信息显示屏: 航班 flight, 出发 departures, 登机 boarding, 延误 delayed, 取消 cancelled.\nFlat things take 块: 一块显示屏.', ['显示屏上有很多航班。', 'Xiǎnshìpíng shang yǒu hěn duō hángbān.', 'There are lots of flights on the screen.']),
  xray: W('安检机', 'ānjiǎnjī', 'security scanner', '台', '安 (ān) safe + 检 (jiǎn) check + 机 (jī) machine. 安检 (ānjiǎn) is short for 安全检查, the security check.\nAlso called X光机 (X-ray machine). Machines take 台: 一台安检机.', ['请把包放进安检机。', 'Qǐng bǎ bāo fàngjìn ānjiǎnjī.', 'Please put your bag into the scanner.']),
  detector: W('安检门', 'ānjiǎnmén', 'metal detector gate', '道', '安检 (ānjiǎn) security check + 门 (mén) door, gate.\nYou walk through it after your things go through the 安检机.\nGates and doors can take 道: 一道安检门.', ['请从安检门走过去。', 'Qǐng cóng ānjiǎnmén zǒu guòqu.', 'Please walk through the metal detector.']),
  bin: W('垃圾桶', 'lājītǒng', 'rubbish bin', '个', '垃圾 (lājī) rubbish + 桶 (tǒng) bucket.\n扔 (rēng) = to throw away: 把它扔进垃圾桶里.\nChina sorts rubbish: 其他垃圾 = other waste, 可回收物 = recyclables.', ['把水瓶扔进垃圾桶里。', 'Bǎ shuǐpíng rēngjìn lājītǒng li.', 'Throw the water bottle into the bin.']),
  seat: W('座位', 'zuòwèi', 'seat', '个', '座 (zuò) seat + 位 (wèi) place, position.\n这个座位有人吗？ = Is this seat taken?\nOn a boarding pass the seat number is 座位号; a window seat is 靠窗的座位.', ['这个座位有人吗？', 'Zhège zuòwèi yǒu rén ma?', 'Is this seat taken?']),
  gate: W('登机口', 'dēngjīkǒu', 'boarding gate', '个', '登 (dēng) to board, climb + 机 (jī) plane + 口 (kǒu) opening.\nNumbers go first with 号: 十二号登机口 = gate 12.\n登机 (dēngjī) = to board; 登机牌 = boarding pass.', ['我们在十二号登机口登机。', 'Wǒmen zài shí\'èr hào dēngjīkǒu dēngjī.', 'We board at gate 12.']),
  plane: W('飞机', 'fēijī', 'plane', '架', '飞 (fēi) to fly + 机 (jī) machine.\nPlanes take 架 (jià): 一架飞机. 坐飞机 = to take a plane; 起飞 = take off, 降落 = land.', ['飞机八点起飞。', 'Fēijī bā diǎn qǐfēi.', 'The plane takes off at eight.']),
  bar: W('吧台', 'bātái', 'bar counter', '个', '吧 (bā) bar — a sound loan from English "bar", as in 酒吧 (jiǔbā) — + 台 (tái) counter.\nIn a café you order at the 吧台.', ['咖啡在吧台上。', 'Kāfēi zài bātái shang.', 'The coffee is on the bar.']),
  coffeeMachine: W('咖啡机', 'kāfēijī', 'coffee machine', '台', '咖啡 (kāfēi) coffee — a sound loan — + 机 (jī) machine.\nMachines take 台: 一台咖啡机. 打开咖啡机 = turn the coffee machine on.', ['这台咖啡机坏了。', 'Zhè tái kāfēijī huài le.', 'This coffee machine is broken.']),
  vending: W('自动售货机', 'zìdòng shòuhuòjī', 'vending machine', '台', '自动 (zìdòng) automatic + 售货 (shòuhuò) sell goods + 机 (jī) machine.\nIn China you usually pay by scanning a code: 扫码 (sǎo mǎ).\nMachines take 台: 一台自动售货机.', ['自动售货机可以扫码付钱。', 'Zìdòng shòuhuòjī kěyǐ sǎo mǎ fù qián.', 'You can pay the vending machine by scanning a code.']),
  rack: W('报刊架', 'bàokānjià', 'newsstand rack', '个', '报 (bào) newspaper + 刊 (kān) periodical + 架 (jià) rack, shelf.\n报刊 = newspapers and magazines together; a newsstand kiosk is 报刊亭.', ['报刊架上有很多杂志。', 'Bàokānjià shang yǒu hěn duō zázhì.', 'There are lots of magazines on the rack.']),
  infoDesk: W('问询处', 'wènxúnchù', 'information desk', '个', '问询 (wènxún) to enquire + 处 (chù) place, office.\nAlso 服务台 (fúwùtái) service desk. Ask there: 请问…在哪儿？', ['问询处在哪儿？', 'Wènxúnchù zài nǎr?', 'Where is the information desk?']),
  lostFound: W('失物招领', 'shīwù zhāolǐng', 'lost and found', undefined, '失物 (shīwù) lost property + 招领 (zhāolǐng) to invite the owner to claim it.\nThe set phrase on signs and boxes; 丢 (diū) = to lose: 我的雨伞丢了.', ['你可以去失物招领问问。', 'Nǐ kěyǐ qù shīwù zhāolǐng wènwen.', 'You can ask at lost and found.']),
  bench: W('长椅', 'chángyǐ', 'bench', '张', '长 (cháng) long + 椅 (yǐ) chair: a long seat.\nTakes 张 or 条: 一张长椅. Don\'t read 长 as zhǎng here — that is "to grow".', ['我坐在长椅上等你。', 'Wǒ zuò zài chángyǐ shang děng nǐ.', 'I\'ll wait for you on the bench.']),
  plant: W('植物', 'zhíwù', 'plant', '盆', '植 (zhí) to plant + 物 (wù) thing.\nA potted plant takes 盆 (pén) pot: 一盆植物. 动物 (dòngwù) = animal — same 物.', ['窗户旁边有一盆植物。', 'Chuānghu pángbiān yǒu yì pén zhíwù.', 'There is a plant next to the window.']),
  toilet: W('洗手间', 'xǐshǒujiān', 'restroom', '个', '洗 (xǐ) wash + 手 (shǒu) hand + 间 (jiān) room: the polite word, like "the bathroom".\nSigns also say 卫生间 (wèishēngjiān); 厕所 (cèsuǒ) is more blunt.', ['请问，洗手间在哪儿？', 'Qǐngwèn, xǐshǒujiān zài nǎr?', 'Excuse me, where is the restroom?']),
  exit: W('出口', 'chūkǒu', 'exit', '个', '出 (chū) go out + 口 (kǒu) opening.\nThe opposite is 入口 (rùkǒu) entrance. 出口 also means "to export".', ['出口在那边。', 'Chūkǒu zài nàbiān.', 'The exit is over there.']),
  baggageClaim: W('行李提取', 'xíngli tíqǔ', 'baggage claim', undefined, '行李 (xíngli) luggage + 提取 (tíqǔ) to collect, pick up.\nThe sign you follow after landing; also 取行李 (qǔ xíngli) = to get your luggage.', ['行李提取在一楼。', 'Xíngli tíqǔ zài yī lóu.', 'Baggage claim is on the first floor.']),
  suitcase: W('行李箱', 'xínglixiāng', 'suitcase', '个', '行李 (xíngli) luggage + 箱 (xiāng) box, case.\n托运 (tuōyùn) = to check a bag in; a carry-on is 登机箱 or 随身行李.\n行李 alone = luggage in general (no plural).', ['我的行李箱太重了。', 'Wǒ de xínglixiāng tài zhòng le.', 'My suitcase is too heavy.']),
  backpack: W('背包', 'bēibāo', 'backpack', '个', '背 (bēi) to carry on your back + 包 (bāo) bag.\nHere 背 is bēi (first tone); as "the back" it is bèi.', ['我的背包里有电脑。', 'Wǒ de bēibāo li yǒu diànnǎo.', 'There is a laptop in my backpack.']),
  trolley: W('手推车', 'shǒutuīchē', 'luggage trolley', '辆', '手 (shǒu) hand + 推 (tuī) push + 车 (chē) cart, vehicle.\nVehicles take 辆 (liàng): 一辆手推车. At airports also 行李车.', ['我们用手推车推行李吧。', 'Wǒmen yòng shǒutuīchē tuī xíngli ba.', 'Let\'s push the luggage on a trolley.']),
  passport: W('护照', 'hùzhào', 'passport', '本', '护 (hù) protect + 照 (zhào) licence, permit.\nBooks and booklets take 本: 一本护照. 签证 (qiānzhèng) = visa.', ['请出示您的护照。', 'Qǐng chūshì nín de hùzhào.', 'Please show your passport.']),
  boardingPass: W('登机牌', 'dēngjīpái', 'boarding pass', '张', '登机 (dēngjī) to board a plane + 牌 (pái) card, tag.\nFlat things take 张: 一张登机牌. It shows your 座位号 and 登机口.', ['这是您的登机牌。', 'Zhè shì nín de dēngjīpái.', 'Here is your boarding pass.']),
  idCard: W('身份证', 'shēnfènzhèng', 'ID card', '张', '身份 (shēnfèn) identity + 证 (zhèng) certificate, card.\nChinese citizens fly domestically with it instead of a passport.', ['坐飞机要带身份证。', 'Zuò fēijī yào dài shēnfènzhèng.', 'You need your ID card to fly.']),
  phone: W('手机', 'shǒujī', 'mobile phone', '部', '手 (shǒu) hand + 机 (jī) machine: a "hand machine".\nMeasure word 部 (bù) or 个: 一部手机. 充电 (chōngdiàn) = to charge it.', ['请把手机拿出来。', 'Qǐng bǎ shǒujī ná chūlai.', 'Please take your phone out.']),
  keys: W('钥匙', 'yàoshi', 'keys', '串', '钥 (yào) key + 匙 (shi) spoon, key — both with the 钅 metal / 匕 spoon parts.\nOne key: 一把钥匙; a bunch: 一串钥匙 (串 = string of things).', ['我的钥匙不见了。', 'Wǒ de yàoshi bú jiàn le.', 'My keys are gone.']),
  belt: W('皮带', 'pídài', 'belt', '条', '皮 (pí) leather + 带 (dài) band, strap.\nLong thin things take 条: 一条皮带. At security: 解开皮带 = undo your belt.\n安全带 is a seat belt.', ['安检的时候要解开皮带。', 'Ānjiǎn de shíhou yào jiěkāi pídài.', 'You have to undo your belt at security.']),
  wallet: W('钱包', 'qiánbāo', 'wallet', '个', '钱 (qián) money + 包 (bāo) bag: a money bag.\nA purse or a wallet — both are 钱包.', ['钱包在我的口袋里。', 'Qiánbāo zài wǒ de kǒudai li.', 'The wallet is in my pocket.']),
  headphones: W('耳机', 'ěrjī', 'headphones', '副', '耳 (ěr) ear + 机 (jī) machine, device.\nPairs take 副 (fù): 一副耳机. 戴耳机 = to wear headphones.', ['我在飞机上戴着耳机听音乐。', 'Wǒ zài fēijī shang dàizhe ěrjī tīng yīnyuè.', 'On the plane I listen to music with headphones on.']),
  waterBottle: W('水瓶', 'shuǐpíng', 'water bottle', '个', '水 (shuǐ) water + 瓶 (píng) bottle.\nYou can\'t take liquids through security: 不能带水. A bottle OF water is 一瓶水.', ['我的水瓶是空的。', 'Wǒ de shuǐpíng shì kōng de.', 'My water bottle is empty.']),
  tray: W('托盘', 'tuōpán', 'tray', '个', '托 (tuō) to hold up on the palm + 盘 (pán) plate, dish.\nAt security: 把东西放进托盘里 = put your things in the tray.', ['请把手机放进托盘里。', 'Qǐng bǎ shǒujī fàngjìn tuōpán li.', 'Please put your phone in the tray.']),
  coffee: W('咖啡', 'kāfēi', 'coffee', '杯', '咖啡 (kāfēi) is a sound loan of "coffee"; both characters carry 口 (mouth) — words for drinking and sound.\nA cup of: 一杯咖啡. 美式 = Americano, 拿铁 = latte.', ['我要一杯咖啡。', 'Wǒ yào yì bēi kāfēi.', 'I\'d like a coffee.']),
  sandwich: W('三明治', 'sānmíngzhì', 'sandwich', '个', '三明治 (sānmíngzhì) is a sound loan of "sandwich" — the characters (three, bright, govern) are only for their sounds.\n一个三明治.', ['我早饭吃了一个三明治。', 'Wǒ zǎofàn chīle yí gè sānmíngzhì.', 'I had a sandwich for breakfast.']),
  cola: W('可乐', 'kělè', 'cola', '罐', '可 (kě) can, may + 乐 (lè) happy: a sound loan that also means "can be happy".\nA can: 一罐可乐 (罐 guàn); a bottle: 一瓶可乐.', ['我想喝一罐可乐。', 'Wǒ xiǎng hē yí guàn kělè.', 'I\'d like a can of cola.']),
  magazine: W('杂志', 'zázhì', 'magazine', '本', '杂 (zá) mixed + 志 (zhì) records: a mixed record.\nMagazines take 本: 一本杂志. 看杂志 = to read a magazine.', ['我在飞机上看杂志。', 'Wǒ zài fēijī shang kàn zázhì.', 'I read a magazine on the plane.']),
  newspaper: W('报纸', 'bàozhǐ', 'newspaper', '份', '报 (bào) report + 纸 (zhǐ) paper.\nMeasure word 份 (fèn) copy, or 张: 一份报纸. 看报 = to read the paper.', ['今天的报纸在这儿。', 'Jīntiān de bàozhǐ zài zhèr.', 'Today\'s newspaper is here.']),
  neckPillow: W('颈枕', 'jǐngzhěn', 'neck pillow', '个', '颈 (jǐng) neck + 枕 (zhěn) pillow (枕头 zhěntou).\nIn shops also U型枕 (U-shaped pillow).', ['坐长途飞机最好带一个颈枕。', 'Zuò chángtú fēijī zuìhǎo dài yí gè jǐngzhěn.', 'On a long flight it\'s best to bring a neck pillow.']),
  umbrella: W('雨伞', 'yǔsǎn', 'umbrella', '把', '雨 (yǔ) rain + 伞 (sǎn) umbrella — 伞 looks like one.\nThings with a handle take 把: 一把雨伞. 打伞 = to put up an umbrella.', ['外面下雨了，带上雨伞吧。', 'Wàimiàn xià yǔ le, dàishang yǔsǎn ba.', 'It\'s raining outside, take the umbrella.']),
  bell: W('铃', 'líng', 'bell', '个', '铃 (líng) bell — the 钅 metal radical + 令 for the sound.\n按铃 (àn líng) = to press the bell; a desk bell is a 服务铃. 铃声 = ringtone.', ['请按铃。', 'Qǐng àn líng.', 'Please ring the bell.']),
  map: W('地图', 'dìtú', 'map', '张', '地 (dì) land, place + 图 (tú) picture, chart.\nFlat things take 张: 一张地图. 机场地图 = airport map.', ['我看看机场地图。', 'Wǒ kànkan jīchǎng dìtú.', 'Let me look at the airport map.']),
  wetFloorSign: W('警示牌', 'jǐngshìpái', 'warning sign', '个', '警 (jǐng) warn + 示 (shì) show + 牌 (pái) board, sign.\nThe yellow one says 小心地滑 (xiǎoxīn dì huá) — careful, slippery floor.', ['地上有一个警示牌。', 'Dì shang yǒu yí gè jǐngshìpái.', 'There is a warning sign on the floor.']),
};

const R = Math.PI / 2;

const TRAY_COLLIDER = [
  { box: [0.56, 0.012, 0.4] as [number, number, number], offset: [0, -0.034, 0] as [number, number, number] },
  { box: [0.56, 0.08, 0.012] as [number, number, number], offset: [0, 0, 0.194] as [number, number, number] },
  { box: [0.56, 0.08, 0.012] as [number, number, number], offset: [0, 0, -0.194] as [number, number, number] },
  { box: [0.012, 0.08, 0.4] as [number, number, number], offset: [0.274, 0, 0] as [number, number, number] },
  { box: [0.012, 0.08, 0.4] as [number, number, number], offset: [-0.274, 0, 0] as [number, number, number] },
];
const TRAY_INSIDE = { min: [-0.268, -0.03, -0.188] as [number, number, number], max: [0.268, 0.12, 0.188] as [number, number, number] };

const SHELF_Y = [-0.55, -0.05, 0.45];

const objects: WorldObjectDef[] = [
  // ── fixed (inspectable, not grabbable) ──
  { id: 'counter', word: WORDS.counter, material: 'wood', mass: 0, at: [-4.7, 0.525, 1.7], yaw: R, surface: true, model: M.CounterModel, collider: { box: [1.7, 1.05, 0.7] } },
  { id: 'scale', word: WORDS.scale, material: 'metal', mass: 0, at: [-4.75, 0.15, 0.42], yaw: R, surface: true, model: M.ScaleModel, collider: { box: [0.75, 0.3, 0.62] } },
  {
    id: 'conveyor', word: WORDS.conveyor, material: 'metal', mass: 0, at: [-5.42, 0.15, 0.75], yaw: R, surface: true, model: M.ConveyorModel,
    collider: [
      { box: [3.9, 0.3, 0.56] },
      { box: [3.9, 0.08, 0.04], offset: [0, 0.19, -0.3] },
      { box: [0.06, 0.16, 0.56], offset: [1.98, 0.15, 0] },
    ],
    states: [{ key: 'belt', initial: 'off', values: SWITCH }],
    loops: { 'belt=on': 'conveyor' },
  },
  { id: 'board', word: WORDS.board, material: 'metal', mass: 0, at: [-0.6, 2.85, 0.6], model: M.BoardModel, collider: { box: [3.0, 1.35, 0.16] } },
  {
    id: 'xray', word: WORDS.xray, tags: ['security'], material: 'metal', mass: 0, at: [-1.5, 0.8, -1.8], model: M.XrayModel,
    collider: [
      { box: [3.3, 0.78, 0.66], offset: [-0.015, -0.41, 0] },
      { box: [1.44, 0.72, 0.1], offset: [0, 0.34, -0.45] },
      { box: [1.44, 0.72, 0.1], offset: [0, 0.34, 0.45] },
      { box: [1.44, 0.2, 1.0], offset: [0, 0.8, 0] },
      { box: [0.05, 0.12, 0.7], offset: [1.66, 0.04, 0] },
      { box: [0.92, 0.05, 0.03], offset: [-1.185, 0.005, -0.35] },
      { box: [0.92, 0.05, 0.03], offset: [-1.185, 0.005, 0.35] },
      { box: [0.9, 0.05, 0.03], offset: [1.17, 0.005, -0.35] },
      { box: [0.9, 0.05, 0.03], offset: [1.17, 0.005, 0.35] },
    ],
    states: [{ key: 'power', initial: 'on', values: SWITCH_ON_FIRST }],
    loops: { 'power=on': 'xray' },
  },
  {
    id: 'detector', word: WORDS.detector, tags: ['security'], material: 'plastic', mass: 0, at: [1.0, 1.1, -1.8], model: M.DetectorModel,
    collider: [
      { box: [0.14, 2.2, 0.55], offset: [-0.5, 0, 0] },
      { box: [0.14, 2.2, 0.55], offset: [0.5, 0, 0] },
      { box: [1.14, 0.18, 0.55], offset: [0, 1.01, 0] },
    ],
  },
  {
    id: 'bin', word: WORDS.bin, material: 'metal', mass: 0, at: [-0.95, 0.38, -0.5], model: M.BinModel,
    collider: [
      { box: [0.4, 0.02, 0.4], offset: [0, -0.37, 0] },
      { box: [0.4, 0.76, 0.02], offset: [0, 0, 0.19] },
      { box: [0.4, 0.76, 0.02], offset: [0, 0, -0.19] },
      { box: [0.02, 0.76, 0.4], offset: [0.19, 0, 0] },
      { box: [0.02, 0.76, 0.4], offset: [-0.19, 0, 0] },
    ],
    inside: { min: [-0.18, -0.36, -0.18], max: [0.18, 0.42, 0.18] },
  },
  { id: 'seats', word: WORDS.seat, tags: ['seat'], material: 'cloth', mass: 0, at: [3.3, 0.42, -3.0], surface: true, model: M.SeatsModel, collider: { box: [2.4, 0.08, 0.5] } },
  { id: 'seats_2', word: WORDS.seat, tags: ['seat'], material: 'cloth', mass: 0, at: [3.3, 0.42, -4.1], surface: true, model: M.SeatsModel, collider: { box: [2.4, 0.08, 0.5] } },
  { id: 'gate_sign', word: WORDS.gate, material: 'metal', mass: 0, at: [5.6, 2.55, -2.35], yaw: -Math.PI / 4, model: M.GateSignModel, collider: { box: [1.0, 0.56, 0.12] } },
  { id: 'plane', word: WORDS.plane, material: 'metal', mass: 0, at: [1.5, 3.2, -24], model: M.PlaneModel, collider: { box: [30, 4.2, 4.2] } },
  { id: 'cafe_counter', word: WORDS.bar, material: 'wood', mass: 0, at: [4.9, 0.55, 2.6], yaw: -R, surface: true, model: M.CafeCounterModel, collider: { box: [2.0, 1.1, 0.6] } },
  {
    id: 'coffee_machine', word: WORDS.coffeeMachine, material: 'metal', mass: 0, at: [5.0, 1.375, 3.25], yaw: -R, model: M.CoffeeMachineModel,
    collider: { box: [0.5, 0.54, 0.43] },
    states: [{ key: 'power', initial: 'off', values: SWITCH }],
    loops: { 'power=on': 'coffee' },
  },
  { id: 'vending', word: WORDS.vending, material: 'metal', mass: 0, at: [5.58, 0.95, 0.6], yaw: -R, model: M.VendingModel, collider: { box: [0.95, 1.9, 0.8] } },
  {
    id: 'rack', word: WORDS.rack, material: 'wood', mass: 0, at: [5.72, 0.85, -0.7], yaw: -R, model: M.RackModel,
    collider: [
      { box: [1.1, 1.7, 0.04], offset: [0, 0, -0.16] },
      { box: [0.03, 1.7, 0.36], offset: [-0.535, 0, 0] },
      { box: [0.03, 1.7, 0.36], offset: [0.535, 0, 0] },
      ...SHELF_Y.map((y) => ({ box: [1.07, 0.03, 0.3] as [number, number, number], offset: [0, y, 0] as [number, number, number] })),
      ...SHELF_Y.map((y) => ({ box: [1.07, 0.08, 0.02] as [number, number, number], offset: [0, y + 0.04, 0.15] as [number, number, number] })),
    ],
  },
  { id: 'info_desk', word: WORDS.infoDesk, material: 'wood', mass: 0, at: [-5.0, 0.55, 4.15], yaw: R, surface: true, model: M.InfoDeskModel, collider: { box: [1.6, 1.1, 0.66] } },
  {
    id: 'lost_box', word: WORDS.lostFound, material: 'wood', mass: 0, at: [-3.4, 0.45, 4.6], yaw: Math.PI, model: M.LostBoxModel,
    collider: [
      { box: [0.7, 0.04, 0.5], offset: [0, -0.43, 0] },
      { box: [0.7, 0.9, 0.03], offset: [0, 0, 0.235] },
      { box: [0.7, 0.9, 0.03], offset: [0, 0, -0.235] },
      { box: [0.03, 0.9, 0.5], offset: [0.335, 0, 0] },
      { box: [0.03, 0.9, 0.5], offset: [-0.335, 0, 0] },
    ],
    inside: { min: [-0.32, -0.41, -0.22], max: [0.32, 0.5, 0.22] },
  },
  { id: 'bench', word: WORDS.bench, material: 'wood', mass: 0, at: [-2.5, 0.23, 3.4], surface: true, model: M.BenchModel, collider: { box: [1.8, 0.46, 0.5] } },
  { id: 'plant', word: WORDS.plant, material: 'ceramic', mass: 0, at: [-0.9, 0.7, -4.4], model: M.PlantModel, collider: { cylinder: [0.28, 1.4] } },
  { id: 'toilet_sign', word: WORDS.toilet, tags: ['sign'], material: 'plastic', mass: 0, at: [-5.93, 2.45, -3.4], yaw: R, model: M.ToiletSignModel, collider: { box: [1.1, 0.36, 0.06] } },
  { id: 'exit_sign', word: WORDS.exit, tags: ['sign'], material: 'plastic', mass: 0, at: [0, 2.75, 4.93], yaw: Math.PI, model: M.ExitSignModel, collider: { box: [1.0, 0.32, 0.06] } },
  { id: 'baggage_sign', word: WORDS.baggageClaim, tags: ['sign'], material: 'plastic', mass: 0, at: [3.4, 2.6, 4.93], yaw: Math.PI, model: M.BaggageSignModel, collider: { box: [1.5, 0.38, 0.06] } },

  // ── grabbable ──
  { id: 'suitcase', word: WORDS.suitcase, tags: ['luggage', 'suitcase'], material: 'plastic', mass: 12, at: [-0.8, 0.302, 2.5], yaw: 0.35, model: M.SuitcaseModel, collider: { box: [0.44, 0.6, 0.27] } },
  { id: 'suitcase_2', word: WORDS.suitcase, tags: ['luggage', 'suitcase'], material: 'cloth', mass: 6, at: [-1.35, 0.242, 2.85], yaw: -0.25, model: M.CarryOnModel, collider: { box: [0.36, 0.48, 0.23] } },
  { id: 'backpack', word: WORDS.backpack, tags: ['luggage'], material: 'cloth', mass: 3, at: [-1.95, 0.552, 3.4], model: M.BackpackModel, collider: { box: [0.32, 0.18, 0.44] } },
  {
    id: 'trolley', word: WORDS.trolley, material: 'metal', mass: 15, at: [1.7, 0.452, 2.6], yaw: -0.3, model: M.TrolleyModel,
    collider: [
      { box: [0.95, 0.04, 0.58], offset: [0, -0.32, 0] },
      { box: [0.9, 0.12, 0.5], offset: [0, -0.39, 0] },
      { box: [0.05, 0.9, 0.58], offset: [-0.45, 0.1, 0] },
      { box: [0.04, 0.15, 0.58], offset: [0.47, -0.25, 0] },
    ],
    inside: { min: [-0.42, -0.3, -0.29], max: [0.45, 0.6, 0.29] },
  },
  { id: 'passport', word: WORDS.passport, tags: ['document'], material: 'paper', mass: 0.1, at: [-2.95, 0.467, 3.35], yaw: 0.2, model: M.PassportModel, collider: { box: [0.09, 0.012, 0.125] } },
  { id: 'boarding_pass', word: WORDS.boardingPass, tags: ['document'], material: 'paper', mass: 0.02, at: [-2.7, 0.464, 3.45], yaw: -0.15, model: M.BoardingPassModel, collider: { box: [0.2, 0.006, 0.08] } },
  { id: 'id_card', word: WORDS.idCard, tags: ['document'], material: 'plastic', mass: 0.02, at: [-2.45, 0.464, 3.3], yaw: 0.4, model: M.IdCardModel, collider: { box: [0.0856, 0.006, 0.054] } },
  { id: 'phone', word: WORDS.phone, tags: ['pocket'], material: 'plastic', mass: 0.2, at: [-3.0, 0.806, -0.6], yaw: 0.3, model: M.PhoneModel, collider: { box: [0.075, 0.01, 0.155] } },
  { id: 'keys', word: WORDS.keys, tags: ['pocket'], material: 'metal', mass: 0.08, at: [-2.78, 0.812, -0.48], yaw: 0.6, model: M.KeysModel, collider: { box: [0.09, 0.02, 0.05] } },
  { id: 'wallet', word: WORDS.wallet, tags: ['pocket'], material: 'cloth', mass: 0.15, at: [-2.58, 0.813, -0.68], yaw: -0.2, model: M.WalletModel, collider: { box: [0.11, 0.022, 0.09] } },
  { id: 'belt', word: WORDS.belt, tags: ['pocket'], material: 'cloth', mass: 0.25, at: [-2.38, 0.82, -0.52], model: M.BeltModel, collider: { cylinder: [0.065, 0.036] } },
  { id: 'headphones', word: WORDS.headphones, tags: ['pocket'], material: 'plastic', mass: 0.25, at: [-2.17, 0.828, -0.6], model: M.HeadphonesModel, collider: { box: [0.24, 0.05, 0.16] } },
  { id: 'water_bottle', word: WORDS.waterBottle, tags: ['liquid'], material: 'plastic', mass: 0.5, at: [-2.06, 0.912, -0.8], model: M.WaterBottleModel, collider: { cylinder: [0.035, 0.22] } },
  { id: 'tray', word: WORDS.tray, tags: ['tray'], material: 'plastic', mass: 0.8, at: [-2.75, 0.822, -1.8], model: M.TrayModel, collider: TRAY_COLLIDER, inside: TRAY_INSIDE },
  { id: 'tray_2', word: WORDS.tray, tags: ['tray'], material: 'plastic', mass: 0.8, at: [-3.65, 0.745, -1.8], model: M.TrayModel, collider: TRAY_COLLIDER, inside: TRAY_INSIDE },
  { id: 'tray_3', word: WORDS.tray, tags: ['tray'], material: 'plastic', mass: 0.8, at: [-3.65, 0.83, -1.8], model: M.TrayModel, collider: TRAY_COLLIDER, inside: TRAY_INSIDE },
  { id: 'coffee', word: WORDS.coffee, tags: ['coffee', 'drink'], material: 'paper', mass: 0.35, at: [4.78, 1.157, 2.45], model: M.CoffeeModel, collider: { cylinder: [0.042, 0.11] } },
  { id: 'coffee_2', word: WORDS.coffee, tags: ['coffee', 'drink'], material: 'paper', mass: 0.35, at: [4.7, 1.157, 2.64], model: M.CoffeeModel, collider: { cylinder: [0.042, 0.11] } },
  { id: 'sandwich', word: WORDS.sandwich, tags: ['food'], material: 'food', mass: 0.2, at: [4.78, 1.127, 2.24], yaw: 0.3, model: M.SandwichModel, collider: { box: [0.14, 0.05, 0.1] } },
  { id: 'cola', word: WORDS.cola, tags: ['drink'], material: 'metal', mass: 0.35, at: [3.4, 0.803, 2.2], model: M.ColaModel, collider: { cylinder: [0.033, 0.122] } },
  { id: 'magazine', word: WORDS.magazine, tags: ['reading'], material: 'paper', mass: 0.3, at: [5.72, 0.823, -0.9], model: M.MagazineModel, collider: { box: [0.21, 0.01, 0.28] } },
  { id: 'newspaper', word: WORDS.newspaper, tags: ['reading'], material: 'paper', mass: 0.2, at: [5.72, 0.325, -0.5], model: M.NewspaperModel, collider: { box: [0.28, 0.014, 0.21] } },
  { id: 'neck_pillow', word: WORDS.neckPillow, material: 'cloth', mass: 0.3, at: [5.72, 1.363, -0.75], model: M.NeckPillowModel, collider: { box: [0.24, 0.09, 0.24] } },
  { id: 'umbrella', word: WORDS.umbrella, material: 'cloth', mass: 0.5, at: [3.0, 0.497, -4.1], yaw: 0.1, model: M.UmbrellaModel, collider: { box: [0.86, 0.07, 0.07] } },
  { id: 'bell', word: WORDS.bell, material: 'metal', mass: 0.3, at: [-4.85, 1.133, 3.9], model: M.BellModel, collider: { cylinder: [0.045, 0.064] } },
  { id: 'map', word: WORDS.map, tags: ['document'], material: 'paper', mass: 0.05, at: [-4.9, 1.104, 4.4], yaw: 0.25, model: M.MapModel, collider: { box: [0.21, 0.006, 0.15] } },
  { id: 'wet_floor_sign', word: WORDS.wetFloorSign, material: 'plastic', mass: 1.2, at: [-5.3, 0.312, -2.8], yaw: 0.5, model: M.WetFloorSignModel, collider: { box: [0.32, 0.62, 0.24] } },
];

export default defineWorld({
  id: 'airport',
  title_zh: '机场',
  title_en: 'Airport',
  blurb: 'Check in your suitcase, get through security (no water!), find gate 12 and grab a coffee.',
  bounds: { min: [-16, 0, -27], max: [18, 12, 5] },
  spawn: { at: [0, 0, 4.2], yaw: 0 },
  lighting: 'indoor_hall',
  shadowArea: 13,
  ambience: 'airport',
  Scene: AirportScene,
  objects,
  zones: [
    { id: 'gate', min: [1.8, 0, -4.95], max: [5.95, 3, -2.3] },
    { id: 'scanner', min: [-2.2, 0.76, -2.2], max: [-0.8, 1.45, -1.4] },
  ],
  tasks: [
    { id: 'pick_passport', zh: '拿起你的护照。', pinyin: 'Náqǐ nǐ de hùzhào.', en: 'Pick up your passport.', done: { holding: 'passport' } },
    {
      id: 'bags_on_trolley', zh: '把两个行李箱放在手推车上。', pinyin: 'Bǎ liǎng gè xínglixiāng fàng zài shǒutuīchē shang.', en: 'Put both suitcases on the trolley.',
      done: { count_in_zone: '#suitcase', zone: 'trolley', n: 2 }, hint: ['suitcase', 'suitcase_2', 'trolley'],
    },
    { id: 'weigh_suitcase', zh: '把大行李箱放在秤上。', pinyin: 'Bǎ dà xínglixiāng fàng zài chèng shang.', en: 'Put the big suitcase on the scale.', done: { on: 'suitcase', surface: 'scale' }, hint: ['suitcase', 'scale'] },
    {
      id: 'documents', zh: '把护照和登机牌放在柜台上。', pinyin: 'Bǎ hùzhào hé dēngjīpái fàng zài guìtái shang.', en: 'Put your passport and boarding pass on the counter.',
      done: { all_of: [{ on: 'passport', surface: 'counter' }, { on: 'boarding_pass', surface: 'counter' }] }, hint: ['passport', 'boarding_pass', 'counter'],
    },
    {
      id: 'check_bag',
      zh: '先把大行李箱放在传送带上，然后打开传送带。',
      pinyin: 'Xiān bǎ dà xínglixiāng fàng zài chuánsòngdài shang, ránhòu dǎkāi chuánsòngdài.',
      en: 'First put the big suitcase on the conveyor belt, then switch the belt on.',
      done: { sequence: [{ on: 'suitcase', surface: 'conveyor' }, { state: 'conveyor', key: 'belt', value: 'on' }] },
    },
    {
      id: 'phone_in_tray', zh: '把手机放进托盘里。', pinyin: 'Bǎ shǒujī fàngjìn tuōpán li.', en: 'Put your phone in a tray.',
      done: { any_of: [{ in_zone: 'phone', zone: 'tray' }, { in_zone: 'phone', zone: 'tray_2' }, { in_zone: 'phone', zone: 'tray_3' }] }, hint: ['phone', 'tray'],
    },
    { id: 'no_water', zh: '不能带水！把水瓶扔进垃圾桶里。', pinyin: 'Bù néng dài shuǐ! Bǎ shuǐpíng rēngjìn lājītǒng li.', en: 'No water allowed! Throw the water bottle into the bin.', done: { thrown_into: 'water_bottle', zone: 'bin' } },
    {
      id: 'scan_tray',
      zh: '把三样东西放进托盘里，然后推进安检机。',
      pinyin: 'Bǎ sān yàng dōngxi fàngjìn tuōpán li, ránhòu tuījìn ānjiǎnjī.',
      en: 'Put three things in a tray, then push it into the scanner.',
      done: {
        sequence: [
          { any_of: [{ count_in_zone: '#pocket', zone: 'tray', n: 3 }, { count_in_zone: '#pocket', zone: 'tray_2', n: 3 }, { count_in_zone: '#pocket', zone: 'tray_3', n: 3 }] },
          { count_in_zone: '#pocket', zone: 'scanner', n: 3 },
        ],
      },
      hint: ['tray', 'xray'],
    },
    { id: 'go_to_gate', zh: '去十二号登机口。', pinyin: 'Qù shí\'èr hào dēngjīkǒu.', en: 'Go to gate 12.', done: { player_in: 'gate' }, hint: ['gate_sign'] },
    {
      id: 'backpack_on_seat', zh: '把背包放在座位上。', pinyin: 'Bǎ bēibāo fàng zài zuòwèi shang.', en: 'Put your backpack on a seat.',
      done: { any_of: [{ on: 'backpack', surface: 'seats' }, { on: 'backpack', surface: 'seats_2' }] }, hint: ['backpack', 'seats'],
    },
    {
      id: 'lost_umbrella', zh: '有人忘了雨伞，把它放进失物招领箱里。', pinyin: 'Yǒu rén wàngle yǔsǎn, bǎ tā fàngjìn shīwù zhāolǐng xiāng li.', en: 'Someone forgot an umbrella — put it in the lost-and-found box.',
      done: { in_zone: 'umbrella', zone: 'lost_box' },
    },
    { id: 'get_coffee', zh: '最后，去咖啡店拿一杯咖啡。', pinyin: 'Zuìhòu, qù kāfēidiàn ná yì bēi kāfēi.', en: 'Finally, go to the café and get a coffee.', done: { holding: '#coffee' } },
  ],
});
