/**
 * E2E_TEST_MODE only (docs/AUDIO_LESSONS.md "Tests"): a stand-in for Claude and
 * for the TTS providers, so the whole pipeline — agent loop, synthesis,
 * rendering, the player — runs in the E2E suite without keys.
 */
import { SAMPLE_DIALOGUE_PLAN, SAMPLE_SLEEP_PLAN, type AudioLessonFormat } from '@shared/audio-lesson';
import { assembleMp3, emptyFrame, LESSON_MP3 } from './mp3';

/**
 * A "clip": silence about as long as the text would take to say, as real
 * lesson-format frames (16 kbps, so they are not the renderer's own silence frame).
 */
export function fakeClip(text: string, rate: number): Uint8Array {
  const ms = Math.max(300, ([...text].length * 180) / Math.max(rate, 0.5));
  const frame = emptyFrame(16, LESSON_MP3);
  const frames = new Array<Uint8Array>(Math.round(ms / 24)).fill(frame);
  return assembleMp3([{ kind: 'frames', frames }]).bytes;
}

/** The fake model's answer: the sample plan, as a `submit_lesson` tool call. */
export function fakeModelResponse(format: AudioLessonFormat, title?: string): { content: Array<Record<string, unknown>>; usage: Record<string, number>; stop_reason: string } {
  const plan = format === 'dialogue' ? { ...SAMPLE_DIALOGUE_PLAN } : { ...SAMPLE_SLEEP_PLAN };
  if (title) plan.title = title;
  return {
    stop_reason: 'tool_use',
    usage: { input_tokens: 1200, output_tokens: 900 },
    content: [{ type: 'tool_use', id: `toolu_fake_${format}`, name: 'submit_lesson', input: { plan } }],
  };
}
