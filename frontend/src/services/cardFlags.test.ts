import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db/database';
import { humanTutors, rememberTutors, getRememberedTutors, queueCardFlag, uploadPendingCardFlags } from './cardFlags';
import type { TutorRelationshipWithUsers } from '../types';

vi.mock('../api/cardFlags', () => ({
  createCardFlag: vi.fn(),
}));

import { createCardFlag } from '../api/cardFlags';
const mockCreate = vi.mocked(createCardFlag);

const ME = 'student-1';
function rel(id: string, otherId: string, name: string | null, status = 'active'): TutorRelationshipWithUsers {
  return {
    id,
    requester_id: otherId,
    recipient_id: ME,
    requester_role: 'tutor',
    status: status as TutorRelationshipWithUsers['status'],
    created_at: '2026-01-01T00:00:00Z',
    accepted_at: '2026-01-01T00:00:00Z',
    requester: { id: otherId, email: `${otherId}@x`, name, picture_url: null },
    recipient: { id: ME, email: 'me@x', name: 'Me', picture_url: null },
  };
}

describe('humanTutors', () => {
  it('keeps active human tutors and drops the Claude practice relationship', () => {
    const list = humanTutors([rel('r1', 'tutor-1', 'Wang Laoshi'), rel('r2', 'claude-ai', 'Claude'), rel('r3', 'tutor-2', null, 'pending')], ME);
    expect(list).toEqual([{ relationship_id: 'r1', name: 'Wang Laoshi' }]);
  });

  it('falls back to the email when the tutor has no name', () => {
    expect(humanTutors([rel('r1', 'tutor-1', null)], ME)[0].name).toBe('tutor-1@x');
  });
});

describe('rememberTutors', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage and ignores junk', () => {
    rememberTutors([{ relationship_id: 'r1', name: 'Wang' }]);
    expect(getRememberedTutors()).toEqual([{ relationship_id: 'r1', name: 'Wang' }]);
    localStorage.setItem('card-flags:tutors', '{"nope":1}');
    expect(getRememberedTutors()).toEqual([]);
    localStorage.setItem('card-flags:tutors', 'not json');
    expect(getRememberedTutors()).toEqual([]);
  });
});

describe('queueCardFlag / uploadPendingCardFlags', () => {
  const online = { mockReturnValue: (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true, writable: true }) };

  beforeEach(async () => {
    await db.pendingCardFlags.clear();
    mockCreate.mockReset();
  });
  afterEach(() => online.mockReturnValue(true));

  const input = { relationship_id: 'r1', tutor_name: 'Wang', note_id: 'n1', card_id: 'c1', hanzi: '银行', message: '  mixing up with 很行 ' };

  it('sends at once when online and clears the queue', async () => {
    online.mockReturnValue(true);
    mockCreate.mockResolvedValue({ flag: {} as never, created: true });
    const r = await queueCardFlag(input);
    expect(r.sent).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ id: r.id, note_id: 'n1', card_id: 'c1', message: 'mixing up with 很行' }));
    expect(await db.pendingCardFlags.count()).toBe(0);
  });

  it('keeps the flag locally when offline, then the sync posts it with the same id', async () => {
    online.mockReturnValue(false);
    const r = await queueCardFlag(input);
    expect(r.sent).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await db.pendingCardFlags.count()).toBe(1);

    mockCreate.mockResolvedValue({ flag: {} as never, created: true });
    const up = await uploadPendingCardFlags();
    expect(up).toEqual({ uploaded: 1, errors: [] });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ id: r.id }));
    expect(await db.pendingCardFlags.count()).toBe(0);
  });

  it('keeps a flag whose upload failed, with the error, for the next sync', async () => {
    online.mockReturnValue(true);
    mockCreate.mockRejectedValue(new Error('HTTP 500'));
    const r = await queueCardFlag(input);
    expect(r.sent).toBe(false);
    const row = await db.pendingCardFlags.get(r.id);
    expect(row?.error).toBe('HTTP 500');
    const up = await uploadPendingCardFlags();
    expect(up.uploaded).toBe(0);
    expect(up.errors).toEqual(['HTTP 500']);
    expect(await db.pendingCardFlags.count()).toBe(1);
  });
});
