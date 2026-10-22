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
  ['#words', '书\tn\t\t本:běn,册:cè\t1\t書', '睡觉\tv\t\t\t1\t睡覺\t睡了一个好觉', '您\tr\tP\t\t1', '告知\tv\t\t\t6', '打扰\tv\tP\t\t5', '结账\tv\t\t\t\t\t结了账', '#markers', '您\tP', '^请\tP', ''].join('\n'),
);
vi.mock('../../services/wordTags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/wordTags')>()),
  loadWordTagLexicon: () => Promise.resolve(LEXICON),
}));
vi.mock('../../services/wordFrequency', () => ({
  loadWordFrequency: () => Promise.resolve({ words: new Map([['睡觉', 900]]), chars: new Map([['书', 150]]) }),
}));

// The device segmenter (services/chineseSegmenter): a tiny greedy stand-in over a few words.
const SEG_WORDS = ['人品', '脾气', '告诉', '见面', '睡觉'];
vi.mock('../../services/chineseSegmenter', () => ({
  useSegmentedWords: (text: string, enabled = true) => {
    if (!enabled) return null;
    const out: Array<{ text: string; pinyin: string; gloss: string }> = [];
    let plain = '';
    for (let i = 0; i < text.length; ) {
      const w = SEG_WORDS.find((x) => text.startsWith(x, i));
      const han = /[\u4e00-\u9fff]/.test(text[i]);
      if (w || han) {
        if (plain) out.push({ text: plain, pinyin: '', gloss: '' });
        plain = '';
        const t = w ?? text[i];
        out.push({ text: t, pinyin: '', gloss: '' });
        i += t.length;
      } else plain += text[i++];
    }
    if (plain) out.push({ text: plain, pinyin: '', gloss: '' });
    return out;
  },
}));

