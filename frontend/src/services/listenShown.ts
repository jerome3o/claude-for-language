/**
 * "Listen in context" on this device (shared/study/listenContext.ts): the sentence set the last showing of
 * each word offered — so the next showing never offers the same set twice in a row (`pickListenRows`'s
 * `previous`) — and the seed of a showing (a new order every time the card comes up, the same while it is up).
 * A per-device convenience in localStorage (the heard history itself is synced: sentencePractice.ts).
 */
const KEY = 'listen-context-shown-v1';
const MAX_NOTES = 300;

type Shown = Record<string, string[]>;

function read(): Shown {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Shown) : {};
  } catch {
    return {};
  }
}

/** The keys the last showing of this note offered ([] = none known). */
export function lastShownListenKeys(noteId: string): string[] {
  const keys = read()[noteId];
  return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [];
}

/** Remember this showing's keys (newest last; the oldest notes are forgotten past MAX_NOTES). */
export function rememberShownListenKeys(noteId: string, keys: string[]): void {
  try {
    const all = read();
    delete all[noteId];
    all[noteId] = keys;
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_NOTES))) delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode: the heard history still keeps it fresh */
  }
}

/** A new seed for one showing of a listening card. */
export function newListenSeed(noteId: string): string {
  let rand = '';
  try {
    rand = crypto.randomUUID();
  } catch {
    rand = Math.random().toString(36).slice(2);
  }
  return `${noteId}:${Date.now().toString(36)}:${rand}`;
}
