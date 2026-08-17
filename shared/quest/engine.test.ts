import { describe, it, expect } from 'vitest';
import {
  applyQuestAction,
  availableActions,
  createQuestState,
  objectsInReach,
  resetQuestState,
  type QuestState,
} from './engine';
import type { QuestWorld } from './types';

/**
 * A small kitchen: a walkable floor with a wall down the right-hand side, an
 * apple, a table, and a fridge that starts closed with milk inside.
 *
 *   . . . . #
 *   . P . . #
 *   . a t f #
 *   . . . . #
 */
function kitchen(overrides: Partial<QuestWorld> = {}): QuestWorld {
  return {
    schema_version: 1,
    title: { hanzi: '厨房', pinyin: 'chúfáng', english: 'Kitchen' },
    scenario: { hanzi: '你在厨房。', pinyin: 'nǐ zài chúfáng.', english: 'You are in the kitchen.' },
    width: 5,
    height: 4,
    terrain: [
      { key: '.', hanzi: '地板', pinyin: 'dìbǎn', english: 'floor', color: '#eee', walkable: true },
      { key: '#', hanzi: '墙', pinyin: 'qiáng', english: 'wall', color: '#333', walkable: false },
    ],
    grid: ['....#', '....#', '....#', '....#'],
    player: { emoji: '🧑', x: 1, y: 1 },
    carry_limit: 1,
    objects: [
      {
        id: 'apple',
        emoji: '🍎',
        hanzi: '苹果',
        pinyin: 'píngguǒ',
        english: 'apple',
        x: 1,
        y: 2,
        portable: true,
        surface: false,
        blocks_movement: false,
        actions: [
          { id: 'eat', hanzi: '吃', pinyin: 'chī', english: 'eat', removes_object: true },
        ],
      },
      {
        id: 'table',
        emoji: '🪑',
        hanzi: '桌子',
        pinyin: 'zhuōzi',
        english: 'table',
        x: 2,
        y: 2,
        portable: false,
        surface: true,
        blocks_movement: false,
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
        surface: false,
        blocks_movement: false,
        states: [
          { id: 'closed', hanzi: '关着', pinyin: 'guānzhe', english: 'closed' },
          { id: 'open', hanzi: '开着', pinyin: 'kāizhe', english: 'open' },
        ],
        initial_state: 'closed',
        actions: [
          {
            id: 'open',
            hanzi: '打开',
            pinyin: 'dǎkāi',
            english: 'open',
            requires_state: 'closed',
            sets_state: 'open',
          },
          {
            id: 'close',
            hanzi: '关上',
            pinyin: 'guānshàng',
            english: 'close',
            requires_state: 'open',
            sets_state: 'closed',
          },
        ],
      },
      {
        id: 'milk',
        emoji: '🥛',
        hanzi: '牛奶',
        pinyin: 'niúnǎi',
        english: 'milk',
        x: 3,
        y: 2,
        portable: true,
        surface: false,
        blocks_movement: false,
        hidden_until: { object: 'fridge', state: 'open' },
      },
    ],
    goals: [
      {
        id: 'g1',
        instruction: { hanzi: '拿起苹果。', pinyin: 'ná qǐ píngguǒ.', english: 'Pick up the apple.' },
        condition: { type: 'holding', object: 'apple' },
      },
    ],
    glossary: [],
    ...overrides,
  };
}

/** Walk a scripted list of actions, asserting each one is accepted. */
function run(state: QuestState, actions: Parameters<typeof applyQuestAction>[1][]): QuestState {
  return actions.reduce((current, action) => {
    const result = applyQuestAction(current, action);
    expect({ action, ok: result.ok, rejection: result.rejection }).toMatchObject({ ok: true });
    return result.state;
  }, state);
}

