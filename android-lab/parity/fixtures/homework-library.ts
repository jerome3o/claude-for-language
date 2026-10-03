/**
 * Golden vectors: the tutor's homework library (shared/homework/library.ts) and link homework
 * (shared/homework/link.ts) — status, colour, filters, counts, "most recent homework", due
 * text, sorting; URL normalising, YouTube ids / thumbnails, site names, the student's note.
 * Writes homework-library.json; checked by core/…/HomeworkLibraryParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  dueDateChoices,
  filterLibrary,
  libraryCounts,
  libraryDueText,
  libraryStatus,
  mostRecentHomework,
  sortLibrary,
  statusTone,
  type LibraryItem,
  type LibraryKind,
  type LibraryStatus,
} from '../../../shared/homework/library';
import { cleanLinkNote, linkHost, linkSiteName, linkThumbnail, normalizeLinkUrl, youtubeVideoId } from '../../../shared/homework/link';
import { addDays } from '../../../shared/homework/due';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261003);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const TODAYS = ['2026-10-03', '2026-12-31', '2027-01-01', '2028-02-28', '2028-03-01'];
const STATUSES: LibraryStatus[] = ['completed', 'in_progress', 'overdue', 'not_started'];
const KINDS: LibraryKind[] = ['deck', 'lesson', 'reader', 'link'];

function randomDue(today: string): string | null {
  if (r() < 0.2) return null;
  return addDays(today, int(-40, 40));
}

// ---- libraryStatus / statusTone / libraryDueText ----
const statusCases = Array.from({ length: 400 }, () => {
  const today = pick(TODAYS);
  const due = r() < 0.5 ? (r() < 0.2 ? null : addDays(today, int(-3, 3))) : randomDue(today);
  const complete = r() < 0.3;
  const started = r() < 0.5;
  const status = libraryStatus({ complete, started, due_date: due, today });
  const toneStatus = r() < 0.7 ? status : pick(STATUSES);
  return {
    today,
    due,
    complete,
    started,
    status,
    toneStatus,
    tone: statusTone(toneStatus, due, today),
    dueText: libraryDueText(due, today),
  };
});

// ---- items: sort / filter / counts / most recent ----
const TITLES = ['HSK 1', 'hsk 1', 'Lesson 8', 'lesson 8', 'Tones', '小猫找妈妈', '第三周作业：天气', 'Apple', 'apple', 'Banana', '周末去爬山', 'Week 3 · quotes', ''];
const NAMES = ['Jerome Swannack', 'Minghui', '王小明', 'Ana', 'jerome'];

function iso(ms: number, sqlite = false): string {
  const s = new Date(ms).toISOString();
  return sqlite ? s.slice(0, 19).replace('T', ' ') : s;
}

function randomItems(n: number): LibraryItem[] {
  const base = Date.parse('2026-10-03T12:00:00Z');
  const anchor = base - int(0, 30) * 86_400_000;
  const items: LibraryItem[] = [];
  for (let i = 0; i < n; i++) {
    const kind = pick(KINDS);
    // Mostly near the anchor (batches), some far, some exact ties.
    const offset = r() < 0.5 ? int(0, 45) * 60_000 : r() < 0.5 ? int(0, 20) * 86_400_000 : 0;
    const ms = anchor - offset + (r() < 0.2 ? int(0, 59) * 1000 : 0);
    const status = pick(STATUSES);
    items.push({
      key: `${kind}:t${i}`,
      kind,
      relationship_id: `rel${int(1, 3)}`,
      student_id: `s${i}`,
      student_name: pick(NAMES),
      title: pick(TITLES),
      source_id: r() < 0.9 ? `src${i}` : null,
      target_id: `t${i}`,
      share_id: null,
      sent_at: iso(ms, r() < 0.1),
      due_date: r() < 0.7 ? addDays('2026-10-03', int(-10, 10)) : null,
      mode: pick(['one_off', 'fsrs', 'both', null] as const),
      percent: int(0, 100),
      progress: '',
      status,
      completed_at: null,
      assignment_ids: [],
      due_assignment_id: null,
      behind: 0,
      url: null,
      instructions: null,
      thumbnail_url: null,
      student_note: null,
    });
  }
  return items;
}

const QUERIES = [null, '', 'hsk', 'HSK', '  tones ', 'jer', '小猫', '王', 'zzz', 'e'];

const listCases = Array.from({ length: 120 }, () => {
  const items = randomItems(int(0, 9));
  const status = r() < 0.5 ? pick(STATUSES) : null;
  const kind = r() < 0.4 ? pick(KINDS) : null;
  const query = pick(QUERIES);
  const limit = r() < 0.8 ? 3 : int(1, 5);
  return {
    items: items.map((i) => ({ key: i.key, kind: i.kind, title: i.title, student_name: i.student_name, sent_at: i.sent_at, status: i.status })),
    status,
    kind,
    query,
    limit,
    sorted: sortLibrary(items).map((i) => i.key),
    filtered: filterLibrary(items, { status, kind, query }).map((i) => i.key),
    counts: libraryCounts(items),
    recent: mostRecentHomework(items, limit).map((i) => i.key),
  };
});

const choices = TODAYS.map((today) => ({ today, choices: dueDateChoices(today) }));

// ---- links ----
const URLS: unknown[] = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'youtube.com/watch?v=dQw4w9WgXcQ&t=42',
  'http://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ',
  'youtu.be/dQw4w9WgXcQ?si=abc',
  'https://youtu.be/',
  'https://youtu.be/short',
  'https://www.youtube.com/shorts/abcdefghijk',
  'https://youtube.com/embed/abcdefghijk?start=3',
  'https://www.youtube.com/live/ABCDEFGHIJK',
  'https://www.youtube.com/v/ABCDEFGHIJ_',
  'https://music.youtube.com/watch?v=ABCDEFGHIJ-',
  'https://www.youtube-nocookie.com/embed/abcdefghijk',
  'https://www.youtube.com/watch?v=tooShort',
  'https://www.youtube.com/watch?v=abcdefghijkl',
  'https://www.youtube.com/playlist?list=PL123',
  'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
  'HTTPS://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ',
  'https://www.bilibili.com/video/BV1xx411c7mD',
  'b23.tv/abc',
  'https://open.spotify.com/track/123',
  'https://music.163.com/#/song?id=1',
  'https://y.qq.com/n/ryqq/songDetail/1',
  'https://v.qq.com/x/cover/1.html',
  'https://www.iqiyi.com/v_19rr.html',
  'https://www.netflix.com/title/81',
  'https://example.com',
  'example.com/path?x=1#frag',
  'Example.COM:8080/Path',
  'http://localhost:8787/api',
  'localhost',
  'https://localhost',
  'javascript:alert(1)',
  'data:text/html,hi',
  'file:///etc/passwd',
  'ftp://example.com',
  'mailto:me@example.com',
  'https://user:pass@example.com/',
  'https://exa mple.com',
  'https://example.com/a b',
  '  https://example.com/trimmed  ',
  '　https://example.com/ideographic　',
  'https://example.com/ nbsp',
  'https://.example.com',
  'https://example.com.',
  'https://exämple.com',
  'https://例子.中国',
  'https://nodot',
  'https://',
  'https:///path',
  '',
  '   ',
  null,
  undefined,
  42,
  'https://example.com/' + 'a'.repeat(1990),
  'https://example.com/' + 'a'.repeat(1985),
  'www.example.co.uk/page',
  'm.example.com',
  'https://sub.www.example.com',
  'https://example.com?q=1',
  'https://example.com#x',
  'HTTP://Example.com/MiXeD',
  'https://example.com/\u0085nel',
  'https://example.com:abc/',
  'https://a-b.c-d.com/x',
  'https://a_b.com/',
];

const links = URLS.map((raw) => {
  const url = normalizeLinkUrl(raw);
  const probe = typeof raw === 'string' ? raw : '';
  return {
    raw: typeof raw === 'string' ? raw : null,
    url,
    host: linkHost(url ?? probe),
    videoId: youtubeVideoId(url ?? probe),
    thumbnail: linkThumbnail(url ?? probe),
    site: linkSiteName(url ?? probe),
  };
});

const NOTES: unknown[] = ['', '   ', 'Done!', '  看完了，很好看  ', null, 12, 'x'.repeat(1200), '﻿hi　', '\n\tline\n'];
const notes = NOTES.map((raw) => ({ raw: typeof raw === 'string' ? raw : null, note: cleanLinkNote(raw) }));

writeFileSync(join(OUT, 'homework-library.json'), JSON.stringify({ statusCases, listCases, choices, links, notes }));
