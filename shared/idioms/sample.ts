/**
 * One hand-written entry (画蛇添足) in the generator's exact shape: the E2E stand-in for the
 * model (worker/src/services/idioms-fake.ts), unit tests, the Lab screenshots and the parity
 * vectors all use it. The story follows 《战国策·齐策二》.
 */
import type { IdiomEntry } from './types';

export const SAMPLE_IDIOM_ENTRY: IdiomEntry = {
  hanzi: '画蛇添足',
  pinyin: 'huà shé tiān zú',
  literal: [
    { hanzi: '画', pinyin: 'huà', gloss: 'draw' },
    { hanzi: '蛇', pinyin: 'shé', gloss: 'snake' },
    { hanzi: '添', pinyin: 'tiān', gloss: 'add' },
    { hanzi: '足', pinyin: 'zú', gloss: 'foot, feet' },
  ],
  literal_english: 'draw a snake and add feet to it',
  meaning: 'to ruin something by adding what isn’t needed; to overdo it',
  explanation_zh: '比喻做了多余的事，反而把事情弄坏了。',
  explanation_pinyin: 'bǐyù zuò le duōyú de shì, fǎn’ér bǎ shìqing nòng huài le.',
  origin: {
    kind: 'classical',
    source: '《战国策·齐策二》',
    era: '战国 (Warring States)',
    summary: 'In a snake-drawing race for a pot of wine, the winner stopped to add feet to his snake — and lost the wine, because snakes have no feet.',
    story: [
      {
        hanzi: '古时候，楚国有一个人请客人喝酒，可是只有一壶酒。',
        pinyin: 'gǔ shíhou, Chǔguó yǒu yí gè rén qǐng kèrén hē jiǔ, kěshì zhǐ yǒu yì hú jiǔ.',
        english: 'Long ago, a man in the state of Chu offered his guests wine — but there was only one pot of it.',
      },
      {
        hanzi: '客人们说：“这壶酒大家喝不够，一个人喝正好。我们比赛画蛇吧，谁先画好，谁就喝这壶酒。”',
        pinyin: 'kèrénmen shuō: “zhè hú jiǔ dàjiā hē bu gòu, yí gè rén hē zhènghǎo. wǒmen bǐsài huà shé ba, shéi xiān huà hǎo, shéi jiù hē zhè hú jiǔ.”',
        english: 'The guests said: “This pot isn’t enough for all of us, but it’s just right for one. Let’s race to draw a snake — whoever finishes first drinks the wine.”',
      },
      {
        hanzi: '有一个人画得很快，第一个画好了。他拿起酒壶，看见别人还没画完，就说：“我还能给蛇画上脚呢！”',
        pinyin: 'yǒu yí gè rén huà de hěn kuài, dì yī gè huà hǎo le. tā ná qǐ jiǔhú, kànjiàn biérén hái méi huà wán, jiù shuō: “wǒ hái néng gěi shé huà shang jiǎo ne!”',
        english: 'One man drew fast and finished first. He picked up the wine pot, saw the others hadn’t finished, and said: “I can even give my snake feet!”',
      },
      {
        hanzi: '他还没画完脚，另一个人已经画好了蛇。那个人拿过酒壶说：“蛇本来没有脚，你画的不是蛇！”说完，他就把酒喝了。',
        pinyin: 'tā hái méi huà wán jiǎo, lìng yí gè rén yǐjīng huà hǎo le shé. nàge rén ná guò jiǔhú shuō: “shé běnlái méiyǒu jiǎo, nǐ huà de bú shì shé!” shuō wán, tā jiù bǎ jiǔ hē le.',
        english: 'Before he had finished the feet, another man had finished his snake. He took the pot and said: “Snakes have no feet — what you drew isn’t a snake!” And he drank the wine.',
      },
      {
        hanzi: '后来，人们用“画蛇添足”比喻做了多余的事，反而把事情弄坏了。',
        pinyin: 'hòulái, rénmen yòng “huà shé tiān zú” bǐyù zuò le duōyú de shì, fǎn’ér bǎ shìqing nòng huài le.',
        english: 'Since then, people use 画蛇添足 for doing something unnecessary that ends up spoiling things.',
      },
    ],
    note: null,
  },
  usage: {
    roles: ['谓语', '宾语'],
    register: 'both',
    sentiment: 'criticism',
    note: 'Said of an extra that spoils something already good — often after 简直是, 真是 or 反而.',
    collocations: [
      { hanzi: '简直是画蛇添足', pinyin: 'jiǎnzhí shì huà shé tiān zú', english: 'it’s simply overdoing it' },
      { hanzi: '不要画蛇添足', pinyin: 'bú yào huà shé tiān zú', english: 'don’t overdo it' },
      { hanzi: '画蛇添足的做法', pinyin: 'huà shé tiān zú de zuòfǎ', english: 'an unnecessary addition' },
    ],
    examples: [
      { hanzi: '这句话已经很好了，别画蛇添足。', pinyin: 'zhè jù huà yǐjīng hěn hǎo le, bié huà shé tiān zú.', english: 'This sentence is already good — don’t overdo it.' },
      { hanzi: '他在照片上加了很多字，真是画蛇添足。', pinyin: 'tā zài zhàopiàn shang jiā le hěn duō zì, zhēn shì huà shé tiān zú.', english: 'He added lots of text to the photo — completely unnecessary.' },
      { hanzi: '文章写到这里就够了，再加一段反而画蛇添足。', pinyin: 'wénzhāng xiě dào zhèlǐ jiù gòu le, zài jiā yí duàn fǎn’ér huà shé tiān zú.', english: 'The essay is enough as it is; another paragraph would only spoil it.' },
      {
        hanzi: '设计本来很简洁，老板却要加上许多装饰，结果画蛇添足，客户反而不满意了。',
        pinyin: 'shèjì běnlái hěn jiǎnjié, lǎobǎn què yào jiā shang xǔduō zhuāngshì, jiéguǒ huà shé tiān zú, kèhù fǎn’ér bù mǎnyì le.',
        english: 'The design was clean, but the boss wanted lots of decoration added; it overdid it, and the client ended up unhappy.',
      },
    ],
    mistake: 'It criticises an unnecessary extra — not just any mistake. Don’t use it for leaving something out, and never as praise for extra effort.',
  },
  synonyms: [{ hanzi: '多此一举', pinyin: 'duō cǐ yì jǔ', english: 'do something superfluous' }],
  antonyms: [
    { hanzi: '画龙点睛', pinyin: 'huà lóng diǎn jīng', english: 'add the finishing touch' },
    { hanzi: '恰到好处', pinyin: 'qià dào hǎo chù', english: 'just right' },
  ],
  quiz: [
    {
      kind: 'meaning',
      prompt: '画蛇添足 means…',
      options: ['to ruin something by adding what isn’t needed', 'to draw very well', 'to finish a job quickly', 'to be afraid of snakes'],
      answer: 0,
      explanation: 'The man added feet to his snake and lost the wine — the extra spoiled it.',
    },
    {
      kind: 'fit',
      prompt: 'Which sentence uses 画蛇添足 correctly?',
      options: ['这道菜已经很好吃了，再放糖就是画蛇添足。', '他学习很努力，真是画蛇添足。', '我今天画蛇添足地去上班了。'],
      answer: 0,
      explanation: 'It criticises an unnecessary extra — like more sugar in a dish that is already good.',
    },
  ],
  confidence: 'high',
  confidence_note: null,
};
