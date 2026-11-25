/**
 * What the VR world panels show (docs/VR_WORLDS.md "Inspect → word", "Tasks"), as plain UI nodes for
 * the VR panel kit (vr/ui/layout.ts): the task HUD on the wrist (or the corner of the flat preview),
 * the inspect panel over an object, the hover label. Pure functions of their inputs (unit-tested);
 * the page decides the inputs, the scene draws the nodes.
 */
import type { WorldTaskSpec, WorldWord } from '@shared/vr-worlds';
import { formatDuration } from '@shared/vr-worlds';
import type { UiButton, UiNode } from '../ui/layout';

export type WordStatus = 'checking' | 'new' | 'in_decks' | 'known';

export interface InspectInput {
  word: WorldWord;
  status: WordStatus;
  /** The deck it is in (or was just added to). */
  deckName?: string | null;
  /** Just added from here (the line says so). */
  added?: boolean;
  /** In today's ⚡ pocket already. */
  bumped?: boolean;
  online: boolean;
  busy?: 'adding' | 'bumping' | null;
  error?: string | null;
  /** The object's states: what it is now and the verb that changes it ("打开"). */
  states?: Array<{ key: string; now: WorldWord; next: WorldWord }>;
  /** Grabbable things say how to pick them up. */
  grabbable: boolean;
  presenting: boolean;
}

const btn = (label: string, action: string, tone: UiButton['tone'] = 'chip', extra: Partial<UiButton> = {}): UiButton => ({ t: 'button', label, action, tone, size: 26, ...extra });

export function inspectPanelNodes(i: InspectInput): UiNode[] {
  const w = i.word;
  const nodes: UiNode[] = [
    { t: 'text', text: w.hanzi, size: 92, weight: 600, color: 'zh', align: 'center', explore: true },
    { t: 'text', text: w.pinyin, size: 34, color: 'accent', align: 'center' },
    { t: 'text', text: w.english, size: 28, align: 'center' },
  ];
  if (w.measure) {
    nodes.push({ t: 'text', text: `一${w.measure}${w.hanzi}`, size: 26, color: 'muted', align: 'center', explore: true, segments: ['一', w.measure, w.hanzi] });
  }
  for (const s of i.states ?? []) {
    nodes.push({
      t: 'row',
      mode: 'wrap',
      align: 'center',
      children: [
        { t: 'text', text: `${s.now.hanzi} ${s.now.pinyin}`, size: 24, color: 'muted' },
        btn(`✋ ${s.next.hanzi} ${s.next.pinyin} · ${s.next.english}`, `use:${s.key}`, 'primary'),
      ],
    });
  }
  // The card line: known / in your decks / new.
  if (i.status === 'known') nodes.push({ t: 'text', text: `✓ You know this word${i.deckName ? ` · ${i.deckName}` : ''}`, size: 22, color: 'good', align: 'center' });
  else if (i.status === 'in_decks') nodes.push({ t: 'text', text: `${i.added ? '✓ Added to' : '📚 In your decks ·'} ${i.deckName ?? 'your deck'}${i.bumped ? ' · ⚡ in today' : ''}`, size: 22, color: i.added ? 'good' : 'muted', align: 'center' });
  if (i.error) nodes.push({ t: 'text', text: i.error, size: 22, color: 'bad', align: 'center' });
  const actions: UiButton[] = [btn('▶ Listen', 'play')];
  if (i.status === 'new' || i.status === 'checking') {
    actions.push(btn(i.busy === 'adding' ? 'Adding…' : '＋ Add as card', 'add', 'primary', { disabled: i.status === 'checking' || !i.online || !!i.busy }));
  } else {
    actions.push(btn(i.bumped ? '⚡ In today' : i.busy === 'bumping' ? '⚡ …' : '⚡ Study it today', 'bump', i.bumped ? 'chip' : 'primary', { disabled: i.bumped || !!i.busy, selected: i.bumped }));
  }
  actions.push(btn('🔍 Explore', 'explore'), btn('✕', 'close', 'plain'));
  nodes.push({ t: 'row', mode: 'wrap', align: 'center', gap: 10, children: actions });
  if ((i.status === 'new' || i.status === 'checking') && !i.online) nodes.push({ t: 'text', text: 'Adding a card needs a connection.', size: 20, color: 'muted', align: 'center' });
  if (i.grabbable) {
    nodes.push({
      t: 'text',
      text: i.presenting ? 'Squeeze (or hold the trigger) to pick it up · let go to drop · swing to throw' : 'Hold the mouse on it to pick it up · flick to throw · Space throws',
      size: 19,
      color: 'muted',
      align: 'center',
    });
  }
  return nodes;
}

