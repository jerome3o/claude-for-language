import { describe, it, expect, beforeEach } from 'vitest';
import { isPeekTap, PEEK_MAX_MOVE_PX, PEEK_MAX_PRESS_MS } from './peekFlip';

/** A card back shaped like StudyPage's: empty space, plain text, and things with their own taps. */
function buildCard(): HTMLElement {
  document.body.innerHTML = `
    <div id="card" class="study-card-content">
      <div class="study-card-main study-card-main--back" id="back">
        <div class="hanzi hanzi-large"><span class="hanzi-char-clickable" id="char">打</span></div>
        <div class="answer-diff" id="diff"><div class="answer-diff-row" id="diff-row"></div></div>
        <div class="pinyin" id="pinyin">dǎsuàn</div>
        <div class="study-back-pills"><button id="play"><span id="play-icon">🔊</span> Play</button></div>
        <div class="study-fun-fact"><p id="fact">打 to hit</p><a href="#" id="link">more</a></div>
        <div class="study-tutor-notes"><p id="note">Second syllable is fourth tone</p></div>
        <ul class="sentence-set-list"><li class="sentence-set-row" id="row"><div id="row-body"></div></li></ul>
        <div class="word-definition-popup" id="popup-overlay"><div class="popup-content" id="popup"></div></div>
        <div id="empty"></div>
      </div>
    </div>
    <div id="outside"></div>`;
  return document.getElementById('card')!;
}

const at = (x: number, y: number, t: number) => ({ x, y, t });

describe('isPeekTap', () => {
  let card: HTMLElement;
  beforeEach(() => {
    card = buildCard();
  });
  const tap = (id: string, extra: Partial<Parameters<typeof isPeekTap>[0]> = {}) =>
    isPeekTap({ target: document.getElementById(id), container: card, down: at(10, 10, 1000), up: at(12, 11, 1120), ...extra });

  it('peeks on empty space and plain answer text', () => {
    expect(tap('empty')).toBe(true);
    expect(tap('back')).toBe(true);
    expect(tap('card')).toBe(true);
    expect(tap('pinyin')).toBe(true);
  });

  it('never peeks on something with its own tap', () => {
    for (const id of ['play', 'play-icon', 'char', 'diff', 'diff-row', 'fact', 'link', 'note', 'row', 'row-body', 'popup-overlay', 'popup']) {
      expect(tap(id), id).toBe(false);
    }
  });

  it('ignores clicks bubbling from outside the card (portals)', () => {
    expect(tap('outside')).toBe(false);
    expect(isPeekTap({ target: null, container: card, down: null, up: at(0, 0, 0) })).toBe(false);
  });

  it('a drag / scroll is not a tap', () => {
    expect(tap('empty', { up: at(10, 10 + PEEK_MAX_MOVE_PX + 5, 1100) })).toBe(false);
    expect(tap('empty', { up: at(10 + PEEK_MAX_MOVE_PX - 2, 10, 1100) })).toBe(true);
  });

  it('a long press is not a tap', () => {
    expect(tap('empty', { up: at(10, 10, 1000 + PEEK_MAX_PRESS_MS + 50) })).toBe(false);
  });

  it('finishing a text selection is not a tap', () => {
    expect(tap('pinyin', { selection: 'dǎsuàn' })).toBe(false);
    expect(tap('pinyin', { selection: '  ' })).toBe(true);
  });

  it('a click with no pointer-down (keyboard / synthetic) still counts on empty space', () => {
    expect(tap('empty', { down: null })).toBe(true);
  });
});
