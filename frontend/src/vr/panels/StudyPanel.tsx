/**
 * Study in VR: the regular study session — `useStudySession`, the same queue, the same
 * event-sourced reviews written to IndexedDB and synced by the existing sync — drawn as a VR
 * window. Reading cards (hanzi → meaning), meaning → hanzi and listening cards; the typing cards
 * are answered by voice (🎤, the same check as the web's "Say the answer").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkSpokenAnswer, isAcceptedVerdict, tidySpokenTranscript, type AnswerVerdict } from '@shared/cards/answer';
import { useStudySession } from '../../hooks/useStudySession';
import { track } from '../../services/analytics';
import { segmentNow } from '../../services/chineseSegmenter';
import type { CardWithNote, IntervalPreview, QueueCounts, Rating } from '../../types';
import { playNoteClip } from '../audio';
import type { UiNode } from '../ui/layout';
import type { PanelHostProps } from './types';

const RATING_KEYS = ['again', 'hard', 'good', 'easy'] as const;
const QUEUE_KEYS = ['new', 'learning', 'review', 'relearning'] as const;

export interface SpokenCheck {
  transcript: string;
  verdict: AnswerVerdict;
}

export interface StudyViewInput {
  loading: boolean;
  card: CardWithNote | null;
  reader: { id: string; title: string } | null;
  grammar: boolean;
  revealed: boolean;
  spoken: SpokenCheck | null;
  counts: QueueCounts;
  previews: Record<Rating, IntervalPreview> | null;
  reviewsToday: number;
  /** Word segments of a text (device segmenter), null while it loads. */
  segments?: (text: string) => string[] | undefined;
  online: boolean;
}

