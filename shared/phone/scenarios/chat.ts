/** 微聊 scenarios: pay a friend back, scan a stall's QR code, ask the landlord + pay the deposit. */
import type { ChatContact, ChatThread, ChatWorld, ScenarioSpec } from '../types';
import { PASSWORD_FACT, PROFILE, wallet } from './common';

const CONTACTS: ChatContact[] = [
  { id: 'xiaolin', name: '小林', color: '#e57373', initial: '林' },
  { id: 'landlord', name: '房东刘先生', color: '#7986cb', initial: '刘' },
  { id: 'colleague', name: '王经理', color: '#4db6ac', initial: '王' },
  { id: 'mom', name: '妈妈', color: '#f06292', initial: '妈' },
  { id: 'fandian', name: '饭点外卖', color: '#f5b400', initial: '饭', business: true },
  { id: 'filehelper', name: '文件传输助手', color: '#43a047', initial: '文' },
];

function threads(extra: ChatThread[] = []): ChatThread[] {
  return [
    ...extra,
    {
      contact: 'colleague',
      messages: [
        { from: 'them', text: '明天上午的会改到十点半了，别忘了哦。', time: '昨天' },
        { from: 'me', text: '好的，收到！', time: '昨天' },
      ],
    },
    {
      contact: 'fandian',
      messages: [{ from: 'them', kind: 'mini_program', text: '饭点外卖 · 午餐满30减5，红包已到账，点我领取', app: 'food', time: '10:02' }],
      unread: 1,
    },
    { contact: 'mom', messages: [{ from: 'them', text: '最近吃得好吗？天冷了，记得多穿点衣服。', time: '星期二' }] },
    { contact: 'filehelper', messages: [{ from: 'me', text: '护照复印件.pdf', time: '星期一' }] },
  ];
}

function chatWorld(extra: ChatThread[] = [], qr?: ChatWorld['qr_codes']): ChatWorld {
  return { me: { name: 'Sam', id: 'sam_taylor88' }, contacts: CONTACTS, threads: threads(extra), qr_codes: qr };
}

const CHAT_VOCAB = [
  { hanzi: '转账', pinyin: 'zhuǎnzhàng', english: 'bank transfer (in the messenger)' },
  { hanzi: '红包', pinyin: 'hóngbāo', english: 'red packet (money gift)' },
  { hanzi: '金额', pinyin: 'jīn\'é', english: 'amount (of money)' },
  { hanzi: '零钱', pinyin: 'língqián', english: 'wallet balance, small change' },
  { hanzi: '支付密码', pinyin: 'zhīfù mìmǎ', english: 'payment password' },
];

export const chatPayBack: ScenarioSpec = {
  id: 'chat-pay-back',
  version: 1,
  title: { en: 'Pay your friend back for dinner', zh: '把饭钱转给朋友' },
  difficulty: 'easy',
  apps: ['chat'],
  minutes: 3,
  situation: 'Last night your friend 小林 paid for dinner for both of you. She has messaged you how much your half was.',
  goal: { en: 'Read 小林\'s message and transfer (转账) her exactly what you owe on 微聊, with a note saying it is for dinner.', zh: '看小林的消息，在微聊给她转账你应付的钱，备注写“饭钱”。' },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '09:12',
  profile: PROFILE,
  wallet: wallet(300),
  world: {
    chat: chatWorld([
      {
        contact: 'xiaolin',
        unread: 2,
        pinned: true,
        messages: [
          { from: 'me', text: '昨天的火锅太好吃了！谢谢你请客～', time: '昨天 22:10' },
          { from: 'them', text: '哈哈不客气！一共172，你的那份是86，有空转我就行，不着急～', time: '昨天 22:14' },
          { from: 'them', text: '下次你请奶茶😄', time: '昨天 22:15' },
        ],
      },
    ]),
  },
  goals: [
    { id: 'paid', label: { en: 'Transferred ¥86 to 小林', zh: '给小林转账86元' }, condition: { kind: 'record', record: 'transfer', where: { to_id: 'xiaolin', kind: 'transfer', amount: 86 } } },
    { id: 'note', optional: true, label: { en: 'Bonus: a note saying what it is for', zh: '加分：写了转账说明' }, condition: { kind: 'record', record: 'transfer', where: { to_id: 'xiaolin', note: { contains: '饭' } } } },
  ],
  mistakes: [
    { id: 'amount', label: { en: 'Sent the wrong amount (your half was ¥86)', zh: '金额不对（应是86元）' }, when: { kind: 'record', record: 'transfer', where: { to_id: 'xiaolin', amount: { ne: 86 } } } },
    { id: 'whole', label: { en: 'Sent the whole bill (¥172)', zh: '转了全部的172元' }, when: { kind: 'record', record: 'transfer', where: { to_id: 'xiaolin', amount: 172 } } },
  ],
  hints: [
    { en: 'Open the chat with 小林 and read what she wrote: 你的那份是… means "your share is…".', zh: '打开和小林的聊天，看“你的那份是…”' },
    { en: 'Tap ⊕ next to the input box, then 转账.', zh: '⊕ → 转账' },
    { en: 'Type the amount, tap 添加转账说明 and write 饭钱, then 转账 and enter your pay password.', zh: '输入金额 → 添加转账说明：饭钱 → 转账' },
  ],
  vocab: [...CHAT_VOCAB, { hanzi: '请客', pinyin: 'qǐngkè', english: 'to treat (pay for others)' }, { hanzi: '那份', pinyin: 'nà fèn', english: 'that portion, share' }, { hanzi: '转账说明', pinyin: 'zhuǎnzhàng shuōmíng', english: 'transfer note' }],
};

