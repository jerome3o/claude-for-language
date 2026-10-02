/**
 * Package E golden vectors: the chat's role-aware message tools
 * (shared/chats/messageTools) and Ask-Claude thread grouping (shared/chats/threads).
 * Writes chat.json; checked by core/…/ChatParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { toolsForMessage, learningToolsForMessage, looksLikeChinese, groupQuestionThreads, sqliteToIso } from '../../../shared/chats';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const texts = ['我把作业做完了。', 'See you tomorrow!', 'hello 你好', '', '👍', '一', '鿿', '〇', '㐀', 'ｈｉ', '好的 OK', 'ok?'];
const tools: unknown[] = [];
for (const content of texts)
  for (const mine of [true, false])
    for (const role of ['student', 'tutor'] as const)
      for (const ai of [false, true])
        for (const check of [null, undefined, 'correct', 'needs_improvement'] as const)
          for (const disc of [false, true]) {
            const msg = { sender_id: mine ? 'me' : 'other', content, check_status: check, has_discussion: disc };
            tools.push({ message: msg, role, ai, result: toolsForMessage(msg, role, ai, 'me') });
          }
// PR 3: learningToolsForMessage over kinds × correction × deleted / pending × roles × AI.
const learning: unknown[] = [];
const attachments = [null, { kind: 'image' }, { kind: 'voice', transcript: '好可爱' }, { kind: 'voice', transcript: '  ' }, { kind: 'voice', transcript: null }];
for (const content of ['我昨天去商店买东西了', '  ', '', 'See you!'])
  for (const attachment of attachments)
    for (const mine of [true, false])
      for (const corrected of [false, true])
        for (const state of ['live', 'deleted', 'pending'] as const)
          for (const role of ['student', 'tutor'] as const)
            for (const ai of [false, true]) {
              const msg = {
                sender_id: mine ? 'me' : 'other', content, attachment,
                correction: corrected ? { text: '我昨天去商店买了东西' } : null,
                deleted_at: state === 'deleted' ? '2026-10-02T10:00:00Z' : null,
                pending: state === 'pending',
              };
              learning.push({ message: msg, role, ai, result: learningToolsForMessage(msg, role, ai, 'me') });
            }
const chinese = texts.map((t) => ({ text: t, chinese: looksLikeChinese(t) }));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(7);
const threads = Array.from({ length: 60 }, (_, c) => {
  const rows = Array.from({ length: Math.floor(r() * 12) }, (_, i) => {
    const t = Date.UTC(2026, 8, 20) + Math.floor(r() * 4 * 3600_000);
    return { id: `q${c}-${i}`, note_id: `n${Math.floor(r() * 3)}`, question: 'q', answer: 'a', asked_at: new Date(t).toISOString() };
  });
  return { rows, threads: groupQuestionThreads(rows).map((t) => ({ id: t.id, note_id: t.note_id, questions: t.questions.map((q) => q.id), started_at: t.started_at, last_at: t.last_at })) };
});
const sqlite = ['2026-09-25 10:01:02', '2026-09-25T10:01:02Z', '', '2026-09-25 10:01:02Z'].map((v) => ({ in: v, out: sqliteToIso(v) }));

writeFileSync(join(OUT, 'chat.json'), JSON.stringify({ tools, learning, chinese, threads, sqlite }));
