import { describe, it, expect } from 'vitest';
import { validateQuestWorld } from './validate';
import type { QuestWorld } from './types';

function world(overrides: Partial<QuestWorld> = {}): QuestWorld {
  return {
    schema_version: 1,
    title: { hanzi: '公园', pinyin: 'gōngyuán', english: 'Park' },
    scenario: { hanzi: '你在公园。', pinyin: 'nǐ zài gōngyuán.', english: 'You are in the park.' },
    width: 5,
    height: 4,
    terrain: [
      { key: '.', hanzi: '草地', pinyin: 'cǎodì', english: 'grass', color: '#cfe8bd', walkable: true },
      { key: '#', hanzi: '墙', pinyin: 'qiáng', english: 'wall', color: '#555', walkable: false },
    ],
    grid: ['.....', '.....', '.....', '.....'],
    player: { emoji: '🧑', x: 0, y: 0 },
    carry_limit: 2,
    objects: [
      {
        id: 'ball',
        emoji: '⚽',
        hanzi: '球',
        pinyin: 'qiú',
        english: 'ball',
        x: 2,
        y: 2,
        portable: true,
        surface: false,
        blocks_movement: false,
      },
      {
        id: 'bench',
        emoji: '🪑',
        hanzi: '长椅',
        pinyin: 'chángyǐ',
        english: 'bench',
        x: 4,
        y: 3,
        portable: false,
        surface: true,
        blocks_movement: false,
      },
    ],
    goals: [
      {
        id: 'g1',
        instruction: { hanzi: '把球放在长椅上。', pinyin: 'bǎ qiú fàng zài chángyǐ shàng.', english: 'Put the ball on the bench.' },
        condition: { type: 'object_on', object: 'ball', target: 'bench' },
      },
    ],
    glossary: [],
    ...overrides,
  };
}

/** The one error we care about, or the whole list if it is missing. */
function errorMatching(errors: string[], pattern: RegExp): string | string[] {
  return errors.find((e) => pattern.test(e)) ?? errors;
}

