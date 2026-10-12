/**
 * "Up next" on the web device: an add (offline) puts the note first within the budget in
 * getStudyQueue AND in the Home counts (the same numbers); reorder / remove apply at once
 * and wait to upload; a sync's list never overrides a waiting change; flushing sends the
 * changes in order.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, getStudyQueue, getRawQueueCounts, allocateQueueCounts, sumQueueCounts, type LocalCard } from '../db/database';
import { CardQueue } from '../types';
import { addToUpNext, flushUpNext, removeFromUpNext, reorderUpNext, replaceLocalUpNext } from './upNext';
import { addUpNextApi, removeUpNextApi, reorderUpNextApi, UpNextApiError } from '../api/upNext';
import { writeStudyBudget } from './studyBudget';

vi.mock('./analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../api/upNext', async (orig) => ({
  ...(await orig<typeof import('../api/upNext')>()),
  addUpNextApi: vi.fn(),
  reorderUpNextApi: vi.fn(),
  removeUpNextApi: vi.fn(),
  listUpNextApi: vi.fn(),
}));

const iso = () => new Date().toISOString();
const deckRow = (id: string, priority: number, cap: number) => ({
  id, user_id: 'u1', name: id, description: null, new_cards_per_day: cap, secondary_cards_per_day: 6, study_priority: priority,
  request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4,
  relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1,
  hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: iso(), updated_at: iso(), _synced_at: null,
});
const card = (id: string, noteId: string, deck: string, type = 'hanzi_to_meaning', queue = CardQueue.NEW): LocalCard => ({
  id, note_id: noteId, deck_id: deck, card_type: type, queue, stability: 0, difficulty: 0, lapses: 0,
  learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0,
  next_review_at: queue === CardQueue.REVIEW ? new Date(Date.now() + 9 * 86_400_000).toISOString() : null, due_timestamp: null,
  created_at: iso(), updated_at: iso(), _synced_at: null,
} as LocalCard);

async function seed() {
  // "top" is first in the deck queue; 银行 sits in a one-off copy (0 + 0) at the bottom.
  await db.decks.bulkPut([deckRow('top', 5, 3), deckRow('oneoff', 0, 0)] as never);
  await db.decks.update('oneoff', { secondary_cards_per_day: 0 });
  const notes: Array<[string, string, string]> = [['n-apple', '苹果', 'top'], ['n-pear', '梨', 'top'], ['n-bank', '银行', 'oneoff'], ['n-rice', '米饭', 'top']];
  for (const [id, hanzi, deck] of notes) {
    await db.notes.put({ id, deck_id: deck, hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  await db.cards.bulkPut([
    card('c-apple', 'n-apple', 'top'), card('c-pear', 'n-pear', 'top'),
    card('c-bank', 'n-bank', 'oneoff'), card('c-bank-m', 'n-bank', 'oneoff', 'meaning_to_hanzi'),
    card('c-rice', 'n-rice', 'top', 'hanzi_to_meaning', CardQueue.REVIEW),
  ]);
}

const homeCounts = async () => sumQueueCounts(allocateQueueCounts(await getRawQueueCounts(), 0).values());

describe('Up next on the device', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear(), db.upNext.clear(), db.upNextOps.clear()]);
    vi.mocked(addUpNextApi).mockReset();
    vi.mocked(reorderUpNextApi).mockReset();
    vi.mocked(removeUpNextApi).mockReset();
    await seed();
    writeStudyBudget({ new_cards_per_day: 1, secondary_cards_per_day: 0, is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
  });

  it('an Up next word takes the budget first — from a 0 + 0 deck too — and Home counts the same', async () => {
    expect((await getStudyQueue()).dueCards.map((c) => c.id)).toEqual(['c-apple']);
    const out = await addToUpNext(['n-bank'], { source: 'up_next_page' });
    expect(out.message).toBe('↑ 银行 is up next');
    const q = await getStudyQueue();
    expect(q.dueCards.map((c) => c.id)).toEqual(['c-bank']);
    expect(q.counts).toMatchObject({ new: 1, secondaryNew: 0 });
    expect(await homeCounts()).toMatchObject({ new: 1, secondaryNew: 0, hasMoreNew: true });
    // "Study more": the next ones come from the deck queue as usual.
    const more = await getStudyQueue(undefined, 2);
    expect(more.dueCards.map((c) => c.id)).toEqual(['c-bank', 'c-apple', 'c-pear']);
  });

  it('refuses a fully studied word, moves one already listed when a position is given', async () => {
    expect((await addToUpNext(['n-rice'], { source: 'deck' })).noNewCards).toEqual(['n-rice']);
    await addToUpNext(['n-apple', 'n-pear'], { source: 'search' });
    await addToUpNext(['n-bank'], { source: 'search', position: 'top' });
    expect((await db.upNext.orderBy('position').toArray()).map((r) => r.note_id)).toEqual(['n-bank', 'n-apple', 'n-pear']);
    expect((await addToUpNext(['n-pear'], { source: 'search', position: 0 })).message).toBe('Moved');
    expect((await db.upNext.orderBy('position').toArray()).map((r) => r.note_id)).toEqual(['n-pear', 'n-bank', 'n-apple']);
    expect((await getStudyQueue()).dueCards.map((c) => c.id)).toEqual(['c-pear']);
  });

  it('reorder / remove apply at once; a sync list waits while changes are pending', async () => {
    await addToUpNext(['n-apple', 'n-pear'], { source: 'search' });
    await reorderUpNext(['n-pear', 'n-apple'], 'drag');
    expect((await getStudyQueue()).dueCards.map((c) => c.id)).toEqual(['c-pear']);
    expect(await removeFromUpNext('n-pear')).toEqual({ index: 0 });
    expect((await db.upNext.toArray()).map((r) => r.note_id)).toEqual(['n-apple']);
    await replaceLocalUpNext([]);
    expect((await db.upNext.toArray()).map((r) => r.note_id)).toEqual(['n-apple']); // 3 changes waiting
    expect(await db.upNextOps.count()).toBe(3);
  });

  it('flush sends the changes in order, drops a refused one, then takes the server list', async () => {
    await addToUpNext(['n-apple'], { source: 'search' });
    await removeFromUpNext('n-apple');
    const server = { id: 's', note_id: 'n-pear', position: 0, created_at: iso(), source: 'tutor', added_by: 't', added_by_name: 'Minghui', hanzi: '梨', pinyin: '', english: '', deck_id: 'top', deck_name: 'top', status: 'new' as const, new_cards: 1, total_cards: 1 };
    vi.mocked(addUpNextApi).mockRejectedValueOnce(new UpNextApiError('nope', 404));
    vi.mocked(removeUpNextApi).mockResolvedValueOnce({ removed: 0, up_next: [server] });
    await flushUpNext();
    expect(addUpNextApi).toHaveBeenCalledTimes(1);
    expect(removeUpNextApi).toHaveBeenCalledWith('n-apple');
    expect(await db.upNextOps.count()).toBe(0);
    expect(await db.upNext.toArray()).toEqual([{ note_id: 'n-pear', id: 's', position: 0, created_at: server.created_at, source: 'tutor', added_by_name: 'Minghui' }]);
  });

  it('Home counts agree with the session over random lists, caps, budgets and bonuses', async () => {
    let seedN = 7;
    const rand = () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
    const HANZI = ['银行', '学生', '老师', '熊猫', '你好', '电脑', '手机', '工作', '我在银行工作。', '苹果'];
    for (let round = 0; round < 12; round++) {
      await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.upNext.clear(), db.upNextOps.clear()]);
      const decks = [deckRow('a', 3, Math.floor(rand() * 4)), deckRow('b', 1, Math.floor(rand() * 3)), deckRow('c', 0, 0)];
      await db.decks.bulkPut(decks as never);
      const noteIds: string[] = [];
      for (let n = 0; n < 12; n++) {
        const id = `r${n}`;
        const deck = decks[Math.floor(rand() * 3)].id;
        noteIds.push(id);
        await db.notes.put({ id, deck_id: deck, hanzi: HANZI[n % HANZI.length], pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
        const started = rand() < 0.3;
        await db.cards.bulkPut([
          card(`${id}-h`, id, deck, 'hanzi_to_meaning', started ? CardQueue.REVIEW : CardQueue.NEW),
          card(`${id}-m`, id, deck, 'meaning_to_hanzi'),
        ]);
      }
      writeStudyBudget({ new_cards_per_day: Math.floor(rand() * 5), secondary_cards_per_day: Math.floor(rand() * 4), is_default: false, set_by: null, set_by_name: null, set_at: null } as never);
      await addToUpNext(noteIds.filter(() => rand() < 0.4), { source: 'search' });
      for (const bonus of [0, 3]) {
        const q = await getStudyQueue(undefined, bonus);
        let fresh = 0;
        let purple = 0;
        for (const c of q.dueCards) {
          if (c.queue !== CardQueue.NEW) continue;
          if (q.reviewedNoteIds.has(c.note_id)) purple++;
          else fresh++;
        }
        expect({ round, bonus, new: q.counts.new, secondaryNew: q.counts.secondaryNew }).toEqual({ round, bonus, new: fresh, secondaryNew: purple });
      }
    }
  });

  it('a network failure keeps the change for later', async () => {
    await addToUpNext(['n-apple'], { source: 'search' });
    vi.mocked(addUpNextApi).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(flushUpNext()).rejects.toThrow();
    expect(await db.upNextOps.count()).toBe(1);
  });
});