export const chatFruitQr: ScenarioSpec = {
  id: 'chat-fruit-qr',
  version: 1,
  title: { en: 'Pay at a fruit stall with a QR code', zh: '扫码买水果' },
  difficulty: 'medium',
  apps: ['chat', 'wallet'],
  minutes: 4,
  situation:
    'You bought mangoes at a street fruit stall. The owner, 张阿姨, says "十八块五". Two QR codes are taped to the stall: one to pay, one to add her as a friend. Your friend 小林 also sent you a red packet this morning that you haven\'t opened.',
  goal: { en: "Scan the stall's payment code and pay ¥18.50. Then open 小林's red packet.", zh: '扫水果摊的收款码，付18.5元。然后打开小林发的红包。' },
  facts: [PASSWORD_FACT],
  today: '2026-10-29',
  now: '17:45',
  profile: PROFILE,
  wallet: wallet(200),
  world: {
    chat: chatWorld(
      [
        {
          contact: 'xiaolin',
          unread: 2,
          messages: [
            { from: 'them', text: '谢谢你昨天帮我取快递！', time: '08:31' },
            { from: 'them', kind: 'red_packet', text: '谢谢啦，请你喝奶茶🧋', amount: 16.8, time: '08:31', opened: false },
          ],
        },
      ],
      [
        { id: 'stall_pay', payee: '张阿姨水果摊', label: '微聊收款码', kind: 'pay' },
        { id: 'stall_friend', payee: '张阿姨', label: '扫一扫，加我好友', kind: 'contact' },
      ],
    ),
  },
  goals: [
    { id: 'paid', label: { en: 'Paid ¥18.50 to the fruit stall by QR code', zh: '扫码付给水果摊18.5元' }, condition: { kind: 'record', record: 'qr_payment', where: { qr_id: 'stall_pay', amount: 18.5 } } },
    { id: 'redpacket', label: { en: "Opened 小林's red packet", zh: '打开了小林的红包' }, condition: { kind: 'record', record: 'red_packet_opened', where: { from_id: 'xiaolin' } } },
  ],
  mistakes: [{ id: 'amount', label: { en: 'Paid the wrong amount (十八块五 = ¥18.50)', zh: '金额不对（十八块五 = 18.5元）' }, when: { kind: 'record', record: 'qr_payment', where: { qr_id: 'stall_pay', amount: { ne: 18.5 } } } }],
  hints: [
    { en: 'In 微聊, tap ⊕ at the top right → 扫一扫 (scan).', zh: '右上角 ⊕ → 扫一扫' },
    { en: 'Point at the code labelled 收款码 (payment code), not the one to add a friend.', zh: '扫“收款码”，不是“加我好友”' },
    { en: '十八块五 = 18.5. Type 18.5, tap 付款, and enter your pay password.', zh: '十八块五 = 18.5 → 付款' },
    { en: "Back in the chat list, open 小林's chat and tap the red packet, then 開.", zh: '打开小林的聊天 → 点红包 → 開' },
  ],
  vocab: [
    ...CHAT_VOCAB,
    { hanzi: '扫一扫', pinyin: 'sǎo yi sǎo', english: 'scan (a QR code)' },
    { hanzi: '收款码', pinyin: 'shōukuǎnmǎ', english: 'payment QR code' },
    { hanzi: '二维码', pinyin: 'èrwéimǎ', english: 'QR code' },
    { hanzi: '付款', pinyin: 'fùkuǎn', english: 'to pay' },
    { hanzi: '块', pinyin: 'kuài', english: 'yuan (spoken)' },
    { hanzi: '芒果', pinyin: 'mángguǒ', english: 'mango' },
  ],
};

