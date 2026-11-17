import { describe, expect, it } from 'vitest';
import { addedToDeckOpenLink, studyTodayOpenLink } from './open-links';

describe('addedToDeckOpenLink', () => {
  it('opens the one card', () => {
    expect(addedToDeckOpenLink({ noteIds: ['n1'], deckId: 'd1', deckName: 'From readers', hanzi: '银行' })).toEqual({
      kind: 'added', target: 'card', id: 'n1', path: '/cards/n1', label: 'Open', aria: 'Open the card 银行',
    });
  });
  it('opens the deck for several cards', () => {
    const link = addedToDeckOpenLink({ noteIds: ['n1', 'n2', 'n1'], deckId: 'd 1', deckName: 'From chats' });
    expect(link).toMatchObject({ target: 'deck', id: 'd 1', path: '/decks/d%201', aria: 'Open the deck From chats with the new cards' });
  });
  it('is null with nothing to open', () => {
    expect(addedToDeckOpenLink({ noteIds: [] })).toBeNull();
    expect(addedToDeckOpenLink({ noteIds: [' ', null] })).toBeNull();
    expect(addedToDeckOpenLink({ noteIds: ['a', 'b'] })).toBeNull();
  });
});

describe('studyTodayOpenLink', () => {
  it('opens the card for one word, Up next for several', () => {
    expect(studyTodayOpenLink([{ noteId: 'n1', hanzi: '银行' }])).toMatchObject({ target: 'card', path: '/cards/n1', aria: 'Open the card 银行' });
    expect(studyTodayOpenLink([{ noteId: 'n1' }, { noteId: 'n2' }])).toMatchObject({ target: 'up_next', id: null, path: '/up-next' });
    expect(studyTodayOpenLink([{ noteId: 'n1' }, { noteId: 'n1' }])).toMatchObject({ target: 'card', aria: 'Open the card' });
    expect(studyTodayOpenLink([])).toBeNull();
  });
});