// The app's explorer: open / push recorded; `inside` = the pills sit in the explorer's Word view.
const explorer = vi.hoisted(() => ({ open: vi.fn(), push: vi.fn(), inside: false }));
vi.mock('../explorer/ExplorerContext', () => ({ useExplorer: () => explorer }));

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
    explorer.open.mockClear();
    explorer.push.mockClear();
    explorer.inside = false;
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
      // An HSK word is never "Rare", however low the frequency list ranks it.
      expect(pills()).toEqual(['Verb', '✨Takes an object', '✨Formal', 'HSK 6']);
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
      expect(pills()).toEqual(['Verb', '✨Takes an object', 'Polite', 'HSK 5']);
    });

    it('low confidence and junk show nothing extra', async () => {
      await render('告知', { aiTags: JSON.stringify({ v: 1, transitivity: 'transitive', register: 'formal', confidence: 'low' }) });
      expect(pills()).toEqual(['Verb', 'HSK 6']);
      await render('告知', { aiTags: 'not json' });
      expect(pills()).toEqual(['Verb', 'HSK 6']);
    });

    it('Everyday speech replaces "Rare" (结账: not HSK, ranked low by written text), with its own sheet', async () => {
      await render('结账');
      expect(pills()).toEqual(['Verb', 'Separable verb', 'Rare']);
      const everyday = JSON.stringify({ v: 2, transitivity: 'intransitive', register: 'neutral', spoken: 'everyday', spoken_confidence: 'high', confidence: 'high' });
      await render('结账', { aiTags: everyday });
      expect(pills()).toEqual(['Verb', 'Separable verb', '✨No object', '✨Everyday speech']);
      act(() => (host.querySelector('[data-tag="spoken:everyday"]') as HTMLButtonElement).click());
      const sheet = document.querySelector('[data-testid="word-tag-sheet"]')!;
      expect(sheet.textContent).toContain('Everyday speech');
      expect(sheet.textContent).toContain('daily life');
      expect(sheet.querySelector('[data-testid="word-tag-sheet-ai"]')!.textContent).toContain('Suggested by AI — may be wrong');
      expect(analytics.track).toHaveBeenCalledWith('study.word_tag_open', { kind: 'spoken', tag: 'spoken:everyday', source: 'study', tag_source: 'ai' });
    });

    it('Everyday speech at medium confidence changes nothing', async () => {
      await render('结账', { aiTags: JSON.stringify({ v: 2, spoken: 'everyday', spoken_confidence: 'medium', confidence: 'low' }) });
      expect(pills()).toEqual(['Verb', 'Separable verb', 'Rare']);
    });
  });

  describe('Chinese in the sheet opens the explorer', () => {
    const verdict = JSON.stringify({ v: 1, register: 'formal', register_note: 'Formal/literary; use 人品 or 脾气 in casual speech', confidence: 'high' });
    const openFormal = async () => {
      await render('告知', { aiTags: verdict });
      act(() => (host.querySelector('[data-tag="register:F"]') as HTMLButtonElement).click());
      return document.querySelector('[data-testid="word-tag-sheet"]')!;
    };
    const tapWord = (sheet: Element, word: string) => {
      const piece = [...sheet.querySelectorAll('[data-testid="word-tag-sheet-note"] .xt-tap')].find((el) => el.textContent === word);
      expect(piece, word).toBeTruthy();
      act(() => (piece as HTMLElement).click());
    };

    it('the register note is tappable by WORD (人品, 脾气), the English stays plain', async () => {
      const sheet = await openFormal();
      const taps = [...sheet.querySelectorAll('[data-testid="word-tag-sheet-note"] .xt-tap')].map((el) => el.textContent);
      expect(taps).toEqual(['人品', '脾气']);
      expect(sheet.querySelector('[data-testid="word-tag-sheet-note"]')!.textContent).toBe('Formal/literary; use 人品 or 脾气 in casual speech');
      expect(sheet.querySelector('[data-testid="word-tag-sheet-hint"]')).not.toBeNull();
    });

    it('a tap opens the explorer on the word, the sheet steps aside and comes back when it closes', async () => {
      const sheet = await openFormal();
      tapWord(sheet, '人品');
      expect(explorer.open).toHaveBeenCalledTimes(1);
      const [item, opts] = explorer.open.mock.calls[0];
      expect(item).toMatchObject({ kind: 'word', hanzi: '人品' });
      expect(opts.source).toBe('word_tag');
      expect(document.querySelector('[data-testid="word-tag-sheet"]')).toBeNull();
      expect(analytics.track).toHaveBeenCalledWith('study.word_tag_word', { kind: 'register', tag_source: 'ai', item: 'word', inside: false });
      expect(parentClick).not.toHaveBeenCalled();
      // ✕ / back in the explorer → the Formal sheet again, ready for 脾气.
      act(() => opts.onClosed());
      const again = document.querySelector('[data-testid="word-tag-sheet"]')!;
      expect(again.textContent).toContain('Formal/literary; use 人品 or 脾气');
      tapWord(again, '脾气');
      expect(explorer.open.mock.calls[1][0]).toMatchObject({ kind: 'word', hanzi: '脾气' });
    });

    it('inside the explorer (the Word view pills) a tap pushes, and the sheet stays closed', async () => {
      explorer.inside = true;
      const sheet = await openFormal();
      tapWord(sheet, '脾气');
      expect(explorer.push).toHaveBeenCalledWith(expect.objectContaining({ kind: 'word', hanzi: '脾气' }));
      expect(explorer.open).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid="word-tag-sheet"]')).toBeNull();
      expect(analytics.track).toHaveBeenCalledWith('study.word_tag_word', { kind: 'register', tag_source: 'ai', item: 'word', inside: true });
    });

    it('a lexicon sheet too: the separable example and the title (离合词)', async () => {
      await render('睡觉');
      act(() => (host.querySelector('[data-tag="separable"]') as HTMLButtonElement).click());
      const sheet = document.querySelector('[data-testid="word-tag-sheet"]')!;
      const example = [...sheet.querySelectorAll('[data-testid="word-tag-sheet-example"] .xt-tap')].map((el) => el.textContent);
      expect(example.join('')).toBe('睡了一个好觉');
      expect([...sheet.querySelectorAll('h2 .xt-tap')].length).toBeGreaterThan(0);
      act(() => (sheet.querySelector('[data-testid="word-tag-sheet-example"] .xt-tap') as HTMLElement).click());
      expect(explorer.open.mock.calls[0][0]).toMatchObject({ kind: 'char', char: '睡' });
    });

    it('a sheet with no Chinese has no hint', async () => {
      await render('书');
      act(() => (host.querySelector('[data-tag="hsk"]') as HTMLButtonElement).click());
      expect(document.querySelector('[data-testid="word-tag-sheet-hint"]')).toBeNull();
    });
  });
});
