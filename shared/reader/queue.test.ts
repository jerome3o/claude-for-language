import { describe, expect, it } from 'vitest';
import {
  bottomQueuePriority,
  compareReaderQueue,
  isReaderQueuePlacement,
  mergeReaderOrder,
  moveReaderInQueue,
  queuePositions,
  queuePriorities,
  sortReadersForQueue,
  type ReaderQueueRow,
} from './queue';
import { nextUnreadReader, unreadReaderQueue, type ReaderOfferRow } from '../study/daily-reader';

const r = (id: string, created_at: string, queue_priority: number | null = null): ReaderQueueRow => ({ id, created_at, queue_priority });
const ids = (rows: ReaderQueueRow[]) => rows.map(x => x.id);

describe('reader queue order', () => {
  it('without priorities: newest first, ties by id (today\'s rule, unchanged)', () => {
    const rows = [r('b', '2026-10-01'), r('c', '2026-10-03'), r('a', '2026-10-01')];
    expect(ids(sortReadersForQueue(rows))).toEqual(['c', 'a', 'b']);
  });

  it('readers never placed by hand come first; placed ones by priority, high first', () => {
    const rows = [r('old', '2026-09-01', 1), r('top', '2026-09-02', 3), r('new', '2026-10-20'), r('mid', '2026-10-01', 2)];
    expect(ids(sortReadersForQueue(rows))).toEqual(['new', 'top', 'mid', 'old']);
  });

  it('equal priorities fall back to newest first', () => {
    expect(compareReaderQueue(r('a', '2026-10-01', 1), r('b', '2026-10-02', 1))).toBeGreaterThan(0);
    expect(compareReaderQueue(r('a', '2026-10-01', 1), r('a', '2026-10-01', 1))).toBe(0);
  });

  it('a written order is exactly reproduced by its priorities', () => {
    const order = ['x', 'y', 'z'];
    const pr = queuePriorities(order);
    expect(pr).toEqual([{ id: 'x', queue_priority: 3 }, { id: 'y', queue_priority: 2 }, { id: 'z', queue_priority: 1 }]);
    const rows = pr.map(p => r(p.id, p.id === 'z' ? '2026-12-01' : '2026-01-01', p.queue_priority));
    expect(ids(sortReadersForQueue(rows))).toEqual(order);
  });

  it('a new story at the bottom sits below everything placed', () => {
    expect(bottomQueuePriority([])).toBe(-1);
    expect(bottomQueuePriority([null, 3, 1])).toBe(-1);
    expect(bottomQueuePriority([2, -4, null])).toBe(-5);
    const rows = [r('a', '2026-10-01', 2), r('b', '2026-10-02', 1), r('new', '2026-10-25', bottomQueuePriority([2, 1]))];
    expect(ids(sortReadersForQueue(rows))).toEqual(['a', 'b', 'new']);
  });

  it('placements', () => {
    expect(isReaderQueuePlacement('top')).toBe(true);
    expect(isReaderQueuePlacement('bottom')).toBe(true);
    expect(isReaderQueuePlacement('up')).toBe(false);
  });

  it('merge a requested order into the queue', () => {
    expect(mergeReaderOrder(['a', 'b', 'c', 'd'], ['c', 'zz', 'a', 'c'])).toEqual(['c', 'a', 'b', 'd']);
    expect(mergeReaderOrder(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('moves: top / up / down / bottom and a 1-based place', () => {
    const q = ['a', 'b', 'c', 'd'];
    expect(moveReaderInQueue(q, 'c', 'top')).toEqual(['c', 'a', 'b', 'd']);
    expect(moveReaderInQueue(q, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveReaderInQueue(q, 'a', 'down')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveReaderInQueue(q, 'a', 'bottom')).toEqual(['b', 'c', 'd', 'a']);
    expect(moveReaderInQueue(q, 'd', 2)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveReaderInQueue(q, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveReaderInQueue(q, 'b', 0)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveReaderInQueue(q, 'a', 'top')).toBe(q);
    expect(moveReaderInQueue(q, 'nope', 'top')).toBe(q);
  });

  it('positions are 1-based', () => {
    expect(queuePositions(['a', 'b']).get('b')).toBe(2);
  });
});

describe('the session follows the queue', () => {
  const o = (id: string, created_at: string, queue_priority: number | null, over: Partial<ReaderOfferRow> = {}): ReaderOfferRow =>
    ({ id, created_at, queue_priority, studyable: true, read: false, ...over });

  it('offers the first unread story in queue order, not simply the newest', () => {
    const readers = [o('newest', '2026-10-20', 1), o('chosen', '2026-09-01', 2), o('read', '2026-09-02', 3, { read: true })];
    expect(nextUnreadReader(readers)?.id).toBe('chosen');
    expect(unreadReaderQueue(readers).map(x => x.id)).toEqual(['chosen', 'newest']);
  });

  it('a story created after a reorder lands on top', () => {
    const readers = [o('a', '2026-09-01', 2), o('b', '2026-09-02', 1), o('fresh', '2026-10-25', null)];
    expect(nextUnreadReader(readers)?.id).toBe('fresh');
  });

  it('not-yet-ready stories are not in the queue', () => {
    const readers = [o('gen', '2026-10-25', null, { studyable: false }), o('a', '2026-09-01', null)];
    expect(unreadReaderQueue(readers).map(x => x.id)).toEqual(['a']);
  });
});
