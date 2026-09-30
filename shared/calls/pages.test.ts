import { describe, it, expect } from 'vitest';
import {
  combineCallPagesText,
  localDateKey,
  pageAfterDelete,
  pageLabel,
  pagePreview,
  pickOpeningPage,
  sanitizePageId,
  sanitizePageTitle,
  snapshotFromText,
  CONTINUE_PAGE_WINDOW_MS,
} from './pages';
import { TextDoc } from './textDoc';

const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe('pickOpeningPage — which page a call opens on', () => {
  it('no pages → a new one', () => {
    expect(pickOpeningPage([], at('2026-09-30T09:00:00Z'))).toEqual({ kind: 'new' });
  });

  it('continues the page used earlier the same day, within the lesson window', () => {
    const now = at('2026-09-30T11:00:00Z');
    const pages = [
      { id: 'a', chars: 10, last_used_at: now - 30 * H },
      { id: 'b', chars: 5, last_used_at: now - 2 * H },
    ];
    expect(pickOpeningPage(pages, now, 'UTC')).toEqual({ kind: 'continue', id: 'b' });
    // The most recently USED page wins, even if it isn't the last in the strip.
    expect(pickOpeningPage([pages[1], pages[0]], now, 'UTC')).toEqual({ kind: 'continue', id: 'b' });
  });

  it('a new page for a later lesson: past the window, or across midnight in the starter\'s time zone', () => {
    const now = at('2026-09-30T11:00:00Z');
    expect(pickOpeningPage([{ id: 'a', chars: 3, last_used_at: now - CONTINUE_PAGE_WINDOW_MS - 1 }], now, 'UTC')).toEqual({ kind: 'new' });
    // 23:30 → 00:30 Auckland (UTC+13 in late September): one hour apart but another day there.
    const late = at('2026-09-30T10:30:00Z'); // 23:30 NZDT
    const next = at('2026-09-30T11:30:00Z'); // 00:30 NZDT, 1 Oct
    expect(pickOpeningPage([{ id: 'a', chars: 3, last_used_at: late }], next, 'Pacific/Auckland')).toEqual({ kind: 'new' });
    expect(pickOpeningPage([{ id: 'a', chars: 3, last_used_at: late }], next, 'UTC')).toEqual({ kind: 'continue', id: 'a' });
  });

  it('an empty last page is reused however old it is', () => {
    const now = at('2026-09-30T11:00:00Z');
    expect(pickOpeningPage([{ id: 'a', chars: 9, last_used_at: now - H }, { id: 'b', chars: 0, last_used_at: now - 100 * H }], now, 'UTC')).toEqual({ kind: 'continue', id: 'b' });
  });

  it('a page "used" in the future (a clock off) is not continued', () => {
    const now = at('2026-09-30T11:00:00Z');
    expect(pickOpeningPage([{ id: 'a', chars: 3, last_used_at: now + H }], now, 'UTC')).toEqual({ kind: 'new' });
  });
});

describe('page helpers', () => {
  it('localDateKey follows the zone, falls back to UTC', () => {
    expect(localDateKey(at('2026-09-30T20:00:00Z'), 'Asia/Shanghai')).toBe('2026-10-01');
    expect(localDateKey(at('2026-09-30T20:00:00Z'), 'Not/AZone')).toBe('2026-09-30');
    expect(localDateKey(at('2026-09-30T20:00:00Z'))).toBe('2026-09-30');
  });

  it('titles are one line, ≤ 60 characters, blank = none', () => {
    expect(sanitizePageTitle('  把 字句\n练习 ')).toBe('把 字句 练习');
    expect(sanitizePageTitle('   ')).toBeNull();
    expect(sanitizePageTitle(5)).toBeNull();
    expect(Array.from(sanitizePageTitle('字'.repeat(80))!)).toHaveLength(60);
    expect(pageLabel(6, null)).toBe('Page 7');
    expect(pageLabel(0, ' Homework ')).toBe('Homework');
  });

  it('previews squeeze blank lines and cut at 140 characters', () => {
    expect(pagePreview('\n\n你好\n\n\n\n再见')).toBe('你好\n\n再见');
    expect(Array.from(pagePreview('好'.repeat(300)))).toHaveLength(140);
  });

  it('page ids are short and plain', () => {
    expect(sanitizePageId('abc_DEF-123')).toBe('abc_DEF-123');
    expect(sanitizePageId('a b')).toBeNull();
    expect(sanitizePageId('x'.repeat(65))).toBeNull();
    expect(sanitizePageId(null)).toBeNull();
  });

  it('after a delete: the next page, else the previous one', () => {
    expect(pageAfterDelete(['a', 'b', 'c'], 'b')).toBe('c');
    expect(pageAfterDelete(['a', 'b', 'c'], 'c')).toBe('b');
    expect(pageAfterDelete(['a'], 'a')).toBeNull();
    expect(pageAfterDelete(['a', 'b'], 'zz')).toBe('a');
  });

  it('snapshotFromText is a document the CRDT reads back', () => {
    expect(new TextDoc('x', snapshotFromText('一二 😀', 'copy:1')).text()).toBe('一二 😀');
    expect(snapshotFromText('', 's')).toEqual({ v: 1, runs: [] });
  });

  it("the call's board text: one page as is, several headed, blank pages left out", () => {
    expect(combineCallPagesText([])).toBe('');
    expect(combineCallPagesText([{ label: 'Page 3', text: '你好' }, { label: 'Page 4', text: '  ' }])).toBe('你好');
    expect(combineCallPagesText([{ label: 'Page 3', text: '你好\n' }, { label: 'Homework', text: '作业' }])).toBe('— Page 3 —\n你好\n\n— Homework —\n作业');
  });
});
