import { describe, expect, it } from 'vitest';
import { chatPersonLinks, chatPersonPath, connectionRequestsLine, personFirstName } from './personLinks';

describe('chatPersonPath', () => {
  it('opens the person page for a person, nothing for Claude', () => {
    expect(chatPersonPath('r1', false)).toBe('/connections/r1');
    expect(chatPersonPath('r1', true)).toBeNull();
    expect(chatPersonPath(null, false)).toBeNull();
  });
});

describe('chatPersonLinks', () => {
  it('a learner gets the tutor page parts, in order', () => {
    const links = chatPersonLinks({ relationshipId: 'r1', otherName: '明慧', viewerRole: 'student', isAi: false });
    expect(links.map((l) => l.id)).toEqual(['person', 'lesson_board', 'homework', 'flags', 'tutor_notes']);
    expect(links.map((l) => l.label)).toEqual(['About 明慧', 'Lesson board', 'Homework from 明慧', 'Cards you flagged', 'Notes from 明慧']);
    expect(links.find((l) => l.id === 'homework')).toMatchObject({ path: '/connections/r1', section: 'homework' });
    expect(links.find((l) => l.id === 'flags')).toMatchObject({ path: '/connections/r1', section: 'flags' });
    expect(links.find((l) => l.id === 'lesson_board')?.path).toBe('/connections/r1/board');
    expect(links.find((l) => l.id === 'tutor_notes')?.path).toBe('/tutor-notes');
  });

  it('uses the first name, and "your tutor" without one', () => {
    expect(chatPersonLinks({ relationshipId: 'r1', otherName: 'Minghui Li', viewerRole: 'student', isAi: false })[0].label).toBe('About Minghui');
    expect(chatPersonLinks({ relationshipId: 'r1', otherName: '  ', viewerRole: 'student', isAi: false })[0].label).toBe('About your tutor');
  });

  it('a tutor gets the student page and the board', () => {
    const links = chatPersonLinks({ relationshipId: 'r2', otherName: 'Jerome Swannack', viewerRole: 'tutor', isAi: false });
    expect(links.map((l) => [l.id, l.label])).toEqual([['person', 'Jerome’s page'], ['lesson_board', 'Lesson board']]);
  });

  it('Claude chats and chats without a relationship get none', () => {
    expect(chatPersonLinks({ relationshipId: 'r1', otherName: 'Claude', viewerRole: 'student', isAi: true })).toEqual([]);
    expect(chatPersonLinks({ relationshipId: null, otherName: 'X', viewerRole: 'student', isAi: false })).toEqual([]);
  });
});

describe('personFirstName', () => {
  it.each([['Minghui Li', 'Minghui'], ['明慧', '明慧'], ['', null], [null, null], ['  Anna  ', 'Anna']])('%s → %s', (n, f) => {
    expect(personFirstName(n)).toBe(f);
  });
});

describe('connectionRequestsLine', () => {
  it('says who and what for one request, how many for several', () => {
    expect(connectionRequestsLine([])).toBeNull();
    expect(connectionRequestsLine([{ name: '明慧', requesterRole: 'tutor' }])).toBe('🤝 明慧 wants to be your tutor');
    expect(connectionRequestsLine([{ name: 'Anna', requesterRole: 'student' }])).toBe('🤝 Anna wants you to be their tutor');
    expect(connectionRequestsLine([{ name: '', requesterRole: 'tutor' }])).toBe('🤝 Someone wants to be your tutor');
    expect(connectionRequestsLine([{ name: 'A', requesterRole: 'tutor' }, { name: 'B', requesterRole: 'student' }])).toBe('🤝 2 connection requests');
  });
});