/** The small label over whatever the ray / mouse is on. */
export function hoverLabelNodes(word: WorldWord, known: boolean): UiNode[] {
  return [
    { t: 'text', text: `${known ? '✓ ' : ''}${word.hanzi}`, size: 44, weight: 600, color: known ? 'good' : 'zh', align: 'center' },
    { t: 'text', text: word.pinyin, size: 24, color: 'accent', align: 'center' },
  ];
}

export interface TaskPanelInput {
  title_zh: string;
  task: WorldTaskSpec | null;
  index: number;
  total: number;
  /** The task's Chinese cut into words (explorer taps), when the segmenter is ready. */
  segments?: string[];
  showPinyin: boolean;
  showEnglish: boolean;
  /** A sequence's progress ("step 1 of 2"). */
  step?: { step: number; of: number } | null;
  elapsedMs: number;
  /** Just finished this one (the "✓ 做得好" moment). */
  justDone?: WorldTaskSpec | null;
  finished?: { ms: number; bestMs: number | null; doneCount: number } | null;
  freePlay: boolean;
  hinting: boolean;
  presenting: boolean;
  seated: boolean;
}

export function taskPanelNodes(i: TaskPanelInput): UiNode[] {
  const nodes: UiNode[] = [];
  const toggles: UiButton[] = [
    btn('拼', 'toggle:pinyin', 'chip', { selected: i.showPinyin }),
    btn('EN', 'toggle:english', 'chip', { selected: i.showEnglish }),
  ];
  const footer: UiButton[] = [
    btn('↺ Reset room', 'reset', 'plain'),
    ...(i.presenting ? [btn(i.seated ? '🧍 Standing' : '🪑 Seated', 'seated', 'plain')] : []),
    btn('🚪 Leave', 'leave', 'plain'),
  ];
  if (i.freePlay) {
    nodes.push(
      { t: 'text', text: `${i.title_zh} · 自由玩 Free play`, size: 26, weight: 600, color: 'accent' },
      { t: 'text', text: 'Pick things up, throw them, tap them to learn their names.', size: 24, color: 'muted' },
      { t: 'row', mode: 'wrap', gap: 8, children: [btn('📝 Tasks', 'tasks', 'primary'), ...footer] },
    );
    return nodes;
  }
  if (i.finished) {
    nodes.push(
      { t: 'text', text: '🎉 全部完成！ All done', size: 40, weight: 700, color: 'good' },
      { t: 'text', text: `${i.finished.doneCount} of ${i.total} tasks · ${formatDuration(i.finished.ms)}${i.finished.bestMs !== null ? ` · best ${formatDuration(i.finished.bestMs)}` : ''}`, size: 24, color: 'muted' },
      { t: 'row', mode: 'wrap', gap: 8, children: [btn('↻ Play again', 'restart', 'primary'), btn('🎮 Free play', 'free'), ...footer] },
    );
    return nodes;
  }
  if (i.justDone) {
    nodes.push(
      { t: 'text', text: '✓ 做得好！ Well done', size: 40, weight: 700, color: 'good' },
      { t: 'text', text: i.justDone.zh, size: 26, color: 'muted' },
    );
    return nodes;
  }
  const t = i.task;
  if (!t) return [{ t: 'text', text: 'No tasks here — free play.', color: 'muted' }];
  nodes.push({ t: 'text', text: `任务 ${i.index + 1} / ${i.total} · ${formatDuration(i.elapsedMs)}`, size: 22, color: 'muted' });
  nodes.push({ t: 'text', text: t.zh, size: 46, weight: 600, color: 'zh', explore: true, segments: i.segments });
  if (i.showPinyin) nodes.push({ t: 'text', text: t.pinyin, size: 26, color: 'accent' });
  if (i.showEnglish) nodes.push({ t: 'text', text: t.en, size: 24, color: 'muted' });
  if (i.step && i.step.of > 1) nodes.push({ t: 'text', text: `第 ${Math.min(i.step.step + 1, i.step.of)} 步 · step ${Math.min(i.step.step + 1, i.step.of)} of ${i.step.of}`, size: 22, color: 'warn' });
  if (i.hinting) nodes.push({ t: 'text', text: '💡 The glowing things are the ones to use.', size: 22, color: 'warn' });
  nodes.push({ t: 'row', mode: 'wrap', gap: 8, children: [btn('▶ 再听', 'speak', 'primary'), ...toggles, btn('💡', 'hint', 'chip', { selected: i.hinting }), btn('⏭ Skip', 'skip', 'plain')] });
  nodes.push({ t: 'row', mode: 'wrap', gap: 8, children: [btn('🎮 Free play', 'free', 'plain'), ...footer] });
  return nodes;
}
