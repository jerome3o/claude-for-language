/**
 * 🎬 "Keep going with <topic>" — the clip's Learn more sheet (double-tap, long press, ✨, the end
 * card). Everything lands in the learner's OWN account, nothing is sent to anyone:
 * ✨ Mini lesson (one per clip, opens when written), 📖 Graded reader, 🎧 Podcast (an audio
 * lesson), ⚡ Study these words today / + Add as cards (the bump pocket / AddChunkModal), and
 * 🎬 More clips like this. Offers come from shared/clips `learnMoreOffers`.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { clipTopic, learnMoreOffers, learnMoreTitle, type ClipLearnMoreAction, type ClipLessonState, type ClipRecord, type ClipWord } from '@shared/clips';
import { clipLearnMore, getClip } from '../../api/clips';
import { track } from '../../services/analytics';
import { bumpNotes, findExistingNotes } from '../../services/studyBumps';
import { syncCustomLessons } from '../../services/custom-lesson-study';
import { BumpButton } from '../bumps/BumpButton';
import { AddChunkModal } from '../AddChunkModal';
import { useNetwork } from '../../contexts/NetworkContext';
import { cacheClip } from '../../services/clips';

type Note = { kind: 'info' | 'error'; text: string; link?: { to: string; label: string } };

export function LearnMoreSheet({ clip, onClose, onClipUpdate, onMoreClips }: {
  clip: ClipRecord;
  onClose: () => void;
  onClipUpdate: (clip: ClipRecord) => void;
  onMoreClips: (clips: ClipRecord[]) => void;
}) {
  const spec = clip.spec!;
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [lesson, setLesson] = useState<ClipLessonState | null>(clip.lesson);
  const [busy, setBusy] = useState<ClipLearnMoreAction | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [showWords, setShowWords] = useState(false);
  const waitingLesson = useRef(false);
  const offers = learnMoreOffers(spec, lesson);

  const openLesson = async (id: string) => {
    await syncCustomLessons().catch(() => undefined);
    navigate(`/lessons/${id}/play`);
  };

  // While the lesson is being written: poll, and open it when it is ready (if still here).
  useEffect(() => {
    if (lesson?.status !== 'generating' || !isOnline) return;
    const id = window.setInterval(async () => {
      try {
        const { clip: fresh } = await getClip(clip.id);
        onClipUpdate(fresh);
        void cacheClip(fresh);
        setLesson(fresh.lesson);
        if (fresh.lesson?.status === 'ready' && fresh.lesson.lesson_id && waitingLesson.current) {
          waitingLesson.current = false;
          track('clips.learn_more', { clip: clip.id, action: 'lesson', status: 'open' });
          void openLesson(fresh.lesson.lesson_id);
        } else if (fresh.lesson?.status === 'failed') {
          setNote({ kind: 'error', text: fresh.lesson.error ?? 'The lesson couldn’t be written — try again.' });
        }
      } catch {
        /* next tick */
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [lesson?.status, isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: ClipLearnMoreAction) {
    if (busy) return;
    setNote(null);
    if (action === 'study_words' || action === 'add_card') {
      setShowWords(true);
      if (action === 'study_words') {
        const ids: string[] = [];
        for (const w of spec.words) for (const hit of await findExistingNotes(w.hanzi)) ids.push(hit.note.id);
        if (ids.length) {
          const out = await bumpNotes(ids, 'other');
          setNote({ kind: 'info', text: out.message });
        } else {
          setNote({ kind: 'info', text: 'None of these words are in your decks yet — add them below.' });
        }
      }
      track('clips.learn_more', { clip: clip.id, action, status: 'open' });
      return;
    }
    if (action === 'lesson' && lesson?.status === 'ready' && lesson.lesson_id) {
      track('clips.learn_more', { clip: clip.id, action, status: 'open' });
      await openLesson(lesson.lesson_id);
      return;
    }
    if (!isOnline) {
      setNote({ kind: 'error', text: 'This needs a connection — try again when you are online.' });
      return;
    }
    setBusy(action);
    try {
      const out = await clipLearnMore(clip.id, action as 'lesson' | 'reader' | 'podcast' | 'more');
      if ('lesson' in out) {
        setLesson(out.lesson);
        if (out.lesson.status === 'ready' && out.lesson.lesson_id) {
          await openLesson(out.lesson.lesson_id);
        } else {
          waitingLesson.current = true;
          setNote({ kind: 'info', text: '✨ Writing your mini lesson (about a minute) — it opens here when it’s ready. You can keep scrolling; it will also be in Mini Lessons.' });
        }
        track('clips.learn_more', { clip: clip.id, action, status: out.started ? 'started' : out.lesson.status === 'ready' ? 'open' : 'writing' });
      } else if ('reader' in out) {
        setNote({ kind: 'info', text: '📖 Writing a short story with these words — it will be in Readers in a minute or two.', link: { to: '/readers', label: 'Open Readers' } });
        track('clips.learn_more', { clip: clip.id, action, status: 'started' });
      } else if ('audio_lesson' in out) {
        setNote({ kind: 'info', text: '🎧 Making a dialogue audio lesson on this — a few minutes. It will be in Audio lessons.', link: { to: `/audio-lessons/${out.audio_lesson.id}`, label: 'Open it' } });
        track('clips.learn_more', { clip: clip.id, action, status: 'started' });
      } else if ('clips' in out) {
        onMoreClips(out.clips);
        setNote({ kind: 'info', text: `🎬 Two more clips on “${clipTopic(spec)}” are being made — they’ll show up in your feed.` });
        track('clips.learn_more', { clip: clip.id, action, status: 'started' });
      }
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'That didn’t work — try again.' });
      track('clips.learn_more', { clip: clip.id, action, status: 'failed' });
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div className="clip-sheet-scrim" onClick={onClose} data-testid="clip-learn-more-sheet">
      <div className="clip-sheet" role="dialog" aria-modal="true" aria-label={learnMoreTitle(clipTopic(spec))} onClick={(e) => e.stopPropagation()}>
        <h2>{learnMoreTitle(clipTopic(spec))}</h2>
        <p className="clip-sheet-sub">Made for you, in your account — nothing is sent to anyone.</p>
        {note && (
          <div className={`clip-sheet-note${note.kind === 'error' ? ' error' : ''}`} role="status">
            {note.text}{' '}
            {note.link && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(note.link!.to)}>{note.link.label}</button>
            )}
          </div>
        )}
        {offers.map((o) => (
          <button
            type="button"
            key={o.action}
            className="clip-offer"
            onClick={() => void act(o.action)}
            disabled={busy !== null || (o.online && !isOnline)}
            data-testid={`clip-offer-${o.action}`}
          >
            <span className="ico" aria-hidden="true">{o.icon}</span>
            <span className="txt">
              <b>{busy === o.action ? 'Starting…' : o.label}</b>
              <small>{o.online && !isOnline ? 'Needs a connection' : o.detail}</small>
            </span>
            <span className="go" aria-hidden="true">›</span>
          </button>
        ))}
        {showWords && <WordsPanel words={spec.words} />}
        <button type="button" className="btn btn-secondary clip-sheet-close" onClick={onClose}>Back to the clip</button>
      </div>
    </div>,
    document.body,
  );
}

