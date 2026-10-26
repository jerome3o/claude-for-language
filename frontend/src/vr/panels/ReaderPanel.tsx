/**
 * Graded readers in VR: the Up next list (the reader queue, shared/reader/queue.ts via
 * services/readerQueue.ts), then a reader page by page — picture, Chinese (tap a word → the
 * explorer), 拼 / EN to reveal, ▶ narration (the device's cached clip first). Finishing records
 * the same read as the web reader (`recordReaderFinish`: the event, the row, its homework), or
 * advances the study session when it is today's story there.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LocalReader } from '../../db/database';
import { readerQueueOrder } from '../../services/readerQueue';
import { recordReaderFinish } from '../../services/reader-study';
import { getReaderPageTTS } from '../../services/readerSync';
import { syncService } from '../../services/sync';
import { markDailyActivity } from '../../api/client';
import { track } from '../../services/analytics';
import { playBlob, stopAudio } from '../audio';
import type { UiNode } from '../ui/layout';
import { segmentsOf } from './StudyPanel';
import type { PanelHostProps } from './types';

export interface ReaderListRow {
  id: string;
  title: string;
  english: string;
  pages: number;
  read: boolean;
}

export function readerListView(rows: readonly ReaderListRow[] | null): UiNode[] {
  if (!rows) return [{ t: 'text', text: 'Loading your readers…', color: 'muted', align: 'center' }];
  if (rows.length === 0) {
    return [
      { t: 'text', text: 'No story waiting.', size: 36, weight: 600, align: 'center' },
      { t: 'text', text: 'A new one arrives with your daily study, or make one on your phone (More → Readers).', color: 'muted', align: 'center' },
    ];
  }
  return [
    { t: 'text', text: 'Up next', size: 26, color: 'accent' },
    { t: 'list', items: rows.slice(0, 6).map((r, i) => ({ title: r.title, sub: `${r.english} · ${r.pages} pages`, right: i === 0 ? 'Today' : undefined, icon: '📖', action: `open:${r.id}` })) },
  ];
}

export interface ReaderPageInput {
  title: string;
  page: { content_chinese: string; content_pinyin: string; content_english: string; image_url: string | null };
  index: number;
  total: number;
  showPinyin: boolean;
  showEnglish: boolean;
  finished: boolean;
  segments?: (text: string) => string[] | undefined;
  /** Opened from the list (← back to it). */
  canGoBack: boolean;
}

export function readerPageView(s: ReaderPageInput): UiNode[] {
  if (s.finished) {
    return [
      { t: 'spacer', h: 20 },
      { t: 'text', text: '✓ Story finished', size: 48, weight: 700, align: 'center', color: 'good' },
      { t: 'text', text: s.title, size: 34, align: 'center', explore: true, segments: s.segments?.(s.title) },
      { t: 'spacer', h: 10 },
      ...(s.canGoBack ? [{ t: 'button', label: '← Up next', action: 'back', tone: 'plain' } as UiNode] : []),
    ];
  }
  const p = s.page;
  const nodes: UiNode[] = [];
  if (p.image_url) nodes.push({ t: 'image', key: p.image_url, height: 340 });
  nodes.push({ t: 'text', text: p.content_chinese, size: 44, color: 'zh', explore: true, segments: s.segments?.(p.content_chinese) });
  if (s.showPinyin && p.content_pinyin) nodes.push({ t: 'text', text: p.content_pinyin, size: 28, color: 'accent' });
  if (s.showEnglish && p.content_english) nodes.push({ t: 'text', text: p.content_english, size: 28, color: 'muted' });
  nodes.push({
    t: 'row',
    mode: 'wrap',
    children: [
      { t: 'button', label: '▶ Listen', action: 'play', tone: 'chip' },
      { t: 'button', label: '拼 Pinyin', action: 'pinyin', tone: 'chip', selected: s.showPinyin },
      { t: 'button', label: 'EN', action: 'english', tone: 'chip', selected: s.showEnglish },
    ],
  });
  nodes.push({ t: 'progress', value: s.index + 1, max: s.total });
  const last = s.index === s.total - 1;
  nodes.push({
    t: 'row',
    mode: 'fill',
    children: [
      s.index > 0 ? { t: 'button', label: '← Back', action: 'prev', tone: 'plain' } : { t: 'button', label: s.canGoBack ? '☰ Up next' : '← Back', action: s.canGoBack ? 'back' : 'prev', tone: 'plain', disabled: !s.canGoBack },
      last ? { t: 'button', label: 'Finish ✓', action: 'finish', tone: 'good' } : { t: 'button', label: `Next → (${s.index + 2}/${s.total})`, action: 'next', tone: 'primary' },
    ],
  });
  return nodes;
}

