import Anthropic from '@anthropic-ai/sdk';
import type {
  QuestGlossaryEntry,
  QuestObject,
  QuestWorld,
} from '@shared/quest';
import {
  QUEST_MAX_GOALS,
  QUEST_MAX_OBJECTS,
  QUEST_MAX_SIZE,
  QUEST_MIN_SIZE,
  QUEST_SCHEMA_VERSION,
  validateQuestWorld,
} from '@shared/quest';

/**
 * Quest generation.
 *
 * The app ships a game *engine*, not a set of hand-written levels: Claude
 * authors the whole world — the map, the objects, the verbs those objects
 * accept, and the goals, each with a machine-checkable condition. The engine in
 * @shared/quest plays whatever comes back, so a new lesson is a prompt away.
 *
 * Because a generated world can be subtly unplayable (an object walled off, a
 * goal referencing a state nothing can produce), every world is validated
 * before it is stored, and validation failures are fed back to the model as a
 * repair turn. Only worlds that pass are saved.
 */

const MODEL = 'claude-opus-5';
const MAX_REPAIR_ATTEMPTS = 2;

export interface QuestGenerationInput {
  /** Free-text topic from the learner ("a farm", "getting ready for work"). */
  topic?: string | null;
  /** Words the learner already knows, to build the world out of. */
  vocabulary?: Array<{ hanzi: string; pinyin: string; english: string }>;
  /** Learner bio, so scenarios can land in their actual life. */
  bio?: string | null;
  difficulty?: QuestDifficulty;
  goalCount?: number;
  /** Called as generation moves through its stages, for the progress breadcrumb. */
  onProgress?: (stage: string) => void | Promise<void>;
}

export type QuestDifficulty = 'easy' | 'medium' | 'hard';

export const QUEST_DEFAULT_GOAL_COUNT = 5;
export const QUEST_MIN_GOAL_COUNT = 3;

const VOCAB_SAMPLE_CAP = 90;

const DIFFICULTY_BRIEF: Record<QuestDifficulty, string> = {
  easy: `Grid around 6x6. 5-8 objects. Instructions are single clauses in the plainest imperative: 拿起…, 放下…, 走到…, 打开…. At most one 把 sentence, and only in the last goal. Keep every sentence under 10 characters.`,
  medium: `Grid around 7x7. 8-12 objects, at least one with states (a door, a fridge, a tap). Most instructions are one clause; the last two chain two actions with 先…然后… or 把…放在…上. Sentences run 8-18 characters.`,
  hard: `Grid around 8x8 (never larger than ${QUEST_MAX_SIZE}). 10-16 objects, several with states, at least one thing hidden inside another and at least one door that needs opening. Instructions chain three or four actions using 先…再…然后…最后, 把…放到…里, 别…, conditional 如果…就…, and directional complements (拿过去, 拿回来). Later sentences run 20-40 characters.`,
};

