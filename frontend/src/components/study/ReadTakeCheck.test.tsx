/**
 * A read card's take checked by Claude (shared/study/readTakeCheck.ts; docs/STUDY_SESSION.md "You said"):
 * Jerome's 我越学中文，越觉得英文很繁琐。 read as 我越学中文，越觉得英语很"繁琐"。 — the box shows "Checking…" (never
 * the bare ✗ Didn't match), then ≈ Close with Claude's reason; the quotes are gone from what he said; Hard mode's
 * question goes checking → close (≈ Nearly). Only the quotes differing = ✓ Match on the device, no call.
 * Offline → the device's verdict. The harness wires `useReadTakeCheck` + `YouSaid` the way StudyCard does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnswerCheck, AnswerCheckInput } from '@shared/lesson/answerCheck';
import { compareTranscription } from '@shared/recordings/transcript';
import { tidySpokenTranscript } from '@shared/cards/answer';
import { hardModeQuestionResult } from '@shared/study/hardMode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));

const CARD = '我越学中文，越觉得英文很繁琐。';
const PINYIN = 'wǒ yuè xué Zhōngwén, yuè juéde Yīngwén hěn fánsuǒ.';
const ENGLISH = 'The more I study Chinese, the more I find English to be complicated.';
const CLOSE: AnswerCheck = {
  verdict: 'almost', headline: 'You said 英语 — the card has 英文 (same meaning).', corrected: '', corrected_pinyin: '', tips: [], suggested: 'missed_it',
};

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(said: string, checker: (input: AnswerCheckInput) => Promise<{ check: AnswerCheck; cached: boolean }>, online = true) {
  const { useReadTakeCheck } = await import('./useReadTakeCheck');
  const { YouSaid } = await import('./YouSaid');
  const raw = compareTranscription(said, CARD, PINYIN);
  function Harness() {
    const rc = useReadTakeCheck({
      showingKey: 'c1', cardType: 'hanzi_to_meaning', hanzi: CARD, pinyin: PINYIN, english: ENGLISH,
      comparison: raw, transcribing: false, online, where: 'session', checker,
    });
    const take = rc.comparison!;
    const question = rc.checking ? 'checking' : hardModeQuestionResult({ take: { status: 'done', isMatch: take.isMatch, containsExpected: take.containsExpected, tonesOff: !!take.tonesOff } });
    return (
      <div data-testid="card" data-question={question}>
        <YouSaid
          hanzi={tidySpokenTranscript(raw.transcribedHanzi, CARD)}
          pinyin={tidySpokenTranscript(raw.transcribedPinyin, CARD)}
          isMatch={raw.isMatch}
          containsExpected={raw.containsExpected}
          tonesOff={!!raw.tonesOff}
          checking={rc.checking}
          claude={rc.claude}
          expected={CARD}
        />
      </div>
    );
  }
  await act(async () => { root.render(<Harness />); });
}

describe('a read card\'s take checked by Claude', () => {
  it('英语 for 英文: Checking… (not ✗), then ≈ Close with the reason; the quotes are gone', async () => {
    let resolve!: (v: { check: AnswerCheck; cached: boolean }) => void;
    const checker = vi.fn((_input: AnswerCheckInput) => new Promise<{ check: AnswerCheck; cached: boolean }>((r) => { resolve = r; }));
    await mount('我越学中文，越觉得英语很"繁琐"。', checker);
    expect(q('you-said')!.dataset.state).toBe('checking');
    expect(q('you-said-verdict')!.textContent).toContain('Checking…');
    expect(host.textContent).not.toContain('Didn’t match');
    expect(q('card')!.dataset.question).toBe('checking');
    // The slim diff against the card: 语 for 文 marked, the card's own punctuation.
    expect(q('you-said-hanzi')!.textContent).toBe('我越学中文，越觉得英语很繁琐。');
    expect(q('you-said-hanzi')!.querySelector('[data-kind="wrong"]')!.textContent).toBe('语');
    expect(q('you-said-pinyin')!.textContent).not.toContain('"');
    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker.mock.calls[0][0]).toMatchObject({ exercise_type: 'read_aloud', input: 'spoken', model_answer: CARD, answer: '我越学中文，越觉得英语很繁琐。', prompt_en: ENGLISH });
    await act(async () => { resolve({ check: CLOSE, cached: false }); });
    expect(q('you-said')!.dataset.state).toBe('close');
    expect(q('you-said-verdict')!.textContent).toBe('Close');
    expect(q('you-said-verdict')!.dataset.icon).toBe('approx');
    // ONE short line from the diff — not Claude's explanation.
    expect(q('you-said-reason')!.textContent).toBe('语 instead of 文');
    expect(q('card')!.dataset.question).toBe('close');
    expect(track).toHaveBeenCalledWith('study.read_take_check', expect.objectContaining({ verdict: 'almost', input: 'spoken', card_type: 'hanzi_to_meaning', where: 'session' }));
  });

  it('only the quotes differ: ✓ Match on the device, no Claude call', async () => {
    const checker = vi.fn();
    await mount('我越学中文，越觉得英文很"繁琐"。', checker);
    expect(q('you-said')!.dataset.state).toBe('match');
    expect(q('you-said-verdict')!.textContent).toBe('Match');
    expect(q('you-said-hanzi')!.textContent).toBe('我越学中文，越觉得英文很繁琐。');
    expect(checker).not.toHaveBeenCalled();
    expect(q('card')!.dataset.question).toBe('right');
  });

  it('wrong → ✗ Didn\'t match with ONE line (Claude\'s first sentence when the take is far off), never the tip', async () => {
    const checker = vi.fn(async () => ({ check: { ...CLOSE, verdict: 'wrong' as const, headline: 'That isn’t what the card says.', tips: [{ text: 'Read 繁琐 again slowly.' }] }, cached: false }));
    await mount('我今天不想去学校。', checker);
    expect(q('you-said')!.dataset.state).toBe('miss');
    expect(q('you-said-verdict')!.textContent).toBe('Didn’t match');
    expect(q('you-said-reason')!.textContent).toContain('That isn’t what the card says.');
    expect(q('you-said-tip')).toBeNull();
    expect(q('card')!.dataset.question).toBe('wrong');
  });

  it('offline: no call, the device\'s ✗ stands', async () => {
    const checker = vi.fn();
    await mount('我越学中文，越觉得英语很"繁琐"。', checker, false);
    expect(checker).not.toHaveBeenCalled();
    expect(q('you-said')!.dataset.state).toBe('miss');
    // The device's own one line (no Claude): what differs.
    expect(q('you-said-reason')!.textContent).toBe('语 instead of 文');
  });
});
