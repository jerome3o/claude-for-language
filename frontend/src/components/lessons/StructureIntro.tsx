/**
 * "▶ Watch the intro" on a structure card (docs/STUDY_SESSION.md "Structure intro"): the card's intro clip
 * (shared/lesson/patternIntro.ts) played full screen by the 🎬 Clips player — a title, the pattern building
 * up, the examples read with their parts lighting up, a closing line; captions with 拼 / EN, pause on tap,
 * ↻ Watch again. Nothing starts until he taps ▶; nothing is recorded (no clip events) but analytics.
 * Audio: the lines are the app voice at the clip speed, prefetched with the lesson, so it plays offline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipRecord } from '@shared/clips';
import { clipHash } from '@shared/clips';
import type { StructureCard } from '@shared/lesson/pattern';
import { patternIntroClip } from '@shared/lesson/patternIntro';
import { ClipPlayer } from '../clips/ClipPlayer';
import { loadClipPrefs, saveClipPrefs, type ClipCaptionPrefs } from '../../services/clips';
import { track } from '../../services/analytics';
import '../clips/clips.css';

export function StructureIntro({ card, source, index, count, onClose }: {
  card: StructureCard;
  source: 'spec' | 'parsed';
  index: number;
  count: number;
  onClose: () => void;
}) {
  const spec = useMemo(() => patternIntroClip(card), [card]);
  const clip: ClipRecord = useMemo(() => ({
    id: `intro-${clipHash(JSON.stringify(spec))}`,
    status: 'ready',
    source: 'generated',
    title: spec.title,
    topic: null,
    theme: spec.style.theme,
    spec,
    images: {},
    progress: null,
    error: null,
    created_at: '',
    state: { viewed: false, completed: false, liked: false, saved: false, skips: 0 },
    lesson: null,
  }), [spec]);
  const [prefs, setPrefs] = useState<ClipCaptionPrefs>(() => loadClipPrefs());
  const finished = useRef(false);
  const props = { source, index, count, scenes: spec.scenes.length };

  useEffect(() => {
    track('lesson.structure_intro', { action: 'play', ...props });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (!finished.current) track('lesson.structure_intro', { action: 'close', ...props });
    onClose();
  };

  return createPortal(
    <div className="structure-intro" role="dialog" aria-label="Structure intro" data-testid="structure-intro">
      <ClipPlayer
        clip={clip}
        active
        prefs={prefs}
        onPrefs={(p) => { setPrefs(p); saveClipPrefs(p); }}
        onLike={() => {}}
        onSave={() => {}}
        onLearnMore={() => {}}
        onComplete={(durationMs) => {
          finished.current = true;
          track('lesson.structure_intro', { action: 'finish', duration_ms: durationMs, ...props });
        }}
        onInteract={() => {}}
        onExplore={() => {}}
        intro={{ onDone: onClose }}
      />
      <button type="button" className="structure-intro-close" onClick={close} aria-label="Close the intro" data-testid="structure-intro-close">✕</button>
    </div>,
    document.body,
  );
}
