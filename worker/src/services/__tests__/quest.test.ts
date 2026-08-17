import { describe, it, expect } from 'vitest';
import { normalizeQuestWorld, clampGoalCount } from '../quest';
import { validateQuestWorld } from '@shared/quest';

/**
 * The model's tool output is forgiving on our side: missing booleans, a stray
 * label after an emoji, a numeric coordinate as a float. What matters is that
 * whatever comes back is turned into something the engine can run — or is
 * caught by validation.
 */
describe('normalizeQuestWorld', () => {
  const raw = {
    title: { hanzi: '厨房', pinyin: 'chúfáng', english: 'Kitchen' },
    scenario: { hanzi: '你在厨房。', pinyin: 'nǐ zài chúfáng.', english: 'You are in the kitchen.' },
    width: 5,
    height: 4,
    carry_limit: 1,
    terrain: [
      { key: '.', hanzi: '地板', pinyin: 'dìbǎn', english: 'floor', color: '#eee', walkable: true },
      { key: '##', hanzi: '墙', pinyin: 'qiáng', english: 'wall', color: '#333', walkable: false },
    ],
    grid: ['.....', '.....', '.....', '.....'],
    player: { emoji: '🧑 the cook', x: 0, y: 0 },
    objects: [
      {
        id: 'apple',
        emoji: '🍎 apple',
        hanzi: '苹果',
        pinyin: 'píngguǒ',
        english: 'apple',
        x: 2,
        y: 2,
        portable: true,
        surface: false,
        blocks_movement: false,
        actions: [{ id: 'eat', hanzi: '吃', pinyin: 'chī', english: 'eat', removes_object: true }],
      },
      {
        id: 'fridge',
        emoji: '🧊',
        hanzi: '冰箱',
        pinyin: 'bīngxiāng',
        english: 'fridge',
        x: 3,
        y: 2,
        portable: false,
        surface: true,
        blocks_movement: false,
        states: [
          { id: 'closed', hanzi: '关着', pinyin: 'guānzhe', english: 'closed' },
          { id: 'open', hanzi: '开着', pinyin: 'kāizhe', english: 'open' },
        ],
        actions: [
          { id: 'open', hanzi: '打开', pinyin: 'dǎkāi', english: 'open', requires_state: 'closed', sets_state: 'open' },
        ],
      },
    ],
    goals: [
      {
        id: 'g1',
        instruction: { hanzi: '打开冰箱，然后吃苹果。', pinyin: 'dǎkāi bīngxiāng, ránhòu chī píngguǒ.', english: 'Open the fridge, then eat the apple.' },
        condition: {
          type: 'sequence',
          conditions: [
            { type: 'object_state', object: 'fridge', state: 'open' },
            { type: 'object_removed', object: 'apple' },
          ],
        },
      },
    ],
    glossary: [{ hanzi: '打开', pinyin: 'dǎkāi', english: 'to open', pos: 'verb' }],
  };

  it('produces a world that passes validation', () => {
    expect(validateQuestWorld(normalizeQuestWorld(raw))).toEqual([]);
  });

  it('keeps only the emoji when the model appends a label', () => {
    const world = normalizeQuestWorld(raw);
    expect(world.player.emoji).toBe('🧑');
    expect(world.objects[0].emoji).toBe('🍎');
  });

  it('trims terrain keys to a single character', () => {
    expect(normalizeQuestWorld(raw).terrain[1].key).toBe('#');
  });

  it('defaults initial_state to the first state when the model omits it', () => {
    expect(normalizeQuestWorld(raw).objects[1].initial_state).toBe('closed');
  });

  it('fills in missing flags rather than leaving them undefined', () => {
    const world = normalizeQuestWorld({
      ...raw,
      objects: [{ id: 'rock', emoji: '🪨', hanzi: '石头', pinyin: 'shítou', english: 'rock', x: 1, y: 1 }],
    });
    expect(world.objects[0]).toMatchObject({
      portable: false,
      surface: false,
      blocks_movement: false,
      states: null,
      actions: null,
      hidden_until: null,
    });
  });

  it('keeps nested condition trees intact', () => {
    const condition = normalizeQuestWorld(raw).goals[0].condition;
    expect(condition).toEqual({
      type: 'sequence',
      conditions: [
        { type: 'object_state', object: 'fridge', state: 'open' },
        { type: 'object_removed', object: 'apple' },
      ],
    });
  });

  it('drops goals with no instruction and objects with no id', () => {
    const world = normalizeQuestWorld({
      ...raw,
      objects: [...raw.objects, { emoji: '🍐', hanzi: '梨', x: 1, y: 1 }],
      goals: [...raw.goals, { id: 'g2', condition: { type: 'holding', object: 'apple' } }],
    });
    expect(world.objects).toHaveLength(2);
    expect(world.goals).toHaveLength(1);
  });

  it('surfaces validation errors instead of storing a broken world', () => {
    const errors = validateQuestWorld(
      normalizeQuestWorld({ ...raw, grid: ['....', '.....', '.....', '.....'] })
    );
    expect(errors.some((e) => /row 0/.test(e))).toBe(true);
  });
});

describe('clampGoalCount', () => {
  it('defaults when nothing sensible is asked for', () => {
    expect(clampGoalCount(undefined)).toBe(5);
    expect(clampGoalCount(NaN)).toBe(5);
  });

  it('clamps to the playable range', () => {
    expect(clampGoalCount(1)).toBe(3);
    expect(clampGoalCount(99)).toBe(8);
    expect(clampGoalCount(4)).toBe(4);
  });
});