const SYSTEM_PROMPT = `You are designing a tiny top-down video game level whose purpose is to teach a learner **imperative-register Mandarin** — the language of instructions, directions and commands. The learner reads an instruction in Chinese and has to carry it out by driving a little character around a grid with on-screen arrows, a pick-up button, a put-down button, and verb buttons that appear next to whatever they are standing beside.

The game engine is fixed. You are authoring the world data it runs. Everything below is a rule of that engine, not a suggestion — a world that breaks one of them is unplayable.

## The grid
- Coordinates are (x, y). x runs left→right, y runs top→bottom, origin (0,0) is the top-left tile.
- \`grid\` is exactly \`height\` strings of exactly \`width\` single-character terrain keys. Every character must be a key defined in \`terrain\`.
- Terrain keys are single ASCII characters (e.g. "." floor, "#" wall, "g" grass, "w" water). Give each terrain a Chinese name, pinyin, English, a CSS colour, and \`walkable\`.
- Walls and water (walkable: false) are what give the map its shape. Use them to make rooms, paths and a bit of visual interest — but never seal off anything a goal needs.

## The character
- The player starts on a walkable tile and moves one tile at a time, up/down/left/right. It cannot enter non-walkable tiles or tiles holding an object with blocks_movement.
- It can touch (pick up, or use a verb on) any object on its own tile or on the four orthogonally adjacent tiles.
- It carries up to \`carry_limit\` objects (1 or 2 — use 1 unless a goal truly needs two).
- **Put down places the object on the tile the player is standing on.** This matters: for "把苹果放在桌子上" to be possible, the table must be on a walkable tile the player can stand on, so tables/shelves/mats must have blocks_movement: false and surface: true.

## Objects
- Every object needs a single emoji that visually reads as the thing (🍎 apple, 🚪 door, 🐕 dog, 🪣 bucket), plus hanzi, pinyin with tone marks, and English.
- \`portable: true\` for anything that can be carried. \`surface: true\` for anything things can be put on or in (table, box, fridge, basket, mat). \`blocks_movement: true\` for walls, closed doors, big furniture.
- **States** model things that change: a door 开着/关着, a lamp 开着/关着, a plate 干净/脏, a window. List them in \`states\`, pick \`initial_state\`, and give a state \`blocks_movement: false\` if being in that state opens the way through (that is exactly how an openable door works).
- **Actions** are the verbs the learner will meet — this is the heart of the lesson. Each action is an imperative verb (打开, 关上, 吃, 喝, 洗, 切, 浇, 喂, 按, 推, 穿, 摘) with pinyin and English, optionally gated on \`requires_state\` or on carrying something (\`requires_holding\`, for a key or a tool), and it either moves the object to \`sets_state\` or makes it disappear (\`removes_object: true\` for 吃 / 喝).
- **hidden_until** puts an object inside another: the milk is \`hidden_until: { object: "fridge", state: "open" }\`. Give it the same coordinates as its container. Something must be able to reach that state, or the object can never be found.

## Goals
- Goals are played strictly in order, one instruction on screen at a time. Ramp them: the first is a single easy action, the last is the longest chain.
- \`instruction.hanzi\` is what the learner reads. Write it as a real imperative — how a person actually gives an order or a direction in Mandarin. Use the natural repertoire: 拿起, 放下, 打开, 关上, 走到…去, 把…放在…上/里, 先…然后…, 再…, 最后…, 请…, 别…, 给…, and directional complements (拿过去, 走回来). Do not write textbook English translated word-for-word into Chinese.
- \`condition\` must encode that instruction **exactly** — no more and no less. If the instruction says to put the apple on the table, the condition is \`object_on\` apple→table. If it says to open the fridge first and then take the milk, the condition is a \`sequence\` of \`object_state\` then \`holding\`.
- \`hint\` is a gentler restatement in Chinese (with pinyin and English) for a stuck learner. \`success\` is a short congratulation in Chinese.

### Condition types
- \`{"type":"holding","object":id}\` / \`{"type":"not_holding","object":id}\` — carrying it (the object must be portable)
- \`{"type":"object_at","object":id,"x":n,"y":n}\` — put down on a specific tile
- \`{"type":"object_on","object":id,"target":id}\` — put down on/in another object (target must have surface: true)
- \`{"type":"object_on_terrain","object":id,"terrain":key}\` — put down on a kind of ground
- \`{"type":"player_at","x":n,"y":n}\` / \`{"type":"player_on_terrain","terrain":key}\` / \`{"type":"player_next_to","object":id}\` — where the character ends up
- \`{"type":"object_state","object":id,"state":stateId}\` — something has been opened, closed, cleaned, switched on
- \`{"type":"object_removed","object":id}\` — eaten, drunk, used up (needs an action with removes_object)
- \`{"type":"performed","object":id,"action":actionId}\` — the verb was used at least once
- \`{"type":"all_of"|"any_of","conditions":[…]}\` — combine, order does not matter
- \`{"type":"sequence","conditions":[…]}\` — each becomes true in order. **This is how 先…然后… instructions are checked, and steps stay ticked off even if the learner undoes them later.**

## Glossary
List the words the lesson actually teaches — every verb used in an action or an instruction, the key nouns, and any pattern worth naming (把 + 名词 + 放在 + 地方 + 上). Give pinyin with tone marks, a natural English gloss, and for patterns a short usage note.

## Hard rules
1. Pinyin uses tone marks (dǎkāi), never numbers (da3kai1). Multi-syllable words stay together.
2. Chinese text uses Chinese punctuation (，。) and no spaces.
3. Every id is a short lowercase ASCII slug (apple, front_door, red_key), unique within its scope.
4. Grid size between ${QUEST_MIN_SIZE} and ${QUEST_MAX_SIZE} on each side; at most ${QUEST_MAX_OBJECTS} objects and ${QUEST_MAX_GOALS} goals.
5. Objects sit on walkable tiles, unless they are the thing doing the blocking.
6. The whole level must be completable from the player's start: every object and tile a goal mentions must be reachable on foot (through doors the learner can open).
7. Before you answer, mentally play the level from the start position: walk to each object, check each verb is offered when you need it, and check each condition can actually become true.

Return the world through the create_quest_world tool.`;

interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

const CONDITION_TYPES = [
  'holding',
  'not_holding',
  'object_at',
  'object_on',
  'object_on_terrain',
  'player_at',
  'player_on_terrain',
  'player_next_to',
  'object_state',
  'object_removed',
  'performed',
  'all_of',
  'any_of',
  'sequence',
];

/**
 * The condition tree is recursive; tool schemas are flattened, so nest it to a
 * fixed depth. Three levels is enough for "sequence of (all_of of leaves)".
 */
function conditionSchema(depth: number): ToolSchema {
  const properties: Record<string, unknown> = {
    type: { type: 'string', enum: CONDITION_TYPES },
    object: { type: 'string', description: 'Object id, for object/holding conditions' },
    target: { type: 'string', description: 'Target object id, for object_on' },
    terrain: { type: 'string', description: 'Terrain key, for *_on_terrain conditions' },
    state: { type: 'string', description: 'State id, for object_state' },
    action: { type: 'string', description: 'Action id, for performed' },
    x: { type: 'integer' },
    y: { type: 'integer' },
  };
  if (depth > 0) {
    properties.conditions = {
      type: 'array',
      description: 'Child conditions, for all_of / any_of / sequence',
      items: conditionSchema(depth - 1),
    };
  }
  return { type: 'object', properties, required: ['type'] };
}

const TEXT_SCHEMA = {
  type: 'object',
  properties: {
    hanzi: { type: 'string' },
    pinyin: { type: 'string', description: 'Tone marks, not numbers' },
    english: { type: 'string' },
  },
  required: ['hanzi', 'pinyin', 'english'],
};

