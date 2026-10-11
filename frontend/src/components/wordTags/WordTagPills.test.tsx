/**
 * Word tags (web): the pills under the meaning render from the lexicon in the shared order, a tap
 * opens the explanation sheet (title, body, example, source) without reaching the card underneath
 * (no peek), "Got it" / Escape close it, Settings → Study switches them off live, and a word with
 * nothing to say renders nothing. AI word tags (notes.word_tags) add ✨ pills only where the
 * lexicon has nothing, low confidence never shows, and their sheet says so with the note.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseWordTagLexicon } from '@shared/cards/word-tags';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../services/analytics', () => analytics);

const LEXICON = parseWordTagLexicon(
  ['#words', '书\tn\t\t本:běn,册:cè\t1\t書', '睡觉\tv\t\t\t1\t睡覺\t睡了一个好觉', '您\tr\tP\t\t1', '告知\tv\t\t\t6', '打扰\tv\tP\t\t5', '#markers', '您\tP', '^请\tP', ''].join('\n'),
);
vi.mock('../../services/wordTags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/wordTags')>()),
  loadWordTagLexicon: () => Promise.resolve(LEXICON),
}));
vi.mock('../../services/wordFrequency', () => ({
  loadWordFrequency: () => Promise.resolve({ words: new Map([['睡觉', 900]]), chars: new Map([['书', 150]]) }),
}));

import { WordTagPills } from './WordTagPills';
import { writeWordTagsOn } from '../../services/wordTags';

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

describe('WordTagPills', () => {
  let host: HTMLDivElement;
  let root: Root;
  const parentClick = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    analytics.track.mockClear();
    parentClick.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
  });

  const render = async (hanzi: string, extra: Partial<Parameters<typeof WordTagPills>[0]> = {}) => {
    act(() =>
      root.render(
        <div onClick={parentClick}>
          <WordTagPills hanzi={hanzi} source="study" {...extra} />
        </div>,
      ),
    );
    await flush();
  };
  const pills = () => [...host.querySelectorAll('[data-testid="word-tags"] button')].map((b) => b.textContent);

  it('shows the tags in order: part of speech, measure word, HSK, how common, traditional', async () => {
    await render('书');
    expect(pills()).toEqual(['Noun', 'Measure: 本 běn, 册 cè', 'HSK 1', 'Top 1,000', 'Trad. 書']);
    const freq = host.querySelector('[data-tag="frequency"]')!;
    expect(freq.className).toContain('freq-decal--top1000');
  });

  it('a tap opens the explanation sheet — and never reaches the card (no peek)', async () => {
    await render('睡觉');
    expect(pills()).toContain('Separable verb');
    act(() => (host.querySelector('[data-tag="separable"]') as HTMLButtonElement).click());
    const sheet = document.querySelector('[data-testid="word-tag-sheet"]')!;
    expect(sheet.textContent).toContain('Separable verb 离合词');
    expect(sheet.textContent).toContain('睡了一个好觉');
    expect(sheet.textContent).toContain('Source: Curated list');
    expect(parentClick).not.toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledWith('study.word_tag_open', { kind: 'separable', tag: 'separable', source: 'study', tag_source: 'lexicon' });
    expect(sheet.querySelector('[data-testid="word-tag-sheet-ai"]')).toBeNull();

    act(() => (sheet.querySelector('.btn') as HTMLButtonElement).click());
    expect(document.querySelector('[data-testid="word-tag-sheet"]')).toBeNull();
  });

  it('the measure word sheet builds its example from the word; Escape closes it', async () => {
    await render('书');
    act(() => (host.querySelector('[data-tag="measure"]') as HTMLButtonElement).click());
    expect(document.querySelector('[data-testid="word-tag-sheet"]')!.textContent).toContain('一本书');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('[data-testid="word-tag-sheet"]')).toBeNull();
  });

  it('a sentence shows only the register words in it; nothing to say → nothing rendered', async () => {
    await render('请坐，您喝茶。');
    expect(pills()).toEqual(['Polite']);
    await render('我今天很忙。');
    expect(host.querySelector('[data-testid="word-tags"]')).toBeNull();
  });

  it('exclude leaves a kind out (the explorer has its own frequency chip)', async () => {
    await render('书', { exclude: ['frequency'] });
    expect(pills()).not.toContain('Top 1,000');
  });

  it('Settings → Study switches them off (and on) live', async () => {
    await render('书');
    expect(pills().length).toBeGreaterThan(0);
    act(() => writeWordTagsOn(false));
    expect(host.querySelector('[data-testid="word-tags"]')).toBeNull();
    act(() => writeWordTagsOn(true));
    expect(pills().length).toBeGreaterThan(0);
  });

  describe('AI word tags', () => {
    const verdict = JSON.stringify({ v: 1, transitivity: 'transitive', register: 'formal', register_note: 'formal written; in speech use 告诉', confidence: 'high' });

    it('adds ✨ transitivity and register pills where the lexicon has none', async () => {
      await render('告知', { aiTags: verdict });
      expect(pills()).toEqual(['Verb', '✨Takes an object', '✨Formal', 'HSK 6', 'Rare']);
      const ai = [...host.querySelectorAll('[data-ai="true"]')].map((b) => b.getAttribute('data-tag'));
      expect(ai).toEqual(['transitivity:transitive', 'register:F']);
      expect(host.querySelector('[data-tag="register:F"]')!.getAttribute('aria-label')).toBe('Formal (suggested by AI)');
    });

    it('the sheet says it is an AI suggestion and shows the register note', async () => {
      await render('告知', { aiTags: verdict });
      act(() => (host.querySelector('[data-tag="register:F"]') as HTMLButtonElement).click());
      const sheet = document.querySelector('[data-testid="word-tag-sheet"]')!;
      expect(sheet.querySelector('[data-testid="word-tag-sheet-ai"]')!.textContent).toContain('Suggested by AI — may be wrong');
      expect(sheet.querySelector('[data-testid="word-tag-sheet-note"]')!.textContent).toBe('formal written; in speech use 告诉');
      expect(analytics.track).toHaveBeenCalledWith('study.word_tag_open', { kind: 'register', tag: 'register:F', source: 'study', tag_source: 'ai' });
    });

    it('the lexicon wins: its register stays, no AI one', async () => {
      await render('打扰', { aiTags: JSON.stringify({ v: 1, register: 'informal', transitivity: 'transitive', confidence: 'high' }) });
      expect(pills()).toEqual(['Verb', '✨Takes an object', 'Polite', 'HSK 5', 'Rare']);
    });

    it('low confidence and junk show nothing extra', async () => {
      await render('告知', { aiTags: JSON.stringify({ v: 1, transitivity: 'transitive', register: 'formal', confidence: 'low' }) });
      expect(pills()).toEqual(['Verb', 'HSK 6', 'Rare']);
      await render('告知', { aiTags: 'not json' });
      expect(pills()).toEqual(['Verb', 'HSK 6', 'Rare']);
    });
  });
});
