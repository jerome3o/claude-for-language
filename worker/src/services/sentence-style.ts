/**
 * "Example sentence style" on the server (shared/study/sentenceStyle.ts; docs/STUDY_SESSION.md "Example
 * sentence style"): the register the account's NEW example sentences are written in. `users.sentence_style`
 * (migration 0155), NULL = the default (everyday). The sentence generator reads the note OWNER's style
 * (services/sentence-learner-context.ts).
 */
import { sentenceStyleOf, type SentenceStyle } from '../../../shared/study/sentenceStyle';

export async function getSentenceStyle(db: D1Database, userId: string): Promise<SentenceStyle> {
  const row = await db
    .prepare('SELECT sentence_style FROM users WHERE id = ?')
    .bind(userId)
    .first<{ sentence_style: string | null }>();
  return sentenceStyleOf(row?.sentence_style);
}

/** Store the style (null = back to the default); returns the style now in effect. */
export async function setSentenceStyle(db: D1Database, userId: string, style: SentenceStyle | null): Promise<SentenceStyle> {
  await db.prepare('UPDATE users SET sentence_style = ? WHERE id = ?').bind(style, userId).run();
  return sentenceStyleOf(style);
}
