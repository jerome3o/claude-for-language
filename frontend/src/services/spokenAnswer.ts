/**
 * "Say the answer" on a typing card (meaning → hanzi, audio → hanzi; docs/STUDY_SESSION.md):
 * 🎤 opens the SAME recorder + live Soniox stream as a read card's take (hooks/useAudio.ts
 * `useAudioRecorder`, services/liveTranscription.ts `LiveTranscriber`); the transcript shows in the
 * answer box as it is spoken (confirmed text + the provisional tail); 🎤 again stops it and the
 * final text becomes the answer — checked at once when "Submit spoken answers automatically" is on.
 *
 * The fallback is the read card's: live missing / failing / empty → the take is uploaded to
 * POST /api/transcribe (`transcribeTakeOutcome`). Never silent: both failing leaves the box as it was
 * with "Couldn't transcribe — tap to retry" (the same take again, upload only), and nothing is
 * submitted. The take stays in the recorder, so the review carries it (recording_url) like a read
 * card's; the review's answer is the transcript.
 *
 * Pure apart from the injected recorder / transcriber / upload, so every branch is unit-tested
 * (spokenAnswer.test.ts). Lab twin: StudyViewModel `startSpokenAnswer` / `stopSpokenAnswer`.
 */
import type { TranscriptionResult } from '../api/client';
import { transcribeTakeOutcome, type TakeOutcome } from './takeTranscription';
import { liveErrorKind } from '@shared/transcription/soniox';

export type SpokenPhase = 'idle' | 'listening' | 'finishing' | 'failed';
/** Why a take gave no answer: both paths failed / went offline (retry the take) or nothing was heard. */
export type SpokenFailure = 'failed' | 'offline' | 'empty';

export interface SpokenAnswerState {
  phase: SpokenPhase;
  /** Confirmed so far (black). */
  finalText: string;
  /** Still provisional (grey). */
  partialText: string;
  failure: SpokenFailure | null;
}

export const IDLE_SPOKEN: SpokenAnswerState = { phase: 'idle', finalText: '', partialText: '', failure: null };

/** The live stream of one take (a `LiveTranscriber`). */
export interface LiveLike {
  push(chunk: Blob): void;
  finish(): Promise<string>;
  abort(): void;
}

export type SpokenResult = 'submitted' | 'filled' | 'failed' | 'empty' | 'cancelled';

export interface SpokenAnswerDeps {
  /** Opens the microphone; true once it records. `onStop` gets the whole take. */
  startRecorder(hooks: { onChunk: (chunk: Blob) => void; onStop: (take: Blob) => void }): Promise<boolean>;
  stopRecorder(): void;
  /** Stop and throw the take away. */
  cancelRecorder(): void;
  /** Drop a finished take (Cancel while finishing). */
  discardTake(): void;
  /** A live transcriber for this take, or null (no key / offline → upload only). */
  createLive(onUpdate: (finalText: string, partialText: string) => void): LiveLike | null;
  upload(take: Blob, liveError: string | null): Promise<TranscriptionResult>;
  isOnline(): boolean;
  autoSubmit(): boolean;
  onState(state: SpokenAnswerState): void;
  /** The answer: put it in the box (and check it when `submit`). */
  onResult(text: string, submit: boolean): void;
  /** The live stream was refused (key etc.): reason as given, for the key cache. */
  onLiveError?(reason: string): void;
  track(result: SpokenResult, props: { via: string; live_error: string; speech_ms: number; ms: number; auto_submit: boolean }): void;
  now?(): number;
}

export class SpokenAnswerController {
  private state: SpokenAnswerState = IDLE_SPOKEN;
  /** Bumped by every take / cancel: a slower, older result never lands. */
  private generation = 0;
  private live: LiveLike | null = null;
  private take: Blob | null = null;
  private recording = false;
  private stopWanted = false;
  private startedAt = 0;
  /** When the result started being waited for (Stop, or a retry): `ms`. */
  private stoppedAt = 0;
  /** How long the microphone was open: `speech_ms`. */
  private speechMs = 0;

  constructor(private readonly deps: SpokenAnswerDeps) {}

  get current(): SpokenAnswerState {
    return this.state;
  }

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private set(next: SpokenAnswerState) {
    this.state = next;
    this.deps.onState(next);
  }

