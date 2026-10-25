/**
 * Homework / lesson rows: the retry bar only once started (blue + orange owed), and the ⋯ menu with
 * the shared actions — Skip this homework asks first and says the tutor will see it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { retryBar, type HomeHomeworkRow } from '@shared/homework';

vi.mock('../../services/homework', () => ({ recordSkip: vi.fn(async () => ({ id: 'k1' })), recordUndoOf: vi.fn(async () => undefined), KIND_ICON: {}, titleParts: (a: { title: string }) => ({ base: a.title, part: null }) }));
vi.mock('../../services/lessonLearn', () => ({ markLessonDone: vi.fn(async () => 'm1'), stepOptions: () => ({ skipHandwriting: false }), homeLessonOf: vi.fn(), lessonSize: vi.fn(), revisionSize: vi.fn() }));
vi.mock('../../services/analytics', () => ({ track: vi.fn() }));
vi.mock('../../db/database', () => ({ db: { customLessons: { get: vi.fn(async () => undefined) } }, getStudyCutoff: () => ({ ts: 0 }) }));

import { HomeworkRowSlim, useSlimRowMenu } from '../home/HomeworkHomeCard';
import { recordSkip } from '../../services/homework';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<MemoryRouter>{el}</MemoryRouter>));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = '';
  root = null;
});

const row = (over: Partial<HomeHomeworkRow> = {}): HomeHomeworkRow => ({
  key: 'a1', kind: 'deck', icon: '📚', title: '餐厅点菜', progress: '2 / 6', size: '6 words', bar: null,
  assignment_id: 'a1', lesson_id: null, due: 'due today', tone: 'today', route: '/homework/a1', tutor_name: '明慧老师', ...over,
});

function List({ rows }: { rows: HomeHomeworkRow[] }) {
  const menu = useSlimRowMenu('home');
  return <>{rows.map((r) => <HomeworkRowSlim key={r.key} row={r} onMenu={menu.onMenu} />)}{menu.element}</>;
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('homework rows', () => {
  it('no bar until started; then blue answered + orange owed', () => {
    const el = render(<List rows={[row(), row({ key: 'a2', assignment_id: 'a2', bar: retryBar({ answered: 3, fresh: 3, retries: 1, itemsDone: 2, items: 6 }) })]} />);
    const bars = el.querySelectorAll('[data-testid="hw-row-bar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('data-retries')).toBe('1');
    expect(bars[0].getAttribute('data-answered')).toBe('3');
  });

  it('⋯ → Skip this homework → the confirm names the tutor → a skip event', async () => {
    const el = render(<List rows={[row()]} />);
    act(() => (el.querySelector('[data-testid="row-menu-btn"]') as HTMLButtonElement).click());
    await flush();
    const skip = document.querySelector('[data-testid="row-action-skip_homework"]') as HTMLButtonElement;
    expect(skip.textContent).toContain('Skip this homework');
    expect(document.querySelector('[data-testid="row-action-delete_lesson"]')).toBeNull();
    act(() => skip.click());
    expect(document.querySelector('[data-testid="row-actions-confirm"]')?.textContent).toBe('Skip “餐厅点菜”? 明慧老师 will see it as skipped. You can undo this.');
    act(() => (document.querySelector('[data-testid="row-actions-confirm-go"]') as HTMLButtonElement).click());
    await flush();
    expect(recordSkip).toHaveBeenCalledWith('a1');
    expect(document.querySelector('[data-testid="row-actions-toast"]')?.textContent).toContain('Skipped — 明慧老师 will see it');
    expect(document.querySelector('[data-testid="row-actions-undo"]')).not.toBeNull();
  });

  it('a revision offers Stop revising — done for good and Delete lesson', async () => {
    const el = render(<List rows={[row({ key: 'revision:l1', kind: 'revision', assignment_id: null, lesson_id: 'l1', tutor_name: null })]} />);
    act(() => (el.querySelector('[data-testid="row-menu-btn"]') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('[data-testid="row-action-done_for_good"]')?.textContent).toContain('Stop revising — done for good');
    expect(document.querySelector('[data-testid="row-action-delete_lesson"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="row-action-skip_homework"]')).toBeNull();
  });
});