function parseAlternatives(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function spokenCheckFor(card: CardWithNote, transcript: string): SpokenCheck {
  const text = tidySpokenTranscript(transcript, card.note.hanzi);
  return { transcript: text, verdict: checkSpokenAnswer(text, card.note.hanzi, parseAlternatives(card.note.alternatives), card.note.pinyin) };
}

function countsLine(c: QueueCounts): string {
  const parts = [`${c.new + c.secondaryNew} new`, `${c.learning} learning`, `${c.review} review`];
  return parts.join(' · ');
}

const VERDICT_TEXT: Partial<Record<AnswerVerdict, string>> = {
  sound: 'Sounded right ✓',
  contains: 'Right ✓',
  close: 'Close — check the tones',
  wrong: 'Not quite',
};

/** The Study window's content (pure: unit-tested). */
export function studyView(s: StudyViewInput): UiNode[] {
  if (s.loading) return [{ t: 'text', text: 'Loading today’s cards…', color: 'muted', align: 'center' }];
  if (s.reader) {
    return [
      { t: 'text', text: countsLine(s.counts), color: 'muted', size: 24, align: 'center' },
      { t: 'spacer', h: 20 },
      { t: 'text', text: 'Today’s story', size: 26, color: 'accent', align: 'center' },
      { t: 'text', text: s.reader.title, size: 56, weight: 600, align: 'center', explore: true, segments: s.segments?.(s.reader.title) },
      { t: 'spacer', h: 16 },
      { t: 'button', label: '📖 Read it in the Reader window', action: 'open_reader', tone: 'primary' },
    ];
  }
  if (s.grammar) {
    return [
      { t: 'text', text: 'A grammar lesson is next.', size: 34, weight: 600, align: 'center' },
      { t: 'text', text: 'It isn’t in VR yet — do it on your phone, then come back for the rest.', color: 'muted', align: 'center' },
    ];
  }
  const card = s.card;
  if (!card) {
    return [
      { t: 'spacer', h: 20 },
      { t: 'text', text: '🎉 All done for today', size: 48, weight: 700, align: 'center' },
      { t: 'text', text: s.reviewsToday > 0 ? `${s.reviewsToday} reviews in this session` : 'Nothing due right now.', color: 'muted', align: 'center' },
      { t: 'spacer', h: 10 },
      { t: 'button', label: '↻ Check again', action: 'reload', tone: 'plain' },
    ];
  }
  const note = card.note;
  const zh = (text: string, size: number): UiNode => ({ t: 'text', text, size, weight: 600, color: 'zh', align: 'center', explore: true, segments: s.segments?.(text) });
  const nodes: UiNode[] = [{ t: 'text', text: countsLine(s.counts), color: 'muted', size: 24, align: 'center' }];
  const speakable = card.card_type === 'meaning_to_hanzi' || card.card_type === 'audio_to_hanzi';

  // Question side
  if (card.card_type === 'hanzi_to_meaning') {
    nodes.push({ t: 'spacer', h: 10 }, zh(note.hanzi, 112));
    if (!s.revealed) nodes.push({ t: 'text', text: 'Say it out loud — what does it mean?', color: 'muted', align: 'center', size: 26 });
  } else if (card.card_type === 'meaning_to_hanzi') {
    nodes.push({ t: 'spacer', h: 10 }, { t: 'text', text: note.english, size: 44, weight: 600, align: 'center' });
    if (!s.revealed) nodes.push({ t: 'text', text: 'How do you say it in Chinese?', color: 'muted', align: 'center', size: 26 });
  } else {
    nodes.push({ t: 'spacer', h: 10 }, { t: 'text', text: '🔊 What did you hear?', size: 40, weight: 600, align: 'center' });
    if (!s.revealed) nodes.push({ t: 'row', mode: 'wrap', align: 'center', children: [{ t: 'button', label: '▶ Play again', action: 'play', tone: 'chip' }] });
  }

  if (s.spoken) {
    const ok = isAcceptedVerdict(s.spoken.verdict);
    nodes.push({ t: 'text', text: `You said: ${s.spoken.transcript || '—'}`, align: 'center', size: 30, color: 'ink' });
    nodes.push({ t: 'text', text: VERDICT_TEXT[s.spoken.verdict] ?? 'Right ✓', align: 'center', size: 30, weight: 600, color: ok ? 'good' : 'bad' });
  }

  if (!s.revealed) {
    nodes.push({ t: 'spacer', h: 12 });
    const buttons: UiNode[] = [];
    if (speakable && s.online) buttons.push({ t: 'button', label: '🎤 Say the answer', action: 'speak', tone: 'plain' });
    buttons.push({ t: 'button', label: 'Show answer', action: 'reveal', tone: 'primary' });
    nodes.push({ t: 'row', mode: 'fill', children: buttons as Array<Extract<UiNode, { t: 'button' }>> });
    return nodes;
  }

  // Answer side
  nodes.push({ t: 'divider' });
  if (card.card_type !== 'hanzi_to_meaning') nodes.push(zh(note.hanzi, 96));
  nodes.push({ t: 'text', text: note.pinyin, size: 36, color: 'accent', align: 'center' });
  if (card.card_type !== 'meaning_to_hanzi') nodes.push({ t: 'text', text: note.english, size: 34, align: 'center' });
  nodes.push({ t: 'row', mode: 'wrap', align: 'center', children: [{ t: 'button', label: '▶ Play', action: 'play', tone: 'chip' }] });
  if (note.sentence_clue) {
    nodes.push({ t: 'text', text: note.sentence_clue, size: 32, color: 'zh', explore: true, segments: s.segments?.(note.sentence_clue) });
    if (note.sentence_clue_translation) nodes.push({ t: 'text', text: note.sentence_clue_translation, size: 24, color: 'muted' });
  }
  if (note.fun_facts) nodes.push({ t: 'text', text: note.fun_facts, size: 24, color: 'muted', maxLines: 4, explore: true, segments: s.segments?.(note.fun_facts) });
  nodes.push({ t: 'spacer', h: 8 });
  const tones = ['again', 'hard', 'good', 'easy'] as const;
  const labels = ['Again', 'Hard', 'Good', 'Easy'];
  nodes.push({
    t: 'row',
    mode: 'fill',
    gap: 12,
    children: tones.map((tone, i) => ({ t: 'button' as const, label: labels[i], action: `rate:${i}`, tone, sub: s.previews?.[i as Rating]?.intervalText })),
  });
  return nodes;
}

export function segmentsOf(text: string): string[] | undefined {
  const words = segmentNow(text);
  return words ? words.map((w) => w.text) : undefined;
}

export function StudyPanel({ spec, ctx, report }: PanelHostProps<{ kind: 'study'; deck_id?: string }>) {
  const session = useStudySession({ deckId: spec.deck_id, enabled: true });
  const [revealed, setRevealed] = useState(false);
  const [spoken, setSpoken] = useState<SpokenCheck | null>(null);
  const shownAt = useRef(Date.now());
  // The hook builds `currentCard` afresh every render: one per shown card (and note edit).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const card = useMemo(() => session.currentCard, [session.cardVersion, session.currentCard?.id, session.currentCard?.note, session.currentCard?.queue]);
  const reader = session.currentReader;

  // A new card: question side, timer from now; listening cards play at once.
  useEffect(() => {
    setRevealed(false);
    setSpoken(null);
    shownAt.current = Date.now();
    if (card?.card_type === 'audio_to_hanzi') void playNoteClip(card.note.audio_url, card.note.hanzi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.cardVersion]);

  // Finishing today's story in the Reader window advances this session.
  useEffect(() => {
    ctx.sessionReader.current = reader ? { readerId: reader.id, finish: (ms) => session.finishReader(ms) } : null;
    return () => {
      ctx.sessionReader.current = null;
    };
  }, [reader, session.finishReader, ctx.sessionReader]);

  const reveal = useCallback(() => {
    if (!card) return;
    setRevealed(true);
    void playNoteClip(card.note.audio_url, card.note.hanzi);
  }, [card]);

  const rate = useCallback((rating: Rating) => {
    if (!card || session.isRating) return;
    const time = Date.now() - shownAt.current;
    track('study.card_rated', { rating: RATING_KEYS[rating], card_type: card.card_type, queue: QUEUE_KEYS[card.queue] ?? null, time_ms: time, recorded: false, multiple_choice: false });
    void session.rateCard(rating, time, spoken?.transcript || undefined);
  }, [card, session, spoken]);

  // Interval previews are recomputed every render by the session hook: keep one per content.
  const previewsKey = JSON.stringify(session.intervalPreviews);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previews = useMemo(() => session.intervalPreviews, [previewsKey]);

  const view = useMemo(() => ({
    title: spec.deck_id && card?.note ? 'Study · deck' : 'Study',
    nodes: studyView({
      loading: session.isLoading,
      card,
      reader: reader ? { id: reader.id, title: reader.title_chinese } : null,
      grammar: !!session.currentGrammar,
      revealed,
      spoken,
      counts: session.counts,
      previews,
      reviewsToday: session.sessionStats.totalReviews,
      segments: segmentsOf,
      online: ctx.online,
    }),
  }), [session.isLoading, card, reader, session.currentGrammar, revealed, spoken, session.counts, previews, session.sessionStats.totalReviews, ctx.online, ctx.segVersion, spec.deck_id]);

  const onAction = (action: string) => {
    if (action === 'reveal') reveal();
    else if (action === 'play' && card) void playNoteClip(card.note.audio_url, card.note.hanzi);
    else if (action.startsWith('rate:')) rate(Number(action.slice(5)) as Rating);
    else if (action === 'speak') ctx.startSpeech();
    else if (action === 'reload') session.reloadQueue();
    else if (action === 'open_reader' && reader) ctx.open({ kind: 'reader', reader_id: reader.id }, 'study');
  };

  const onSpeech = (text: string): string | null => {
    if (!card || revealed) return null;
    setSpoken(spokenCheckFor(card, text));
    reveal();
    return 'study_answer';
  };

  const latest = useRef({ onAction, onSpeech });
  latest.current = { onAction, onSpeech };
  useEffect(() => {
    report({ view, onAction: (a) => latest.current.onAction(a), onSpeech: (t) => latest.current.onSpeech(t) });
  }, [view, report]);
  return null;
}