describe('quest engine — movement', () => {
  it('moves onto walkable tiles and counts the move', () => {
    const state = createQuestState(kitchen());
    const result = applyQuestAction(state, { type: 'move', direction: 'left' });
    expect(result.ok).toBe(true);
    expect(result.state.player).toEqual({ x: 0, y: 1 });
    expect(result.state.moves).toBe(1);
  });

  it('refuses to walk into a wall and leaves the state untouched', () => {
    const state = createQuestState(kitchen({ player: { emoji: '🧑', x: 3, y: 1 } }));
    const result = applyQuestAction(state, { type: 'move', direction: 'right' });
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('blocked');
    expect(result.state).toBe(state);
  });

  it('refuses to walk off the edge of the map', () => {
    const state = createQuestState(kitchen({ player: { emoji: '🧑', x: 0, y: 0 } }));
    expect(applyQuestAction(state, { type: 'move', direction: 'up' }).rejection).toBe('out_of_bounds');
    expect(applyQuestAction(state, { type: 'move', direction: 'left' }).rejection).toBe('out_of_bounds');
  });

  it('treats a closed door as a wall and an opened one as a doorway', () => {
    const world = kitchen({
      objects: [
        {
          id: 'door',
          emoji: '🚪',
          hanzi: '门',
          pinyin: 'mén',
          english: 'door',
          x: 1,
          y: 2,
          portable: false,
          surface: false,
          blocks_movement: true,
          states: [
            { id: 'closed', hanzi: '关着', pinyin: 'guānzhe', english: 'closed', blocks_movement: true },
            { id: 'open', hanzi: '开着', pinyin: 'kāizhe', english: 'open', blocks_movement: false },
          ],
          initial_state: 'closed',
          actions: [
            { id: 'open', hanzi: '打开', pinyin: 'dǎkāi', english: 'open', requires_state: 'closed', sets_state: 'open' },
          ],
        },
      ],
      goals: [
        {
          id: 'g1',
          instruction: { hanzi: '打开门。', pinyin: 'dǎkāi mén.', english: 'Open the door.' },
          condition: { type: 'object_state', object: 'door', state: 'open' },
        },
      ],
    });

    const state = createQuestState(world);
    expect(applyQuestAction(state, { type: 'move', direction: 'down' }).rejection).toBe('blocked');

    const opened = applyQuestAction(state, { type: 'interact', object: 'door', action: 'open' });
    expect(opened.completedGoals).toEqual(['g1']);
    expect(applyQuestAction(opened.state, { type: 'move', direction: 'down' }).ok).toBe(true);
  });
});

describe('quest engine — carrying', () => {
  it('picks up an adjacent object and completes the goal', () => {
    const state = createQuestState(kitchen());
    const result = applyQuestAction(state, { type: 'pick_up', object: 'apple' });
    expect(result.ok).toBe(true);
    expect(result.state.held).toEqual(['apple']);
    expect(result.completedGoals).toEqual(['g1']);
    expect(result.justFinished).toBe(true);
  });

  it('will not pick up something out of reach or not portable', () => {
    const state = createQuestState(kitchen({ player: { emoji: '🧑', x: 0, y: 0 } }));
    expect(applyQuestAction(state, { type: 'pick_up', object: 'apple' }).rejection).toBe('out_of_reach');

    const beside = createQuestState(kitchen());
    expect(applyQuestAction(beside, { type: 'pick_up', object: 'table' }).rejection).toBe('not_portable');
  });

  it('respects the carry limit', () => {
    const world = kitchen({ carry_limit: 1 });
    world.objects.push({
      id: 'pear',
      emoji: '🍐',
      hanzi: '梨',
      pinyin: 'lí',
      english: 'pear',
      x: 0,
      y: 1,
      portable: true,
      surface: false,
      blocks_movement: false,
    });
    const state = run(createQuestState(world), [{ type: 'pick_up', object: 'apple' }]);
    expect(applyQuestAction(state, { type: 'pick_up', object: 'pear' }).rejection).toBe('hands_full');
  });

  it('carries an object along and drops it at the player’s feet', () => {
    const state = run(createQuestState(kitchen()), [
      { type: 'pick_up', object: 'apple' },
      { type: 'move', direction: 'left' },
    ]);
    expect(state.objects.apple).toMatchObject({ x: 0, y: 1, held: true });

    const dropped = applyQuestAction(state, { type: 'put_down', object: 'apple' });
    expect(dropped.state.held).toEqual([]);
    expect(dropped.state.objects.apple).toMatchObject({ x: 0, y: 1, held: false });
  });
});

