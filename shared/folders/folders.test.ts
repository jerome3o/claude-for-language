import { describe, it, expect } from 'vitest';
import {
  cleanFolderName, folderNameProblems, folderNameKey, parentProblem, groupIntoFolders, folderOptions,
  folderPath, spliceGroupOrder, toggleCollapsed, collapseKey, sortFolders, type Folder,
  MAX_FOLDER_DEPTH, folderLevel, folderAncestors, folderDescendantIds, subtreeLevels, flattenFolderGroups,
  parseFolderPath, findFolderByPath,
} from './folders';

function f(id: string, name: string, extra: Partial<Folder> = {}): Folder {
  return { id, user_id: 'u', kind: 'deck', name, parent_id: null, position: 0, created_at: '', updated_at: '', ...extra };
}

describe('folder names', () => {
  it('cleans and validates', () => {
    expect(cleanFolderName('  HSK   2 ')).toBe('HSK 2');
    expect(folderNameProblems('   ')).toEqual(['Give the folder a name']);
    expect(folderNameProblems(42)).toEqual(['Give the folder a name']);
    expect(folderNameProblems('x'.repeat(61))[0]).toMatch(/at most 60/);
    expect(folderNameProblems('课本 第一册')).toEqual([]);
    expect(folderNameKey(' Hsk  2')).toBe(folderNameKey('HSK 2'));
  });
});

