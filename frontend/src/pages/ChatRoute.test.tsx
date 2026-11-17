/**
 * `/connections/:relId/chat/:convId` (ChatRoute): an OLD Claude practice chat opened by its link goes
 * to its Claude thread `/chats/claude/pc-<id>` (the page with a person is never shown for it); a chat
 * with a person opens the chat page (docs/CHAT.md "Practice with Claude" → "Old practice chats").
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./ChatPage', () => ({ ChatPage: () => <div data-testid="person-chat">chat with a person</div> }));
vi.mock('../api/client', () => ({
  getConversations: vi.fn(async () => [
    { id: 'c-ai', relationship_id: 'rel-ai', is_ai_conversation: true },
    { id: 'c-home', relationship_id: 'rel-ai', is_ai_conversation: false },
  ]),
}));

import { ChatRoute } from './ChatRoute';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function Thread() {
  const location = useLocation();
  return <div data-testid="claude-thread">{location.pathname}</div>;
}

async function open(path: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/connections/:relId/chat/:convId" element={<ChatRoute />} />
            <Route path="/connections/:relId/chat" element={<ChatRoute />} />
            <Route path="/chats/claude/:id" element={<Thread />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  // The conversation list resolves, then the redirect renders.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

describe('ChatRoute', () => {
  it('an old practice chat opens its Claude thread', async () => {
    const el = await open('/connections/rel-ai/chat/c-ai');
    expect(el.querySelector('[data-testid="claude-thread"]')?.textContent).toBe('/chats/claude/pc-c-ai');
    expect(el.querySelector('[data-testid="person-chat"]')).toBeNull();
  });

  it('a chat with a person opens the chat page', async () => {
    const el = await open('/connections/rel-ai/chat/c-home');
    expect(el.querySelector('[data-testid="person-chat"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="claude-thread"]')).toBeNull();
  });

  it('the one chat with a person (no id) opens the chat page', async () => {
    const el = await open('/connections/rel-ai/chat');
    expect(el.querySelector('[data-testid="person-chat"]')).not.toBeNull();
  });
});
