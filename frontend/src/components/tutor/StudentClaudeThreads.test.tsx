/**
 * The tutor's "Asked Claude" list (components/tutor/StudentClaudeThreads.tsx) and the learner's
 * Settings → Chat → "Your tutor can see" (components/ChatSettingsSection.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TutorClaudeThread } from '@shared/claude/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const api = vi.hoisted(() => ({ setClaudeTutorVisibility: vi.fn() }));
vi.mock('../../api/claudeThreads', () => api);
const auth = vi.hoisted(() => ({ user: { id: 'u1', role: 'student', chat_auto_check: null, claude_tutor_visibility: 'card_only' } as Record<string, unknown>, refreshUser: vi.fn(async () => {}) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../services/push', () => ({ setChatAutoCheck: vi.fn() }));

import { StudentClaudeThreadList, emptyClaudeText } from './StudentClaudeThreads';
import { ClaudeTutorVisibilitySetting } from '../ChatSettingsSection';

const T0 = '2026-11-03T10:00:00.000Z';
const thread = (id: string, over: Partial<TutorClaudeThread>): TutorClaudeThread => ({
  id, title: '行怎么读？', context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行' }, badge: { icon: '📇', text: 'Asked on card · 银行' },
  preview: '这里读 háng。', last_message_at: T0, created_at: T0, message_count: 2, shared: false, ...over,
});

let host: HTMLDivElement;
let root: Root;
const all = (id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  api.setClaudeTutorVisibility.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('StudentClaudeThreadList', () => {
  it('one row per chat with its context chip; the card chip opens her card hub view; a row opens the chat read-only', async () => {
    const threads = [
      thread('nq-q1', {}),
      thread('th-p', { title: '我要一碗米饭。', context_kind: 'practice', context: { kind: 'practice', scenario: '在饭店点菜' }, badge: { icon: '🎭', text: 'Practice · 在饭店点菜' }, shared: true }),
    ];
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/connections/rel-1']}>
          <Routes>
            <Route path="/connections/rel-1" element={<StudentClaudeThreadList threads={threads} relId="rel-1" from="student_page" emptyText="none" />} />
            <Route path="/connections/:relId/cards/:noteId" element={<div data-testid="hub" />} />
            <Route path="/connections/:relId/claude/:id" element={<div data-testid="thread" />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    const chips = all('student-claude-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['📇 Asked on card · 银行', '🎭 Practice · 在饭店点菜']);
    expect(chips[0].tagName).toBe('A');
    expect(chips[1].tagName).toBe('SPAN');
    expect(all('student-claude-thread')[1].textContent).toContain('👁 shared with you');
    await act(async () => chips[0].click());
    expect(all('hub')).toHaveLength(1);
  });

  it('the empty list says what the student shares, never what he keeps', () => {
    expect(emptyClaudeText('Jerome', 'card_only')).toBe('Jerome has not asked Claude about a card yet. Other chats with Claude are private unless they share them.');
    expect(emptyClaudeText(null, 'all')).toBe('The student has not chatted with Claude yet.');
    expect(emptyClaudeText('Jerome', 'none')).toContain('private');
  });
});

describe('Settings → Chat → Your tutor can see', () => {
  it('card questions by default; picking All saves it and says so in analytics', async () => {
    api.setClaudeTutorVisibility.mockResolvedValue({ claude_tutor_visibility: 'all' });
    await act(async () => root.render(<ClaudeTutorVisibilitySetting />));
    const radio = (id: string) => host.querySelector(`[data-testid="claude-tutor-visibility-${id}"] input`) as HTMLInputElement;
    expect(radio('card_only').checked).toBe(true);
    expect(host.textContent).toContain('Card questions (default)');
    await act(async () => radio('all').click());
    expect(api.setClaudeTutorVisibility).toHaveBeenCalledWith('all');
    expect(radio('all').checked).toBe(true);
    expect(track).toHaveBeenCalledWith('claude.share_with_tutor', { on: true, scope: 'account', visibility: 'all' });
    await act(async () => radio('card_only').click());
    // Back to the default is stored as null.
    expect(api.setClaudeTutorVisibility).toHaveBeenLastCalledWith(null);
  });
});