describe('quest engine — 把 X 放在 Y 上', () => {
  it('completes object_on when the object is put down on the table', () => {
    const world = kitchen({
      goals: [
        {
          id: 'g1',
          instruction: { hanzi: '把苹果放在桌子上。', pinyin: 'bǎ píngguǒ fàng zài zhuōzi shàng.', english: 'Put the apple on the table.' },
          condition: { type: 'object_on', object: 'apple', target: 'table' },
        },
      ],
    });
    const state = run(createQuestState(world), [
      { type: 'pick_up', object: 'apple' },
      { type: 'move', direction: 'down' },
      { type: 'move', direction: 'right' },
    ]);
    // Standing on the table tile while still holding it is not enough.
    expect(state.completedGoals).toEqual([]);

    const result = applyQuestAction(state, { type: 'put_down', object: 'apple' });
    expect(result.completedGoals).toEqual(['g1']);
  });
});

describe('quest engine — states, hidden objects and verbs', () => {
  it('keeps milk hidden until the fridge is opened, then keeps it visible', () => {
    const state = createQuestState(kitchen());
    expect(state.objects.milk.revealed).toBe(false);
    expect(objectsInReach(state).map((o) => o.id)).not.toContain('milk');

    const near = run(state, [{ type: 'move', direction: 'right' }, { type: 'move', direction: 'right' }]);
    const opened = applyQuestAction(near, { type: 'interact', object: 'fridge', action: 'open' }).state;
    expect(opened.objects.milk.revealed).toBe(true);

    // Closing it again does not re-hide the milk the learner has now seen.
    const closed = applyQuestAction(opened, { type: 'interact', object: 'fridge', action: 'close' }).state;
    expect(closed.objects.milk.revealed).toBe(true);
  });

  it('only offers verbs whose state requirement is met', () => {
    const state = run(createQuestState(kitchen()), [
      { type: 'move', direction: 'right' },
      { type: 'move', direction: 'right' },
    ]);
    const verbs = availableActions(state).map((a) => `${a.object.id}:${a.action.id}`);
    expect(verbs).toContain('fridge:open');
    expect(verbs).not.toContain('fridge:close');
  });

  it('removes an object that is eaten, dropping it from the hands', () => {
    const world = kitchen({
      goals: [
        {
          id: 'g1',
          instruction: { hanzi: '吃苹果。', pinyin: 'chī píngguǒ.', english: 'Eat the apple.' },
          condition: { type: 'object_removed', object: 'apple' },
        },
      ],
    });
    const state = run(createQuestState(world), [{ type: 'pick_up', object: 'apple' }]);
    const eaten = applyQuestAction(state, { type: 'interact', object: 'apple', action: 'eat' });
    expect(eaten.completedGoals).toEqual(['g1']);
    expect(eaten.state.held).toEqual([]);
    expect(eaten.state.objects.apple.removed).toBe(true);
    expect(objectsInReach(eaten.state).map((o) => o.id)).not.toContain('apple');
  });

  it('rejects a verb whose requirement is not met without changing anything', () => {
    const state = run(createQuestState(kitchen()), [
      { type: 'move', direction: 'right' },
      { type: 'move', direction: 'right' },
    ]);
    const result = applyQuestAction(state, { type: 'interact', object: 'fridge', action: 'close' });
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('action_unavailable');
    expect(result.state).toBe(state);
  });
});

