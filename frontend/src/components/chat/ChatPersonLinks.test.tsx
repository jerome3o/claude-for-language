/**
 * The chat is the way to the person's page now that the learner's Tutor tab is gone (Nov 2026):
 * the header's name / avatar links to `/connections/:relId`, the ⋯ menu lists the page's parts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { chatPersonLinks, chatPersonPath } from '@shared/chats/personLinks';

const tracked: Array<[string, unknown]> = [];
vi.mock('../../services/analytics', () => ({ track: (name: string, props: unknown) => tracked.push([name, props]) }));

import { ChatHeaderPerson, ChatPersonMenuLinks } from './ChatPersonLinks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.hash}</div>;
}

describe('ChatPersonLinks', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    tracked.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (ui: React.ReactNode) =>
    act(() =>
      root.render(
        <MemoryRouter initialEntries={['/connections/r1/chat/c1']}>
          <Routes>
            <Route path="*" element={<>{ui}<Where /></>} />
          </Routes>
        </MemoryRouter>,
      ),
    );
  const where = () => host.querySelector('[data-testid="where"]')!.textContent;

  it('the header name opens the tutor page', () => {
    render(<ChatHeaderPerson path={chatPersonPath('r1', false)} name="明慧"><span className="chat-header-name">明慧</span></ChatHeaderPerson>);
    const link = host.querySelector<HTMLAnchorElement>('[data-testid="chat-header-person"]')!;
    expect(link.getAttribute('href')).toBe('/connections/r1');
    expect(link.getAttribute('aria-label')).toBe('明慧 page');
    act(() => link.click());
    expect(where()).toBe('/connections/r1');
    expect(tracked).toEqual([['chat.person_link', { link: 'header' }]]);
  });

  it('a Claude chat header is not a link', () => {
    render(<ChatHeaderPerson path={chatPersonPath('r1', true)} name="Claude"><span>Claude</span></ChatHeaderPerson>);
    expect(host.querySelector('[data-testid="chat-header-person"]')).toBeNull();
    expect(host.querySelector('.chat-header-user')?.textContent).toBe('Claude');
  });

  it('the ⋯ menu lists the tutor page parts and lands on their sections', () => {
    const onPick = vi.fn();
    render(<ChatPersonMenuLinks links={chatPersonLinks({ relationshipId: 'r1', otherName: '明慧', viewerRole: 'student', isAi: false })} onPick={onPick} />);
    const items = [...host.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
    expect(items.map((a) => a.getAttribute('data-testid'))).toEqual([
      'chat-person-link-person', 'chat-person-link-lesson_board', 'chat-person-link-homework', 'chat-person-link-flags', 'chat-person-link-tutor_notes',
    ]);
    expect(items.map((a) => a.getAttribute('href'))).toEqual([
      '/connections/r1', '/connections/r1/board', '/connections/r1#homework', '/connections/r1#flags', '/tutor-notes',
    ]);
    expect(items[2].textContent).toContain('Homework from 明慧');
    act(() => items[3].click());
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/connections/r1#flags');
    expect(tracked).toEqual([['chat.person_link', { link: 'flags' }]]);
  });

  it('nothing (not even the divider) without links', () => {
    render(<ChatPersonMenuLinks links={[]} onPick={() => {}} />);
    expect(host.querySelector('[role="separator"]')).toBeNull();
  });
});
