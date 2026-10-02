/**
 * Golden vectors for the chat search (shared/chats/search.ts): messageMatches / searchMessages
 * over seeded messages and queries (content, translation, voice transcript, attachment
 * translation, word pinyin with / without tones, deleted messages, whitespace edge cases).
 * Writes chat-search.json; checked by core/…/ChatSearchParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { searchMessages, messageMatches, type SearchableMessage } from '../../../shared/chats/search';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const messages: SearchableMessage[] = [
  { id: 'm1', content: '你好！今天怎么样？', translation: 'Hello! How are you today?' },
  { id: 'm2', content: 'See you TOMORROW', translation: null },
  { id: 'm3', content: '', attachment: { kind: 'voice', transcript: '我想去银行', translation: 'I want to go to the bank' } },
  { id: 'm4', content: 'Nice photo', attachment: { kind: 'image' } },
  { id: 'm5', content: '我们明天见', deleted_at: '2026-10-01T10:00:00.000Z' },
  {
    id: 'm6', content: '你好吗',
    words: [{ text: '你好', pinyin: 'nǐ hǎo' }, { text: '吗', pinyin: 'ma' }],
  },
  {
    id: 'm7', content: '银行在哪儿？',
    words: [{ text: '银行', pinyin: 'yínháng' }, { text: '在', pinyin: 'zài' }, { text: '哪儿', pinyin: ' nǎr ' }, { text: '？', pinyin: '' }],
  },
  { id: 'm8', content: null, translation: '   ' },
  { id: 'm9', content: 'Ünïcode ÇAFÉ　全角 space', words: [] },
  { id: 'm10', content: '學習中文', words: [{ text: '學習', pinyin: null }, { text: '中文', pinyin: 'Zhōngwén' }] },
  { id: 'm11', content: 'tab\there', translation: 'İstanbul' },
  { id: 'm12', content: '好', deleted_at: '' },
];

const queries = [
  '', '   ', '你好', 'hello', 'HELLO', 'tomorrow', ' tomorrow ', '银行', 'bank', 'nihao', 'ni hao', 'nǐ hǎo', 'NI  HAO',
  'yinhang', 'yínháng zai', 'yinhangzainar', 'nar', 'ma', 'photo', '明天', 'zhongwen', 'zhōng', 'xue', 'café', 'cafe',
  '全角', '　', 'tab\th', 'istanbul', 'i̇stanbul', 'é', 'e', '？', '好', 'a', 'zai nar', 'hǎo ma', 'haoma', 'hao  ma',
];

const cases = queries.map((q) => ({ query: q, ids: searchMessages(messages, q), each: messages.map((m) => messageMatches(m, q)) }));

writeFileSync(join(OUT, 'chat-search.json'), JSON.stringify({ messages, cases }));
