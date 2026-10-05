/**
 * The bundled in-call activities: a few hand-written samples per kind, keyed by
 * level and topic, to try the two-person interaction patterns. Add one by
 * appending a spec here (`validateActivitySpec` and the catalogue test check it).
 */

import type { ActivityKind, ActivitySpec } from './types';

export const ACTIVITY_CATALOGUE: ActivitySpec[] = [
  {
    id: 'describe-food-1',
    kind: 'describe',
    title: 'Describe & guess: food',
    title_zh: '猜一猜：吃的',
    level: 'beginner',
    topic: 'Food',
    summary: 'One sees a food and describes it in Chinese — without saying its name; the other picks it from eight.',
    role_names: { a: 'Describer', b: 'Guesser' },
    tutor_role: 'b',
    items: [
      { emoji: '🍎', hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', hints: ['水果', '红色', '很甜'] },
      { emoji: '🍌', hanzi: '香蕉', pinyin: 'xiāngjiāo', english: 'banana', hints: ['黄色', '长长的', '猴子喜欢吃'] },
      { emoji: '🍉', hanzi: '西瓜', pinyin: 'xīguā', english: 'watermelon', hints: ['夏天', '很大', '外面是绿色的'] },
      { emoji: '🥟', hanzi: '饺子', pinyin: 'jiǎozi', english: 'dumplings', hints: ['春节', '北方人', '里面有肉'] },
      { emoji: '🍜', hanzi: '面条', pinyin: 'miàntiáo', english: 'noodles', hints: ['长长的', '用筷子吃', '有汤'] },
      { emoji: '🍚', hanzi: '米饭', pinyin: 'mǐfàn', english: 'cooked rice', hints: ['白色的', '每天吃', '一碗'] },
      { emoji: '☕', hanzi: '咖啡', pinyin: 'kāfēi', english: 'coffee', hints: ['喝的', '早上', '有点儿苦'] },
      { emoji: '🥚', hanzi: '鸡蛋', pinyin: 'jīdàn', english: 'egg', hints: ['早饭', '鸡', '白色的'] },
    ],
    distractors: [
      { hanzi: '包子', pinyin: 'bāozi', english: 'steamed bun' },
      { hanzi: '牛奶', pinyin: 'niúnǎi', english: 'milk' },
      { hanzi: '橙子', pinyin: 'chéngzi', english: 'orange' },
      { hanzi: '面包', pinyin: 'miànbāo', english: 'bread' },
      { hanzi: '茶', pinyin: 'chá', english: 'tea' },
      { hanzi: '豆腐', pinyin: 'dòufu', english: 'tofu' },
    ],
    glossary: [
      { hanzi: '水果', pinyin: 'shuǐguǒ', english: 'fruit' },
      { hanzi: '红色', pinyin: 'hóngsè', english: 'red' },
      { hanzi: '很甜', pinyin: 'hěn tián', english: 'very sweet' },
      { hanzi: '黄色', pinyin: 'huángsè', english: 'yellow' },
      { hanzi: '长长的', pinyin: 'chángcháng de', english: 'long' },
      { hanzi: '猴子喜欢吃', pinyin: 'hóuzi xǐhuan chī', english: 'monkeys like eating it' },
      { hanzi: '夏天', pinyin: 'xiàtiān', english: 'summer' },
      { hanzi: '很大', pinyin: 'hěn dà', english: 'very big' },
      { hanzi: '外面是绿色的', pinyin: 'wàimiàn shì lǜsè de', english: 'green on the outside' },
      { hanzi: '春节', pinyin: 'Chūnjié', english: 'Spring Festival' },
      { hanzi: '北方人', pinyin: 'běifāng rén', english: 'northerners' },
      { hanzi: '里面有肉', pinyin: 'lǐmiàn yǒu ròu', english: 'there is meat inside' },
      { hanzi: '用筷子吃', pinyin: 'yòng kuàizi chī', english: 'eaten with chopsticks' },
      { hanzi: '有汤', pinyin: 'yǒu tāng', english: 'comes with soup' },
      { hanzi: '白色的', pinyin: 'báisè de', english: 'white' },
      { hanzi: '每天吃', pinyin: 'měitiān chī', english: 'eaten every day' },
      { hanzi: '一碗', pinyin: 'yì wǎn', english: 'a bowl' },
      { hanzi: '喝的', pinyin: 'hē de', english: 'something to drink' },
      { hanzi: '早上', pinyin: 'zǎoshang', english: 'morning' },
      { hanzi: '有点儿苦', pinyin: 'yǒudiǎnr kǔ', english: 'a bit bitter' },
      { hanzi: '早饭', pinyin: 'zǎofàn', english: 'breakfast' },
      { hanzi: '鸡', pinyin: 'jī', english: 'chicken' },
    ],
  },
  {
    id: 'describe-animals-1',
    kind: 'describe',
    title: 'Describe & guess: animals',
    title_zh: '猜一猜：动物',
    level: 'elementary',
    topic: 'Animals',
    summary: 'Describe the animal — where it lives, its colour, what it eats, how big it is — and the other guesses.',
    role_names: { a: 'Describer', b: 'Guesser' },
    tutor_role: 'b',
    items: [
      { emoji: '🐼', hanzi: '熊猫', pinyin: 'xióngmāo', english: 'panda', hints: ['黑白', '四川', '吃竹子'] },
      { emoji: '🐯', hanzi: '老虎', pinyin: 'lǎohǔ', english: 'tiger', hints: ['很大', '很危险', '黄色和黑色'] },
      { emoji: '🐱', hanzi: '猫', pinyin: 'māo', english: 'cat', hints: ['家里', '喜欢鱼', '喵'] },
      { emoji: '🐶', hanzi: '狗', pinyin: 'gǒu', english: 'dog', hints: ['人的朋友', '汪汪', '跑得很快'] },
      { emoji: '🐰', hanzi: '兔子', pinyin: 'tùzi', english: 'rabbit', hints: ['耳朵很长', '吃胡萝卜', '跳'] },
      { emoji: '🐘', hanzi: '大象', pinyin: 'dàxiàng', english: 'elephant', hints: ['非常大', '鼻子很长', '灰色'] },
      { emoji: '🐵', hanzi: '猴子', pinyin: 'hóuzi', english: 'monkey', hints: ['树上', '吃香蕉', '很聪明'] },
      { emoji: '🐟', hanzi: '鱼', pinyin: 'yú', english: 'fish', hints: ['水里', '游泳', '猫喜欢吃'] },
    ],
    distractors: [
      { hanzi: '狮子', pinyin: 'shīzi', english: 'lion' },
      { hanzi: '马', pinyin: 'mǎ', english: 'horse' },
      { hanzi: '鸟', pinyin: 'niǎo', english: 'bird' },
      { hanzi: '牛', pinyin: 'niú', english: 'cow' },
      { hanzi: '猪', pinyin: 'zhū', english: 'pig' },
      { hanzi: '羊', pinyin: 'yáng', english: 'sheep' },
    ],
    glossary: [
      { hanzi: '黑白', pinyin: 'hēibái', english: 'black and white' },
      { hanzi: '四川', pinyin: 'Sìchuān', english: 'Sichuan' },
      { hanzi: '吃竹子', pinyin: 'chī zhúzi', english: 'eats bamboo' },
      { hanzi: '很大', pinyin: 'hěn dà', english: 'very big' },
      { hanzi: '很危险', pinyin: 'hěn wēixiǎn', english: 'very dangerous' },
      { hanzi: '黄色和黑色', pinyin: 'huángsè hé hēisè', english: 'yellow and black' },
      { hanzi: '家里', pinyin: 'jiā li', english: 'at home' },
      { hanzi: '喜欢鱼', pinyin: 'xǐhuan yú', english: 'likes fish' },
      { hanzi: '喵', pinyin: 'miāo', english: 'miaow' },
      { hanzi: '人的朋友', pinyin: 'rén de péngyou', english: 'a friend of people' },
      { hanzi: '汪汪', pinyin: 'wāngwāng', english: 'woof woof' },
      { hanzi: '跑得很快', pinyin: 'pǎo de hěn kuài', english: 'runs fast' },
      { hanzi: '耳朵很长', pinyin: 'ěrduo hěn cháng', english: 'long ears' },
      { hanzi: '吃胡萝卜', pinyin: 'chī húluóbo', english: 'eats carrots' },
      { hanzi: '跳', pinyin: 'tiào', english: 'to jump' },
      { hanzi: '非常大', pinyin: 'fēicháng dà', english: 'extremely big' },
      { hanzi: '鼻子很长', pinyin: 'bízi hěn cháng', english: 'long nose' },
      { hanzi: '灰色', pinyin: 'huīsè', english: 'grey' },
      { hanzi: '树上', pinyin: 'shù shang', english: 'in the trees' },
      { hanzi: '吃香蕉', pinyin: 'chī xiāngjiāo', english: 'eats bananas' },
      { hanzi: '很聪明', pinyin: 'hěn cōngming', english: 'very clever' },
      { hanzi: '水里', pinyin: 'shuǐ li', english: 'in the water' },
      { hanzi: '游泳', pinyin: 'yóuyǒng', english: 'to swim' },
      { hanzi: '猫喜欢吃', pinyin: 'māo xǐhuan chī', english: 'cats like eating it' },
    ],
  },
  {
    id: 'info-gap-weekend-1',
    kind: 'info_gap',
    title: 'Information gap: weekend plans',
    title_zh: '周末做什么？',
    level: 'elementary',
    topic: 'Daily life',
    summary: 'Each of you sees half of Xiaoming’s and Xiaohong’s weekend. Ask each other questions to fill in your blanks.',
    role_names: { a: 'Partner A', b: 'Partner B' },
    tutor_role: 'a',
    prompt: 'Ask in Chinese, e.g. 小红星期六上午做什么？ — answer with 她…',
    phrases: [
      { hanzi: '小明星期天下午做什么？', pinyin: 'Xiǎo Míng xīngqītiān xiàwǔ zuò shénme?', english: 'What is Xiaoming doing on Sunday afternoon?' },
      { hanzi: '他去打篮球。', pinyin: 'Tā qù dǎ lánqiú.', english: 'He is going to play basketball.' },
      { hanzi: '你再说一遍，好吗？', pinyin: 'Nǐ zài shuō yí biàn, hǎo ma?', english: 'Could you say that again?' },
    ],
    columns: ['小明', '小红'],
    rows: [
      { label: '星期六上午', cells: [{ value: '打篮球', owner: 'a' }, { value: '去超市', owner: 'b' }] },
      { label: '星期六下午', cells: [{ value: '看电影', owner: 'b' }, { value: '学中文', owner: 'a' }] },
      { label: '星期天上午', cells: [{ value: '睡懒觉', owner: 'a' }, { value: '去公园', owner: 'b' }] },
      { label: '星期天下午', cells: [{ value: '做饭', owner: 'b' }, { value: '见朋友', owner: 'a' }] },
    ],
    choices: [
      { hanzi: '打篮球', pinyin: 'dǎ lánqiú', english: 'play basketball' },
      { hanzi: '去超市', pinyin: 'qù chāoshì', english: 'go to the supermarket' },
      { hanzi: '看电影', pinyin: 'kàn diànyǐng', english: 'watch a film' },
      { hanzi: '学中文', pinyin: 'xué Zhōngwén', english: 'study Chinese' },
      { hanzi: '睡懒觉', pinyin: 'shuì lǎnjiào', english: 'sleep in' },
      { hanzi: '去公园', pinyin: 'qù gōngyuán', english: 'go to the park' },
      { hanzi: '做饭', pinyin: 'zuò fàn', english: 'cook' },
      { hanzi: '见朋友', pinyin: 'jiàn péngyou', english: 'meet friends' },
      { hanzi: '游泳', pinyin: 'yóuyǒng', english: 'swim' },
      { hanzi: '买衣服', pinyin: 'mǎi yīfu', english: 'buy clothes' },
    ],
  },
  {
    id: 'roleplay-restaurant-1',
    kind: 'roleplay',
    title: 'Role-play: ordering in a restaurant',
    title_zh: '在饭馆点菜',
    level: 'beginner',
    topic: 'Food',
    summary: 'A waiter and a customer. Read your lines in turn — tap Done after yours; swap roles and go again.',
    role_names: { a: '服务员 Waiter', b: '客人 Customer' },
    tutor_role: 'a',
    setting: 'A small dumpling restaurant in Beijing, lunchtime.',
    speakers: { a: '服务员', b: '客人' },
    lines: [
      { speaker: 'a', hanzi: '你好！请问几位？', pinyin: 'Nǐ hǎo! Qǐngwèn jǐ wèi?', english: 'Hello! How many of you?' },
      { speaker: 'b', hanzi: '两位。', pinyin: 'Liǎng wèi.', english: 'Two.' },
      { speaker: 'a', hanzi: '请坐。这是菜单。', pinyin: 'Qǐng zuò. Zhè shì càidān.', english: 'Please sit down. Here is the menu.' },
      { speaker: 'b', hanzi: '谢谢。你们有什么好吃的？', pinyin: 'Xièxie. Nǐmen yǒu shénme hǎochī de?', english: 'Thanks. What’s good here?' },
      { speaker: 'a', hanzi: '我们的饺子很有名。', pinyin: 'Wǒmen de jiǎozi hěn yǒumíng.', english: 'Our dumplings are famous.' },
      { speaker: 'b', hanzi: '好，我要一盘饺子和一碗米饭。', pinyin: 'Hǎo, wǒ yào yì pán jiǎozi hé yì wǎn mǐfàn.', english: 'OK, I’d like a plate of dumplings and a bowl of rice.' },
      { speaker: 'a', hanzi: '喝点儿什么？', pinyin: 'Hē diǎnr shénme?', english: 'Anything to drink?' },
      { speaker: 'b', hanzi: '一杯茶，谢谢。', pinyin: 'Yì bēi chá, xièxie.', english: 'A cup of tea, thanks.' },
      { speaker: 'a', hanzi: '好的，请稍等。', pinyin: 'Hǎo de, qǐng shāo děng.', english: 'Sure, one moment please.' },
      { speaker: 'b', hanzi: '服务员，买单！', pinyin: 'Fúwùyuán, mǎidān!', english: 'Excuse me — the bill, please!' },
      { speaker: 'a', hanzi: '一共八十五块。', pinyin: 'Yígòng bāshíwǔ kuài.', english: 'That’s 85 yuan altogether.' },
      { speaker: 'b', hanzi: '可以用微信付吗？', pinyin: 'Kěyǐ yòng Wēixìn fù ma?', english: 'Can I pay with WeChat?' },
      { speaker: 'a', hanzi: '可以，请扫这里。', pinyin: 'Kěyǐ, qǐng sǎo zhèlǐ.', english: 'Yes — please scan here.' },
    ],
  },
  {
    id: 'roleplay-directions-1',
    kind: 'roleplay',
    title: 'Role-play: asking the way',
    title_zh: '问路',
    level: 'elementary',
    topic: 'Travel',
    summary: 'A tourist asks a passer-by for the subway station. Read your part; swap and try again without looking at the pinyin.',
    role_names: { a: '路人 Passer-by', b: '游客 Tourist' },
    tutor_role: 'a',
    setting: 'A busy street corner in Shanghai.',
    speakers: { a: '路人', b: '游客' },
    lines: [
      { speaker: 'b', hanzi: '不好意思，请问地铁站在哪儿？', pinyin: 'Bù hǎoyìsi, qǐngwèn dìtiězhàn zài nǎr?', english: 'Excuse me, where is the subway station?' },
      { speaker: 'a', hanzi: '一直往前走，到第二个路口往右拐。', pinyin: 'Yìzhí wǎng qián zǒu, dào dì-èr gè lùkǒu wǎng yòu guǎi.', english: 'Go straight ahead and turn right at the second crossing.' },
      { speaker: 'b', hanzi: '远不远？', pinyin: 'Yuǎn bu yuǎn?', english: 'Is it far?' },
      { speaker: 'a', hanzi: '不太远，走路大概十分钟。', pinyin: 'Bú tài yuǎn, zǒulù dàgài shí fēnzhōng.', english: 'Not too far — about ten minutes on foot.' },
      { speaker: 'b', hanzi: '地铁站旁边有银行吗？', pinyin: 'Dìtiězhàn pángbiān yǒu yínháng ma?', english: 'Is there a bank near the station?' },
      { speaker: 'a', hanzi: '有，银行就在地铁站对面。', pinyin: 'Yǒu, yínháng jiù zài dìtiězhàn duìmiàn.', english: 'Yes, the bank is right across from the station.' },
      { speaker: 'b', hanzi: '太好了，谢谢你！', pinyin: 'Tài hǎo le, xièxie nǐ!', english: 'Great, thank you!' },
      { speaker: 'a', hanzi: '不客气。', pinyin: 'Bú kèqi.', english: 'You’re welcome.' },
    ],
  },
  {
    id: 'build-sentences-1',
    kind: 'build',
    title: 'Build the sentence together',
    title_zh: '一起连词成句',
    level: 'elementary',
    topic: 'Grammar: 把, 比, 过, 了',
    summary: 'Scrambled words on a shared board — either of you taps them into order. The tutor reveals the answer; then both say it aloud.',
    role_names: { a: 'Builder', b: 'Builder' },
    tutor_role: 'a',
    items: [
      { tiles: ['我', '把', '书', '放在', '桌子上'], pinyin: 'Wǒ bǎ shū fàng zài zhuōzi shang.', english: 'I put the book on the table.' },
      { tiles: ['他', '昨天', '去', '北京', '了'], pinyin: 'Tā zuótiān qù Běijīng le.', english: 'He went to Beijing yesterday.' },
      { tiles: ['你', '吃过', '北京烤鸭', '吗'], pinyin: 'Nǐ chīguo Běijīng kǎoyā ma?', english: 'Have you ever had Peking duck?' },
      { tiles: ['我', '比', '我哥哥', '高'], pinyin: 'Wǒ bǐ wǒ gēge gāo.', english: 'I am taller than my older brother.' },
      { tiles: ['请', '把', '门', '关上'], pinyin: 'Qǐng bǎ mén guānshang.', english: 'Please close the door.' },
      { tiles: ['我们', '一起', '去', '看', '电影', '吧'], pinyin: 'Wǒmen yìqǐ qù kàn diànyǐng ba.', english: 'Let’s go and see a film together.' },
    ],
  },
  {
    id: 'quiz-tones-1',
    kind: 'quiz',
    title: 'Quick quiz: which one did you hear?',
    title_zh: '听一听：哪一个？',
    level: 'beginner',
    topic: 'Listening: tones',
    summary: 'The tutor plays a word (it plays on both devices, text hidden); the student picks what they heard; the tutor marks it.',
    role_names: { a: 'Asker', b: 'Answerer' },
    tutor_role: 'a',
    questions: [
      { prompt: '', audio: '买', options: ['mǎi 买 (buy)', 'mài 卖 (sell)'], answer: 0, explanation: '买 mǎi is the 3rd tone (dips); 卖 mài the 4th (falls).' },
      { prompt: '', audio: '卖', options: ['mǎi 买 (buy)', 'mài 卖 (sell)'], answer: 1, explanation: '卖 mài falls sharply — 4th tone.' },
      { prompt: '', audio: '糖', options: ['tāng 汤 (soup)', 'táng 糖 (sugar)'], answer: 1, explanation: '糖 táng rises (2nd tone); 汤 tāng stays high (1st).' },
      { prompt: '', audio: '又', options: ['yǒu 有 (to have)', 'yòu 又 (again)'], answer: 1, explanation: '又 yòu falls (4th); 有 yǒu dips (3rd).' },
      { prompt: '', audio: '马', options: ['mā 妈 (mum)', 'mǎ 马 (horse)'], answer: 1, explanation: '马 mǎ dips; 妈 mā is high and level.' },
      { prompt: '', audio: '水饺', options: ['shuìjiào 睡觉 (sleep)', 'shuǐjiǎo 水饺 (dumplings)'], answer: 1, explanation: '水饺 shuǐjiǎo: two 3rd tones — the first one is said as a 2nd.' },
      { prompt: '', audio: '请问', options: ['qǐngwèn 请问 (excuse me)', 'qīnwěn 亲吻 (to kiss)'], answer: 0, explanation: 'Get this one right in a shop: 请问 qǐngwèn = excuse me, may I ask.' },
    ],
  },
  {
    id: 'quiz-measure-words-1',
    kind: 'quiz',
    title: 'Quick quiz: measure words',
    title_zh: '量词小测验',
    level: 'elementary',
    topic: 'Grammar: measure words',
    summary: 'The tutor pushes a question; the student picks the measure word (and says the phrase aloud); the tutor sees the pick live and marks it.',
    role_names: { a: 'Asker', b: 'Answerer' },
    tutor_role: 'a',
    questions: [
      { prompt: '一___书 (a book)', options: ['本', '个', '张', '条'], answer: 0, explanation: '本 běn for books and notebooks.' },
      { prompt: '一___纸 (a sheet of paper)', options: ['本', '张', '条', '只'], answer: 1, explanation: '张 zhāng for flat things: paper, tables, tickets, photos.' },
      { prompt: '一___鱼 (a fish)', options: ['只', '张', '条', '件'], answer: 2, explanation: '条 tiáo for long, thin things: fish, roads, rivers, trousers.' },
      { prompt: '一___猫 (a cat)', options: ['条', '只', '个', '本'], answer: 1, explanation: '只 zhī for most animals (and one of a pair).' },
      { prompt: '三___衣服 (three items of clothing)', options: ['条', '张', '件', '杯'], answer: 2, explanation: '件 jiàn for clothes (on the upper body) and matters.' },
      { prompt: '一___咖啡 (a cup of coffee)', options: ['杯', '本', '只', '件'], answer: 0, explanation: '杯 bēi = a cup / glass of something.' },
    ],
  },
  {
    id: 'dictation-everyday-1',
    kind: 'dictation',
    title: 'Dictation: everyday words',
    title_zh: '听写：常用词',
    level: 'beginner',
    topic: 'Everyday words',
    summary: 'The tutor says a word (or plays it); the student types it in characters; the tutor watches it being typed and marks it.',
    role_names: { a: 'Reader', b: 'Writer' },
    tutor_role: 'a',
    items: [
      { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' },
      { hanzi: '谢谢', pinyin: 'xièxie', english: 'thank you' },
      { hanzi: '朋友', pinyin: 'péngyou', english: 'friend' },
      { hanzi: '老师', pinyin: 'lǎoshī', english: 'teacher' },
      { hanzi: '喜欢', pinyin: 'xǐhuan', english: 'to like' },
      { hanzi: '今天', pinyin: 'jīntiān', english: 'today' },
      { hanzi: '明天', pinyin: 'míngtiān', english: 'tomorrow' },
      { hanzi: '吃饭', pinyin: 'chī fàn', english: 'to eat (a meal)' },
    ],
  },
];

export function findActivity(id: string): ActivitySpec | null {
  return ACTIVITY_CATALOGUE.find((a) => a.id === id) ?? null;
}

/** How each kind is introduced in the picker. */
export const ACTIVITY_KIND_INFO: Record<ActivityKind, { icon: string; name: string; blurb: string }> = {
  describe: { icon: '🎯', name: 'Describe & guess', blurb: 'One describes, one guesses' },
  info_gap: { icon: '🧩', name: 'Information gap', blurb: 'Each sees half — ask to fill the rest' },
  roleplay: { icon: '🎭', name: 'Role-play', blurb: 'Read a dialogue together, turn by turn' },
  build: { icon: '🧱', name: 'Sentence building', blurb: 'Put the words in order together' },
  quiz: { icon: '❓', name: 'Quick quiz', blurb: 'Tutor asks, student answers live' },
  dictation: { icon: '✍️', name: 'Dictation', blurb: 'Tutor says it, student writes it' },
};

/** Problems with a spec (empty = fine). Used by the catalogue test; ready for generated specs later. */
export function validateActivitySpec(spec: ActivitySpec): string[] {
  const p: string[] = [];
  if (!spec.id || !spec.title) p.push('id and title are required');
  if (spec.tutor_role !== 'a' && spec.tutor_role !== 'b') p.push('tutor_role must be a or b');
  switch (spec.kind) {
    case 'describe':
      if (spec.items.length < 4) p.push('describe needs at least 4 items (four options a round)');
      if (new Set(spec.items.map((i) => i.hanzi)).size !== spec.items.length) p.push('describe items must differ');
      for (const d of spec.distractors ?? []) if (spec.items.some((i) => i.hanzi === d.hanzi)) p.push(`distractor ${d.hanzi} is also an item`);
      if (spec.glossary) {
        for (const it of spec.items) for (const h of it.hints ?? []) if (!spec.glossary.some((g) => g.hanzi === h)) p.push(`hint ${h} has no glossary entry`);
      }
      break;
    case 'info_gap': {
      const hanzi = new Set(spec.choices.map((c) => c.hanzi));
      spec.rows.forEach((r, ri) => {
        if (r.cells.length !== spec.columns.length) p.push(`row ${ri + 1} needs one cell per column`);
        r.cells.forEach((c) => { if (!hanzi.has(c.value)) p.push(`"${c.value}" is not among the choices`); });
      });
      break;
    }
    case 'roleplay':
      if (spec.lines.length === 0) p.push('a dialogue needs lines');
      break;
    case 'build':
      spec.items.forEach((it, i) => { if (it.tiles.length < 2) p.push(`sentence ${i + 1} needs at least 2 tiles`); });
      break;
    case 'quiz':
      spec.questions.forEach((q, i) => {
        if (q.options.length < 2) p.push(`question ${i + 1} needs 2+ options`);
        if (q.answer < 0 || q.answer >= q.options.length) p.push(`question ${i + 1}: answer out of range`);
        if (!q.prompt && !q.audio) p.push(`question ${i + 1} needs a prompt or audio`);
      });
      break;
    case 'dictation':
      if (spec.items.length === 0) p.push('dictation needs words');
      break;
  }
  return p;
}