  /** 🎤: start listening (online only — the button is disabled offline). */
  async start(): Promise<void> {
    if (this.state.phase === 'listening' || this.state.phase === 'finishing') return;
    if (!this.deps.isOnline()) return;
    const gen = ++this.generation;
    this.take = null;
    this.stopWanted = false;
    this.recording = false;
    this.live?.abort();
    const live = this.deps.createLive((finalText, partialText) => {
      if (gen !== this.generation || this.state.phase !== 'listening') return;
      this.set({ ...this.state, finalText, partialText });
    });
    this.live = live;
    this.startedAt = this.now();
    this.stoppedAt = 0;
    this.speechMs = 0;
    this.set({ phase: 'listening', finalText: '', partialText: '', failure: null });
    const ok = await this.deps.startRecorder({
      onChunk: (chunk) => { if (gen === this.generation) live?.push(chunk); },
      onStop: (take) => { void this.stopped(gen, take); },
    });
    if (gen !== this.generation) return; // cancelled while the microphone was opening
    if (!ok) {
      live?.abort();
      this.live = null;
      this.set(IDLE_SPOKEN); // the recorder's own error says why
      return;
    }
    this.recording = true;
    if (this.stopWanted) this.stop();
  }

  /** 🎤 again (⏹): stop; the transcript becomes the answer. */
  stop(): void {
    if (this.state.phase !== 'listening') return;
    if (!this.recording) {
      this.stopWanted = true; // the microphone isn't open yet: stop as soon as it is
      return;
    }
    this.recording = false;
    this.stoppedAt = this.now();
    this.speechMs = this.stoppedAt - this.startedAt;
    this.set({ ...this.state, phase: 'finishing' });
    this.deps.stopRecorder();
  }

  /** ✕ while listening / finishing: nothing is filled in, the take is thrown away. */
  cancel(): void {
    const phase = this.state.phase;
    if (phase === 'idle') return;
    this.generation++;
    this.live?.abort();
    this.live = null;
    if (phase === 'listening') {
      this.speechMs = this.now() - this.startedAt;
      this.deps.cancelRecorder();
    } else this.deps.discardTake();
    this.take = null;
    this.recording = false;
    if (phase !== 'failed') this.report('cancelled', null, 0);
    this.set(IDLE_SPOKEN);
  }

  /** "Couldn't transcribe — tap to retry": the same take, upload only. */
  async retry(): Promise<void> {
    if (this.state.phase !== 'failed' || this.state.failure === 'empty' || !this.take) return;
    const gen = ++this.generation;
    this.stoppedAt = this.now();
    this.set({ ...this.state, phase: 'finishing', failure: null });
    const take = this.take;
    const outcome = await transcribeTakeOutcome({ live: null, upload: (e) => this.deps.upload(take, e), isOnline: () => this.deps.isOnline() });
    if (gen === this.generation) this.land(outcome, false);
  }

  /** The card went away. */
  dispose(): void {
    this.generation++;
    this.live?.abort();
    this.live = null;
    if (this.state.phase === 'listening') this.deps.cancelRecorder();
  }

  private async stopped(gen: number, take: Blob) {
    if (gen !== this.generation) return;
    this.take = take;
    if (!this.stoppedAt) {
      // The recorder stopped by itself (the track ended): that is the Stop.
      this.stoppedAt = this.now();
      this.speechMs = this.stoppedAt - this.startedAt;
    }
    const live = this.live;
    this.live = null;
    const outcome = await transcribeTakeOutcome({
      live: live ? live.finish() : null,
      upload: (e) => this.deps.upload(take, e),
      isOnline: () => this.deps.isOnline(),
    });
    if (gen !== this.generation) return;
    if (outcome.liveError) this.deps.onLiveError?.(outcome.liveError);
    this.land(outcome, !!live);
  }

  private land(outcome: TakeOutcome, streamed: boolean) {
    const ms = Math.max(0, this.now() - this.stoppedAt);
    if (outcome.kind === 'done' && outcome.text.trim()) {
      const submit = this.deps.autoSubmit();
      this.report(submit ? 'submitted' : 'filled', outcome, ms, streamed);
      this.set(IDLE_SPOKEN);
      this.deps.onResult(outcome.text.trim(), submit);
      return;
    }
    const failure: SpokenFailure = outcome.kind === 'done' ? 'empty' : outcome.kind === 'offline' ? 'offline' : 'failed';
    this.report(failure === 'empty' ? 'empty' : 'failed', outcome, ms, streamed);
    this.set({ phase: 'failed', finalText: '', partialText: '', failure });
  }

  private report(result: SpokenResult, outcome: TakeOutcome | null, ms: number, streamed = false) {
    this.deps.track(result, {
      via: outcome?.kind === 'done' ? outcome.via : 'none',
      live_error: streamed ? liveErrorKind(outcome?.liveError) : 'none',
      speech_ms: Math.max(0, this.speechMs),
      ms,
      auto_submit: this.deps.autoSubmit(),
    });
  }
}
