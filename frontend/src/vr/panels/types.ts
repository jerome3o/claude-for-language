import type { VrPanelSpec } from '@shared/vr';
import type { PanelView } from '../scene/WindowFrame';

/** What the page lends every panel. */
export interface PanelContext {
  /** Open (or focus) another window. */
  open(spec: VrPanelSpec, source: 'tap' | 'homework' | 'study'): void;
  /** Close this window. */
  close(): void;
  /** Start the 🎤 for this window (its answer, its search). */
  startSpeech(): void;
  /** The study session's current reader, so finishing it in the Reader window advances the session. */
  sessionReader: { current: { readerId: string; finish(ms: number): Promise<void> } | null };
  online: boolean;
  /** Bumped when the word segmenter finishes loading (views re-split their Chinese by word). */
  segVersion: number;
}

/** A panel's live state, reported by its host to the page. */
export interface PanelController {
  view: PanelView;
  onAction(action: string, source: string): void;
  /**
   * What was said while this window had focus. Returns a short label of what it did with it
   * (analytics `vr.speech` target), or null when the window takes no speech.
   */
  onSpeech?(text: string): string | null;
}

export interface PanelHostProps<S extends VrPanelSpec = VrPanelSpec> {
  spec: S;
  ctx: PanelContext;
  report(controller: PanelController): void;
}