const WORLD_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    title: TEXT_SCHEMA,
    scenario: { ...TEXT_SCHEMA, description: 'One or two sentences of setup, in Chinese' },
    width: { type: 'integer', minimum: QUEST_MIN_SIZE, maximum: QUEST_MAX_SIZE },
    height: { type: 'integer', minimum: QUEST_MIN_SIZE, maximum: QUEST_MAX_SIZE },
    carry_limit: { type: 'integer', minimum: 1, maximum: 2 },
    terrain: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Single character used in grid rows' },
          hanzi: { type: 'string' },
          pinyin: { type: 'string' },
          english: { type: 'string' },
          color: { type: 'string', description: 'CSS hex colour for the tile' },
          emoji: { type: 'string', description: 'Optional faint decoration on the tile' },
          walkable: { type: 'boolean' },
        },
        required: ['key', 'hanzi', 'pinyin', 'english', 'color', 'walkable'],
      },
    },
    grid: {
      type: 'array',
      description: 'Exactly `height` rows of exactly `width` terrain key characters',
      items: { type: 'string' },
    },
    player: {
      type: 'object',
      properties: {
        emoji: { type: 'string' },
        x: { type: 'integer' },
        y: { type: 'integer' },
      },
      required: ['emoji', 'x', 'y'],
    },
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          emoji: { type: 'string', description: 'A single emoji sprite' },
          hanzi: { type: 'string' },
          pinyin: { type: 'string' },
          english: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          portable: { type: 'boolean' },
          surface: { type: 'boolean', description: 'Things can be put on/in it' },
          blocks_movement: { type: 'boolean' },
          initial_state: { type: 'string' },
          states: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                hanzi: { type: 'string' },
                pinyin: { type: 'string' },
                english: { type: 'string' },
                emoji: { type: 'string', description: 'Sprite while in this state' },
                blocks_movement: {
                  type: 'boolean',
                  description: 'Overrides the object default while in this state',
                },
              },
              required: ['id', 'hanzi', 'pinyin', 'english'],
            },
          },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                hanzi: { type: 'string', description: 'The verb, e.g. 打开' },
                pinyin: { type: 'string' },
                english: { type: 'string' },
                requires_state: { type: 'string' },
                requires_holding: { type: 'string', description: 'Object id that must be carried' },
                sets_state: { type: 'string' },
                removes_object: { type: 'boolean' },
              },
              required: ['id', 'hanzi', 'pinyin', 'english'],
            },
          },
          hidden_until: {
            type: 'object',
            description: 'Keeps this object inside another until that one reaches a state',
            properties: {
              object: { type: 'string' },
              state: { type: 'string' },
            },
            required: ['object', 'state'],
          },
        },
        required: ['id', 'emoji', 'hanzi', 'pinyin', 'english', 'x', 'y', 'portable', 'surface', 'blocks_movement'],
      },
    },
    goals: {
      type: 'array',
      description: 'Played in order, ramping in difficulty',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          instruction: { ...TEXT_SCHEMA, description: 'The imperative instruction the learner reads' },
          hint: { ...TEXT_SCHEMA, description: 'A gentler restatement for a stuck learner' },
          success: { ...TEXT_SCHEMA, description: 'Short congratulation in Chinese' },
          condition: conditionSchema(3),
        },
        required: ['id', 'instruction', 'condition'],
      },
    },
    glossary: {
      type: 'array',
      description: 'The vocabulary this lesson teaches — every verb used, key nouns, and patterns',
      items: {
        type: 'object',
        properties: {
          hanzi: { type: 'string' },
          pinyin: { type: 'string' },
          english: { type: 'string' },
          pos: { type: 'string', enum: ['verb', 'noun', 'phrase', 'other'] },
          note: { type: 'string', description: 'Short usage note, e.g. the pattern shape' },
        },
        required: ['hanzi', 'pinyin', 'english', 'pos'],
      },
    },
  },
  required: [
    'title',
    'scenario',
    'width',
    'height',
    'carry_limit',
    'terrain',
    'grid',
    'player',
    'objects',
    'goals',
    'glossary',
  ],
};

export function clampGoalCount(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return QUEST_DEFAULT_GOAL_COUNT;
  return Math.min(QUEST_MAX_GOALS, Math.max(QUEST_MIN_GOAL_COUNT, Math.round(requested)));
}

function buildUserPrompt(input: QuestGenerationInput, goalCount: number): string {
  const difficulty: QuestDifficulty = input.difficulty ?? 'medium';
  const parts: string[] = [
    input.topic
      ? `Build a level around this: "${input.topic}".`
      : `Pick an everyday setting the learner can picture — a kitchen, a small shop, a garden, a classroom, a train platform — and build a level in it.`,
    `Difficulty: ${difficulty}. ${DIFFICULTY_BRIEF[difficulty]}`,
    `Write exactly ${goalCount} goals, ramping from a single action to a multi-step chain.`,
  ];

  const vocab = (input.vocabulary ?? []).filter((v) => v.hanzi);
  if (vocab.length > 0) {
    const sample = vocab.length <= VOCAB_SAMPLE_CAP
      ? vocab
      : [...vocab].sort(() => Math.random() - 0.5).slice(0, VOCAB_SAMPLE_CAP);
    parts.push(
      `The learner already knows these words. Build the world out of the ones that fit the setting — objects, verbs and instructions should lean on this list, with only a handful of new words (which must appear in the glossary):\n${sample
        .map((v) => `${v.hanzi} (${v.pinyin}) — ${v.english}`)
        .join('\n')}`
    );
  }

  if (input.bio) {
    parts.push(
      `The learner describes themselves as: "${input.bio}". Nudge the setting towards their life where it fits naturally.`
    );
  }

  return parts.join('\n\n');
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

type RawWorld = Record<string, unknown>;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function text(value: unknown, fallback = { hanzi: '', pinyin: '', english: '' }) {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    hanzi: str(raw.hanzi, fallback.hanzi),
    pinyin: str(raw.pinyin, fallback.pinyin),
    english: str(raw.english, fallback.english),
  };
}

