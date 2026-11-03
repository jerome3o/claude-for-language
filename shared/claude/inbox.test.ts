import { describe, expect, it } from 'vitest';
import {
  claudeRowPreview,
  composeRecipients,
  filterInbox,
  inboxFilters,
  inboxRowLabel,
  inboxRowName,
  mergeInbox,
  teacherSections,
  CLAUDE_ROW_FAILED,
  CLAUDE_ROW_QUEUED,
  CLAUDE_ROW_WRITING,
  type InboxHuman,
  type InboxThread,
} from './inbox';

function human(id: string, over: Partial<InboxHuman> = {}): InboxHuman {
  return {
    conversation_id: id,
    relationship_id: `rel-${id}`,
    title: null,
    is_ai: false,
    other_user: { id: `u-${id}`, name: 'Minghui', picture_url: null },
    other_role: 'tutor',
    last_message: { id: `m-${id}`, sender_id: `u-${id}`, preview: '明天上课见！', created_at: '2026-11-03T09:41:00.000Z' },
    unread: 0,
    last_activity_at: '2026-11-03T09:41:00.000Z',
    ...over,
  };
}

function thread(id: string, over: Partial<InboxThread> = {}): InboxThread {
  return {
    id,
    title: '银行 和 行 的读音',
    context_kind: 'general',
    context: { kind: 'general' },
    first_intent: 'ask',
    preview: '“行”在银行里读 háng。',
    last_message_at: '2026-11-03T10:00:00.000Z',
    created_at: '2026-11-03T09:59:00.000Z',
    unread: 0,
    pending: false,
    failed: false,
    archived: false,
    ...over,
  };
}

