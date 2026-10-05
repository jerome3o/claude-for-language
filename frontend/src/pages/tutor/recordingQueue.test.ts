import { describe, it, expect } from 'vitest';
import type { RecordingQueueItem, RecordingQueueResponse } from '@shared/recordings/queue';
import {
  expectedChars,
  heardChars,
  sortAllRecordings,
  withoutQueueItem,
  emptyQueueLine,
  shouldPoll,
  CHECKING_POLL_CAP_MS,
} from './recordingQueue';

function item(id: string, reviewed_at: string, mark: RecordingQueueItem['mark'] = null): RecordingQueueItem {
  return {
    event_id: id,
    note: { id: `n-${id}`, hanzi: '银行', pinyin: 'yínháng', english: 'bank', deck_name: 'HSK 2', audio_url: null },
    card_type: 'hanzi_to_meaning',
    rating: 2,
    reviewed_at,
    recording_url: `recordings/${id}.webm`,
    user_answer: null,
    mark,
    check: null,
    flag: null,
    reasons: [],
    labels: [],
    in_queue: !mark,
  };
}

describe('expectedChars', () => {
  it('tags weak characters by kind, in order', () => {
    expect(expectedChars('银行', [{ char: '银', score: 55, kind: 'tone' }])).toEqual([
      { ch: '银', kind: 'tone' },
      { ch: '行', kind: null },
    ]);
  });

  it('claims repeated characters left to right and ignores extras', () => {
    const out = expectedChars('谢谢你', [
      { char: '谢', score: 60, kind: 'sound' },
      { char: '谢', score: null, kind: 'missing' },
      { char: '吗', score: 40, kind: 'extra' },
    ]);
    expect(out.map((c) => c.kind)).toEqual(['sound', 'missing', null]);
  });

  it('copes with no check and with a weak char not in the word', () => {
    expect(expectedChars('你好', null).every((c) => c.kind == null)).toBe(true);
    expect(expectedChars('你好', [{ char: '他', score: 10, kind: 'sound' }]).every((c) => c.kind == null)).toBe(true);
  });
});

describe('heardChars', () => {
  it('marks the characters that are not in the card', () => {
    expect(heardChars('音行', '银行')).toEqual([
      { ch: '音', wrong: true },
      { ch: '行', wrong: false },
    ]);
  });

  it('is empty when nothing was heard', () => {
    expect(heardChars('', '银行')).toEqual([]);
    expect(heardChars(null, '银行')).toEqual([]);
  });

  it('ignores punctuation in the transcript', () => {
    expect(heardChars('银行。', '银行').every((c) => !c.wrong)).toBe(true);
  });
});

describe('sortAllRecordings', () => {
  it('puts unmarked first, then needs work, then listened, newest first in each', () => {
    const sorted = sortAllRecordings([
      item('a', '2026-10-01T10:00:00Z', { status: 'listened', comment: null, updated_at: '' }),
      item('b', '2026-10-01T09:00:00Z'),
      item('c', '2026-10-02T09:00:00Z', { status: 'needs_work', comment: 'tone', updated_at: '' }),
      item('d', '2026-10-03T09:00:00Z'),
    ]);
    expect(sorted.map((i) => i.event_id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('withoutQueueItem', () => {
  const data: RecordingQueueResponse = {
    range: { from: 'a', to: 'b' },
    view: 'queue',
    items: [item('a', '2026-10-01T10:00:00Z'), item('b', '2026-10-01T09:00:00Z')],
    counts: { queue: 2, all: 5, checking: 0 },
    scoring: true,
  };

  it('drops the item and lowers the queue count', () => {
    const next = withoutQueueItem(data, 'a');
    expect(next.items.map((i) => i.event_id)).toEqual(['b']);
    expect(next.counts).toEqual({ queue: 1, all: 5, checking: 0 });
  });

  it('leaves the data alone for an unknown id', () => {
    expect(withoutQueueItem(data, 'zzz')).toBe(data);
  });
});

describe('emptyQueueLine / shouldPoll', () => {
  it('says how many sound fine', () => {
    expect(emptyQueueLine(1)).toBe('Nothing needs your ear 🎧 — 1 recording in this range sounds fine');
    expect(emptyQueueLine(4)).toBe('Nothing needs your ear 🎧 — 4 recordings in this range sound fine');
    expect(emptyQueueLine(0)).toBe('No recordings in this range yet.');
  });

  it('polls only while checking and under the cap', () => {
    expect(shouldPoll(2, 0, 1000)).toBe(true);
    expect(shouldPoll(0, 0, 1000)).toBe(false);
    expect(shouldPoll(2, 0, CHECKING_POLL_CAP_MS + 1)).toBe(false);
  });
});