/** First emoji-ish grapheme, so a stray "🍎 apple" still renders as a sprite. */
function firstGlyph(value: unknown, fallback: string): string {
  const raw = str(value);
  if (!raw) return fallback;
  const glyphs = [...raw.replace(/\s/g, '')];
  if (glyphs.length === 0) return fallback;
  // Keep zero-width-joiner sequences and variation selectors together.
  const ZWJ = '\u200D';
  const VARIATION_SELECTOR = '\uFE0F';
  let out = glyphs[0];
  for (let i = 1; i < glyphs.length; i++) {
    const prev = glyphs[i - 1];
    const cur = glyphs[i];
    if (prev === ZWJ || cur === ZWJ || cur === VARIATION_SELECTOR || /\p{Emoji_Modifier}/u.test(cur)) {
      out += cur;
    } else {
      break;
    }
  }
  return out;
}

/**
 * Turn the model's tool output into a world the engine can run: fill in
 * defaults, drop empty entries, and normalise types. Deliberately forgiving —
 * validateQuestWorld is what decides whether the result is playable.
 * Exported for tests.
 */
export function normalizeQuestWorld(raw: RawWorld): QuestWorld {
  const terrain = (Array.isArray(raw.terrain) ? raw.terrain : [])
    .map((t) => {
      const entry = (t ?? {}) as Record<string, unknown>;
      return {
        key: str(entry.key).slice(0, 1),
        hanzi: str(entry.hanzi),
        pinyin: str(entry.pinyin),
        english: str(entry.english),
        color: str(entry.color, '#e5e7eb'),
        emoji: entry.emoji ? firstGlyph(entry.emoji, '') || null : null,
        walkable: bool(entry.walkable, true),
      };
    })
    .filter((t) => t.key);

  const objects: QuestObject[] = (Array.isArray(raw.objects) ? raw.objects : [])
    .map((o) => {
      const entry = (o ?? {}) as Record<string, unknown>;
      const states = (Array.isArray(entry.states) ? entry.states : [])
        .map((s) => {
          const state = (s ?? {}) as Record<string, unknown>;
          return {
            id: str(state.id),
            hanzi: str(state.hanzi),
            pinyin: str(state.pinyin),
            english: str(state.english),
            emoji: state.emoji ? firstGlyph(state.emoji, '') || null : null,
            blocks_movement:
              typeof state.blocks_movement === 'boolean' ? state.blocks_movement : null,
          };
        })
        .filter((s) => s.id);

      const actions = (Array.isArray(entry.actions) ? entry.actions : [])
        .map((a) => {
          const action = (a ?? {}) as Record<string, unknown>;
          return {
            id: str(action.id),
            hanzi: str(action.hanzi),
            pinyin: str(action.pinyin),
            english: str(action.english),
            requires_state: str(action.requires_state) || null,
            requires_holding: str(action.requires_holding) || null,
            sets_state: str(action.sets_state) || null,
            removes_object: bool(action.removes_object, false),
          };
        })
        .filter((a) => a.id && a.hanzi);

      const hidden = (entry.hidden_until ?? null) as Record<string, unknown> | null;

      return {
        id: str(entry.id),
        emoji: firstGlyph(entry.emoji, '❓'),
        hanzi: str(entry.hanzi),
        pinyin: str(entry.pinyin),
        english: str(entry.english),
        x: int(entry.x),
        y: int(entry.y),
        portable: bool(entry.portable, false),
        surface: bool(entry.surface, false),
        blocks_movement: bool(entry.blocks_movement, false),
        states: states.length > 0 ? states : null,
        initial_state: str(entry.initial_state) || (states[0]?.id ?? null),
        actions: actions.length > 0 ? actions : null,
        hidden_until:
          hidden && str(hidden.object) && str(hidden.state)
            ? { object: str(hidden.object), state: str(hidden.state) }
            : null,
      };
    })
    .filter((o) => o.id);

  const goals = (Array.isArray(raw.goals) ? raw.goals : [])
    .map((g, index) => {
      const goal = (g ?? {}) as Record<string, unknown>;
      return {
        id: str(goal.id) || `goal_${index + 1}`,
        instruction: text(goal.instruction),
        hint: goal.hint ? text(goal.hint) : null,
        success: goal.success ? text(goal.success) : null,
        condition: normalizeCondition(goal.condition),
      };
    })
    .filter((g) => g.instruction.hanzi);

  const glossary: QuestGlossaryEntry[] = (Array.isArray(raw.glossary) ? raw.glossary : [])
    .map((e) => {
      const entry = (e ?? {}) as Record<string, unknown>;
      const pos = str(entry.pos, 'other');
      return {
        hanzi: str(entry.hanzi),
        pinyin: str(entry.pinyin),
        english: str(entry.english),
        pos: (['verb', 'noun', 'phrase', 'other'].includes(pos) ? pos : 'other') as QuestGlossaryEntry['pos'],
        note: str(entry.note) || null,
      };
    })
    .filter((e) => e.hanzi);

  const player = (raw.player ?? {}) as Record<string, unknown>;

  return {
    schema_version: QUEST_SCHEMA_VERSION,
    title: text(raw.title),
    scenario: text(raw.scenario),
    width: int(raw.width, 6),
    height: int(raw.height, 6),
    terrain,
    grid: (Array.isArray(raw.grid) ? raw.grid : []).map((row) => str(row)),
    player: {
      emoji: firstGlyph(player.emoji, '🧑'),
      x: int(player.x),
      y: int(player.y),
    },
    carry_limit: Math.min(4, Math.max(1, int(raw.carry_limit, 1))),
    objects,
    goals,
    glossary,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCondition(raw: unknown): any {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const type = str(entry.type);
  const out: Record<string, unknown> = { type };
  for (const key of ['object', 'target', 'terrain', 'state', 'action'] as const) {
    if (entry[key] !== undefined) out[key] = str(entry[key]);
  }
  for (const key of ['x', 'y'] as const) {
    if (entry[key] !== undefined) out[key] = int(entry[key]);
  }
  if (Array.isArray(entry.conditions)) {
    out.conditions = entry.conditions.map(normalizeCondition);
  }
  return out;
}

/**
 * Generate a playable quest world. Validates the result and gives the model up
 * to `MAX_REPAIR_ATTEMPTS` goes at fixing whatever it got wrong, feeding the
 * validation errors back as a normal tool-result turn.
 */
export async function generateQuestWorld(
  apiKey: string,
  input: QuestGenerationInput
): Promise<QuestWorld> {
  const client = new Anthropic({ apiKey });
  const goalCount = clampGoalCount(input.goalCount);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserPrompt(input, goalCount) },
  ];

  let lastErrors: string[] = [];
  const report = async (stage: string) => {
    try {
      await input.onProgress?.(stage);
    } catch {
      // A breadcrumb is never worth failing generation over.
    }
  };

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    await report(attempt === 0 ? 'writing the world' : `repairing the world (round ${attempt})`);
    const response = await callWithRetry(client, messages);
    await report(attempt === 0 ? 'checking it is playable' : `checking the repair (round ${attempt})`);

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('No quest world in AI response');
    }

    const world = normalizeQuestWorld(toolUse.input as RawWorld);
    const errors = validateQuestWorld(world);
    if (errors.length === 0) return world;

    lastErrors = errors;
    console.warn(`[quest] world failed validation (attempt ${attempt + 1}):`, errors);

    if (attempt === MAX_REPAIR_ATTEMPTS) break;

    // Hand the problems back as a tool result so the model repairs in context
    // rather than starting from scratch.
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: `The level is not playable yet. Fix every problem below and call create_quest_world again with the COMPLETE corrected world (not a patch):\n\n${errors
              .map((e) => `- ${e}`)
              .join('\n')}`,
          },
        ],
      }
    );
  }

  throw new Error(
    `Could not build a playable level: ${lastErrors.slice(0, 4).join('; ')}`
  );
}

async function callWithRetry(
  client: Anthropic,
  messages: Anthropic.MessageParam[]
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    try {
      return await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // Forced tool use rules out extended thinking, and the schema is
        // tightly specified enough that the tool call is the whole answer.
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'create_quest_world',
            description: 'Return the complete, playable level.',
            input_schema: WORLD_SCHEMA as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'create_quest_world' },
        messages,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Quest generation failed');
}
