import { describe, expect, it } from 'vitest';
import {
  missingSiblingLine,
  missingSiblingTypes,
  nextInLabel,
  siblingBumpedMessage,
  siblingStrength,
  siblingTile,
  siblingTileLabel,
  siblingTiles,
  type SiblingCardInput,
  type SiblingContext,
} from './sibling-status';
import { studyCutoffMs, studyDayAt } from '../study/studyDay';

const DAY = 86_400_000;
const H = 3_600_000;
const ZONE = 'Europe/London';
// 00:44 on 18 Nov 2026 in London: still the study day of 17 Nov (rollover 4 am).
const NOW = Date.parse('2026-11-18T00:44:00Z');
const DAY_17 = studyDayAt(NOW, 4, ZONE);
const CUTOFF = studyCutoffMs(NOW, DAY_17);
const ctx = (extra: Partial<SiblingContext> = {}): SiblingContext => ({ cutoffMs: CUTOFF, today: DAY_17.key, ...extra });
const card = (extra: Partial<SiblingCardInput>): SiblingCardInput => ({
  id: 'c1', card_type: 'meaning_to_hanzi', queue: 0, due_ms: null, stability: 0, lapses: 0, ...extra,
});

describe('the study day at 00:44', () => {
  it('is still yesterday, its cutoff 4 am today', () => {
    expect(DAY_17.key).toBe('2026-11-17');
    expect(new Date(CUTOFF).toISOString()).toBe('2026-11-18T03:59:59.999Z');
  });

  it('a review due at 02:00 is due today; one due at 05:00 is next in 1d', () => {
    const at2 = siblingTile(card({ queue: 2, stability: 30, due_ms: Date.parse('2026-11-18T02:00:00Z') }), ctx());
    expect(at2.status).toBe('due');
    expect(at2.line).toBe('Due today');
    expect(at2.bump).toBeNull();
    expect(at2.bump_note).toBe('Already due today');
    const at5 = siblingTile(card({ queue: 2, stability: 30, due_ms: Date.parse('2026-11-18T05:00:00Z') }), ctx());
    expect(at5.status).toBe('known');
    expect(at5.line).toBe('Known · next in 1d');
    expect(at5.bump).toBe('early');
  });
});

describe('siblingTile — every status', () => {
  it('not started', () => {
    const t = siblingTile(card({}), ctx());
    expect([t.status, t.line, t.strength, t.tone, t.bump, t.bump_note, t.can_forget]).toEqual(['not_started', 'Not started', 0, 'neutral', 'add', null, false]);
    expect([t.symbol, t.name, t.detail]).toEqual(['写', 'Write', 'English → 汉字']);
  });

  it('new, in today’s queue', () => {
    const t = siblingTile(card({}), ctx({ inToday: new Set(['c1']) }));
    expect([t.status, t.line, t.bump, t.bump_note]).toEqual(['new_today', 'New · in today’s queue', null, 'Already in today’s study']);
  });

  it('learning, due today or later', () => {
    const due = siblingTile(card({ queue: 1, due_ms: NOW + 10 * 60_000 }), ctx());
    expect([due.status, due.line, due.strength, due.bump]).toEqual(['learning', 'Learning · due today', 1, null]);
    const later = siblingTile(card({ queue: 3, due_ms: CUTOFF + 2 * DAY + H }), ctx());
    expect([later.line, later.bump, later.can_forget]).toEqual(['Learning · next in 3d', 'early', true]);
  });

  it('due today (and a review with no due date)', () => {
    expect(siblingTile(card({ queue: 2, stability: 4, due_ms: null }), ctx()).line).toBe('Due today');
    const bumped = siblingTile(card({ queue: 2, stability: 4, due_ms: CUTOFF + 5 * DAY }), ctx({ inToday: new Set(['c1']) }));
    expect([bumped.status, bumped.line]).toEqual(['due', '⚡ In today’s study']);
  });

  it('review vs known (stability > 21 days)', () => {
    const review = siblingTile(card({ queue: 2, stability: 12, due_ms: CUTOFF + 11 * DAY + H }), ctx());
    expect([review.status, review.line, review.strength, review.tone]).toEqual(['review', 'Review · next in 12d', 2, 'neutral']);
    const known = siblingTile(card({ queue: 2, stability: 80, due_ms: CUTOFF + 90 * DAY }), ctx());
    expect([known.status, known.line, known.strength, known.tone]).toEqual(['known', 'Known · next in 3mo', 3, 'known']);
  });

  it('suspended / snoozed win over everything', () => {
    const sus = siblingTile(card({ queue: 2, stability: 80, due_ms: CUTOFF + 90 * DAY }), ctx({ holds: new Map([['c1', { kind: 'suspend', until: null }]]) }));
    expect([sus.status, sus.line, sus.tone, sus.release, sus.bump, sus.bump_note, sus.strength]).toEqual(
      ['suspended', 'Suspended', 'held', 'unsuspend', null, 'Suspended — unsuspend it first', 3]);
    const snz = siblingTile(card({}), ctx({ holds: new Map([['c1', { kind: 'snooze', until: '2026-11-25' }]]) }));
    expect([snz.status, snz.line, snz.release, snz.bump_note]).toEqual(['snoozed', 'Snoozed until 25 Nov', 'wake', 'Snoozed — wake it first']);
    // A snooze that ended is no hold.
    const over = siblingTile(card({}), ctx({ holds: new Map([['c1', { kind: 'snooze', until: '2026-11-17' }]]) }));
    expect(over.status).toBe('not_started');
  });

  it('a leech (8+ lapses) says so', () => {
    const t = siblingTile(card({ queue: 2, stability: 2, lapses: 9, due_ms: CUTOFF + 3 * DAY }), ctx());
    expect([t.status, t.line, t.tone, t.bump]).toEqual(['leech', 'Leech · missed 9×', 'leech', 'early']);
    // 7 lapses: not yet.
    expect(siblingTile(card({ queue: 2, stability: 2, lapses: 7, due_ms: CUTOFF + 3 * DAY }), ctx()).status).toBe('review');
  });

  it('no ⚡ where the card belongs to a homework pass', () => {
    const t = siblingTile(card({}), ctx({ canBump: false }));
    expect([t.bump, t.bump_note]).toEqual([null, null]);
  });
});

