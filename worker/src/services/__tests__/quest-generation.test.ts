import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The generation loop around the model call: validate what comes back, hand the
 * problems back for a repair round, and report progress as it goes. The
 * progress breadcrumb is what a stuck or failed quest is diagnosed from, so it
 * is covered here rather than left to chance.
 */

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message = 'api error') {
      super(message);
      this.status = status;
    }
  }
  class Anthropic {
    messages = { create };
    static APIError = APIError;
  }
  return { default: Anthropic };
});

const { generateQuestWorld } = await import('../quest');

/** A minimal world the validator accepts. */
function validWorld() {
  return {
    title: { hanzi: '厨房', pinyin: 'chúfáng', english: 'Kitchen' },
    scenario: { hanzi: '你在厨房。', pinyin: 'nǐ zài chúfáng.', english: 'You are in the kitchen.' },
    width: 5,
    height: 4,
    carry_limit: 1,
    terrain: [
      { key: '.', hanzi: '地板', pinyin: 'dìbǎn', english: 'floor', color: '#eee', walkable: true },
    ],
    grid: ['.....', '.....', '.....', '.....'],
    player: { emoji: '🧑', x: 0, y: 0 },
    objects: [
      {
        id: 'apple',
        emoji: '🍎',
        hanzi: '苹果',
        pinyin: 'píngguǒ',
        english: 'apple',
        x: 2,
        y: 2,
        portable: true,
        surface: false,
        blocks_movement: false,
      },
    ],
    goals: [
      {
        id: 'g1',
        instruction: { hanzi: '拿起苹果。', pinyin: 'ná qǐ píngguǒ.', english: 'Pick up the apple.' },
        condition: { type: 'holding', object: 'apple' },
      },
    ],
    glossary: [{ hanzi: '拿起', pinyin: 'ná qǐ', english: 'to pick up', pos: 'verb' }],
  };
}

function toolResponse(world: unknown, id = 'toolu_1') {
  return { content: [{ type: 'tool_use', id, name: 'create_quest_world', input: world }] };
}

beforeEach(() => {
  create.mockReset();
});

describe('generateQuestWorld', () => {
  it('returns a validated world and reports each stage', async () => {
    create.mockResolvedValueOnce(toolResponse(validWorld()));
    const stages: string[] = [];

    const world = await generateQuestWorld('key', {
      topic: 'kitchen',
      onProgress: (stage) => {
        stages.push(stage);
      },
    });

    expect(world.goals).toHaveLength(1);
    expect(world.objects[0].id).toBe('apple');
    expect(stages).toEqual(['writing the world', 'checking it is playable']);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('hands validation errors back for a repair round', async () => {
    const broken = validWorld();
    broken.grid = ['....', '.....', '.....', '.....']; // row 0 is a character short
    create.mockResolvedValueOnce(toolResponse(broken, 'toolu_broken'));
    create.mockResolvedValueOnce(toolResponse(validWorld()));
    const stages: string[] = [];

    const world = await generateQuestWorld('key', {
      onProgress: (stage) => {
        stages.push(stage);
      },
    });

    expect(world.goals).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(stages).toContain('repairing the world (round 1)');

    // The second call carries the failed attempt plus its errors as a tool result.
    const repairMessages = create.mock.calls[1][0].messages;
    const toolResult = repairMessages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_broken', is_error: true });
    expect(toolResult.content).toMatch(/row 0 must be exactly 5/);
  });

  it('gives up after the repair rounds and reports what was wrong', async () => {
    const broken = validWorld();
    broken.objects[0].x = 99; // off the map, every time
    create.mockResolvedValue(toolResponse(broken));

    await expect(generateQuestWorld('key', {})).rejects.toThrow(/outside the grid/);
    // First attempt plus two repairs.
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('never lets a failing progress callback break generation', async () => {
    create.mockResolvedValueOnce(toolResponse(validWorld()));

    const world = await generateQuestWorld('key', {
      onProgress: () => {
        throw new Error('D1 is having a moment');
      },
    });

    expect(world.goals).toHaveLength(1);
  });

  it('retries a transient API error before giving up', async () => {
    const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as unknown as {
      default: { APIError: new (status: number) => Error };
    };
    create.mockRejectedValueOnce(new Anthropic.APIError(529));
    create.mockResolvedValueOnce(toolResponse(validWorld()));

    const world = await generateQuestWorld('key', {});
    expect(world.goals).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
