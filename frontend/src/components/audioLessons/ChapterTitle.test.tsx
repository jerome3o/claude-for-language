/**
 * An audio lesson's chapter title: the pinyin of its Chinese part on its own line (the lesson's
 * words first, else automatic), a sleep title's own pinyin split off rather than doubled, nothing
 * for an English title, and hidden when 拼 is off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LessonWord } from '@shared/audio-lesson';
import { ChapterTitle } from './ChapterTitle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const words: LessonWord[] = [{ hanzi: '打扰了', pinyin: 'dǎrǎo le', english: 'sorry to bother you' }];

describe('ChapterTitle — pinyin under an audio lesson chapter', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (title: string, opts: { words?: LessonWord[]; pinyin?: boolean } = {}) =>
    act(() => root.render(<ChapterTitle chapter={{ title, start_ms: 0 }} words={opts.words ?? []} showPinyin={opts.pinyin ?? true} />));
  const label = () => host.querySelector('.al-chapter-label')?.textContent;
  const pinyin = () => host.querySelector('.al-chapter-pinyin')?.textContent ?? null;

  it('a taught word takes the lesson’s own pinyin', () => {
    render('打扰了 — sorry to bother you', { words });
    expect(label()).toBe('打扰了 — sorry to bother you');
    expect(pinyin()).toBe('dǎrǎo le');
  });

  it('without words data the pinyin is automatic', () => {
    render('打扰了 — sorry to bother you');
    expect(pinyin()).toBe('dǎ rǎo le');
    render('开始');
    expect(pinyin()).toBe('kāi shǐ');
  });

  it('a sleep chapter’s own pinyin moves to the pinyin line, never doubled', () => {
    render('自驾游 zìjiàyóu');
    expect(label()).toBe('自驾游');
    expect(pinyin()).toBe('zìjiàyóu');
    expect(host.textContent).toBe('自驾游zìjiàyóu');
  });

  it('an English title has no pinyin line', () => {
    render('First listen', { words });
    expect(label()).toBe('First listen');
    expect(pinyin()).toBeNull();
  });

  it('拼 off hides the pinyin', () => {
    render('打扰了 — sorry to bother you', { words, pinyin: false });
    expect(label()).toBe('打扰了 — sorry to bother you');
    expect(pinyin()).toBeNull();
    // A sleep title doesn't bring it back through the label either.
    render('自驾游 zìjiàyóu', { pinyin: false });
    expect(host.textContent).toBe('自驾游');
  });
});