describe('validateQuestWorld', () => {
  it('accepts a well-formed world', () => {
    expect(validateQuestWorld(world())).toEqual([]);
  });

  it('rejects grid rows that do not match the declared size', () => {
    const errors = validateQuestWorld(world({ grid: ['....', '.....', '.....', '.....'] }));
    expect(errorMatching(errors, /row 0 must be exactly 5/)).toMatch(/row 0/);
  });

  it('rejects undefined terrain keys in the grid', () => {
    const errors = validateQuestWorld(world({ grid: ['..~..', '.....', '.....', '.....'] }));
    expect(errorMatching(errors, /terrain key "~"/)).toMatch(/not defined in terrain/);
  });

  it('rejects a player standing in a wall', () => {
    const errors = validateQuestWorld(
      world({ grid: ['#....', '.....', '.....', '.....'], player: { emoji: '🧑', x: 0, y: 0 } })
    );
    expect(errorMatching(errors, /player start/)).toMatch(/non-walkable/);
  });

  it('rejects goals that reference an object that does not exist', () => {
    const errors = validateQuestWorld(
      world({
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '拿起帽子。', pinyin: 'ná qǐ màozi.', english: 'Pick up the hat.' },
            condition: { type: 'holding', object: 'hat' },
          },
        ],
      })
    );
    expect(errorMatching(errors, /"hat"/)).toMatch(/not an object in the world/);
  });

  it('rejects carrying something that is not portable', () => {
    const errors = validateQuestWorld(
      world({
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '拿起长椅。', pinyin: 'ná qǐ chángyǐ.', english: 'Pick up the bench.' },
            condition: { type: 'holding', object: 'bench' },
          },
        ],
      })
    );
    expect(errorMatching(errors, /bench/)).toMatch(/portable/);
  });

  it('rejects putting something on an object that is not a surface', () => {
    const errors = validateQuestWorld(
      world({
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '把球放在球上。', pinyin: 'bǎ qiú fàng zài qiú shàng.', english: 'Put the ball on the ball.' },
            condition: { type: 'object_on', object: 'ball', target: 'ball' },
          },
        ],
      })
    );
    expect(errorMatching(errors, /surface: true/)).toMatch(/surface/);
  });

  it('rejects a state no action can ever produce', () => {
    const objects = world().objects;
    objects[1] = {
      ...objects[1],
      states: [
        { id: 'clean', hanzi: '干净', pinyin: 'gānjìng', english: 'clean' },
        { id: 'dirty', hanzi: '脏', pinyin: 'zāng', english: 'dirty' },
      ],
      initial_state: 'dirty',
    };
    const errors = validateQuestWorld(
      world({
        objects,
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '擦长椅。', pinyin: 'cā chángyǐ.', english: 'Wipe the bench.' },
            condition: { type: 'object_state', object: 'bench', state: 'clean' },
          },
        ],
      })
    );
    expect(errorMatching(errors, /sets_state/)).toMatch(/nothing can put/);
  });

  it('rejects an action that requires a state the object does not have', () => {
    const objects = world().objects;
    objects[1] = {
      ...objects[1],
      states: [{ id: 'clean', hanzi: '干净', pinyin: 'gānjìng', english: 'clean' }],
      actions: [
        { id: 'wipe', hanzi: '擦', pinyin: 'cā', english: 'wipe', requires_state: 'dirty', sets_state: 'clean' },
      ],
    };
    const errors = validateQuestWorld(world({ objects }));
    expect(errorMatching(errors, /requires state "dirty"/)).toMatch(/does not have/);
  });

  it('rejects an object that is walled off from the player', () => {
    const errors = validateQuestWorld(
      world({
        // (4,2) is sealed in by walls at (4,1), (3,2) and (4,3)
        grid: ['.....', '....#', '...#.', '....#'],
        objects: [
          {
            id: 'ball',
            emoji: '⚽',
            hanzi: '球',
            pinyin: 'qiú',
            english: 'ball',
            x: 4,
            y: 2,
            portable: true,
            surface: false,
            blocks_movement: false,
          },
        ],
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '拿起球。', pinyin: 'ná qǐ qiú.', english: 'Pick up the ball.' },
            condition: { type: 'holding', object: 'ball' },
          },
        ],
      })
    );
    expect(errorMatching(errors, /walled off/)).toMatch(/open a path/);
  });

  it('accepts a blocked-off area when a door can be opened to reach it', () => {
    const errors = validateQuestWorld(
      world({
        grid: ['..#..', '..#..', '..#..', '..#..'],
        objects: [
          {
            id: 'ball',
            emoji: '⚽',
            hanzi: '球',
            pinyin: 'qiú',
            english: 'ball',
            x: 4,
            y: 2,
            portable: true,
            surface: false,
            blocks_movement: false,
          },
        ],
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '拿起球。', pinyin: 'ná qǐ qiú.', english: 'Pick up the ball.' },
            condition: { type: 'holding', object: 'ball' },
          },
        ],
      })
    ).filter((e) => /walled off/.test(e));
    // With a solid wall there is genuinely no way through.
    expect(errors).toHaveLength(1);

    const withDoor = validateQuestWorld(
      world({
        grid: ['..#..', '.....', '..#..', '..#..'],
        objects: [
          {
            id: 'gate',
            emoji: '🚪',
            hanzi: '门',
            pinyin: 'mén',
            english: 'gate',
            x: 2,
            y: 1,
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
          {
            id: 'ball',
            emoji: '⚽',
            hanzi: '球',
            pinyin: 'qiú',
            english: 'ball',
            x: 4,
            y: 2,
            portable: true,
            surface: false,
            blocks_movement: false,
          },
        ],
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '打开门，拿起球。', pinyin: 'dǎkāi mén, ná qǐ qiú.', english: 'Open the gate and pick up the ball.' },
            condition: {
              type: 'sequence',
              conditions: [
                { type: 'object_state', object: 'gate', state: 'open' },
                { type: 'holding', object: 'ball' },
              ],
            },
          },
        ],
      })
    );
    expect(withDoor).toEqual([]);
  });

  it('rejects hidden objects that nothing can uncover', () => {
    const errors = validateQuestWorld(
      world({
        objects: [
          ...world().objects,
          {
            id: 'coin',
            emoji: '🪙',
            hanzi: '硬币',
            pinyin: 'yìngbì',
            english: 'coin',
            x: 1,
            y: 1,
            portable: true,
            surface: false,
            blocks_movement: false,
            hidden_until: { object: 'bench', state: 'open' },
          },
        ],
      })
    );
    expect(errorMatching(errors, /hidden until/)).toMatch(/does not have/);
  });

  it('rejects an empty condition group and an unknown condition type', () => {
    const errors = validateQuestWorld(
      world({
        goals: [
          {
            id: 'g1',
            instruction: { hanzi: '做点什么。', pinyin: 'zuò diǎn shénme.', english: 'Do something.' },
            condition: { type: 'sequence', conditions: [] },
          },
          {
            id: 'g2',
            instruction: { hanzi: '做点别的。', pinyin: 'zuò diǎn bié de.', english: 'Do something else.' },
            condition: { type: 'teleport' } as never,
          },
        ],
      })
    );
    expect(errorMatching(errors, /needs at least one condition/)).toMatch(/sequence/);
    expect(errorMatching(errors, /unknown condition type/)).toMatch(/teleport/);
  });
});
