import { describe, it, expect } from 'vitest';
import { cardTextProblems } from '@shared/cards';
import { validateLessonSpec } from '@shared/lesson';
import { FAKE_CARDS, FAKE_LESSON, fakeStreamingClient } from '../fake';

type Create = (p: unknown) => Promise<{ stop_reason: string; content: Array<{ type: string; name?: string; input?: { flashcards?: Array<{ hanzi: string }> } }> }>;
const create = (fakeStreamingClient('zh', 0).messages as unknown as { create: Create }).create;
const ask = (text: string, tools = ['create_flashcards', 'search_cards']) => create({ tools: tools.map((name) => ({ name })), messages: [{ role: 'user', content: text }] });

describe('the E2E stand-in makes cards when asked (docs/CHAT.md "Cards Claude added")', () => {
  it('"make a card" → create_flashcards with one card; "two cards" / 两张 → both', async () => {
    const one = await ask('Make a card for 机会');
    expect(one.stop_reason).toBe('tool_use');
    expect(one.content[0]).toMatchObject({ type: 'tool_use', name: 'create_flashcards' });
    expect(one.content[0].input!.flashcards!.map((c) => c.hanzi)).toEqual(['机会']);
    const two = await ask('帮我做两张卡片');
    expect(two.content[0].input!.flashcards!.map((c) => c.hanzi)).toEqual(['机会', '难得']);
  });

  it('only where create_flashcards is offered, never after the tool result, and otherwise the plain answer', async () => {
    expect((await ask('Make a card', ['search_my_chats'])).stop_reason).toBe('end_turn');
    expect((await ask('你好')).stop_reason).toBe('end_turn');
    const after = await create({ tools: [{ name: 'create_flashcards' }], messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }] });
    expect(after.stop_reason).toBe('end_turn');
  });

  it('its cards follow the card standard (the content service takes them)', () => {
    for (const c of FAKE_CARDS) expect(cardTextProblems({ hanzi: c.hanzi, pinyin: c.pinyin, sentence_clue: c.sentence_clue })).toEqual([]);
  });
});

describe('the E2E stand-in makes a mini lesson when asked (docs/CHAT.md "Tool lines you can tap")', () => {
  it('"mini lesson" / 小练习 → create_custom_lesson with a valid spec; only where offered', async () => {
    const made = await ask('Make me a mini lesson on 治理 vs 这里', ['create_custom_lesson', 'search_cards']);
    expect(made.content[0]).toMatchObject({ type: 'tool_use', name: 'create_custom_lesson' });
    expect((await ask('给我一个小练习', ['create_flashcards'])).stop_reason).toBe('end_turn');
    expect(validateLessonSpec(FAKE_LESSON)).toEqual([]);
  });
});
