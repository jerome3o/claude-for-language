import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { autoPinyin as toPinyin } from '../utils/autoPinyin';
import { writableCharacters } from '@shared/strokes';
import { db, type LocalNote } from '../db/database';
import { WritingExercise } from '../components/strokes/WritingExercise';
import { cachedCharacters, prefetchStrokeData } from '../services/strokeData';
import '../components/strokes/strokes.css';
import './StrokePracticePage.css';

/** Words worth writing: 1–4 Han characters, nothing else on the card. */
function isWritableWord(hanzi: string): boolean {
  const han = writableCharacters(hanzi);
  return han.length >= 1 && han.length <= 4 && han.length === Array.from(hanzi.trim()).length;
}

/** The words you studied most recently, newest first (falls back to the newest notes). */
async function recentWords(limit: number): Promise<LocalNote[]> {
  const out: LocalNote[] = [];
  const seen = new Set<string>();
  const add = (n: LocalNote | undefined) => {
    if (!n || seen.has(n.hanzi) || !isWritableWord(n.hanzi)) return;
    seen.add(n.hanzi);
    out.push(n);
  };
  try {
    const events = await db.reviewEvents.orderBy('reviewed_at').reverse().limit(400).toArray();
    const cardIds = Array.from(new Set(events.map((e) => e.card_id)));
    const cards = await db.cards.bulkGet(cardIds);
    const noteIds = Array.from(new Set(cards.filter(Boolean).map((c) => c!.note_id)));
    const notes = await db.notes.bulkGet(noteIds);
    notes.forEach(add);
    if (out.length < limit) {
      const newest = await db.notes.orderBy('updated_at').reverse().limit(200).toArray();
      newest.forEach(add);
    }
  } catch {
    // no local data yet
  }
  return out.slice(0, limit);
}

async function deckCharacters(): Promise<string[]> {
  try {
    const set = new Set<string>();
    await db.notes.each((n) => {
      for (const c of writableCharacters(n.hanzi)) set.add(c);
    });
    return Array.from(set);
  } catch {
    return [];
  }
}

/** ~2 KB of stroke data per character. */
function sizeLabel(chars: number): string {
  const kb = chars * 2;
  return kb < 1024 ? `~${kb} KB` : `~${(kb / 1024).toFixed(1)} MB`;
}

const STARTERS = ['一', '十', '人', '口', '大', '你好', '中国', '谢谢'];

/**
 * /practice/strokes — handwriting with stroke-order feedback (preview).
 * `?text=` picks the word (the study card's "Write it" and links use it).
 */
