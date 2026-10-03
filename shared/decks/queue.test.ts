import { describe, it, expect } from 'vitest';
import { moveInOrder, isQueueMove, decksInQueueOrder, defaultPickerDeckId } from './queue';

describe('moveInOrder', () => {
  const q = ['a', 'b', 'c', 'd'];

  it('moves to the top and bottom', () => {
    expect(moveInOrder(q, 'c', 'top')).toEqual(['c', 'a', 'b', 'd']);
    expect(moveInOrder(q, 'b', 'bottom')).toEqual(['a', 'c', 'd', 'b']);
  });

  it('nudges one step', () => {
    expect(moveInOrder(q, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveInOrder(q, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns the same array when nothing changes', () => {
    expect(moveInOrder(q, 'a', 'top')).toBe(q);
    expect(moveInOrder(q, 'a', 'up')).toBe(q);
    expect(moveInOrder(q, 'd', 'bottom')).toBe(q);
    expect(moveInOrder(q, 'd', 'down')).toBe(q);
    expect(moveInOrder(q, 'zzz', 'top')).toBe(q);
  });

  it('validates a move name', () => {
    expect(isQueueMove('up')).toBe(true);
    expect(isQueueMove('sideways')).toBe(false);
    expect(isQueueMove(3)).toBe(false);
  });
});

describe('add-card deck pickers', () => {
  const decks = [
    { id: 'hsk', name: 'HSK 3', study_priority: 0, created_at: '2026-01-01 10:00:00' },
    { id: 'homework', name: 'Homework 第八课', study_priority: 5, created_at: '2026-03-01 10:00:00' },
    { id: 'chats', name: 'From my chats', study_priority: 0, created_at: '2026-02-01 10:00:00' },
    { id: 'starter', name: 'Starter Chinese', study_priority: 5, created_at: '2025-12-01 10:00:00' },
    { id: 'old', name: 'Old', study_priority: -2, created_at: '2026-09-01 10:00:00' },
  ];

  it('lists decks in queue order: priority first, ties newest first', () => {
    expect(decksInQueueOrder(decks).map((d) => d.id)).toEqual(['homework', 'starter', 'chats', 'hsk', 'old']);
  });

  it('defaults to the top of the queue, not the first alphabetically', () => {
    expect(defaultPickerDeckId(decks)).toBe('homework');
  });

  it('treats a missing priority as 0 and a missing date as oldest', () => {
    expect(defaultPickerDeckId([{ id: 'a' }, { id: 'b', created_at: '2026-01-01' }])).toBe('b');
    expect(defaultPickerDeckId([{ id: 'a', study_priority: null }, { id: 'b', study_priority: 1 }])).toBe('b');
  });

  it('keeps a preferred deck only while it exists', () => {
    expect(defaultPickerDeckId(decks, 'hsk')).toBe('hsk');
    expect(defaultPickerDeckId(decks, 'deleted')).toBe('homework');
    expect(defaultPickerDeckId(decks, '')).toBe('homework');
    expect(defaultPickerDeckId(decks, null)).toBe('homework');
  });

  it('is empty with no decks (the picker offers a new deck)', () => {
    expect(defaultPickerDeckId([])).toBe('');
  });

  it('does not reorder its input', () => {
    const copy = [...decks];
    decksInQueueOrder(decks);
    expect(decks).toEqual(copy);
  });
});
