import { describe, expect, it } from 'vitest';
import { coachEntryTarget } from './CoachEntry';

const go = (qs: string, returnTo: string | null = null) => coachEntryTarget(new URLSearchParams(qs), returnTo);

describe('/coach → the Chats tab', () => {
  it('no params (and the widget\'s ?focus=1) → the Chats box', () => {
    expect(go('')).toEqual({ kind: 'redirect', to: '/chats?compose=1' });
    expect(go('focus=1')).toEqual({ kind: 'redirect', to: '/chats?compose=1' });
  });

  it('?c= → that thread', () => {
    expect(go('c=abc')).toEqual({ kind: 'redirect', to: '/chats/claude/abc' });
  });

  it('?text=&action= → a new thread with that intent; English text translates; Chinese waits in the box', () => {
    expect(go('text=我去了&action=check')).toEqual({ kind: 'redirect', to: '/chats/claude/new?text=%E6%88%91%E5%8E%BB%E4%BA%86&intent=check&source=coach_link' });
    expect(go('text=Good+morning')).toEqual({ kind: 'redirect', to: '/chats/claude/new?text=Good+morning&intent=translate&source=coach_link' });
    expect(go('text=我去了')).toEqual({ kind: 'redirect', to: '/chats?compose=1&text=%E6%88%91%E5%8E%BB%E4%BA%86' });
    expect(go('draft=银行')).toEqual({ kind: 'redirect', to: '/chats?compose=1&text=%E9%93%B6%E8%A1%8C' });
  });

  it('the two exceptions keep the Coach page: Open in Coach from a chat message, and a study card', () => {
    expect(go('text=我去了&action=check&from_message=m1')).toEqual({ kind: 'coach' });
    expect(go('text=我去了&action=check', '/study?autostart=true')).toEqual({ kind: 'coach' });
    expect(go('draft=银行&focus=1', '/study?autostart=true')).toEqual({ kind: 'coach' });
    expect(go('c=abc', '/study?autostart=true')).toEqual({ kind: 'coach' });
  });
});
