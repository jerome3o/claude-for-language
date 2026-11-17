import { describe, expect, it } from 'vitest';
import { explorerAddHint, explorerAddProblem, explorerAddPrompt, explorerAddStep } from './addCard';

const base = { hanzi: '吴侬软语', pinyin: '', english: '', devicePinyin: 'wú nóng ruǎn yǔ', online: true, glossed: false };

describe('explorerAddStep', () => {
  it('adds when the meaning is known, with the device reading when pinyin is missing', () => {
    expect(explorerAddStep({ ...base, english: ' soft  Wu dialect ' })).toEqual({ kind: 'add', hanzi: '吴侬软语', pinyin: 'wú nóng ruǎn yǔ', english: 'soft Wu dialect' });
    expect(explorerAddStep({ ...base, pinyin: 'wúnóngruǎnyǔ', english: 'x' })).toMatchObject({ kind: 'add', pinyin: 'wúnóngruǎnyǔ' });
  });

  it('asks the gloss path first when no meaning, then the fill sheet', () => {
    expect(explorerAddStep(base)).toEqual({ kind: 'gloss', hanzi: '吴侬软语', pinyin: 'wú nóng ruǎn yǔ' });
    expect(explorerAddStep({ ...base, glossed: true })).toEqual({ kind: 'fill', hanzi: '吴侬软语', pinyin: 'wú nóng ruǎn yǔ', english: '', reason: 'no_meaning' });
  });

  it('offline always opens the fill sheet, the meaning kept when known', () => {
    expect(explorerAddStep({ ...base, online: false })).toMatchObject({ kind: 'fill', reason: 'offline', english: '' });
    expect(explorerAddStep({ ...base, online: false, english: 'bank' })).toMatchObject({ kind: 'fill', reason: 'offline', english: 'bank' });
  });

  it('copy', () => {
    expect(explorerAddPrompt(' 银行 ')).toBe('What does 银行 mean?');
    expect(explorerAddHint('offline', false)).toContain('offline');
    expect(explorerAddHint('no_meaning', false)).toContain('Type what it means');
    expect(explorerAddProblem('  ', true)).toBe('Type what it means first.');
    expect(explorerAddProblem('bank', false)).toBe('Waiting for a connection…');
    expect(explorerAddProblem('bank', true)).toBeNull();
  });
});
