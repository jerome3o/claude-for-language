/**
 * 💬 Ask Claude on a mini lesson exercise (components/lessons/ExerciseClaude.tsx): a real run of one of
 * his lessons opens the exercise's Claude thread — his checked answer riding with the context — and a
 * preview (no stored lesson) offers nothing, so the answer check keeps its old inline chat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../claude/ContextClaudeSheet', () => ({
  default: (p: { context: unknown; fields: unknown; onResolved?: (r: boolean) => void }) => {
    p.onResolved?.(true);
    return <div data-testid="context-claude-sheet" data-context={JSON.stringify(p.context)} data-fields={JSON.stringify(p.fields)} />;
  },
}));

import { ExerciseClaudeProvider, exerciseAnswerOf, useExerciseClaude, type ExerciseClaudeTarget } from './ExerciseClaude';
import type { AnswerCheck } from '@shared/lesson/answerCheck';

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

const CHECK: AnswerCheck = {
  verdict: 'almost',
  headline: 'Nearly — the object goes before the verb.',
  corrected: '我把书放在桌子上。',
  corrected_pinyin: '',
  tips: [{ text: 'Use 把 here', quote: '放书' }],
  suggested: 'missed_it',
};

function Asker({ answer }: { answer?: boolean }) {
  const claude = useExerciseClaude();
  return (
    <button type="button" data-testid="ask" data-available={claude ? 'yes' : 'no'} onClick={() => claude?.ask(answer ? 'answer_check' : 'toolbar', answer ? exerciseAnswerOf(' 我放书在桌子上。 ', CHECK) : null)}>
      ask
    </button>
  );
}

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

const TARGET: ExerciseClaudeTarget = { lessonId: 'ls1', lessonTitle: '把字句', exerciseKey: 's0e1', exerciseType: 'translate' };

describe('ExerciseClaudeProvider', () => {
  it('his checked answer rides with the exercise context (the check trimmed); analytics say where from', async () => {
    await act(async () => root.render(<ExerciseClaudeProvider target={TARGET}><Asker answer /></ExerciseClaudeProvider>));
    await act(async () => q('ask')!.click());
    for (let i = 0; i < 30 && !q('context-claude-sheet'); i++) await flush();
    const answer = { text: '我放书在桌子上。', verdict: 'almost', headline: 'Nearly — the object goes before the verb.', corrected: '我把书放在桌子上。', tips: ['放书: Use 把 here'] };
    expect(JSON.parse(q('context-claude-sheet')!.dataset.context!)).toEqual({
      kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1', exercise_type: 'translate', answer, label: 'Translate', sublabel: '把字句',
    });
    expect(JSON.parse(q('context-claude-sheet')!.dataset.fields!)).toEqual({ answer });
    expect(track).toHaveBeenCalledWith('lesson.exercise_ask', { from: 'answer_check', exercise_type: 'translate', verdict: 'almost', resumed: true });
  });

  it('the top bar: no answer (null clears an older one); no target (a preview) → nothing offered', async () => {
    await act(async () => root.render(<ExerciseClaudeProvider target={TARGET}><Asker /></ExerciseClaudeProvider>));
    await act(async () => q('ask')!.click());
    for (let i = 0; i < 30 && !q('context-claude-sheet'); i++) await flush();
    expect(JSON.parse(q('context-claude-sheet')!.dataset.fields!)).toEqual({ answer: null });
    expect(JSON.parse(q('context-claude-sheet')!.dataset.context!).answer).toBeUndefined();

    await act(async () => root.render(<ExerciseClaudeProvider target={null}><Asker /></ExerciseClaudeProvider>));
    expect(q('ask')!.dataset.available).toBe('no');
  });
});