describe('mergeInbox', () => {
  it('merges people and Claude newest first, with kinds and badges', () => {
    const items = mergeInbox(
      [human('t', { last_activity_at: '2026-11-03T08:00:00.000Z' }), human('s', { other_role: 'student', other_user: { id: 'u-s', name: 'Lily', picture_url: null }, last_activity_at: '2026-11-03T11:00:00.000Z' })],
      [thread('c1'), thread('c2', { context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行' }, last_message_at: '2026-11-03T07:00:00.000Z' })],
    );
    expect(items.map((i) => i.key)).toEqual(['h:s', 'c:c1', 'h:t', 'c:c2']);
    expect(items.map((i) => i.kind)).toEqual(['student', 'claude', 'tutor', 'claude']);
    expect(items[3].badge).toEqual({ icon: '📇', text: 'Asked on card · 银行' });
    expect(items[1].badge).toBeNull();
  });

  it('pins a learner\'s unread tutor chats on top, not students\' and not without the option', () => {
    const humans = [
      human('t', { unread: 2, last_activity_at: '2026-11-01T08:00:00.000Z' }),
      human('s', { other_role: 'student', unread: 4, last_activity_at: '2026-11-02T08:00:00.000Z' }),
    ];
    const pinned = mergeInbox(humans, [thread('c1')], { pinUnreadTutors: true });
    expect(pinned.map((i) => i.key)).toEqual(['h:t', 'c:c1', 'h:s']);
    expect(pinned[0].pinned).toBe(true);
    const plain = mergeInbox(humans, [thread('c1')]);
    expect(plain.map((i) => i.key)).toEqual(['c:c1', 'h:s', 'h:t']);
    expect(plain.every((i) => !i.pinned)).toBe(true);
  });

  it('shows an old practice chat once: as its thread when there is one, else as a Claude row', () => {
    const ai = human('p', { is_ai: true, title: '点菜', other_user: { id: 'claude-ai', name: 'Claude', picture_url: null } });
    const alone = mergeInbox([ai], []);
    expect(alone).toHaveLength(1);
    expect(alone[0].kind).toBe('claude');
    expect(alone[0].badge).toEqual({ icon: '🎭', text: 'Practice · 点菜' });
    expect(inboxRowName(alone[0])).toBe('点菜');

    const practice = thread('pc-p', { context_kind: 'practice', context: { kind: 'practice', conversation_id: 'p', scenario: '点菜' } });
    const merged = mergeInbox([ai], [practice]);
    expect(merged.map((i) => i.key)).toEqual(['c:pc-p']);
    // An archived practice thread still hides the conversation (it was archived on purpose).
    expect(mergeInbox([ai], [{ ...practice, archived: true }])).toEqual([]);
  });

  it('leaves archived threads out and filters', () => {
    const humans = [human('t')];
    const threads = [thread('c1'), thread('c2', { archived: true })];
    expect(mergeInbox(humans, threads).map((i) => i.key)).toEqual(['c:c1', 'h:t']);
    expect(mergeInbox(humans, threads, { filter: 'claude' }).map((i) => i.key)).toEqual(['c:c1']);
    expect(mergeInbox(humans, threads, { filter: 'people' }).map((i) => i.key)).toEqual(['h:t']);
  });

  it('sorts a thread by its last message, else its creation; ties by key; bad dates last', () => {
    const items = mergeInbox([], [
      thread('b', { last_message_at: null, created_at: '2026-11-03T12:00:00.000Z' }),
      thread('a', { last_message_at: '2026-11-03T12:00:00.000Z' }),
      thread('z', { last_message_at: 'not a date', created_at: 'nope' }),
    ]);
    expect(items.map((i) => i.key)).toEqual(['c:a', 'c:b', 'c:z']);
  });

  it('a started-with-Check chat carries its chip', () => {
    const [item] = mergeInbox([], [thread('c', { first_intent: 'check' })]);
    expect(item.badge).toEqual({ icon: '✏️', text: 'Check' });
  });
});

describe('labels, previews, filters', () => {
  it('every kind has an icon and a word', () => {
    expect(inboxRowLabel('tutor')).toEqual({ icon: '🧑‍🏫', text: 'Tutor' });
    expect(inboxRowLabel('student')).toEqual({ icon: '🎓', text: 'Student' });
    expect(inboxRowLabel('claude')).toEqual({ icon: '✦', text: 'Claude' });
  });

  it('Claude previews say what is going on', () => {
    expect(claudeRowPreview({ preview: 'a  b\nc', pending: false, failed: false })).toBe('a b c');
    expect(claudeRowPreview({ preview: 'x', pending: true, failed: false })).toBe(CLAUDE_ROW_WRITING);
    expect(claudeRowPreview({ preview: 'x', pending: false, failed: true })).toBe(CLAUDE_ROW_FAILED);
    expect(claudeRowPreview({ preview: 'x', pending: true, failed: false, local: true })).toBe(CLAUDE_ROW_QUEUED);
    expect(claudeRowPreview({ preview: null, pending: false, failed: false })).toBe('');
    // A Check chat: its title is the sentence, so the preview would only repeat it.
    expect(claudeRowPreview({ title: '我昨天去了商店', preview: '我昨天去了商店', pending: false, failed: false })).toBe('');
    expect(claudeRowPreview({ title: '我昨天去了商店', preview: '很好', pending: false, failed: false })).toBe('很好');
  });

  it('filter chips only when there are people and Claude', () => {
    const t = mergeInbox([human('t')], [thread('c')]);
    expect(inboxFilters(t).map((f) => f.label)).toEqual(['All', '🧑‍🏫 Tutor', '✦ Claude']);
    expect(inboxFilters(mergeInbox([human('t'), human('t2')], [thread('c')]))[1].label).toBe('🧑‍🏫 Tutors');
    expect(inboxFilters(mergeInbox([human('s', { other_role: 'student' })], [thread('c')]))[1].label).toBe('🎓 Students');
    expect(inboxFilters(mergeInbox([human('s', { other_role: 'student' }), human('t')], [thread('c')]))[1].label).toBe('People');
    expect(inboxFilters(mergeInbox([human('t')], []))).toEqual([]);
    expect(inboxFilters(mergeInbox([], [thread('c')]))).toEqual([]);
  });

  it('search looks at names, previews and context chips', () => {
    const items = mergeInbox([human('t')], [thread('c'), thread('d', { title: '点菜', context_kind: 'card', context: { kind: 'card', note_id: 'n', label: '银行' }, preview: 'ok' })]);
    expect(filterInbox(items, 'minghui').map((i) => i.key)).toEqual(['h:t']);
    expect(filterInbox(items, 'asked card').map((i) => i.key)).toEqual(['c:d']);
    expect(filterInbox(items, 'háng').map((i) => i.key)).toEqual(['c:c']);
    expect(filterInbox(items, 'hang').map((i) => i.key)).toEqual(['c:c']);
    expect(filterInbox(items, '  ')).toHaveLength(3);
  });
});

describe('the tutor view and the To: line', () => {
  it('people (newest first), then Claude', () => {
    const items = mergeInbox(
      [human('t', { last_activity_at: '2026-11-03T12:00:00.000Z' }), human('s', { other_role: 'student' })],
      [thread('c')],
    );
    const s = teacherSections(items);
    expect(s.people.map((i) => i.key)).toEqual(['h:t', 'h:s']);
    expect(s.claude.map((i) => i.key)).toEqual(['c:c']);
  });

  it('recipients: each tutor once, newest chat first, never students or practice chats', () => {
    const out = composeRecipients([
      human('a', { relationship_id: 'r1', last_activity_at: '2026-11-01T00:00:00.000Z' }),
      human('b', { relationship_id: 'r2', other_user: { id: 'x', name: 'Laoshi', picture_url: null }, last_activity_at: '2026-11-02T00:00:00.000Z' }),
      human('c', { relationship_id: 'r3', other_role: 'student' }),
      human('d', { relationship_id: 'r4', is_ai: true }),
    ]);
    expect(out).toEqual([
      { relationship_id: 'r2', conversation_id: 'b', name: 'Laoshi' },
      { relationship_id: 'r1', conversation_id: 'a', name: 'Minghui' },
    ]);
  });
});