export function StrokePracticePage() {
  const [params, setParams] = useSearchParams();
  const text = (params.get('text') || '').trim();
  const [draft, setDraft] = useState(text);
  const [recent, setRecent] = useState<LocalNote[] | null>(null);
  const [offline, setOffline] = useState<{ total: number; cached: number } | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setDraft(text);
  }, [text]);

  useEffect(() => {
    recentWords(12).then(setRecent);
  }, []);

  const refreshOffline = async () => {
    const chars = await deckCharacters();
    const have = await cachedCharacters(chars);
    setOffline({ total: chars.length, cached: have.size });
  };

  useEffect(() => {
    refreshOffline();
  }, []);

  const note = useMemo(() => recent?.find((n) => n.hanzi === text) ?? null, [recent, text]);
  const [lookedUp, setLookedUp] = useState<LocalNote | null>(null);
  useEffect(() => {
    setLookedUp(null);
    if (!text || note) return;
    let cancelled = false;
    // A word from the card's "Write it" link: find its note for the English.
    db.notes
      .filter((n) => n.hanzi === text)
      .first()
      .then((n) => {
        if (!cancelled && n) setLookedUp(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [text, note]);
  const found = note ?? lookedUp;

  const autoPinyin = useMemo(() => {
    if (!text || found) return null;
    try {
      return toPinyin(text);
    } catch {
      return null;
    }
  }, [text, found]);

  const pick = (word: string) => {
    const w = word.trim();
    setParams(w ? { text: w } : {}, { replace: false });
    setRunKey((k) => k + 1);
  };

  const saveAll = async () => {
    setSaveNote(null);
    const chars = await deckCharacters();
    setSaving({ done: 0, total: chars.length });
    const r = await prefetchStrokeData(chars, (done, total) => setSaving({ done, total }));
    setSaving(null);
    await refreshOffline();
    if (r.failed > 0) setSaveNote(`Saved ${r.saved}. ${r.failed} couldn't be downloaded — check your connection and try again.`);
    else setSaveNote(r.saved > 0 ? `Saved ${r.saved} more characters.` : 'Everything is already saved.');
  };

  return (
    <div className="page">
      <div className="container stroke-practice">
        <div className="stroke-practice-head">
          <h1>
            Write characters <span className="preview-badge">Preview</span>
          </h1>
          {!text && (
            <p className="stroke-practice-lede">
              Draw each stroke with your finger or a stylus — every stroke is checked as you go: the right
              stroke, in the right order, in the right direction.
            </p>
          )}
        </div>

        <form
          className="stroke-practice-picker"
          onSubmit={(e) => {
            e.preventDefault();
            pick(draft);
          }}
        >
          <input
            className="form-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a character or word, e.g. 你好"
            aria-label="Character or word to write"
            lang="zh-CN"
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>
            Write
          </button>
        </form>

        <div className="stroke-practice-words">
          <span className="stroke-practice-words-label">{recent && recent.length > 0 ? 'Your recent words' : 'Try'}</span>
          <div className="stroke-practice-chips">
            {(recent && recent.length > 0 ? recent.map((n) => n.hanzi) : STARTERS).map((w) => (
              <button
                key={w}
                type="button"
                className={`stroke-practice-chip${w === text ? ' active' : ''}`}
                onClick={() => pick(w)}
                lang="zh-CN"
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {text ? (
          <div className="card stroke-practice-card">
            <WritingExercise
              key={`${text}-${runKey}`}
              text={text}
              pinyin={found?.pinyin ?? autoPinyin}
              english={found?.english ?? null}
              onComplete={() => {
                refreshOffline();
              }}
            />
          </div>
        ) : (
          <div className="card stroke-practice-empty">
            <div className="stroke-practice-empty-glyph" aria-hidden="true">
              永
            </div>
            <p>
              Pick a word above. <strong>Trace</strong> shows the character in grey with the stroke order
              animated; <strong>From memory</strong> gives you an empty grid and the pinyin.
            </p>
          </div>
        )}

        <div className="card stroke-practice-offline">
          <div className="stroke-practice-offline-text">
            <strong>Offline</strong>
            {offline === null
              ? ' Checking…'
              : offline.total === 0
                ? ' Each character is saved on this device the first time you write it.'
                : ` ${offline.cached} of ${offline.total} characters from your decks are saved on this device.`}
            {saveNote && <span className="stroke-practice-offline-note">{saveNote}</span>}
          </div>
          {offline && offline.total > offline.cached && (
            <button className="btn btn-secondary" onClick={saveAll} disabled={saving !== null}>
              {saving
                ? `Saving… ${saving.done}/${saving.total}`
                : `Save all (${sizeLabel(offline.total - offline.cached)})`}
            </button>
          )}
        </div>

        <p className="stroke-practice-credit">
          Stroke data: <a href="https://github.com/skishore/makemeahanzi" target="_blank" rel="noreferrer">Make Me a Hanzi</a> via{' '}
          <a href="https://github.com/chanind/hanzi-writer-data" target="_blank" rel="noreferrer">hanzi-writer-data</a>, derived from fonts
          by Arphic Technology — <a href="/strokes/ARPHICPL.TXT" target="_blank" rel="noreferrer">Arphic Public License</a>. Stroke
          checking adapted from <a href="https://github.com/chanind/hanzi-writer" target="_blank" rel="noreferrer">Hanzi Writer</a> (MIT).
        </p>
      </div>
    </div>
  );
}
