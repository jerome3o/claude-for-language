/**
 * The curated starter list: common, well-known 成语 a learner meets early (many with a classic
 * 典故), shown as a browsable grid before anything is generated. The entry itself is generated
 * lazily the first time someone opens it. Pinyin follows the card standard (一 / 不 tone
 * changes written — a unit test checks it against applyYiBuToneChanges).
 */

export interface StarterIdiom {
  hanzi: string;
  pinyin: string;
  english: string;
  /** story = a classic 典故 behind it; everyday = a descriptive idiom used all the time. */
  kind: 'story' | 'everyday';
}

export const STARTER_IDIOMS: readonly StarterIdiom[] = [
  // With a story (典故)
  { hanzi: '画蛇添足', pinyin: 'huà shé tiān zú', english: 'ruin something by adding what isn’t needed', kind: 'story' },
  { hanzi: '守株待兔', pinyin: 'shǒu zhū dài tù', english: 'wait idly for luck to strike again', kind: 'story' },
  { hanzi: '自相矛盾', pinyin: 'zì xiāng máo dùn', english: 'contradict oneself', kind: 'story' },
  { hanzi: '亡羊补牢', pinyin: 'wáng yáng bǔ láo', english: 'mend the pen after losing a sheep — better late than never', kind: 'story' },
  { hanzi: '井底之蛙', pinyin: 'jǐng dǐ zhī wā', english: 'a frog in a well — someone with a narrow view', kind: 'story' },
  { hanzi: '塞翁失马', pinyin: 'sài wēng shī mǎ', english: 'a blessing in disguise', kind: 'story' },
  { hanzi: '对牛弹琴', pinyin: 'duì niú tán qín', english: 'play the lute to a cow — talk to the wrong audience', kind: 'story' },
  { hanzi: '刻舟求剑', pinyin: 'kè zhōu qiú jiàn', english: 'act without seeing that things have changed', kind: 'story' },
  { hanzi: '拔苗助长', pinyin: 'bá miáo zhù zhǎng', english: 'spoil things by being too eager', kind: 'story' },
  { hanzi: '掩耳盗铃', pinyin: 'yǎn ěr dào líng', english: 'fool oneself', kind: 'story' },
  { hanzi: '狐假虎威', pinyin: 'hú jiǎ hǔ wēi', english: 'borrow someone’s power to bully others', kind: 'story' },
  { hanzi: '叶公好龙', pinyin: 'yè gōng hào lóng', english: 'claim to love what one actually fears', kind: 'story' },
  { hanzi: '杯弓蛇影', pinyin: 'bēi gōng shé yǐng', english: 'be frightened by one’s own imagination', kind: 'story' },
  { hanzi: '胸有成竹', pinyin: 'xiōng yǒu chéng zhú', english: 'have a plan already worked out', kind: 'story' },
  { hanzi: '卧薪尝胆', pinyin: 'wò xīn cháng dǎn', english: 'endure hardship to prepare for a comeback', kind: 'story' },
  { hanzi: '破釜沉舟', pinyin: 'pò fǔ chén zhōu', english: 'burn one’s bridges — no way back', kind: 'story' },
  { hanzi: '纸上谈兵', pinyin: 'zhǐ shàng tán bīng', english: 'theory with no practice — an armchair strategist', kind: 'story' },
  { hanzi: '指鹿为马', pinyin: 'zhǐ lù wéi mǎ', english: 'call a deer a horse — deliberately twist the truth', kind: 'story' },
  { hanzi: '望梅止渴', pinyin: 'wàng méi zhǐ kě', english: 'console oneself with false hopes', kind: 'story' },
  { hanzi: '画龙点睛', pinyin: 'huà lóng diǎn jīng', english: 'add the finishing touch', kind: 'story' },
  { hanzi: '班门弄斧', pinyin: 'bān mén nòng fǔ', english: 'show off in front of an expert', kind: 'story' },
  { hanzi: '废寝忘食', pinyin: 'fèi qǐn wàng shí', english: 'so absorbed one forgets to sleep and eat', kind: 'story' },
  { hanzi: '熟能生巧', pinyin: 'shú néng shēng qiǎo', english: 'practice makes perfect', kind: 'story' },
  { hanzi: '半途而废', pinyin: 'bàn tú ér fèi', english: 'give up halfway', kind: 'story' },
  { hanzi: '入乡随俗', pinyin: 'rù xiāng suí sú', english: 'when in Rome, do as the Romans do', kind: 'everyday' },
  { hanzi: '九牛一毛', pinyin: 'jiǔ niú yì máo', english: 'a drop in the ocean', kind: 'story' },
  // Everyday
  { hanzi: '一举两得', pinyin: 'yì jǔ liǎng dé', english: 'kill two birds with one stone', kind: 'everyday' },
  { hanzi: '一心一意', pinyin: 'yì xīn yí yì', english: 'wholeheartedly', kind: 'everyday' },
  { hanzi: '三心二意', pinyin: 'sān xīn èr yì', english: 'half-hearted, unable to make up one’s mind', kind: 'everyday' },
  { hanzi: '七上八下', pinyin: 'qī shàng bā xià', english: 'on edge, very anxious', kind: 'everyday' },
  { hanzi: '乱七八糟', pinyin: 'luàn qī bā zāo', english: 'in a complete mess', kind: 'everyday' },
  { hanzi: '一路顺风', pinyin: 'yí lù shùn fēng', english: 'have a good trip', kind: 'everyday' },
  { hanzi: '一模一样', pinyin: 'yì mú yí yàng', english: 'exactly alike', kind: 'everyday' },
  { hanzi: '一见钟情', pinyin: 'yí jiàn zhōng qíng', english: 'love at first sight', kind: 'everyday' },
  { hanzi: '千方百计', pinyin: 'qiān fāng bǎi jì', english: 'by every possible means', kind: 'everyday' },
  { hanzi: '五颜六色', pinyin: 'wǔ yán liù sè', english: 'colourful, of every colour', kind: 'everyday' },
  { hanzi: '人山人海', pinyin: 'rén shān rén hǎi', english: 'huge crowds of people', kind: 'everyday' },
  { hanzi: '不可思议', pinyin: 'bù kě sī yì', english: 'unbelievable, inconceivable', kind: 'everyday' },
  { hanzi: '不知不觉', pinyin: 'bù zhī bù jué', english: 'without noticing, before one knows it', kind: 'everyday' },
  { hanzi: '津津有味', pinyin: 'jīn jīn yǒu wèi', english: 'with great relish', kind: 'everyday' },
  { hanzi: '莫名其妙', pinyin: 'mò míng qí miào', english: 'baffling, for no apparent reason', kind: 'everyday' },
  { hanzi: '马到成功', pinyin: 'mǎ dào chéng gōng', english: 'win success at once', kind: 'everyday' },
  { hanzi: '东张西望', pinyin: 'dōng zhāng xī wàng', english: 'look around in all directions', kind: 'everyday' },
  { hanzi: '半信半疑', pinyin: 'bàn xìn bàn yí', english: 'half believing, half doubting', kind: 'everyday' },
  { hanzi: '名副其实', pinyin: 'míng fù qí shí', english: 'living up to its name', kind: 'everyday' },
  { hanzi: '井井有条', pinyin: 'jǐng jǐng yǒu tiáo', english: 'in perfect order', kind: 'everyday' },
];

const BY_HANZI = new Map(STARTER_IDIOMS.map((s) => [s.hanzi, s]));

export function starterIdiom(hanzi: string): StarterIdiom | undefined {
  return BY_HANZI.get(hanzi);
}

export function isStarterIdiom(hanzi: string): boolean {
  return BY_HANZI.has(hanzi);
}
