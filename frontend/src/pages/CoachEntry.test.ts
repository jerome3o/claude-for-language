import { describe, expect, it } from 'vitest';
import { coachEntryTarget } from './CoachEntry';

const go = (qs: string) => coachEntryTarget(new URLSearchParams(qs));

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

  it('no Coach page any more: Open in Coach from a chat message is a thread started from that message', () => {
    expect(go('text=我去了&action=check&from_message=m1')).toEqual({ kind: 'redirect', to: '/chats/claude/new?text=%E6%88%91%E5%8E%BB%E4%BA%86&intent=check&source=chat_message&from_message=m1' });
    expect(go('text=我去了&action=explain&from_message=m2')).toEqual({ kind: 'redirect', to: '/chats/claude/new?text=%E6%88%91%E5%8E%BB%E4%BA%86&intent=explain&source=chat_message&from_message=m2' });
  });
});
