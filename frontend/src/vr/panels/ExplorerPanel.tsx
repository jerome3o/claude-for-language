/**
 * The language explorer as a VR window (docs/LANGUAGE_EXPLORER.md): the same stack of views
 * (shared/explorer/stack.ts) and the same card-independent data — the character dictionary and
 * the word dictionary, device cache first (services/charDict.ts, services/wordDict.ts). Tap a
 * character or word inside it to go deeper; ← goes back. 🎤 with the explorer in front looks up
 * what you say.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { explorerReducer, hanOnly, itemForText, itemKey, breadcrumbTrail, type ExplorerItem } from '@shared/explorer/stack';
import { resolveWord, wordFrequencyLabel, type ResolvedWord } from '@shared/explorer/word';
import type { CharRecord } from '@shared/chars/types';
import { lookupChar, type CharLookup } from '../../services/charDict';
import { lookupWord, type WordLookup } from '../../services/wordDict';
import { track } from '../../services/analytics';
import { playText } from '../audio';
import type { UiNode } from '../ui/layout';
import type { PanelHostProps } from './types';

export type ExplorerData =
  | { kind: 'loading' }
  | { kind: 'char'; record: CharRecord }
  | { kind: 'word'; word: ResolvedWord; chars: string[] }
  | { kind: 'missing'; offline: boolean };

export function explorerView(stack: readonly ExplorerItem[], data: ExplorerData): UiNode[] {
  const nodes: UiNode[] = [];
  if (stack.length > 1) {
    const trail = breadcrumbTrail(stack, 4);
    nodes.push({
      t: 'row',
      mode: 'wrap',
      children: [
        { t: 'button', label: '← Back', action: 'pop', tone: 'plain', size: 26 },
        ...trail.map((c) => (c.kind === 'gap'
          ? { t: 'text' as const, text: '…', color: 'muted' as const }
          : { t: 'button' as const, label: c.label, action: `crumb:${c.index}`, tone: 'chip' as const, size: 26, selected: c.current })),
      ],
    });
  }
  const top = stack[stack.length - 1];
  if (!top) return [{ t: 'text', text: 'Tap any Chinese in a window to explore it.', color: 'muted', align: 'center' }];
  const label = top.kind === 'char' ? top.char : top.hanzi;
  if (data.kind === 'loading') {
    nodes.push({ t: 'text', text: label, size: 120, weight: 600, color: 'zh', align: 'center' }, { t: 'text', text: 'Looking it up…', color: 'muted', align: 'center' });
    return nodes;
  }
  if (data.kind === 'missing') {
    nodes.push(
      { t: 'text', text: label, size: 120, weight: 600, color: 'zh', align: 'center', explore: top.kind === 'word', segments: [...label] },
      { t: 'text', text: data.offline ? 'Not on this device yet — it needs a connection the first time.' : 'Not in the dictionary.', color: 'muted', align: 'center' },
    );
    return nodes;
  }
  if (data.kind === 'char') {
    const r = data.record;
    nodes.push({ t: 'text', text: r.char, size: 140, weight: 600, color: 'zh', align: 'center' });
    const readings = r.readings.slice(0, 3);
    if (readings.length) nodes.push({ t: 'text', text: readings.map((x) => x.pinyin).join(' · '), size: 38, color: 'accent', align: 'center' });
    if (r.meaning) nodes.push({ t: 'text', text: r.meaning, size: 30, align: 'center' });
    const facts = [r.radical ? `radical ${r.radical}${r.radical_meaning ? ` (${r.radical_meaning})` : ''}` : null, r.strokes ? `${r.strokes} strokes` : null, r.rank ? `#${r.rank} most common` : null].filter(Boolean).join(' · ');
    if (facts) nodes.push({ t: 'text', text: facts, size: 24, color: 'muted', align: 'center', explore: true, segments: undefined });
    nodes.push({ t: 'row', mode: 'wrap', align: 'center', children: [{ t: 'button', label: '▶ Listen', action: 'play', tone: 'chip' }] });
    if (r.components.length) {
      nodes.push({
        t: 'row',
        mode: 'wrap',
        children: [{ t: 'text', text: 'Parts', size: 24, color: 'muted' }, ...r.components.slice(0, 6).map((c) => ({ t: 'button' as const, label: c.meaning ? `${c.char} ${c.meaning}` : c.char, action: `push:${c.char}`, tone: 'chip' as const, size: 24 }))],
      });
    }
    if (r.words.length) {
      nodes.push({ t: 'text', text: `Words with ${r.char}`, size: 26, color: 'accent' });
      nodes.push({ t: 'list', items: r.words.slice(0, 4).map((w) => ({ title: `${w.hanzi}  ${w.pinyin}`, sub: w.english, action: `push:${w.hanzi}` })) });
    }
    return nodes;
  }
  const w = data.word;
  nodes.push({ t: 'text', text: w.hanzi, size: 112, weight: 600, color: 'zh', align: 'center' });
  if (w.pinyin) nodes.push({ t: 'text', text: w.pinyin, size: 38, color: 'accent', align: 'center' });
  if (w.english) nodes.push({ t: 'text', text: w.english, size: 30, align: 'center' });
  const senses = w.senses.filter((s) => s !== w.english).slice(0, 3);
  for (const s of senses) nodes.push({ t: 'text', text: `• ${s}`, size: 24, color: 'muted' });
  if (w.rank) nodes.push({ t: 'text', text: wordFrequencyLabel(w.rank).text, size: 24, color: 'muted', align: 'center' });
  nodes.push({ t: 'row', mode: 'wrap', align: 'center', children: [{ t: 'button', label: '▶ Listen', action: 'play', tone: 'chip' }] });
  if (data.chars.length > 1) {
    nodes.push({ t: 'text', text: 'Characters', size: 26, color: 'accent' });
    nodes.push({ t: 'row', mode: 'wrap', children: data.chars.map((c) => ({ t: 'button' as const, label: c, action: `push:${c}`, tone: 'chip' as const, size: 44 })) });
  }
  return nodes;
}

async function loadData(item: ExplorerItem): Promise<ExplorerData> {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (item.kind === 'char') {
    const r: CharLookup = await lookupChar(item.char);
    if (r.status === 'ok') return { kind: 'char', record: r.record };
    return { kind: 'missing', offline: r.status === 'offline' || offline };
  }
  const chars = [...item.hanzi];
  const [w, first]: [WordLookup, CharLookup] = await Promise.all([lookupWord(item.hanzi), lookupChar(chars[0])]);
  const record = w.status === 'ok' ? w.record : null;
  const charWords = first.status === 'ok' ? first.record.words : [];
  const word = resolveWord(item.hanzi, { record, charWords, hint: { pinyin: item.pinyin, gloss: item.gloss } });
  if (word.source === 'none' && (w.status === 'offline' || offline)) return { kind: 'missing', offline: true };
  return { kind: 'word', word, chars };
}

export function ExplorerPanel({ spec, report }: PanelHostProps<{ kind: 'explorer'; text: string }>) {
  const [stack, dispatch] = useReducer(explorerReducer, [] as ExplorerItem[]);
  const [data, setData] = useState<ExplorerData>({ kind: 'loading' });

  // A tap elsewhere (or the 🎤) opens a fresh stack on that text.
  useEffect(() => {
    const item = itemForText(spec.text);
    if (item) {
      dispatch({ type: 'open', item });
      track('explorer.open', { source: 'vr', kind: item.kind });
    }
  }, [spec.text]);

  const top = stack[stack.length - 1];
  const topKey = top ? itemKey(top) : '';
  useEffect(() => {
    if (!top) return;
    let cancelled = false;
    setData({ kind: 'loading' });
    void loadData(top).then((d) => {
      if (!cancelled) setData(d);
    }, () => {
      if (!cancelled) setData({ kind: 'missing', offline: !navigator.onLine });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topKey]);

  const view = useMemo(() => ({ title: top ? `Explorer · ${top.kind === 'char' ? top.char : top.hanzi}` : 'Explorer', nodes: explorerView(stack, data) }), [stack, data, top]);

  const onAction = (action: string) => {
    if (action === 'pop') dispatch({ type: 'pop' });
    else if (action.startsWith('crumb:')) dispatch({ type: 'popTo', index: Number(action.slice(6)) });
    else if (action.startsWith('push:')) {
      const item = itemForText(action.slice(5));
      if (item) {
        dispatch({ type: 'push', item });
        track('explorer.push', { kind: item.kind });
      }
    } else if (action === 'play' && top) void playText(top.kind === 'char' ? top.char : top.hanzi);
  };

  const onSpeech = (text: string): string | null => {
    const han = hanOnly(text).slice(0, 8);
    const item = itemForText(han);
    if (!item) return null;
    dispatch({ type: 'open', item });
    return 'explorer_search';
  };

  const latest = useRef({ onAction, onSpeech });
  latest.current = { onAction, onSpeech };
  useEffect(() => {
    report({ view, onAction: (a) => latest.current.onAction(a), onSpeech: (t) => latest.current.onSpeech(t) });
  }, [view, report]);
  return null;
}