function WordsPanel({ words }: { words: ClipWord[] }) {
  return (
    <div className="clip-words-panel" data-testid="clip-words-panel">
      {words.map((w) => (
        <WordRow key={w.hanzi} word={w} />
      ))}
    </div>
  );
}

function WordRow({ word }: { word: ClipWord }) {
  const navigate = useNavigate();
  const [existing, setExisting] = useState<Array<{ note: { id: string }; deckName: string }> | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    let live = true;
    findExistingNotes(word.hanzi).then((hits) => live && setExisting(hits)).catch(() => live && setExisting([]));
    return () => {
      live = false;
    };
  }, [word.hanzi, added]);
  return (
    <div className="clip-word-row">
      <span className="w">
        <b lang="zh-CN">{word.hanzi}</b>
        <small>{word.pinyin} · {word.english}</small>
        {existing && existing.length > 0 && <span className="have">📚 In {[...new Set(existing.map((e) => e.deckName))].join(', ')}</span>}
      </span>
      {existing && existing.length > 0 ? (
        <BumpButton noteIds={existing.map((e) => e.note.id)} source="other" compact label="⚡ Today" />
      ) : added ? (
        <span className="have" role="status">✓ Added</span>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} data-testid="clip-add-card">+ Add</button>
      )}
      {adding && (
        <AddChunkModal
          source="other"
          chunk={{ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english }}
          onOpenCard={(noteId) => navigate(`/cards/${noteId}`)}
          onAdded={() => {
            setAdded(true);
            track('clips.learn_more', { action: 'add_card', status: 'started' });
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
