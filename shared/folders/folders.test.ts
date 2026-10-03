import { describe, it, expect } from 'vitest';
import {
  cleanFolderName, folderNameProblems, folderNameKey, parentProblem, groupIntoFolders, folderOptions,
  folderPath, spliceGroupOrder, toggleCollapsed, collapseKey, sortFolders, type Folder,
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
  const all = [f('a', 'A'), f('b', 'B', { parent_id: 'a' }), f('l', 'Lessons', { kind: 'lesson' })];
  it('allows one level', () => {
    expect(parentProblem({ id: null, kind: 'deck' }, 'a', all)).toBeNull();
    expect(parentProblem({ id: null, kind: 'deck' }, null, all)).toBeNull();
  });
  it('refuses depth two, itself, other kinds, unknown, and a parent going inside', () => {
    expect(parentProblem({ id: null, kind: 'deck' }, 'b', all)).toMatch(/one level/);
    expect(parentProblem({ id: 'a', kind: 'deck' }, 'a', all)).toMatch(/itself/);
    expect(parentProblem({ id: null, kind: 'deck' }, 'l', all)).toMatch(/does not exist/);
    expect(parentProblem({ id: null, kind: 'deck' }, 'zzz', all)).toMatch(/does not exist/);
    const withC = [...all, f('c', 'C')];
    expect(parentProblem({ id: 'a', kind: 'deck' }, 'c', withC)).toMatch(/top level/);
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
  it('sorts by position, then name', () => {
    expect(sortFolders([f('2', 'b', { position: 1 }), f('1', 'z'), f('3', 'a')]).map((x) => x.id)).toEqual(['3', '1', '2']);
  });
});

describe('spliceGroupOrder', () => {
  it('reorders a group in place inside the whole queue', () => {
    expect(spliceGroupOrder(['a', 'x', 'b', 'y', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'y', 'b']);
    expect(spliceGroupOrder(['a', 'b'], [])).toEqual(['a', 'b']);
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
    expect(movedMessage('deck', 1, null)).toBe('Moved 1 deck to Unfiled');
    expect(movedMessage('lesson', 4, 'HSK 2')).toBe('Moved 4 lessons to HSK 2');
    expect(folderCountLabel('reader', 0)).toBe('Empty');
    expect(folderCountLabel('deck', 1)).toBe('1 deck');
  });
});