describe('quest engine — goal sequences', () => {
  const sequenced = () =>
    kitchen({
      goals: [
        {
          id: 'g1',
          instruction: {
            hanzi: '先打开冰箱，然后拿起牛奶，最后把牛奶放在桌子上。',
            pinyin: 'xiān dǎkāi bīngxiāng, ránhòu ná qǐ niúnǎi, zuìhòu bǎ niúnǎi fàng zài zhuōzi shàng.',
            english: 'First open the fridge, then pick up the milk, and finally put the milk on the table.',
          },
          condition: {
            type: 'sequence',
            conditions: [
              { type: 'object_state', object: 'fridge', state: 'open' },
              { type: 'holding', object: 'milk' },
              { type: 'object_on', object: 'milk', target: 'table' },
            ],
          },
        },
      ],
    });

  it('completes only after every step, in order', () => {
    let state = createQuestState(sequenced());
    state = run(state, [
      { type: 'move', direction: 'right' },
      { type: 'move', direction: 'right' },
      { type: 'interact', object: 'fridge', action: 'open' },
    ]);
    expect(state.sequenceProgress.g0).toBe(1);
    expect(state.completedGoals).toEqual([]);

    state = run(state, [{ type: 'pick_up', object: 'milk' }]);
    expect(state.sequenceProgress.g0).toBe(2);
    expect(state.finished).toBe(false);

    // Carry the milk over to the table at (2,2)
    state = run(state, [
      { type: 'move', direction: 'down' },
      { type: 'move', direction: 'left' },
    ]);
    const result = applyQuestAction(state, { type: 'put_down', object: 'milk' });
    expect(result.completedGoals).toEqual(['g1']);
    expect(result.state.finished).toBe(true);
  });

  it('remembers steps already taken even if they are undone', () => {
    let state = createQuestState(sequenced());
    state = run(state, [
      { type: 'move', direction: 'right' },
      { type: 'move', direction: 'right' },
      { type: 'interact', object: 'fridge', action: 'open' },
      { type: 'pick_up', object: 'milk' },
      // Put the milk back and close the fridge — the first two steps still count.
      { type: 'put_down', object: 'milk' },
      { type: 'interact', object: 'fridge', action: 'close' },
    ]);
    expect(state.sequenceProgress.g0).toBe(2);
  });

  it('plays goals one at a time and finishes the quest on the last one', () => {
    const world = kitchen({
      goals: [
        {
          id: 'g1',
          instruction: { hanzi: '拿起苹果。', pinyin: 'ná qǐ píngguǒ.', english: 'Pick up the apple.' },
          condition: { type: 'holding', object: 'apple' },
        },
        {
          id: 'g2',
          instruction: { hanzi: '走到桌子那儿。', pinyin: 'zǒu dào zhuōzi nàr.', english: 'Walk to the table.' },
          condition: { type: 'player_at', x: 2, y: 2 },
        },
      ],
    });
    let state = createQuestState(world);
    expect(state.activeGoalIndex).toBe(0);

    const picked = applyQuestAction(state, { type: 'pick_up', object: 'apple' });
    expect(picked.state.activeGoalIndex).toBe(1);
    expect(picked.justFinished).toBe(false);

    state = run(picked.state, [{ type: 'move', direction: 'down' }]);
    const done = applyQuestAction(state, { type: 'move', direction: 'right' });
    expect(done.completedGoals).toEqual(['g2']);
    expect(done.justFinished).toBe(true);
  });
});

describe('quest engine — reset', () => {
  it('puts the world back exactly as it started', () => {
    const start = createQuestState(kitchen());
    const played = run(start, [
      { type: 'pick_up', object: 'apple' },
      { type: 'move', direction: 'left' },
      { type: 'put_down', object: 'apple' },
    ]);
    expect(played.moves).toBe(3);
    expect(resetQuestState(played)).toEqual(start);
  });
});