export function ReaderPanel({ spec, ctx, report }: PanelHostProps<{ kind: 'reader'; reader_id?: string }>) {
  const readers = useLiveQuery(() => db.readers.toArray(), []);
  const [openId, setOpenId] = useState<string | null>(spec.reader_id ?? null);
  const [pageIndex, setPageIndex] = useState(0);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [finished, setFinished] = useState(false);
  const openedAt = useRef(Date.now());
  const fromList = useRef(!spec.reader_id);

  // Opened again for another reader (homework, the session's story): show that one.
  useEffect(() => {
    if (spec.reader_id) {
      setOpenId(spec.reader_id);
      fromList.current = false;
    }
  }, [spec.reader_id]);
  useEffect(() => {
    setPageIndex(0);
    setFinished(false);
    setShowPinyin(false);
    setShowEnglish(false);
    openedAt.current = Date.now();
    stopAudio();
  }, [openId]);

  const reader: LocalReader | null = useMemo(() => readers?.find((r) => r.id === openId) ?? null, [readers, openId]);
  useEffect(() => {
    if (reader) track('reader.open', { source: 'vr', pages: reader.pages.length });
  }, [reader?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = useMemo(() => (reader ? [...reader.pages].sort((a, b) => a.page_number - b.page_number) : []), [reader]);
  const page = pages[pageIndex] ?? null;

  const rows = useMemo<ReaderListRow[] | null>(() => {
    if (!readers) return null;
    return readerQueueOrder(readers).map((r) => ({ id: r.id, title: r.title_chinese, english: r.title_english, pages: r.pages.length, read: false }));
  }, [readers]);

  const view = useMemo(() => {
    if (!openId) return { title: 'Reader · Up next', nodes: readerListView(rows) };
    if (!reader || !page) {
      return { title: 'Reader', nodes: [{ t: 'text', text: readers ? 'This story isn’t on this device yet.' : 'Loading…', color: 'muted', align: 'center' } as UiNode] };
    }
    return {
      title: `Reader · ${reader.title_chinese}`,
      nodes: readerPageView({
        title: reader.title_chinese,
        page,
        index: pageIndex,
        total: pages.length,
        showPinyin,
        showEnglish,
        finished,
        segments: segmentsOf,
        canGoBack: fromList.current,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, reader, page, pageIndex, pages.length, showPinyin, showEnglish, finished, rows, readers, ctx.segVersion]);

  const finish = async () => {
    if (!reader || finished) return;
    const ms = Date.now() - openedAt.current;
    setFinished(true);
    stopAudio();
    track('reader.finish', { how: 'finish', pages: pages.length });
    const session = ctx.sessionReader.current;
    if (session && session.readerId === reader.id) {
      await session.finish(ms);
    } else {
      await recordReaderFinish(reader.id, ms);
      if (navigator.onLine) {
        void markDailyActivity('reader', reader.id).catch(() => {});
        void syncService.syncEvents().catch(() => {});
      }
    }
  };

  const onAction = (action: string) => {
    if (action.startsWith('open:')) {
      fromList.current = true;
      setOpenId(action.slice(5));
    } else if (action === 'back') {
      stopAudio();
      setOpenId(null);
    } else if (action === 'next') {
      setPageIndex((i) => Math.min(pages.length - 1, i + 1));
      setShowPinyin(false);
      setShowEnglish(false);
      stopAudio();
    } else if (action === 'prev') {
      setPageIndex((i) => Math.max(0, i - 1));
      stopAudio();
    } else if (action === 'pinyin') setShowPinyin((v) => !v);
    else if (action === 'english') setShowEnglish((v) => !v);
    else if (action === 'play' && page) void playBlob(() => getReaderPageTTS(page), page.content_chinese);
    else if (action === 'finish') void finish();
  };

  const latest = useRef(onAction);
  latest.current = onAction;
  useEffect(() => {
    report({ view, onAction: (a) => latest.current(a) });
  }, [view, report]);
  return null;
}
