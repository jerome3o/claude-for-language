/**
 * Golden vectors for the Kotlin port of shared/idioms (android-lab/core/…/idioms/Idioms.kt):
 * the starter list, the cache key (normalizeIdiomHanzi / idiomKeyProblem), isIdiomShaped, the
 * explorer link rule, the quiz score line, the labels, and the "+ Add as card" fields of the
 * sample entry and of variants (uncertain / modern origin, no examples, no mistake). The sample
 * entry itself is written as JSON so the Kotlin data classes are checked to decode it.
 * Writes idioms.json; checked by core/…/idioms/IdiomsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  IDIOM_ROLES,
  SAMPLE_IDIOM_ENTRY,
  STARTER_IDIOMS,
  idiomCardFields,
  idiomKeyProblem,
  idiomOriginLine,
  idiomQuizScoreLine,
  idiomRegisterLabel,
  idiomRolesLabel,
  idiomSentimentLabel,
  isIdiomShaped,
  normalizeIdiomHanzi,
  showIdiomLink,
  type IdiomEntry,
} from '../../../shared/idioms';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const TEXTS = [
  '画蛇添足', ' 《画蛇添足》 ', '画 蛇 添 足。', '畫蛇添足', '「守株待兔」', '一举两得！', '银行', '你', '', '   ', 'hua she tian zu',
  '画蛇添足abc', '不入虎穴焉得虎子', '一二三四五六七八九十一二三', '多此一举', '图书馆员', '画蛇　添足', '画蛇添足﻿', '自相矛盾?',
  '亡羊补牢…', '１２３４', '井底之蛙—', '对牛弹琴~', '學而時習之',
];

const LINKS: Array<{ hanzi: string; known?: boolean; senses?: string[] }> = [
  { hanzi: '画蛇添足' },
  { hanzi: '多此一举' },
  { hanzi: '多此一举', known: true },
  { hanzi: '多此一举', senses: ['to do something superfluous (idiom)'] },
  { hanzi: '多此一举', senses: ['an Idiom for overdoing it'] },
  { hanzi: '多此一举', senses: ['idiomatic'] },
  { hanzi: '图书馆员', senses: ['librarian'] },
  { hanzi: '银行', known: true },
  { hanzi: '一举两得', senses: [] },
  { hanzi: '不入虎穴焉得虎子', known: true },
  { hanzi: '马马虎虎', senses: ['careless', 'so-so (chengyu)'] },
];

const variant = (patch: (e: IdiomEntry) => void): IdiomEntry => {
  const e = JSON.parse(JSON.stringify(SAMPLE_IDIOM_ENTRY)) as IdiomEntry;
  patch(e);
  return e;
};

const ENTRIES: IdiomEntry[] = [
  SAMPLE_IDIOM_ENTRY,
  variant((e) => {
    e.origin = { kind: 'uncertain', source: null, era: null, summary: 'Nobody is sure where it comes from.', story: [], note: 'The origin is uncertain.' };
  }),
  variant((e) => {
    e.origin = { kind: 'modern', source: null, era: null, summary: '', story: [], note: null };
  }),
  variant((e) => {
    e.origin.source = null;
    e.origin.era = '战国';
    e.usage.mistake = '';
    e.usage.note = '';
    e.usage.examples = [];
    e.literal_english = '';
  }),
  variant((e) => {
    e.origin.source = null;
    e.origin.era = null;
    e.origin.kind = 'folk';
    e.usage.roles = ['定语', '其他'];
    e.usage.sentiment = 'praise';
    e.usage.register = 'written';
  }),
];

const out = {
  roles: Object.entries(IDIOM_ROLES),
  starter: STARTER_IDIOMS.map((s) => ({ ...s })),
  keys: TEXTS.map((text) => ({ text, normalized: normalizeIdiomHanzi(text), problem: idiomKeyProblem(text), shaped: isIdiomShaped(text) })),
  links: LINKS.map((l) => ({ ...l, show: showIdiomLink(l.hanzi, { known: l.known, senses: l.senses }) })),
  scores: [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2], [2, 2], [0, 3], [1, 3], [2, 3], [3, 3]].map(([c, t]) => ({ correct: c, total: t, line: idiomQuizScoreLine(c, t) })),
  labels: {
    sentiment: ['praise', 'criticism', 'neutral'].map((s) => [s, idiomSentimentLabel(s as IdiomEntry['usage']['sentiment'])]),
    register: ['written', 'spoken', 'both'].map((r) => [r, idiomRegisterLabel(r as IdiomEntry['usage']['register'])]),
    roles: [[['谓语', '宾语']], [['定语', '其他']], [[]]].map(([r]) => ({ roles: r, label: idiomRolesLabel(r) })),
  },
  entries: ENTRIES.map((entry) => ({ entry, origin_line: idiomOriginLine(entry), card: idiomCardFields(entry) })),
};

writeFileSync(join(OUT, 'idioms.json'), JSON.stringify(out, null, 1));