describe('parentProblem', () => {
  // a › b › c › d (4 levels), e at the top, l = another kind
  const all = [
    f('a', 'A'), f('b', 'B', { parent_id: 'a' }), f('c', 'C', { parent_id: 'b' }), f('d', 'D', { parent_id: 'c' }),
    f('e', 'E'), f('e1', 'E1', { parent_id: 'e' }), f('l', 'Lessons', { kind: 'lesson' }),
  ];
  it('allows nesting at any level up to the cap', () => {
    expect(parentProblem({ id: null, kind: 'deck' }, 'a', all)).toBeNull();
    expect(parentProblem({ id: null, kind: 'deck' }, 'b', all)).toBeNull();
    expect(parentProblem({ id: null, kind: 'deck' }, 'd', all)).toBeNull(); // level 5
    expect(parentProblem({ id: null, kind: 'deck' }, null, all)).toBeNull();
    expect(parentProblem({ id: 'e', kind: 'deck' }, 'b', all)).toBeNull(); // e (2 levels) under b (level 2) → 4
  });
  it('refuses the sixth level, a subtree that would not fit, itself, cycles, other kinds, unknown', () => {
    expect(MAX_FOLDER_DEPTH).toBe(5);
    const deeper = [...all, f('x', 'X', { parent_id: 'd' })];
    expect(parentProblem({ id: null, kind: 'deck' }, 'x', deeper)).toMatch(/5 levels deep: pick a folder higher up/);
    expect(parentProblem({ id: 'e', kind: 'deck' }, 'd', all)).toMatch(/don't fit/);
    expect(parentProblem({ id: 'a', kind: 'deck' }, 'a', all)).toMatch(/itself/);
    expect(parentProblem({ id: 'a', kind: 'deck' }, 'c', all)).toMatch(/one of its own folders/);
    expect(parentProblem({ id: 'b', kind: 'deck' }, 'd', all)).toMatch(/one of its own folders/);
    expect(parentProblem({ id: null, kind: 'deck' }, 'l', all)).toMatch(/does not exist/);
    expect(parentProblem({ id: null, kind: 'deck' }, 'zzz', all)).toMatch(/does not exist/);
  });
  it('levels, ancestors, descendants', () => {
    expect(folderLevel(all[3], all)).toBe(4);
    expect(folderAncestors(all[3], all).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(folderDescendantIds('a', all)).toEqual(['b', 'c', 'd']);
    expect(subtreeLevels('a', all)).toBe(4);
    expect(subtreeLevels('d', all)).toBe(1);
    // A cycle in bad data never loops.
    const loop = [f('p', 'P', { parent_id: 'q' }), f('q', 'Q', { parent_id: 'p' })];
    expect(folderAncestors(loop[0], loop).map((x) => x.id)).toEqual(['q']);
    expect(folderDescendantIds('p', loop)).toEqual(['q']);
  });
});

describe('groupIntoFolders', () => {
  const folders = [
    f('b', 'Beta', { position: 1 }),
    f('a', 'Alpha', { position: 0 }),
    f('a1', 'Week 1', { parent_id: 'a' }),
    f('x', 'Other kind', { kind: 'reader' }),
    f('orph', 'Orphan', { parent_id: 'gone' }),
  ];
  const items = [
    { id: '1', folder_id: 'a' },
    { id: '2', folder_id: null },
    { id: '3', folder_id: 'a1' },
    { id: '4', folder_id: 'deleted-elsewhere' },
    { id: '5', folder_id: 'b' },
    { id: '6', folder_id: 'x' },
  ];
  it('builds the tree with Unfiled last and nothing hidden', () => {
    const { groups, unfiled } = groupIntoFolders(items, (i) => i.folder_id, folders, 'deck');
    expect(groups.map((g) => g.folder!.id)).toEqual(['a', 'orph', 'b']);
    const alpha = groups[0];
    expect(alpha.items.map((i) => i.id)).toEqual(['1']);
    expect(alpha.children.map((c) => c.folder!.id)).toEqual(['a1']);
    expect(alpha.children[0].items.map((i) => i.id)).toEqual(['3']);
    expect(alpha.total).toBe(2);
    expect(groups[2].total).toBe(1);
    // unknown folder + another kind's folder → Unfiled
    expect(unfiled.items.map((i) => i.id)).toEqual(['2', '4', '6']);
    expect(unfiled.total).toBe(3);
  });
  it('keeps empty folders', () => {
    const { groups } = groupIntoFolders([], () => null, [f('e', 'Empty')], 'deck');
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(0);
  });
  it('options and paths', () => {
    expect(folderOptions(folders, 'deck').map((o) => [o.folder.id, o.depth])).toEqual([['a', 0], ['a1', 1], ['orph', 0], ['b', 0]]);
    expect(folderPath(folders[2], folders)).toBe('Alpha › Week 1');
    expect(folderPath(folders[0], folders)).toBe('Beta');
  });
  it('nests at any depth, totals roll up, cycles and orphans show at the top', () => {
    const deep = [
      f('a', 'HSK 2'), f('b', 'Week 1', { parent_id: 'a' }), f('c', 'Monday', { parent_id: 'b' }), f('c2', 'Extra', { parent_id: 'b', position: 1 }),
      f('p', 'Loop P', { parent_id: 'q', position: 5 }), f('q', 'Loop Q', { parent_id: 'p', position: 6 }),
    ];
    const its = [{ id: '1', folder_id: 'c' }, { id: '2', folder_id: 'b' }, { id: '3', folder_id: 'a' }, { id: '4', folder_id: 'q' }];
    const { groups } = groupIntoFolders(its, (i) => i.folder_id, deep, 'deck');
    expect(groups.map((g) => g.folder!.id)).toEqual(['a', 'p', 'q']);
    const [hsk] = groups;
    expect(hsk.total).toBe(3);
    expect(hsk.children[0].folder!.id).toBe('b');
    expect(hsk.children[0].total).toBe(2);
    expect(hsk.children[0].children.map((c) => [c.folder!.id, c.depth, c.total])).toEqual([['c', 2, 1], ['c2', 2, 0]]);
    expect(folderOptions(deep, 'deck').map((o) => `${o.depth}:${o.folder.id}`)).toEqual(['0:a', '1:b', '2:c', '2:c2', '0:p', '0:q']);
    expect(folderPath(deep[2], deep)).toBe('HSK 2 › Week 1 › Monday');
    expect(folderPath(deep[2], deep, ' / ')).toBe('HSK 2 / Week 1 / Monday');
    expect(flattenFolderGroups(groups).map((g) => g.folder!.id)).toEqual(['a', 'b', 'c', 'c2', 'p', 'q']);
  });
  it('finds a folder by path', () => {
    const deep = [f('a', 'HSK 2'), f('b', 'Week 1', { parent_id: 'a' }), f('c', 'Monday', { parent_id: 'b' }), f('t', 'Week 1')];
    expect(parseFolderPath(' HSK 2 / week  1 › Monday ')).toEqual(['HSK 2', 'week 1', 'Monday']);
    expect(findFolderByPath(deep, 'deck', ['hsk 2', 'WEEK 1', 'monday'])!.id).toBe('c');
    expect(findFolderByPath(deep, 'deck', ['Week 1'])!.id).toBe('t'); // top level first
    expect(findFolderByPath(deep, 'deck', ['Monday'])!.id).toBe('c'); // one name: any depth
    expect(findFolderByPath(deep, 'deck', ['HSK 2', 'Week 2'])).toBeNull();
    expect(findFolderByPath(deep, 'lesson', ['HSK 2'])).toBeNull();
  });
  it('sorts by position, then name', () => {
    expect(sortFolders([f('2', 'b', { position: 1 }), f('1', 'z'), f('3', 'a')]).map((x) => x.id)).toEqual(['3', '1', '2']);
  });
});

describe('spliceGroupOrder', () => {
  it('reorders a group in place inside the whole queue', () => {
    expect(spliceGroupOrder(['a', 'x', 'b', 'y', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'y', 'b']);
    expect(spliceGroupOrder(['a', 'b'], [])).toEqual(['a', 'b']);
    // A deck dragged inside a nested folder: only that folder's own decks swap places.
    const queue = ['top1', 'w1a', 'mon1', 'w1b', 'mon2', 'top2'];
    expect(spliceGroupOrder(queue, ['mon2', 'mon1'])).toEqual(['top1', 'w1a', 'mon2', 'w1b', 'mon1', 'top2']);
  });
});

describe('collapsed state', () => {
  it('toggles keys', () => {
    expect(collapseKey(null)).toBe('unfiled');
    expect(toggleCollapsed([], 'b')).toEqual(['b']);
    expect(toggleCollapsed(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleCollapsed(['c'], 'a')).toEqual(['a', 'c']);
  });
});

import { deleteFolderMessage, movedMessage, folderCountLabel } from './folders';
describe('copy', () => {
  it('says nothing is deleted', () => {
    expect(deleteFolderMessage('deck', 'HSK 2', 3)).toBe('All 3 decks move to Unfiled. Nothing is deleted.');
    expect(deleteFolderMessage('lesson', 'Grammar', 0)).toBe('“Grammar” is empty. Nothing is deleted.');
    expect(deleteFolderMessage('reader', 'Stories', 1, 2)).toBe('Its reader moves to Unfiled. Its 2 folders move to the top level. Nothing is deleted.');
    expect(deleteFolderMessage('deck', 'Week 1', 0, 1, 'HSK 2')).toBe('“Week 1” is empty. Its folder moves into “HSK 2”. Nothing is deleted.');
    expect(movedMessage('deck', 1, null)).toBe('Moved 1 deck to Unfiled');
    expect(movedMessage('lesson', 4, 'HSK 2')).toBe('Moved 4 lessons to HSK 2');
    expect(folderCountLabel('reader', 0)).toBe('Empty');
    expect(folderCountLabel('deck', 1)).toBe('1 deck');
  });
});
