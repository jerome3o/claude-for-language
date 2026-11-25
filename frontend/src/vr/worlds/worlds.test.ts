import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateWorld, WORLD_MATERIALS } from '@shared/vr-worlds';
import { db } from '../../db/database';
import type { UiNode } from '../ui/layout';
import { WORLDS, worldEntry } from './registry';
import { AMBIENCES } from './types';
import { hoverLabelNodes, inspectPanelNodes, taskPanelNodes } from './panels';
import { emptyProgress, withTaskDone } from './progress';
import { carryVelocity, clampLength, easeTowards, releaseVelocity, throwForward, VelocityTracker } from './grabMath';
import { impactVolume } from './sound';

vi.mock('../../services/sourceDecks', () => ({
  addCardToSourceDeck: vi.fn(async (key: string) => ({ key, noteId: 'new-note', noteIds: ['new-note'], deckId: 'deck-vr', deckName: 'From VR' })),
}));

const PUBLIC = join(__dirname, '..', '..', '..', 'public');

function texts(nodes: readonly UiNode[]): string[] {
  const out: string[] = [];
  const visit = (n: UiNode) => {
    if (n.t === 'text') out.push(n.text);
    else if (n.t === 'button') out.push(n.label);
    else if (n.t === 'row') n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

function actions(nodes: readonly UiNode[]): string[] {
  const out: string[] = [];
  const visit = (n: UiNode) => {
    if (n.t === 'button' && !n.disabled) out.push(n.action);
    else if (n.t === 'row') n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

describe('every registered world', () => {
  it('has a unique id and a thumbnail', () => {
    const ids = WORLDS.map((w) => w.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of WORLDS) {
      expect(worldEntry(w.meta.id)).toBe(w);
      expect(w.meta.thumbnail).toBe(`/vr/worlds/${w.meta.id}/thumb.jpg`);
      expect(existsSync(join(PUBLIC, w.meta.thumbnail)), `${w.meta.thumbnail} is missing`).toBe(true);
    }
  });

  for (const entry of WORLDS) {
    it(`${entry.meta.id}: validates, matches its card and has its sounds`, async () => {
      const def = (await entry.load()).default;
      const r = validateWorld(def);
      expect(r.problems).toEqual([]);
      expect(def.id).toBe(entry.meta.id);
      expect(def.title_zh).toBe(entry.meta.title_zh);
      expect(def.title_en).toBe(entry.meta.title_en);
      expect(entry.meta.taskCount).toBe(def.tasks.length);
      expect(entry.meta.objectCount).toBe(def.objects.length);
      expect(def.tasks.length).toBeGreaterThanOrEqual(5);
      expect(def.tasks.length).toBeLessThanOrEqual(12);
      expect(AMBIENCES).toContain(def.ambience);
      if (def.ambience !== 'none') expect(existsSync(join(PUBLIC, 'vr', 'sfx', `amb-${def.ambience}.mp3`))).toBe(true);
      for (const o of def.objects) {
        expect(typeof o.model === 'function' || typeof (o.model as { gltf?: string }).gltf === 'string', `${o.id} has no model`).toBe(true);
        expect(WORLD_MATERIALS).toContain(o.material);
        for (const name of Object.values(o.loops ?? {})) expect(existsSync(join(PUBLIC, 'vr', 'sfx', `${name}.mp3`)), `${o.id} loop ${name}`).toBe(true);
        if (typeof o.model !== 'function') expect(existsSync(join(PUBLIC, o.model.gltf.replace(/^\//, '')))).toBe(true);
      }
    });
  }

  it('every material has its impact sound', () => {
    for (const m of WORLD_MATERIALS) expect(existsSync(join(PUBLIC, 'vr', 'sfx', `impact-${m}.mp3`)), m).toBe(true);
  });
});

describe('the inspect panel', () => {
  const word = { hanzi: '杯子', pinyin: 'bēizi', english: 'cup', measure: '个' };
  const base = { word, online: true, grabbable: true, presenting: false };

  it('shows the word, its measure word and + Add as card when it is new', () => {
    const nodes = inspectPanelNodes({ ...base, status: 'new' });
    expect(texts(nodes)).toEqual(expect.arrayContaining(['杯子', 'bēizi', 'cup', '一个杯子', '＋ Add as card', '▶ Listen']));
    expect(actions(nodes)).toEqual(['play', 'add', 'explore', 'close']);
  });

  it('offline: the add is off and says why', () => {
    const nodes = inspectPanelNodes({ ...base, status: 'new', online: false });
    expect(actions(nodes)).not.toContain('add');
    expect(texts(nodes)).toContain('Adding a card needs a connection.');
  });

  it('a word he has: ⚡ Study it today, the deck, ✓ when known', () => {
    const inDecks = inspectPanelNodes({ ...base, status: 'in_decks', deckName: 'HSK 1' });
    expect(actions(inDecks)).toContain('bump');
    expect(texts(inDecks).join('\n')).toMatch(/In your decks · HSK 1/);
    const added = inspectPanelNodes({ ...base, status: 'in_decks', deckName: 'From VR', added: true });
    expect(texts(added).join('\n')).toMatch(/✓ Added to From VR/);
    const known = inspectPanelNodes({ ...base, status: 'known', deckName: 'HSK 1', bumped: true });
    expect(texts(known).join('\n')).toMatch(/✓ You know this word/);
    expect(actions(known)).not.toContain('bump');
  });

  it('a thing with a state offers its verb', () => {
    const nodes = inspectPanelNodes({
      ...base, word: { hanzi: '冰箱', pinyin: 'bīngxiāng', english: 'fridge' }, status: 'new', grabbable: false,
      states: [{ key: 'door', now: { hanzi: '关着', pinyin: 'guānzhe', english: 'closed' }, next: { hanzi: '打开', pinyin: 'dǎkāi', english: 'open' } }],
    });
    expect(actions(nodes)).toContain('use:door');
    expect(texts(nodes).join('\n')).toMatch(/打开 dǎkāi · open/);
  });

  it('the hover label marks a known word', () => {
    expect(texts(hoverLabelNodes(word, true))).toEqual(['✓ 杯子', 'bēizi']);
    expect(texts(hoverLabelNodes(word, false))).toEqual(['杯子', 'bēizi']);
  });
});

describe('the task panel', () => {
  const task = { id: 't', zh: '把杯子放在桌子上。', pinyin: 'Bǎ bēizi fàng zài zhuōzi shang.', en: 'Put the cup on the table.', done: { holding: 'cup' } };
  const base = { title_zh: '厨房', task, index: 1, total: 9, showPinyin: true, showEnglish: false, elapsedMs: 65_000, freePlay: false, hinting: false, presenting: false, seated: false };

  it('shows the instruction, pinyin when on, English when on', () => {
    expect(texts(taskPanelNodes(base))).toEqual(expect.arrayContaining(['任务 2 / 9 · 1:05', '把杯子放在桌子上。', 'Bǎ bēizi fàng zài zhuōzi shang.']));
    expect(texts(taskPanelNodes(base))).not.toContain('Put the cup on the table.');
    expect(texts(taskPanelNodes({ ...base, showEnglish: true }))).toContain('Put the cup on the table.');
    expect(actions(taskPanelNodes(base))).toEqual(expect.arrayContaining(['speak', 'toggle:pinyin', 'toggle:english', 'hint', 'skip', 'free', 'reset', 'leave']));
    expect(actions(taskPanelNodes(base))).not.toContain('seated');
    expect(actions(taskPanelNodes({ ...base, presenting: true }))).toContain('seated');
  });

  it('a sequence says which step; done / finished / free play have their own faces', () => {
    expect(texts(taskPanelNodes({ ...base, step: { step: 1, of: 2 } })).join('\n')).toMatch(/第 2 步 · step 2 of 2/);
    expect(texts(taskPanelNodes({ ...base, justDone: task }))[0]).toBe('✓ 做得好！ Well done');
    const fin = taskPanelNodes({ ...base, finished: { ms: 200_000, bestMs: 180_000, doneCount: 8 } });
    expect(texts(fin).join('\n')).toMatch(/8 of 9 tasks · 3:20 · best 3:00/);
    expect(actions(fin)).toContain('restart');
    expect(actions(taskPanelNodes({ ...base, freePlay: true }))).toContain('tasks');
  });
});

describe('progress', () => {
  it('remembers tasks once and the best time', () => {
    let p = emptyProgress('kitchen');
    const now = new Date('2026-11-25T10:00:00Z');
    p = withTaskDone(p, 'a', null, now);
    p = withTaskDone(p, 'a', null, now);
    p = withTaskDone(p, 'b', 200_000, now);
    p = withTaskDone(p, 'b', 250_000, now);
    expect(p.done).toEqual(['a', 'b']);
    expect(p.best_ms).toBe(200_000);
    expect(p.runs_finished).toBe(2);
  });
});

describe('carrying and throwing', () => {
  it('estimates the hand velocity', () => {
    const t = new VelocityTracker();
    for (let i = 0; i <= 6; i++) t.push(i * 16, [i * 0.032, 1, 0]);
    const v = t.velocity();
    expect(v[0]).toBeCloseTo(2, 1);
    expect(Math.abs(v[1])).toBeLessThan(1e-6);
  });

  it('steers towards the hand, capped', () => {
    expect(carryVelocity([0, 0, 0], [0.1, 0, 0], [0, 0, 0], 10)).toEqual([1, 0, 0]);
    const fast = carryVelocity([0, 0, 0], [5, 0, 0], [0, 0, 0]);
    expect(Math.hypot(...fast)).toBeCloseTo(14);
    const c = clampLength([3, 4, 0], 2);
    expect(c[0]).toBeCloseTo(1.2);
    expect(c[1]).toBeCloseTo(1.6);
    expect(easeTowards(1, 0.1, 10)).toBeCloseTo(0.1);
  });

  it('flat flicks throw forward; slow letting go just drops', () => {
    expect(releaseVelocity([0.2, 0, 0], 'flat', [0, 0, -1])).toEqual([0.2, 0, 0]);
    const v = releaseVelocity([3, 0, 0], 'flat', [0, 0, -1]);
    expect(v[2]).toBeLessThan(-2);
    expect(releaseVelocity([20, 0, 0], 'xr', [0, 0, -1])[0]).toBe(12);
    expect(throwForward([0, 0, -1])).toEqual([0, 1.6, -5.5]);
  });

  it('impact loudness follows speed', () => {
    expect(impactVolume(0.1)).toBe(0);
    expect(impactVolume(1)).toBeGreaterThan(0);
    expect(impactVolume(10)).toBe(1);
  });
});

describe('words in VR worlds', () => {
  beforeEach(async () => {
    await db.studyBumps.clear();
  });

  it('new / in decks / known from the device; + Add as card goes into "From VR"', async () => {
    const { lookupWorldWord, addWorldWordCard, knownWords } = await import('./words');
    const { addCardToSourceDeck } = await import('../../services/sourceDecks');
    expect((await lookupWorldWord('杯子')).status).toBe('new');
    await db.decks.put({ id: 'd1', name: 'HSK 1' } as never);
    await db.notes.put({ id: 'n1', deck_id: 'd1', hanzi: '杯子', pinyin: 'bēizi', english: 'cup' } as never);
    await db.cards.put({ id: 'c1', note_id: 'n1', deck_id: 'd1', card_type: 'hanzi_to_meaning', queue: 1, stability: 2 } as never);
    expect(await lookupWorldWord('杯子')).toMatchObject({ status: 'in_decks', noteId: 'n1', deckName: 'HSK 1', bumped: false });
    expect((await knownWords(['杯子', '碗'])).size).toBe(0);
    await db.cards.put({ id: 'c1', note_id: 'n1', deck_id: 'd1', card_type: 'hanzi_to_meaning', queue: 2, stability: 40 } as never);
    expect((await lookupWorldWord('杯子')).status).toBe('known');
    expect([...(await knownWords(['杯子', '碗']))]).toEqual(['杯子']);

    const added = await addWorldWordCard({ hanzi: '碗', pinyin: 'wǎn', english: 'bowl', fun_facts: '碗 bowl.', example: { hanzi: '这个碗是蓝色的。', pinyin: 'Zhège wǎn shì lánsè de.', english: 'This bowl is blue.' } });
    expect(added).toEqual({ noteId: 'new-note', deckName: 'From VR' });
    expect(addCardToSourceDeck).toHaveBeenCalledWith('vr', {
      hanzi: '碗', pinyin: 'wǎn', english: 'bowl', fun_facts: '碗 bowl.',
      sentence_clue: '这个碗是蓝色的。', sentence_clue_pinyin: 'Zhège wǎn shì lánsè de.', sentence_clue_translation: 'This bowl is blue.',
    }, 'vr_world');
  });
});
