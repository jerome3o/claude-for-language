/**
 * "Review together" (shared/call-activities `review`; docs/RECORDING_REVIEW.md "In the call"):
 * the student's recordings that need the tutor's ear, cards they flagged and the tutor's recent
 * needs-work marks. Both people see the same list and the same selected item; either selects and
 * plays — "Play for both" bumps the room's counter and each device plays the clip itself (never
 * through the screen share). Only the tutor marks (a real mark: recordings page, the student's card).
 */

import { useEffect, useState } from 'react';
import { reviewMarkOf, type ReviewSpec } from '@shared/call-activities';
import { diffHanzi } from '@shared/lesson/answer-check';
import type { BodyProps } from './ActivityViews';

const SOURCE_LABEL: Record<string, string> = { recording: '🎤', flag: '🚩', needs_work: '🔁' };
const KIND_LABEL: Record<string, string> = { tone: 'tone', sound: 'sound', missing: 'missed', extra: 'extra' };

export function ReviewView({ session: s, host, act, can, spec }: BodyProps & { spec: ReviewSpec }) {
  const item = spec.items[s.round];
  const sessionMark = item ? reviewMarkOf(s, s.round) : null;
  const mark = sessionMark ?? item?.mark ?? null;
  const [comment, setComment] = useState('');
  useEffect(() => {
    setComment(sessionMark?.comment ?? '');
  }, [s.round, sessionMark?.comment]);

  if (!spec.items.length) {
    return (
      <div className="act-center" data-testid="review-empty">
        <div className="act-emoji" aria-hidden="true">🎧</div>
        <p className="act-instr">Nothing needs your ear right now — no recordings in the queue, no flagged cards.</p>
      </div>
    );
  }

  const weak = new Map(item.weak.map((w) => [w.char, w.kind]));
  const heard = item.transcript ? diffHanzi(item.transcript, item.hanzi) : null;

  return (
    <div className="act-review" data-testid="review-activity">
      <ol className="act-review-list" aria-label="To review">
        {spec.items.map((it, i) => {
          const m = reviewMarkOf(s, i) ?? it.mark;
          return (
            <li key={it.id}>
              <button
                type="button"
                className={`act-review-row${i === s.round ? ' on' : ''}`}
                aria-current={i === s.round}
                disabled={i !== s.round && !can({ type: 'select', index: i })}
                onClick={() => i !== s.round && act({ type: 'select', index: i })}
                data-testid="review-row"
              >
                <span className="act-review-src" aria-hidden="true">{SOURCE_LABEL[it.source] ?? '•'}</span>
                <span className="act-review-hanzi">{it.hanzi}</span>
                <span className="act-review-why">{it.labels[0] ?? ''}</span>
                {m && <span className={`act-review-mark ${m.status}`}>{m.status === 'listened' ? '✓' : '✎'}</span>}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="act-review-detail" data-testid="review-detail">
        <div className="act-review-word">
          <span className="act-hanzi" data-testid="review-hanzi">
            {Array.from(item.hanzi).map((ch, i) => (
              <span key={i} className={weak.has(ch) ? `act-weak ${weak.get(ch)}` : undefined} title={weak.has(ch) ? KIND_LABEL[weak.get(ch)!] : undefined}>{ch}</span>
            ))}
          </span>
          <span className="act-pinyin">{item.pinyin} · {item.english}</span>
        </div>
        {item.labels.length > 0 && (
          <div className="act-chips" data-testid="review-labels">
            {item.labels.map((l) => <span key={l} className="act-chip static">{l}</span>)}
          </div>
        )}
        {heard && (
          <p className="act-review-heard" data-testid="review-heard">
            Heard:{' '}
            {heard.typed.map((c, i) => <span key={i} className={c.hit ? undefined : 'act-off'}>{c.ch}</span>)}
          </p>
        )}
        {item.flag_message && <p className="act-review-flag" data-testid="review-flag">🚩 “{item.flag_message}”</p>}

        <div className="act-actions">
          {can({ type: 'play_clip', clip: 'recording' }) && (
            <button type="button" className="act-primary" onClick={() => act({ type: 'play_clip', clip: 'recording' })} data-testid="review-play-recording">
              🔊 Their recording — play for both
            </button>
          )}
          {can({ type: 'play_clip', clip: 'reference' }) && (
            <button type="button" className="act-secondary" onClick={() => act({ type: 'play_clip', clip: 'reference' })} data-testid="review-play-reference">
              🔊 Reference
            </button>
          )}
        </div>

        {host ? (
          <div className="act-review-marking">
            <textarea
              className="act-review-comment"
              rows={2}
              placeholder="A note for them (optional) — shown on the card"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              data-testid="review-comment"
            />
            <div className="act-actions">
              <button type="button" className={`act-secondary${mark?.status === 'listened' ? ' on' : ''}`} disabled={!can({ type: 'review_mark', status: 'listened', comment })} onClick={() => act({ type: 'review_mark', status: 'listened', comment })} data-testid="review-listened">
                ✓ Listened
              </button>
              <button type="button" className={`act-secondary warn${mark?.status === 'needs_work' ? ' on' : ''}`} disabled={!can({ type: 'review_mark', status: 'needs_work', comment })} onClick={() => act({ type: 'review_mark', status: 'needs_work', comment })} data-testid="review-needs-work">
                ✎ Needs work
              </button>
            </div>
          </div>
        ) : (
          mark && (
            <p className={`act-review-verdict ${mark.status}`} data-testid="review-verdict">
              {mark.status === 'listened' ? '✓ Listened' : '✎ Needs work'}{mark.comment ? ` — “${mark.comment}”` : ''}
            </p>
          )
        )}
      </div>
    </div>
  );
}

/** The R2 key the last "play for both" was for (null when nothing to play). */
export function reviewClipKey(spec: ReviewSpec, round: number, clip: 'recording' | 'reference' | null | undefined): string | null {
  const it = spec.items[round];
  if (!it || !clip) return null;
  return clip === 'recording' ? it.recording_key : it.reference_key;
}
