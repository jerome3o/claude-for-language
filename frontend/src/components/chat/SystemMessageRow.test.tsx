/**
 * System messages in the chat (docs/CHAT.md "System messages"): a centred row, third person
 * from the viewer's side, with the action button and the Copy menu — never a bubble.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { systemMessageView } from '@shared/chats/system';
import { SystemMessageRow } from './SystemMessageRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SystemMessageRow', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('the student reads the tutor’s budget change in the third person, no bubble', () => {
    const view = systemMessageView(
      { system_kind: 'study_budget', system_data: { new_cards_per_day: 2, secondary_cards_per_day: 5 } },
      { viewerIsSender: false, otherName: 'Minghui Wang' },
    )!;
    act(() => root.render(<SystemMessageRow view={view} time="9:41 AM" />));
    const row = host.querySelector('[data-testid="chat-system-message"]')!;
    expect(row.textContent).toContain('Minghui set your new cards to 2 a day (+5 extra)');
    expect(row.textContent).not.toMatch(/\bI've\b/);
    expect(host.querySelector('.chat-bubble')).toBeNull();
    expect(host.querySelector('[data-testid="chat-system-action"]')).toBeNull();
  });

  it('a live call has Join; a flag quotes the student and opens the card', () => {
    const onAction = vi.fn();
    const call = systemMessageView({ system_kind: 'call_started', system_data: { call_id: 'c1' } }, { viewerIsSender: false, otherName: 'Minghui' })!;
    act(() => root.render(<SystemMessageRow view={call} time="9:41 AM" onAction={onAction} />));
    const join = host.querySelector<HTMLButtonElement>('[data-testid="chat-system-action"]')!;
    expect(join.textContent).toBe('Join');
    act(() => join.click());
    expect(onAction).toHaveBeenCalledWith('/calls/c1');

    const flag = systemMessageView(
      { system_kind: 'card_flag', system_data: { note_id: 'n1', hanzi: '银行', message: '总是和很行搞混' } },
      { viewerIsSender: false, otherName: 'Jerome', relationshipId: 'rel-1' },
    )!;
    act(() => root.render(<SystemMessageRow view={flag} time="9:41 AM" onAction={onAction} />));
    expect(host.textContent).toContain('Jerome flagged 银行 for you');
    expect(host.querySelector('.chat-system-quote')?.textContent).toBe('“总是和很行搞混”');
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="chat-system-action"]')!.click());
    expect(onAction).toHaveBeenLastCalledWith('/connections/rel-1/cards/n1');
  });

  it('right-click opens the Copy menu; the install steps fold open', () => {
    const onMenu = vi.fn();
    const howto = systemMessageView({ system_kind: 'install_howto', system_data: { app_url: 'https://app.test' } }, { viewerIsSender: true, otherName: 'Jerome' })!;
    act(() => root.render(<SystemMessageRow view={howto} time="9:41 AM" onMenu={onMenu} />));
    expect(host.textContent).toContain('You sent Jerome how to install the app');
    expect(host.querySelector('.chat-system-body')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('.chat-system-more')!.click());
    expect(host.querySelector('.chat-system-body')?.textContent).toContain('open https://app.test in Chrome');
    act(() => {
      host.querySelector('[data-testid="chat-system-message"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }));
    });
    expect(onMenu).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
});
