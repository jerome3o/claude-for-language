/**
 * Pictures on cards — one optional picture per note (migration 0123; docs/STUDY_SESSION.md
 * "Pictures on cards"). Pure rules shared by the worker, the web app and the Lab app
 * (`core/…/cards/NoteImage.kt`, parity-tested by `android-lab/parity/fixtures/note-image.ts`).
 *
 * WHERE the picture shows (Jerome, Oct 2026): the picture depicts the MEANING, so it may never
 * give away the answer of a card that tests the meaning.
 *   - meaning → hanzi: the English is the prompt, so the picture goes WITH it on the question
 *     side (picture + English = the clue), and stays on the answer side;
 *   - hanzi → meaning, audio → hanzi: the answer side only.
 *
 * WHAT is drawn: a friendly illustration of the meaning, never any writing (a picture with
 * 苹果 painted on it would be the answer of a meaning → hanzi card).
 */

import { formatUsd } from './check';

export type NoteImageSource = 'generated' | 'upload';
/** pending = being drawn, failed = the generator gave up (Regenerate tries again). */
export type NoteImageStatus = 'pending' | 'failed';
export type NoteImageCardType = 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';
export type CardSide = 'front' | 'back';

/**
 * Estimated cost of ONE generated picture, USD (the image model's list price for a ~1K square
 * picture, rounded up). Shown before "Illustrate this deck".
 */
export const NOTE_IMAGE_COST_USD = 0.07;
/** "Illustrate this deck" queues at most this many pictures per press. */
export const ILLUSTRATE_DECK_MAX = 500;
/** Longest side of an uploaded picture after the device resizes it. */
export const NOTE_IMAGE_UPLOAD_PX = 800;
/** Largest upload the server takes. */
export const NOTE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** Which sides of a card show the note's picture (see the header). */
export function noteImageSides(cardType: string): { front: boolean; back: boolean } {
  return { front: cardType === 'meaning_to_hanzi', back: true };
}

/**
 * Does this side of this card show a picture? `enabled` = Settings → Study → "Show pictures on
 * cards" (per device, on by default); `imageKey` = the note's picture (null = none).
 */
export function showNoteImage(cardType: string, side: CardSide, enabled: boolean, imageKey: string | null | undefined): boolean {
  if (!enabled || !imageKey) return false;
  const sides = noteImageSides(cardType);
  return side === 'front' ? sides.front : sides.back;
}

export interface NoteImageInput {
  hanzi: string;
  english: string;
  sentence_clue?: string | null;
  sentence_clue_translation?: string | null;
}

/** A note whose hanzi is a whole sentence (sentence punctuation, or long). */
export function isSentenceNote(hanzi: string): boolean {
  const t = (hanzi ?? '').trim();
  return /[。！？!?，,；;]/.test(t) || [...t].length > 8;
}

/** The consistent style every card picture is drawn in. */
export const NOTE_IMAGE_STYLE =
  'A friendly, simple flat illustration in a warm, consistent picture-book style: soft colours, clean shapes, ' +
  'one clear subject in the middle, a plain light background, square composition. ' +
  'Absolutely no text: no letters, no Chinese characters, no numbers, no signs, no labels, no speech bubbles, no captions.';

function clean(s: string | null | undefined, max: number): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * The image prompt for a note: the MEANING (English; for a sentence the scene it describes), the
 * card's example sentence translation to pin the sense down, the house style. The Chinese is left
 * out on purpose — the model would paint the characters. `variant` > 0 = Regenerate (a new
 * picture, a different prompt hash).
 */
export function buildNoteImagePrompt(note: NoteImageInput, variant = 0): string {
  const english = clean(note.english, 200);
  const clue = clean(note.sentence_clue_translation, 200);
  const lines: string[] = [];
  if (isSentenceNote(note.hanzi)) {
    lines.push(`Illustrate this scene for a language-learning flashcard: "${english}".`);
  } else {
    lines.push(`Illustrate the meaning of "${english}" for a language-learning flashcard.`);
    if (clue) lines.push(`The sense meant here, as in: "${clue}".`);
    lines.push('Show the thing, action or feeling itself so a learner recognises the meaning at a glance.');
  }
  lines.push(NOTE_IMAGE_STYLE);
  if (variant > 0) lines.push(`Variation ${variant}: a different composition from earlier versions.`);
  return lines.join('\n');
}

export interface IllustrateEstimate {
  /** Pictures that would be made (notes without one, capped). */
  pictures: number;
  usd: number;
  label: string;
}

/** "24 pictures · about $1.68" — the estimate before "Illustrate this deck". */
export function estimateIllustrateCost(missing: number): IllustrateEstimate {
  const pictures = Math.max(0, Math.min(ILLUSTRATE_DECK_MAX, Math.floor(missing)));
  const usd = pictures * NOTE_IMAGE_COST_USD;
  const label = pictures === 0
    ? 'Every card already has a picture'
    : `${pictures} picture${pictures === 1 ? '' : 's'} · about ${formatUsd(usd)}`;
  return { pictures, usd, label };
}

export interface NoteImageFields {
  image_key?: string | null;
  image_source?: string | null;
  image_status?: string | null;
}

/** What the picture controls say about a note: none / ready / pending / failed. */
export function noteImageState(note: NoteImageFields): 'none' | 'ready' | 'pending' | 'failed' {
  if (note.image_status === 'pending') return 'pending';
  if (note.image_key) return 'ready';
  if (note.image_status === 'failed') return 'failed';
  return 'none';
}

/** The deck sheet's progress line: "18 of 24 cards have a picture · 6 being drawn". */
export function illustrateProgressLabel(p: { total: number; with_image: number; pending: number; failed: number }): string {
  const parts = [`${p.with_image} of ${p.total} card${p.total === 1 ? '' : 's'} ${p.with_image === 1 ? 'has' : 'have'} a picture`];
  if (p.pending > 0) parts.push(`${p.pending} being drawn`);
  if (p.failed > 0) parts.push(`${p.failed} couldn’t be drawn`);
  return parts.join(' · ');
}
