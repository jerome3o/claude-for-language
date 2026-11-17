/**
 * Package E golden vectors: which chat text counts as Chinese (shared/chats/messageTools
 * `looksLikeChinese` — the gate of every learning tool). Writes chat.json; checked by
 * core/…/ChatParityTest.kt. (The message menu's vectors are in chat-round2.ts.)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikeChinese } from '../../../shared/chats';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const texts = ['我把作业做完了。', 'See you tomorrow!', 'hello 你好', '', '👍', '一', '鿿', '〇', '㐀', 'ｈｉ', '好的 OK', 'ok?'];
const chinese = texts.map((t) => ({ text: t, chinese: looksLikeChinese(t) }));

writeFileSync(join(OUT, 'chat.json'), JSON.stringify({ chinese }));
