import { describe, it, expect } from 'vitest';
import { studyTodayHint, studyTodayKindOfRow, studyTodayMessage, studyTodayPlan, type StudyTodayInput } from './study-today';

const c = (card_type: string, queue = 0) => ({ card_type, queue });
const threeNew = [c('hanzi_to_meaning'), c('meaning_to_hanzi'), c('audio_to_hanzi')];
const input = (over: Partial<StudyTodayInput>): StudyTodayInput => ({
  cards: threeNew, started: false, hasAudio: true, longTermPref: null, deckInReview: true, ...over,
});

describe('studyTodayPlan — what ONE ⚡ tap puts in today, from anywhere', () => {
  it('an unstarted word with audio: only its listening card', () => {
    expect(studyTodayPlan(input({}))).toEqual({ kind: 'listening', cardTypes: ['audio_to_hanzi'], longTerm: undefined });
    expect(studyTodayPlan(input({ cards: [] })).cardTypes).toEqual(['audio_to_hanzi']);
  });

  it('an unstarted word without audio: its lead card (one card)', () => {
    expect(studyTodayPlan(input({ hasAudio: false }))).toEqual({ kind: 'lead', cardTypes: ['hanzi_to_meaning'], longTerm: undefined });
    expect(studyTodayPlan(input({ hasAudio: false, knownCharactersLead: () => true })).cardTypes).toEqual(['meaning_to_hanzi']);
  });

  it('"Start new words by ear": a word just added (its clip not made yet) still starts with its listening card', () => {
    // Regression (Nov 2026): a word added from an example sentence's "What's going on here?" breakdown was
    // bumped with its reading card — its clip is made in the background a few seconds after the add.
    expect(studyTodayPlan(input({ hasAudio: false, newWordsByEar: true }))).toEqual({ kind: 'listening', cardTypes: ['audio_to_hanzi'], longTerm: undefined });
    expect(studyTodayPlan(input({ cards: [], hasAudio: false, newWordsByEar: true })).cardTypes).toEqual(['audio_to_hanzi']);
    expect(studyTodayPlan(input({ hasAudio: false, newWordsByEar: true, knownCharactersLead: () => true })).cardTypes).toEqual(['audio_to_hanzi']);
    // The switch off keeps the old rule: no clip → the lead card.
    expect(studyTodayPlan(input({ hasAudio: false, newWordsByEar: false })).cardTypes).toEqual(['hanzi_to_meaning']);
    // A listening card already reviewed / missing: the lead card as before.
    expect(studyTodayPlan(input({ cards: [c('hanzi_to_meaning'), c('meaning_to_hanzi')], hasAudio: false, newWordsByEar: true })).cardTypes).toEqual(['hanzi_to_meaning']);
    // A started word without audio is unchanged (the whole note).
    expect(studyTodayPlan(input({ cards: [c('hanzi_to_meaning', 2), c('audio_to_hanzi', 0)], started: true, hasAudio: false, newWordsByEar: true })).kind).toBe('whole');
  });

  it('an unstarted word in a one-off deck goes into long-term review so its other cards come later', () => {
    expect(studyTodayPlan(input({ deckInReview: false })).longTerm).toBe(1);
  });

  it('a started word with a due listening card: only the listening card (it moves to the front)', () => {
    const cards = [c('hanzi_to_meaning', 2), c('meaning_to_hanzi', 2), c('audio_to_hanzi', 2)];
    expect(studyTodayPlan(input({ cards, started: true }))).toEqual({ kind: 'listening', cardTypes: ['audio_to_hanzi'], longTerm: undefined });
  });

  it('a started word whose listening card is not due / still NEW: still only the listening card', () => {
    expect(studyTodayPlan(input({ cards: [c('hanzi_to_meaning', 2), c('meaning_to_hanzi', 0), c('audio_to_hanzi', 0)], started: true })).cardTypes).toEqual(['audio_to_hanzi']);
    // Never touches the long-term choice of a started word.
    expect(studyTodayPlan(input({ cards: [c('hanzi_to_meaning', 2), c('audio_to_hanzi', 1)], started: true, deckInReview: false, longTermPref: 0 })).longTerm).toBeUndefined();
  });

  it('a started word with no listening card, or no audio: the whole-note bump', () => {
    expect(studyTodayPlan(input({ cards: [c('hanzi_to_meaning', 2), c('meaning_to_hanzi', 0)], started: true }))).toEqual({ kind: 'whole', cardTypes: null, longTerm: undefined });
    expect(studyTodayPlan(input({ cards: [c('hanzi_to_meaning', 2), c('audio_to_hanzi', 2)], started: true, hasAudio: false })).kind).toBe('whole');
  });

  it('hint: an unstarted word’s other cards come later; a started word’s keep their schedule', () => {
    expect(studyTodayHint('listening')).toMatch(/come later/);
    expect(studyTodayHint('listening', true)).toBe('');
    expect(studyTodayHint('whole')).toBe('');
    expect(studyTodayKindOfRow(['audio_to_hanzi'])).toBe('listening');
    expect(studyTodayKindOfRow(['hanzi_to_meaning'])).toBe('lead');
    expect(studyTodayKindOfRow(null)).toBe('whole');
  });

  it('the toast says what happened', () => {
    expect(studyTodayMessage([{ hanzi: '银行', kind: 'listening' }])).toBe('⚡ Listening card of 银行 added to today');
    expect(studyTodayMessage([{ hanzi: '银行', kind: 'listening' }, { hanzi: '学生', kind: 'listening' }])).toBe('⚡ Listening cards of 银行 and 学生 added to today');
    expect(studyTodayMessage([{ hanzi: '银行', kind: 'lead' }])).toBe('⚡ 1 card of 银行 added to today');
    expect(studyTodayMessage([{ hanzi: '银行', kind: 'whole' }])).toBe('⚡ 银行 will come first in today’s study');
    expect(studyTodayMessage([{ hanzi: '银行', kind: 'listening' }, { hanzi: '学生', kind: 'whole' }, { hanzi: '老师', kind: 'lead' }])).toBe('⚡ 银行, 学生 and 1 more added to today');
    expect(studyTodayMessage([], 2)).toBe('Already in today’s pocket ⚡');
  });
});