export const chatLandlord: ScenarioSpec = {
  id: 'chat-landlord',
  version: 1,
  title: { en: 'Ask the landlord to move in early', zh: '跟房东商量提前入住' },
  difficulty: 'hard',
  apps: ['chat'],
  minutes: 8,
  situation:
    "You're renting a flat from 刘先生 and the contract says you move in on Saturday 31 October. Your hotel booking ends on Friday morning, so you'd like to move in on Friday 30 October instead. You haven't paid the deposit (押金) yet.",
  goal: {
    en: 'Message 房东刘先生 on 微聊: ask whether you can move in a day early, on Friday. Agree a time, find out how much the deposit is, and transfer it to him on 微聊.',
    zh: '在微聊问房东刘先生能不能提前一天（周五）入住，约好时间，问清楚押金多少，然后在微聊转给他。',
  },
  facts: [PASSWORD_FACT, { en: 'The flat: 愚园路68弄 梧桐公寓 3号楼1202室. Monthly rent ¥6500.', zh: '房子：愚园路68弄 梧桐公寓 3号楼1202室，月租6500元' }],
  today: '2026-10-28',
  now: '19:30',
  profile: PROFILE,
  wallet: wallet(500, 20000),
  personas: [
    {
      id: 'landlord',
      name: '房东刘先生',
      role: 'A Shanghai landlord in his sixties, renting his flat to a foreign tenant.',
      personality: 'Kind but careful with money and details; types short messages, sometimes with 哈 or 好的好的; addresses the tenant as 小Sam or 你.',
      knows:
        'The tenant (Sam) signed a one-year contract for 愚园路68弄 梧桐公寓 3号楼1202室, rent ¥6500 a month, move-in date Saturday 31 October. The cleaners finish on Thursday 29 October, so Friday 30 October is fine from 14:00 (you are free on Friday afternoon to hand over the keys in person at the flat). The deposit (押金) is one month\'s rent, ¥6500, and must be paid before you hand over the keys; transfer by 微聊转账 is fine. The first month\'s rent is due on 1 November, not now. You will see a 转账 in the chat as "[转账] ¥…".',
      aim: 'Agree the early move-in time, tell the tenant the deposit and how to pay it, and confirm when the money arrives.',
      actions: [
        { name: 'agree_early', description: 'You agree the tenant can move in early on Friday 30 October, with a time.', params: { time: 'the agreed time, in Chinese (e.g. 周五下午两点)' } },
        { name: 'deposit_received', description: 'You see the deposit transfer of ¥6500 in the chat and confirm you received it.', params: { amount: 'the amount you received' } },
      ],
      fake_reply: '可以的，周五下午两点以后过来吧，押金6500，你微聊转我就行。',
      fake_action: { name: 'agree_early', params: { time: '周五下午两点' } },
    },
  ],
  world: {
    chat: {
      ...chatWorld([
        {
          contact: 'landlord',
          messages: [
            { from: 'them', text: '小Sam你好，合同我已经发你邮箱了，看一下有没有问题。', time: '10月20日' },
            { from: 'me', text: '收到，谢谢刘先生！没有问题。', time: '10月20日' },
          ],
        },
      ]),
      contacts: CONTACTS.map((c) => (c.id === 'landlord' ? { ...c, persona: 'landlord' } : c)),
    },
  },
  goals: [
    { id: 'early', label: { en: 'The landlord agreed you can move in on Friday', zh: '房东同意周五入住' }, condition: { kind: 'event', event: 'persona.action', where: { persona: 'landlord', action: 'agree_early' } } },
    { id: 'deposit', label: { en: 'Transferred the deposit (one month\'s rent) to the landlord', zh: '把押金转给了房东' }, condition: { kind: 'record', record: 'transfer', where: { to_id: 'landlord', amount: 6500, kind: 'transfer' } } },
    { id: 'note', optional: true, label: { en: 'Bonus: the transfer note says 押金', zh: '加分：转账说明写了押金' }, condition: { kind: 'record', record: 'transfer', where: { to_id: 'landlord', note: { contains: '押金' } } } },
  ],
  mistakes: [
    { id: 'amount', label: { en: 'Transferred an amount other than the deposit', zh: '转账金额不是押金' }, when: { kind: 'record', record: 'transfer', where: { to_id: 'landlord', amount: { ne: 6500 } } } },
  ],
  hints: [
    { en: 'Open the chat with 房东刘先生.', zh: '打开和房东刘先生的聊天' },
    { en: 'Ask: 刘先生您好，我酒店周五早上到期，请问我可以周五提前入住吗？', zh: '请问我可以周五提前入住吗？' },
    { en: 'Agree a time and ask about the deposit: 押金是多少？怎么付？', zh: '押金是多少？怎么付？' },
    { en: 'The deposit is too much for 零钱 — pay with your bank card in the pay sheet (付款方式).', zh: '零钱不够 → 付款方式：银行卡' },
    { en: 'Tap ⊕ → 转账, type the amount, add the note 押金, and pay.', zh: '⊕ → 转账 → 备注：押金' },
  ],
  vocab: [
    ...CHAT_VOCAB,
    { hanzi: '房东', pinyin: 'fángdōng', english: 'landlord' },
    { hanzi: '押金', pinyin: 'yājīn', english: 'deposit' },
    { hanzi: '提前', pinyin: 'tíqián', english: 'in advance, earlier' },
    { hanzi: '入住', pinyin: 'rùzhù', english: 'to move in, check in' },
    { hanzi: '合同', pinyin: 'hétong', english: 'contract' },
    { hanzi: '房租', pinyin: 'fángzū', english: 'rent' },
    { hanzi: '钥匙', pinyin: 'yàoshi', english: 'key' },
  ],
};

export const CHAT_SCENARIOS: ScenarioSpec[] = [chatPayBack, chatFruitQr, chatLandlord];
