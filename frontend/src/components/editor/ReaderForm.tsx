/**
 * Structured form for a graded reader: title fields, then a list of
 * collapsible page cards (Chinese with play + auto-pinyin, pinyin, English
 * with auto-translate, illustration prompt with suggest / illustrate and a
 * thumbnail). Pure over `spec` — every edit goes through onChange; the page
 * owns saving.
 */

import { useState } from 'react';
import type { ReaderSpec, ReaderPageSpec, ReaderDifficulty } from '@shared/reader';
import { READER_DIFFICULTIES, readerDifficultyLabel } from '@shared/reader';
import { useCachedImageUrl } from '../../hooks/useCachedImageUrl';
import { Field, TextInput, RowControls, moveItem, toPinyin, Speak } from './fields';

export interface ReaderFormProps {
  spec: ReaderSpec;
  onChange: (spec: ReaderSpec) => void;
  errors: string[];
  speak: Speak;
  /** The last saved spec — a page can only be illustrated once its prompt is saved. */
  savedSpec: ReaderSpec | null;
  /** Translate / draft a prompt (server; null when offline or unavailable). */
  assist: ((field: 'english' | 'image_prompt', chinese: string, english?: string) => Promise<string>) | null;
  /** Generate the illustration for a saved page; resolves to the image key. */
  illustrate: ((page: ReaderPageSpec) => Promise<string | null>) | null;
}

function blankPage(): ReaderPageSpec {
  return { content_chinese: '', content_pinyin: '', content_english: '', image_prompt: null };
}

