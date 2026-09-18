import { describe, it, expect } from 'vitest';
import { CardQueue } from '../../types';
import { pickHomework, summarizeHomeworkDeck, describeDeckProgress, stripFromTutorSuffix } from './homework';

const wang = { relationshipId: 'rel-wang', tutorId: 'wang', tutorName: 'Wang Laoshi' };
const li = { relationshipId: 'rel-li', tutorId: 'li', tutorName: 'Li Laoshi' };

const base = {
  tutors: [wang],
  sharedDecks: [],
  lessons: [],
  unreadMessages: [],
  localDecks: new Map<string, string>(),
};

describe('pickHomework', () => {
  it('returns null without tutors or without anything sent', () => {
    expect(pickHomework({ ...base, tutors: [] })).toBeNull();
    expect(pickHomework(base)).toBeNull();
  });

  it('surfaces a shared deck that exists locally, without the "(from tutor)" suffix', () => {
    const pick = pickHomework({
      ...base,
      sharedDecks: [{ relationshipId: 'rel-wang', targetDeckId: 'd1', sharedAt: '2026-09-10T00:00:00Z' }],
      localDecks: new Map([['d1', '第三周作业：天气 (from tutor)']]),
    });
    expect(pick).toEqual({
      tutorName: 'Wang Laoshi',
      relationshipId: 'rel-wang',
      item: { kind: 'deck', deckId: 'd1', name: '第三周作业：天气', sentAt: '2026-09-10T00:00:00Z' },
      unreadMessage: null,
    });
  });

  it('skips shared decks that are not in the local cache (deleted or not synced)', () => {
    const pick = pickHomework({
      ...base,
      sharedDecks: [{ relationshipId: 'rel-wang', targetDeckId: 'gone', sharedAt: '2026-09-10T00:00:00Z' }],
    });
    expect(pick).toBeNull();
  });

  it('prefers the newest item across decks and lessons', () => {
    const pick = pickHomework({
      ...base,
      sharedDecks: [{ relationshipId: 'rel-wang', targetDeckId: 'd1', sharedAt: '2026-09-01T00:00:00Z' }],
      lessons: [{ id: 'l1', title: '把字句', assignedBy: 'wang', assignedRelationshipId: null, createdAt: '2026-09-12T00:00:00Z', status: 'active' }],
      localDecks: new Map([['d1', 'Old deck']]),
    });
    expect(pick?.item).toEqual({ kind: 'lesson', lessonId: 'l1', title: '把字句', sentAt: '2026-09-12T00:00:00Z' });
  });

  it('ignores lessons the student wrote themselves, completed ones, and strangers', () => {
    const pick = pickHomework({
      ...base,
      lessons: [
        { id: 'own', title: 'Mine', assignedBy: null, assignedRelationshipId: null, createdAt: '2026-09-20T00:00:00Z', status: 'active' },
        { id: 'done', title: 'Done', assignedBy: 'wang', assignedRelationshipId: null, createdAt: '2026-09-19T00:00:00Z', status: 'done' },
        { id: 'other', title: 'Other', assignedBy: 'someone', assignedRelationshipId: 'rel-x', createdAt: '2026-09-18T00:00:00Z', status: 'active' },
      ],
    });
    expect(pick).toBeNull();
  });

  it('shows an unread tutor message even with nothing else sent, and only for that tutor', () => {
    const pick = pickHomework({
      ...base,
      tutors: [wang, li],
      unreadMessages: [
        { conversationId: 'c-old', relationshipId: 'rel-wang', text: 'old', createdAt: '2026-09-01T00:00:00Z' },
        { conversationId: 'c-new', relationshipId: 'rel-wang', text: '谢谢老师', createdAt: '2026-09-15T00:00:00Z' },
        { conversationId: 'c-x', relationshipId: 'rel-nobody', text: 'x', createdAt: '2026-09-16T00:00:00Z' },
      ],
    });
    expect(pick?.tutorName).toBe('Wang Laoshi');
    expect(pick?.item).toBeNull();
    expect(pick?.unreadMessage?.conversationId).toBe('c-new');
  });

  it('does not attach another tutor\'s message to this tutor\'s homework', () => {
    const pick = pickHomework({
      ...base,
      tutors: [wang, li],
      sharedDecks: [{ relationshipId: 'rel-wang', targetDeckId: 'd1', sharedAt: '2026-09-10T00:00:00Z' }],
      localDecks: new Map([['d1', 'Deck']]),
      unreadMessages: [{ conversationId: 'c-li', relationshipId: 'rel-li', text: 'hi', createdAt: '2026-09-15T00:00:00Z' }],
    });
    expect(pick?.tutorName).toBe('Wang Laoshi');
    expect(pick?.unreadMessage).toBeNull();
  });
});

describe('summarizeHomeworkDeck / describeDeckProgress', () => {
  const notes = [
    { id: 'n1', hanzi: '刮风' },
    { id: 'n2', hanzi: '晴天' },
    { id: 'n3', hanzi: '下雨' },
  ];
  const cards = [
    { id: 'c1', note_id: 'n1', queue: CardQueue.LEARNING },
    { id: 'c2', note_id: 'n1', queue: CardQueue.NEW },
    { id: 'c3', note_id: 'n2', queue: CardQueue.REVIEW },
    { id: 'c4', note_id: 'n2', queue: CardQueue.NEW },
    { id: 'c5', note_id: 'n3', queue: CardQueue.NEW },
    { id: 'c6', note_id: 'n3', queue: CardQueue.NEW },
  ];

  it('counts started cards and ranks words by Again ratings', () => {
    const events = [
      { card_id: 'c1', rating: 0 },
      { card_id: 'c1', rating: 0 },
      { card_id: 'c3', rating: 0 },
      { card_id: 'c3', rating: 2 },
      { card_id: 'c5', rating: 2 },
      { card_id: 'unknown', rating: 0 },
    ];
    const summary = summarizeHomeworkDeck(cards, notes, events);
    expect(summary).toEqual({ total: 6, started: 2, needWork: ['刮风', '晴天'] });
    expect(describeDeckProgress(summary)).toBe('2 of 6 cards started · 刮风 and 晴天 need work');
  });

  it('describes the edge cases in words', () => {
    expect(describeDeckProgress({ total: 6, started: 0, needWork: [] })).toBe('Not started yet · 6 cards');
    expect(describeDeckProgress({ total: 6, started: 6, needWork: ['下雨'] })).toBe('All 6 cards started · 下雨 needs work');
    expect(describeDeckProgress({ total: 0, started: 0, needWork: [] })).toBe('No cards yet');
    expect(describeDeckProgress({ total: 1, started: 0, needWork: [] })).toBe('Not started yet · 1 card');
  });

  it('strips the "(from tutor)" suffix only', () => {
    expect(stripFromTutorSuffix('HSK 1 (from tutor)')).toBe('HSK 1');
    expect(stripFromTutorSuffix('HSK 1')).toBe('HSK 1');
    expect(stripFromTutorSuffix('(from tutor)')).toBe('(from tutor)');
  });
});
