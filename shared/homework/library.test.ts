import { describe, expect, it } from 'vitest';
import {
  buildHomeworkLibrary,
  filterLibrary,
  libraryCounts,
  LIBRARY_STATUS_LABELS,
  libraryDueText,
  libraryStatus,
  mostRecentHomework,
  statusTone,
  type LibraryInput,
} from './library';
import { cleanLinkNote, linkSiteName, linkThumbnail, normalizeLinkUrl, pickLinkHomework, youtubeVideoId } from './link';
import type { HomeworkAssignment } from './types';

const TODAY = '2026-10-03';

function assignment(over: Partial<HomeworkAssignment>): HomeworkAssignment {
  return {
    id: 'a1',
    relationship_id: 'rel',
    tutor_id: 't',
    student_id: 's',
    batch_id: null,
    kind: 'deck',
    target_id: 'deck-copy',
    source_id: 'deck-src',
    title: 'Food',
    mode: 'one_off',
    due_date: '2026-10-05',
    item_ids: null,
    item_count: 10,
    part_index: 0,
    part_count: 1,
    status: 'active',
    done_count: 0,
    completed_at: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

function input(over: Partial<LibraryInput>): LibraryInput {
  return { relationship_id: 'rel', student_id: 's', student_name: 'Anna', assignments: [], decks: [], lessons: [], readers: [], today: TODAY, ...over };
}

const deckRow = {
  share_id: 'sh1',
  source_id: 'deck-src',
  target_id: 'deck-copy',
  title: 'Food',
  shared_at: '2026-10-01T10:00:00.000Z',
  notes_total: 10,
  notes_introduced: 0,
  notes_missing: 0,
  cards_started: 0,
};

describe('libraryStatus', () => {
  it('completed wins over a past due date', () => {
    expect(libraryStatus({ complete: true, started: true, due_date: '2026-09-01', today: TODAY })).toBe('completed');
  });
  it('a past due date makes an unfinished item overdue, started or not', () => {
    expect(libraryStatus({ complete: false, started: true, due_date: '2026-10-02', today: TODAY })).toBe('overdue');
    expect(libraryStatus({ complete: false, started: false, due_date: '2026-10-02', today: TODAY })).toBe('overdue');
  });
  it('due today is not overdue yet', () => {
    expect(libraryStatus({ complete: false, started: false, due_date: TODAY, today: TODAY })).toBe('not_started');
    expect(libraryStatus({ complete: false, started: true, due_date: TODAY, today: TODAY })).toBe('in_progress');
  });
  it('no due date never goes overdue', () => {
    expect(libraryStatus({ complete: false, started: false, due_date: null, today: TODAY })).toBe('not_started');
  });
});

describe('statusTone', () => {
  it('green / red / amber when due soon / blue / grey', () => {
    expect(statusTone('completed', '2026-09-01', TODAY)).toBe('green');
    expect(statusTone('overdue', '2026-10-01', TODAY)).toBe('red');
    expect(statusTone('in_progress', '2026-10-04', TODAY)).toBe('amber');
    expect(statusTone('not_started', TODAY, TODAY)).toBe('amber');
    expect(statusTone('in_progress', '2026-10-09', TODAY)).toBe('blue');
    expect(statusTone('in_progress', null, TODAY)).toBe('blue');
    expect(statusTone('not_started', null, TODAY)).toBe('grey');
  });
});

describe('buildHomeworkLibrary — decks', () => {
  it('a one-off deck: pass progress, due date, in progress', () => {
    const [item] = buildHomeworkLibrary(input({ decks: [deckRow], assignments: [assignment({ done_count: 4 })] }));
    expect(item).toMatchObject({ kind: 'deck', percent: 40, progress: '4 / 10 words', status: 'in_progress', due_date: '2026-10-05', due_assignment_id: 'a1', mode: 'one_off', share_id: 'sh1' });
  });

  it('split over days: parts add up; the due date is the first unfinished part', () => {
    const parts = [
      assignment({ id: 'p1', item_count: 5, done_count: 5, status: 'done', due_date: '2026-10-02', completed_at: '2026-10-02T09:00:00Z' }),
      assignment({ id: 'p2', item_count: 5, done_count: 1, part_index: 1, part_count: 2, due_date: '2026-10-04' }),
    ];
    const [item] = buildHomeworkLibrary(input({ decks: [deckRow], assignments: parts }));
    expect(item).toMatchObject({ percent: 60, progress: '6 / 10 words', due_date: '2026-10-04', due_assignment_id: 'p2', status: 'in_progress' });
    expect(item.assignment_ids).toEqual(['p1', 'p2']);
  });

  it('overdue when the open part is past due', () => {
    const [item] = buildHomeworkLibrary(input({ decks: [deckRow], assignments: [assignment({ due_date: '2026-10-01' })] }));
    expect(item.status).toBe('overdue');
  });

  it('completed when every part is done — percent 100, no due-date target', () => {
    const [item] = buildHomeworkLibrary(
      input({ decks: [deckRow], assignments: [assignment({ status: 'done', done_count: 10, due_date: '2026-09-30', completed_at: '2026-09-29T08:00:00Z' })] })
    );
    expect(item).toMatchObject({ status: 'completed', percent: 100, due_assignment_id: null, completed_at: '2026-09-29T08:00:00Z' });
  });

  it('a long-term-only deck is "In long-term review" (never In progress); progress says words met (minus left out)', () => {
    const [item] = buildHomeworkLibrary(
      input({ decks: [{ ...deckRow, notes_total: 12, notes_left_out: 2, notes_introduced: 5, cards_started: 9 }], assignments: [assignment({ mode: 'fsrs', due_date: null })] })
    );
    expect(item).toMatchObject({ percent: 50, progress: '5 / 10 words met', status: 'long_term', mode: 'fsrs', due_date: null, completed_at: null });
    expect(LIBRARY_STATUS_LABELS[item.status]).toBe('In long-term review');
    expect(statusTone(item.status, null, TODAY)).toBe('grey');
  });

  it('a deck shared before assignments existed has mode null and is long-term too, even with every word met', () => {
    const [item] = buildHomeworkLibrary(input({ decks: [{ ...deckRow, notes_introduced: 10, cards_started: 30 }] }));
    expect(item).toMatchObject({ mode: null, status: 'long_term', percent: 100 });
  });

  it('a "both" deck is judged by its one-off pass, not by long-term review', () => {
    const [item] = buildHomeworkLibrary(
      input({ decks: [{ ...deckRow, notes_introduced: 0 }], assignments: [assignment({ mode: 'both', status: 'done', done_count: 10, item_count: 10 })] })
    );
    expect(item).toMatchObject({ mode: 'both', status: 'completed', percent: 100 });
  });

  it('a copy the student deleted is left out; cancelled assignments are ignored', () => {
    const items = buildHomeworkLibrary(
      input({ decks: [{ ...deckRow, target_deleted: true }, { ...deckRow, share_id: 'sh2', target_id: 'c2' }], assignments: [assignment({ target_id: 'c2', status: 'cancelled' })] })
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ target_id: 'c2', mode: null, assignment_ids: [] });
  });

  it('behind = tutor words the copy lacks', () => {
    const [item] = buildHomeworkLibrary(input({ decks: [{ ...deckRow, notes_missing: 3 }] }));
    expect(item.behind).toBe(3);
  });
});

describe('buildHomeworkLibrary — lessons, readers, links', () => {
  it('a lesson is complete once completed; source = the library item', () => {
    const items = buildHomeworkLibrary(
      input({
        lessons: [
          { lesson_id: 'L1', library_item_id: 'lib1', title: '把 sentences', created_at: '2026-10-02T00:00:00Z', completions: 2, last_completed_at: '2026-10-02T10:00:00Z' },
          { lesson_id: 'L2', library_item_id: null, title: 'Tones', created_at: '2026-10-01T00:00:00Z', completions: 0, last_completed_at: null },
        ],
        assignments: [assignment({ id: 'aL2', kind: 'lesson', target_id: 'L2', item_count: 1, due_date: '2026-10-02' })],
      })
    );
    expect(items[0]).toMatchObject({ kind: 'lesson', source_id: 'lib1', status: 'completed', percent: 100, progress: 'done 2×' });
    expect(items[1]).toMatchObject({ kind: 'lesson', status: 'overdue', percent: 0, due_assignment_id: 'aL2' });
  });

  it('a reader is complete once read', () => {
    const [read, unread] = buildHomeworkLibrary(
      input({
        readers: [
          { share_id: 'r1', source_id: 'src1', target_id: 'R1', title: '小明在巴黎', shared_at: '2026-10-02T00:00:00Z', read_count: 1, last_read_at: '2026-10-02T12:00:00Z' },
          { share_id: 'r2', source_id: 'src2', target_id: 'R2', title: 'Market', shared_at: '2026-10-01T00:00:00Z', read_count: 0, last_read_at: null },
        ],
      })
    );
    expect(read).toMatchObject({ status: 'completed', progress: 'read', completed_at: '2026-10-02T12:00:00Z' });
    expect(unread).toMatchObject({ status: 'not_started', progress: 'not read yet' });
  });

  it('a link is one row per assignment with its details and the student note', () => {
    const items = buildHomeworkLibrary(
      input({
        assignments: [
          assignment({ id: 'k1', kind: 'link', target_id: 'link1', source_id: 'link1', title: '月亮代表我的心', item_count: 1, due_date: null, status: 'done', done_count: 1, completed_at: '2026-10-02T20:00:00Z', details: { url: 'https://youtu.be/abcdefghijk', instructions: 'Listen twice', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' } }),
          assignment({ id: 'k2', kind: 'link', target_id: 'link1', source_id: 'link1', title: '月亮代表我的心', item_count: 1, due_date: '2026-10-08', created_at: '2026-09-30T00:00:00Z' }),
        ],
        notes: { k1: 'I learned 5 words!' },
      })
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: 'link:k1', status: 'completed', percent: 100, url: 'https://youtu.be/abcdefghijk', instructions: 'Listen twice', student_note: 'I learned 5 words!' });
    expect(items[1]).toMatchObject({ key: 'link:k2', status: 'not_started', due_date: '2026-10-08', due_assignment_id: 'k2', student_note: null });
  });
});

describe('filter, counts, most recent', () => {
  const items = buildHomeworkLibrary(
    input({
      decks: [deckRow],
      assignments: [
        assignment({ done_count: 2 }),
        assignment({ id: 'k1', kind: 'link', target_id: 'l', title: 'Song', item_count: 1, due_date: '2026-10-01', created_at: '2026-10-01T10:10:00.000Z' }),
      ],
      readers: [{ share_id: 'r', source_id: 's', target_id: 'R', title: 'Story', shared_at: '2026-09-20T00:00:00Z', read_count: 1, last_read_at: null }],
    })
  );

  it('filters by status, kind and text', () => {
    expect(filterLibrary(items, { status: 'overdue' }).map((i) => i.title)).toEqual(['Song']);
    expect(filterLibrary(items, { kind: 'reader' }).map((i) => i.title)).toEqual(['Story']);
    expect(filterLibrary(items, { query: 'anna' })).toHaveLength(3);
    expect(filterLibrary(items, { query: 'foo' }).map((i) => i.title)).toEqual(['Food']);
  });

  it('counts per status', () => {
    expect(libraryCounts(items)).toEqual({ completed: 1, in_progress: 1, overdue: 1, not_started: 0, long_term: 0 });
  });

  it('most recent = the newest plus whatever was sent within 30 minutes', () => {
    expect(mostRecentHomework(items).map((i) => i.title)).toEqual(['Song', 'Food']);
    expect(mostRecentHomework([])).toEqual([]);
  });
});

describe('libraryDueText', () => {
  it('reads naturally', () => {
    expect(libraryDueText(null, TODAY)).toBe('No due date');
    expect(libraryDueText(TODAY, TODAY)).toBe('Due today');
    expect(libraryDueText('2026-10-04', TODAY)).toBe('Due tomorrow');
    expect(libraryDueText('2026-10-08', TODAY)).toBe('Due in 5 days');
    expect(libraryDueText('2026-10-02', TODAY)).toBe('Was due yesterday');
    expect(libraryDueText('2026-09-30', TODAY)).toBe('Was due 3 days ago');
  });
});

describe('link homework', () => {
  it('normalises http(s) links and refuses other schemes', () => {
    expect(normalizeLinkUrl('youtu.be/abcdefghijk')).toBe('https://youtu.be/abcdefghijk');
    expect(normalizeLinkUrl('  HTTPS://WWW.YouTube.com/watch?v=abcdefghijk ')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull();
    expect(normalizeLinkUrl('not a link')).toBeNull();
    expect(normalizeLinkUrl('hello')).toBeNull();
    expect(normalizeLinkUrl('https://user@evil.com')).toBeNull();
    expect(normalizeLinkUrl(42)).toBeNull();
  });

  it('finds YouTube ids in every link shape', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=x')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/channel/UC123')).toBeNull();
    expect(youtubeVideoId('https://vimeo.com/123')).toBeNull();
    expect(youtubeVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('thumbnail and site name', () => {
    expect(linkThumbnail('https://youtu.be/dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(linkThumbnail('https://www.bilibili.com/video/BV1')).toBeNull();
    expect(linkSiteName('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('YouTube');
    expect(linkSiteName('https://www.bilibili.com/video/BV1')).toBe('Bilibili');
    expect(linkSiteName('https://news.example.org/a')).toBe('news.example.org');
  });

  it('validates a link to save', () => {
    expect(pickLinkHomework({ title: ' Song ', url: 'youtu.be/dQw4w9WgXcQ', instructions: ' Listen ' })).toEqual({
      value: { title: 'Song', url: 'https://youtu.be/dQw4w9WgXcQ', instructions: 'Listen', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
      problems: [],
    });
    expect(pickLinkHomework({ title: '', url: 'nope' }).problems).toEqual(['url must be a web link (https://…)', 'title is required']);
    expect(pickLinkHomework({ instructions: '' }, true)).toEqual({ value: { instructions: null }, problems: [] });
  });

  it('cleans the student note', () => {
    expect(cleanLinkNote('  ')).toBeNull();
    expect(cleanLinkNote(' great ')).toBe('great');
    expect(cleanLinkNote('x'.repeat(2000))!.length).toBe(1000);
    expect(cleanLinkNote(3)).toBeNull();
  });
});

describe('itemStatus (the student side)', () => {
  it('uses the same four statuses from the pass on the device', async () => {
    const { toHomeworkItems, itemStatus } = await import('./items');
    const a = assignment({ id: 'x', item_ids: ['n1', 'n2'], item_count: 2, due_date: '2026-10-05' });
    const [fresh] = toHomeworkItems([a], [], TODAY);
    expect(itemStatus(fresh, TODAY)).toBe('not_started');
    const [tried] = toHomeworkItems([a], [{ assignment_id: 'x', item_id: 'n1', result: 'wrong', created_at: '2026-10-03T08:00:00Z' }], TODAY);
    expect(itemStatus(tried, TODAY)).toBe('in_progress');
    const [late] = toHomeworkItems([{ ...a, due_date: '2026-10-01' }], [], TODAY);
    expect(itemStatus(late, TODAY)).toBe('overdue');
    const [link] = toHomeworkItems([assignment({ id: 'l', kind: 'link', target_id: 'L', due_date: null, item_count: 1 })], [{ assignment_id: 'l', item_id: 'L', result: 'done', created_at: '2026-10-03T08:00:00Z' }], TODAY);
    expect(itemStatus(link, TODAY)).toBe('completed');
  });
});

describe('isoTime', () => {
  it('turns SQLite times into ISO so mixed lists sort by time', async () => {
    const { isoTime } = await import('./library');
    expect(isoTime('2026-10-03 14:12:00')).toBe('2026-10-03T14:12:00Z');
    expect(isoTime('2026-10-03T14:12:00.000Z')).toBe('2026-10-03T14:12:00.000Z');
    expect(isoTime(null)).toBeNull();
    const items = buildHomeworkLibrary(
      input({
        decks: [{ ...deckRow, shared_at: '2026-10-03 14:12:00' }],
        assignments: [assignment({ id: 'k', kind: 'link', target_id: 'L', item_count: 1, created_at: '2026-10-03T14:00:00.000Z' })],
      })
    );
    expect(items.map((i) => i.kind)).toEqual(['deck', 'link']);
    expect(items[0].sent_at).toBe('2026-10-03T14:12:00Z');
  });
});