describe('siblingTiles', () => {
  it('the OTHER cards in read · write · listen order', () => {
    const cards = [
      card({ id: 'a', card_type: 'audio_to_hanzi' }),
      card({ id: 'h', card_type: 'hanzi_to_meaning', queue: 2, stability: 30, due_ms: CUTOFF + 40 * DAY }),
      card({ id: 'm', card_type: 'meaning_to_hanzi' }),
    ];
    expect(siblingTiles(cards, 'h', ctx()).map(t => [t.card_id, t.symbol])).toEqual([['m', '写'], ['a', '听']]);
    expect(siblingTiles(cards, 'a', ctx()).map(t => t.name)).toEqual(['Read', 'Write']);
  });

  it('a word with no audio has no listening card', () => {
    expect(missingSiblingTypes(['hanzi_to_meaning', 'meaning_to_hanzi'], 'hanzi_to_meaning')).toEqual(['audio_to_hanzi']);
    expect(missingSiblingTypes(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'], 'audio_to_hanzi')).toEqual([]);
    expect(missingSiblingLine('audio_to_hanzi')).toBe('No listening card (no audio)');
  });
});

describe('helpers', () => {
  it('strength = the mastery tier', () => {
    expect([siblingStrength(0, 50), siblingStrength(1, 50), siblingStrength(3, 50), siblingStrength(2, 7), siblingStrength(2, 21), siblingStrength(2, 21.5), siblingStrength(2, null)]).toEqual([0, 1, 1, 1, 2, 3, 1]);
  });

  it('next-in labels', () => {
    expect(nextInLabel(CUTOFF - 5, CUTOFF)).toBe('1d');
    expect(nextInLabel(CUTOFF + 59 * DAY, CUTOFF)).toBe('59d');
    expect(nextInLabel(CUTOFF + 60 * DAY, CUTOFF)).toBe('2mo');
    expect(nextInLabel(CUTOFF + 400 * DAY, CUTOFF)).toBe('1y');
  });

  it('copy', () => {
    expect(siblingBumpedMessage({ detail: 'English → 汉字' }, true)).toBe('⚡ English → 汉字 comes up in a few cards');
    expect(siblingBumpedMessage({ detail: 'Listen → 汉字' }, false)).toBe('⚡ Listen → 汉字 added to today');
    expect(siblingTileLabel({ symbol: '写', name: 'Write', line: 'Not started', strength: 0 })).toBe('Write card (写): Not started. Strength 0 of 3.');
  });
});
