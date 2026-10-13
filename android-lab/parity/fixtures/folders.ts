/**
 * Folders for decks / Library lessons / readers (shared/folders/folders.ts): names, parent
 * rules (nesting up to MAX_FOLDER_DEPTH, no cycles), sorting, grouping (any depth), picker
 * options, paths, path lookup, the in-folder deck reorder splice, collapsed keys and the copy. Writes folders.json; checked by core/…/FoldersParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanFolderName,
  collapseKey,
  deleteFolderMessage,
  findFolderByPath,
  folderAncestors,
  folderCountLabel,
  folderDescendantIds,
  folderLevel,
  folderItemNoun,
  folderNameKey,
  folderNameProblems,
  folderOptions,
  folderPath,
  groupIntoFolders,
  movedMessage,
  parentProblem,
  parseFolderPath,
  sortFolders,
  spliceGroupOrder,
  subtreeLevels,
  toggleCollapsed,
  FOLDER_KINDS,
  MAX_FOLDER_DEPTH,
  type Folder,
  type FolderKind,
} from '../../../shared/folders/folders';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// Seeded PRNG (mulberry32) so the vectors are stable.
let seed = 20261003;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

const NAMES = ['HSK 1', 'HSK 2', 'hsk 2', 'Week 1', 'Week 2', 'Week 10', 'Grammar', 'grammar', 'Food', '课本 第一册', '课本 第二册', 'Travel', 'A', 'B', 'Zoo'];

function f(id: string, name: string, extra: Partial<Folder> = {}): Folder {
  return { id, user_id: 'u', kind: 'deck', name, parent_id: null, position: 0, created_at: '', updated_at: '', ...extra };
}

// ---- names ----
const rawNames: Array<string | null> = [
  null, '', '   ', 'HSK 2', '  HSK   2 ', '\tWeek\n1 ', 'x'.repeat(60), 'x'.repeat(61), '课本　第一册', ' a  b ',
  '😀'.repeat(60), '😀'.repeat(61), ' Hsk  2', 'Grammar\r\nNotes', 'a b', '﻿Name﻿',
];
const names = rawNames.map((raw) => ({
  raw,
  clean: cleanFolderName(raw),
  problems: folderNameProblems(raw),
  key: raw == null ? null : folderNameKey(raw),
}));

// ---- random folder sets ----
function randomFolders(n: number): Folder[] {
  const out: Folder[] = [];
  for (let i = 0; i < n; i++) {
    const kind = rand() < 0.75 ? 'deck' : pick(['lesson', 'reader'] as FolderKind[]);
    const r = rand();
    // Mostly valid trees (any depth), sometimes a dangling parent, '' or a (server-impossible) cycle.
    const parent_id = r < 0.25 && out.length ? out[out.length - 1].id // chains: deep trees, past the cap too
      : r < 0.5 && out.length ? pick(out).id
      : r < 0.55 ? 'ghost'
      : r < 0.58 ? ''
      : null;
    out.push(f(`f${i}${rand() < 0.5 ? 'a' : 'B'}`, pick(NAMES), { kind, parent_id, position: Math.floor(rand() * 4) }));
  }
  return out;
}

const groupings = [] as unknown[];
for (let c = 0; c < 120; c++) {
  const folders = randomFolders(Math.floor(rand() * 13));
  const ids = folders.map((x) => x.id);
  const items = Array.from({ length: Math.floor(rand() * 12) }, (_, i) => ({
    id: `i${i}`,
    folder_id: rand() < 0.2 ? null : rand() < 0.1 ? 'gone' : rand() < 0.05 ? '' : ids.length ? pick(ids) : null,
  }));
  const kind = pick([...FOLDER_KINDS]);
  const tree = groupIntoFolders(items, (it) => it.folder_id, folders, kind);
  // Now and then a cycle: the last folder becomes the parent of its own parent.
  if (folders.length > 2 && rand() < 0.15) {
    const last = folders[folders.length - 1];
    const parent = folders.find((x) => x.id === last.parent_id);
    if (parent) parent.parent_id = last.id;
  }
  const shape = (g: (typeof tree.groups)[number]): unknown => ({
    folder: g.folder?.id ?? null,
    items: g.items.map((it) => it.id),
    total: g.total,
    depth: g.depth,
    children: g.children.map(shape),
  });
  groupings.push({
    kind,
    folders,
    items,
    groups: tree.groups.map(shape),
    unfiled: shape(tree.unfiled),
    options: folderOptions(folders, kind).map((o) => ({ id: o.folder.id, depth: o.depth })),
    sorted: sortFolders(folders).map((x) => x.id),
    paths: folders.map((x) => folderPath(x, folders)),
    slash_paths: folders.map((x) => folderPath(x, folders, ' / ')),
    levels: folders.map((x) => folderLevel(x, folders)),
    ancestors: folders.map((x) => folderAncestors(x, folders).map((a) => a.id)),
    descendants: folders.map((x) => folderDescendantIds(x.id, folders)),
    subtree: folders.map((x) => subtreeLevels(x.id, folders)),
    parent_problems: folders.flatMap((x) => [null, ...folders.map((p) => p.id), 'ghost'].map((p) => parentProblem({ id: x.id, kind: x.kind }, p, folders))),
    new_problems: [null, ...folders.map((p) => p.id)].map((p) => parentProblem({ id: null, kind }, p, folders)),
    finds: folders.slice(0, 3).flatMap((x) => {
      const names = [...folderAncestors(x, folders).map((a) => a.name), x.name];
      return [names, [x.name], [x.name.toUpperCase()], [...names, 'nope']].map((path) => ({ path, hit: findFolderByPath(folders, kind, path)?.id ?? null }));
    }),
  });
}

// ---- parent rules ----
// a › b › c › d › g (5 levels), e ('' parent), l = another kind, h › i (2 levels)
const base = [
  f('a', 'A'), f('b', 'B', { parent_id: 'a' }), f('l', 'Lessons', { kind: 'lesson' }), f('c', 'C', { parent_id: 'b' }), f('e', 'E', { parent_id: '' }),
  f('d', 'D', { parent_id: 'c' }), f('g', 'G', { parent_id: 'd' }), f('h', 'H'), f('i', 'I', { parent_id: 'h' }),
];
const parentCases: Array<{ id: string | null; kind: FolderKind; parent: string | null }> = [];
const ids = [null, '', 'a', 'b', 'c', 'd', 'e', 'g', 'h', 'i', 'l', 'zzz'];
for (const id of [...ids, 'new']) {
  for (const kind of FOLDER_KINDS) {
    for (const parent of ids) parentCases.push({ id, kind, parent });
  }
}
const parents = parentCases.map((p) => ({ ...p, problem: parentProblem({ id: p.id, kind: p.kind }, p.parent, base) }));

// ---- splice ----
const splices = [] as unknown[];
for (let c = 0; c < 80; c++) {
  const all = Array.from({ length: 1 + Math.floor(rand() * 10) }, (_, i) => `d${i}`);
  const group = all.filter(() => rand() < 0.5);
  const shuffled = group.slice().sort(() => rand() - 0.5);
  // Sometimes a shorter / foreign order (defensive branches).
  const order = rand() < 0.1 ? shuffled.slice(1) : rand() < 0.05 ? [...shuffled, 'x'] : shuffled;
  splices.push({ all, order, out: spliceGroupOrder(all, order) });
}

// ---- collapsed ----
const toggles = [] as unknown[];
let collapsed: string[] = [];
for (let c = 0; c < 40; c++) {
  const key = collapseKey(rand() < 0.2 ? null : pick(['f1', 'f2', 'F3', 'a', 'unfiled', 'z9']));
  const before = collapsed;
  collapsed = toggleCollapsed(collapsed, key);
  toggles.push({ before, key, after: collapsed });
}
toggles.push({ before: ['b', 'a', 'b'], key: 'c', after: toggleCollapsed(['b', 'a', 'b'], 'c') });

// ---- copy ----
const copy = [] as unknown[];
for (const kind of FOLDER_KINDS) {
  for (const n of [0, 1, 2, 3, 12]) {
    copy.push({
      kind,
      n,
      noun: folderItemNoun(kind, n),
      count: folderCountLabel(kind, n),
      moved: movedMessage(kind, n, 'HSK 2'),
      moved_unfiled: movedMessage(kind, n, null),
      del: [0, 1, 2].map((s) => deleteFolderMessage(kind, 'HSK 2', n, s)),
      del_into: [0, 1, 2].map((s) => deleteFolderMessage(kind, 'Week 1', n, s, '课本 第一册')),
    });
  }
}

// ---- path parsing ----
const parsedPaths = ['HSK 2 / Week 1', ' a›b > c ', '//', 'x', ' HSK  2 /  week 1 / ', '课本 / 第一册'].map((raw) => ({ raw, out: parseFolderPath(raw) }));

writeFileSync(join(OUT, 'folders.json'), JSON.stringify({ names, groupings, parents, splices, toggles, copy, parsed_paths: parsedPaths, max_depth: MAX_FOLDER_DEPTH, collapse_null: collapseKey(null) }));