/** Whole-page pinyin: tone marks, and no stray spaces around Chinese punctuation. */
export function toPagePinyin(chinese: string): string {
  return toPinyin(chinese)
    .replace(/\s+([，。！？、；：）」』】”’])/g, '$1')
    .replace(/([（「『【“‘])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Validation lines that belong to page n (1-based), with the prefix removed. */
function pageErrors(errors: string[], n: number): string[] {
  const prefix = `Page ${n}:`;
  return errors.filter(e => e.startsWith(prefix)).map(e => e.slice(prefix.length).trim());
}

function PageCard(props: {
  page: ReaderPageSpec;
  index: number;
  count: number;
  errors: string[];
  open: boolean;
  onToggle: () => void;
  onChange: (page: ReaderPageSpec) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: () => void;
  onInsertAfter: () => void;
  onRemove: () => void;
  speak: Speak;
  savedPrompt: string | null | undefined;
  assist: ReaderFormProps['assist'];
  illustrate: ReaderFormProps['illustrate'];
}) {
  const { page, index, count, errors, open, onToggle, onChange, onMove, onDuplicate, onInsertAfter, onRemove, speak, savedPrompt, assist, illustrate } = props;
  const [busy, setBusy] = useState<'english' | 'image_prompt' | 'illustrate' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const imageUrl = useCachedImageUrl(page.image_url ?? null);

  const prompt = (page.image_prompt ?? '').trim();
  // savedPrompt is undefined for a page that was never saved (no id).
  const promptSaved = savedPrompt !== undefined && (savedPrompt ?? '').trim() === prompt;
  const canIllustrate = !!illustrate && !!page.id && !!prompt && promptSaved && !page.image_url;
  const illustrateHint = !prompt
    ? 'Write an illustration prompt first'
    : !page.id || !promptSaved
      ? 'Save first, then illustrate'
      : page.image_url
        ? 'Already illustrated — change the prompt and save to redraw'
        : 'Generate the illustration now';

  async function runAssist(field: 'english' | 'image_prompt') {
    if (!assist || !page.content_chinese.trim()) return;
    setBusy(field);
    setNote(null);
    try {
      const text = await assist(field, page.content_chinese, page.content_english);
      onChange(field === 'english' ? { ...page, content_english: text } : { ...page, image_prompt: text });
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Claude is unavailable');
    } finally {
      setBusy(null);
    }
  }

  async function runIllustrate() {
    if (!illustrate || !canIllustrate) return;
    setBusy('illustrate');
    setNote(null);
    try {
      const key = await illustrate(page);
      if (key) onChange({ ...page, image_url: key });
      else setNote('No image came back — try again in a moment.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setBusy(null);
    }
  }

  const summary = page.content_chinese.trim() || page.content_english.trim() || 'Empty page';

  return (
    <div className={`ed-exercise ed-page ${errors.length ? 'has-errors' : ''}`}>
      <div className="ed-exercise-head">
        <button type="button" className="ed-exercise-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="ed-exercise-num">{index + 1}</span>
          {imageUrl ? (
            <img className="ed-page-thumb" src={imageUrl} alt="" />
          ) : (
            <span className="ed-exercise-icon" aria-hidden="true">{prompt ? '🖼' : '📄'}</span>
          )}
          <span className="ed-exercise-titles">
            <span className="ed-exercise-type">Page {index + 1}{page.content_chinese ? ` · ${page.content_chinese.trim().length} chars` : ''}</span>
            <span className="ed-exercise-summary" lang="zh-CN">{summary}</span>
            {errors.length > 0 && <span className="ed-exercise-err">{errors.length} problem{errors.length === 1 ? '' : 's'}</span>}
          </span>
          <span className="ed-exercise-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} onDuplicate={onDuplicate} removeLabel="Delete page" />
      </div>
      {open && (
        <div className="ed-exercise-body">
          <div className="ed-exercise-form">
            {errors.length > 0 && <ul className="ed-errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}

            <Field label="中文" hint="the page text">
              <div className="ed-page-text-row">
                <textarea
                  className="ed-input"
                  lang="zh-CN"
                  rows={3}
                  value={page.content_chinese}
                  onChange={e => onChange({ ...page, content_chinese: e.target.value })}
                  placeholder="长春的冬天很冷。"
                />
                <div className="ed-page-text-btns">
                  <button type="button" className="ed-mini-btn" onClick={() => speak(page.content_chinese)} disabled={!page.content_chinese.trim()} aria-label="Play" title="Play">🔊</button>
                  <button
                    type="button"
                    className="ed-mini-btn text"
                    onClick={() => onChange({ ...page, content_pinyin: toPagePinyin(page.content_chinese) })}
                    disabled={!page.content_chinese.trim()}
                    title="Fill pinyin from the Chinese"
                  >
                    拼音
                  </button>
                </div>
              </div>
            </Field>

            <Field label="Pinyin" hint="tone marks; may be left blank">
              <TextInput value={page.content_pinyin} onChange={v => onChange({ ...page, content_pinyin: v })} placeholder="Chángchūn de dōngtiān hěn lěng." />
            </Field>

            <Field label="English">
              <div className="ed-page-text-row">
                <textarea
                  className="ed-input"
                  rows={2}
                  value={page.content_english}
                  onChange={e => onChange({ ...page, content_english: e.target.value })}
                  placeholder="Winter in Changchun is very cold."
                />
                {assist && (
                  <div className="ed-page-text-btns">
                    <button type="button" className="ed-mini-btn text" onClick={() => runAssist('english')} disabled={busy !== null || !page.content_chinese.trim()} title="Translate the Chinese with Claude">
                      {busy === 'english' ? '…' : 'Translate'}
                    </button>
                  </div>
                )}
              </div>
            </Field>

            <Field label="Illustration" hint="English scene description; blank = no picture">
              <div className="ed-page-text-row">
                <textarea
                  className="ed-input"
                  rows={2}
                  value={page.image_prompt ?? ''}
                  onChange={e => onChange({ ...page, image_prompt: e.target.value })}
                  placeholder="A child in a red coat walking down a snowy street in Changchun, warm storybook style"
                />
                <div className="ed-page-text-btns">
                  {assist && (
                    <button type="button" className="ed-mini-btn text" onClick={() => runAssist('image_prompt')} disabled={busy !== null || !page.content_chinese.trim()} title="Draft a prompt from the page with Claude">
                      {busy === 'image_prompt' ? '…' : 'Suggest'}
                    </button>
                  )}
                  {illustrate && (
                    <button type="button" className="ed-mini-btn text" onClick={runIllustrate} disabled={busy !== null || !canIllustrate} title={illustrateHint}>
                      {busy === 'illustrate' ? '…' : 'Illustrate'}
                    </button>
                  )}
                </div>
              </div>
              {imageUrl ? (
                <div className="ed-image-preview">
                  <img src={imageUrl} alt={prompt || 'Illustration'} />
                  <span className="ed-hint">Change the prompt and save to redraw.</span>
                </div>
              ) : prompt ? (
                <span className="ed-hint">{page.id && promptSaved ? 'Illustration pending — it is drawn in the background after Save, or press Illustrate.' : 'Saved pages are illustrated in the background.'}</span>
              ) : null}
            </Field>

            {note && <div className="ed-errors"><li>{note}</li></div>}
          </div>
          <div className="ed-exercise-foot">
            <button type="button" className="ed-add-btn" onClick={onInsertAfter}>+ Insert page after</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReaderForm({ spec, onChange, errors, speak, savedSpec, assist, illustrate }: ReaderFormProps) {
  // Open state is keyed by position; new pages open, others start collapsed
  // unless the reader is short.
  const [openPages, setOpenPages] = useState<Set<number>>(() => new Set(spec.pages.length <= 3 ? spec.pages.map((_, i) => i) : [0]));
  const topErrors = errors.filter(e => !/^Page \d+:/.test(e));
  const savedPromptById = new Map((savedSpec?.pages ?? []).filter(p => p.id).map(p => [p.id as string, p.image_prompt ?? null]));

  const setPages = (pages: ReaderPageSpec[]) => onChange({ ...spec, pages });
  const toggle = (i: number) => setOpenPages(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const openOnly = (i: number) => setOpenPages(prev => new Set([...prev, i]));

  function insertAt(i: number, page: ReaderPageSpec) {
    const pages = spec.pages.slice();
    pages.splice(i, 0, page);
    setPages(pages);
    setOpenPages(prev => new Set([...Array.from(prev).map(x => (x >= i ? x + 1 : x)), i]));
  }

  return (
    <div className="ed-form">
      {topErrors.length > 0 && <ul className="ed-errors top">{topErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}

      <div className="ed-head-fields ed-reader-head">
        <Field label="中文 title">
          <div className="ed-hanzi-row">
            <input className="ed-input" type="text" lang="zh-CN" value={spec.title_chinese} onChange={e => onChange({ ...spec, title_chinese: e.target.value })} placeholder="长春的冬天" />
            <button type="button" className="ed-mini-btn" onClick={() => speak(spec.title_chinese)} disabled={!spec.title_chinese.trim()} aria-label="Play" title="Play">🔊</button>
          </div>
        </Field>
        <Field label="English title">
          <TextInput value={spec.title_english} onChange={v => onChange({ ...spec, title_english: v })} placeholder="Winter in Changchun" />
        </Field>
      </div>
      <div className="ed-head-fields ed-reader-head">
        <Field label="Difficulty">
          <select className="ed-input" value={spec.difficulty_level} onChange={e => onChange({ ...spec, difficulty_level: e.target.value as ReaderDifficulty })}>
            {READER_DIFFICULTIES.map(d => <option key={d} value={d}>{readerDifficultyLabel(d)}</option>)}
          </select>
        </Field>
        <Field label="Topic" hint="optional">
          <TextInput value={spec.topic ?? ''} onChange={v => onChange({ ...spec, topic: v || null })} placeholder="winter, daily life…" />
        </Field>
      </div>

      <div className="ed-section">
        <div className="ed-section-head">
          <span className="ed-section-title">Pages</span>
          <span className="ed-section-count">{spec.pages.length}</span>
          <button type="button" className="ed-mini-btn text" onClick={() => setOpenPages(new Set(spec.pages.map((_, i) => i)))}>Expand all</button>
          <button type="button" className="ed-mini-btn text" onClick={() => setOpenPages(new Set())}>Collapse all</button>
        </div>
        <div className="ed-section-body">
          {spec.pages.map((page, i) => (
            <PageCard
              key={page.id ?? `new-${i}`}
              page={page}
              index={i}
              count={spec.pages.length}
              errors={pageErrors(errors, i + 1)}
              open={openPages.has(i)}
              onToggle={() => toggle(i)}
              onChange={next => setPages(spec.pages.map((p, j) => (j === i ? next : p)))}
              onMove={(from, to) => {
                setPages(moveItem(spec.pages, from, to));
                setOpenPages(prev => {
                  const next = new Set<number>();
                  for (const x of prev) next.add(x === from ? to : x === to ? from : x);
                  return next;
                });
              }}
              onDuplicate={() => {
                const { id: _id, image_url: _img, ...rest } = page;
                insertAt(i + 1, { ...rest });
              }}
              onInsertAfter={() => insertAt(i + 1, blankPage())}
              onRemove={() => {
                if (page.content_chinese.trim() && !confirm(`Delete page ${i + 1}?`)) return;
                setPages(spec.pages.filter((_, j) => j !== i));
                setOpenPages(prev => new Set(Array.from(prev).filter(x => x !== i).map(x => (x > i ? x - 1 : x))));
              }}
              speak={speak}
              savedPrompt={page.id ? savedPromptById.get(page.id) : undefined}
              assist={assist}
              illustrate={illustrate}
            />
          ))}
          <button
            type="button"
            className="ed-add-btn big"
            onClick={() => {
              setPages([...spec.pages, blankPage()]);
              openOnly(spec.pages.length);
            }}
          >
            + Add page
          </button>
        </div>
      </div>
    </div>
  );
}
