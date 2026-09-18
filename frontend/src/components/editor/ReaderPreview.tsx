/**
 * Preview for the reader editor: the real reading view (illustration first,
 * tap to reveal Chinese, then pinyin, then translation, audio per page) in a
 * non-scoring mode — page through the unsaved spec exactly as the learner
 * will see it, nothing recorded.
 */

import { useState } from 'react';
import type { ReaderSpec, ReaderPageSpec } from '@shared/reader';
import { readerDifficultyLabel } from '@shared/reader';
import { useCachedImageUrl } from '../../hooks/useCachedImageUrl';
import type { Speak } from './fields';
import '../../pages/ReaderPage.css';

function PreviewPage({ page, speak }: { page: ReaderPageSpec; speak: Speak }) {
  const [showChinese, setShowChinese] = useState(false);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const imageUrl = useCachedImageUrl(page.image_url ?? null);
  const prompt = (page.image_prompt ?? '').trim();

  return (
    <div className="reader-page-view">
      {imageUrl ? (
        <div className="reader-image-container">
          <img src={imageUrl} alt="Story illustration" className="reader-image" />
        </div>
      ) : prompt ? (
        <div className="reader-image-container ed-preview-image-pending">
          <span>🖼</span>
          <span>Illustration not drawn yet</span>
        </div>
      ) : null}

      <div className="reader-text-content">
        <div className="reader-chinese-section">
          {showChinese ? (
            <div className="reader-chinese-revealed tappable" onClick={() => setShowChinese(false)} role="button" tabIndex={0} aria-label="Hide Chinese">
              <div className="reader-chinese-text">{page.content_chinese || '(no Chinese yet)'}</div>
            </div>
          ) : (
            <div className="reader-chinese-reveal-box" onClick={() => setShowChinese(true)}>Tap to reveal Chinese</div>
          )}
        </div>

        <button type="button" className="ed-reader-play" onClick={() => speak(page.content_chinese)} disabled={!page.content_chinese.trim()}>
          🔊 Play audio
        </button>

        <div onClick={() => setShowPinyin(!showPinyin)} className={`reader-pinyin-box ${showPinyin ? 'visible' : 'hidden'}`}>
          {showPinyin ? (page.content_pinyin || '(no pinyin)') : 'Tap to reveal pinyin'}
        </div>
        <div onClick={() => setShowTranslation(!showTranslation)} className={`reader-translation-box ${showTranslation ? 'visible' : 'hidden'}`}>
          {showTranslation ? (page.content_english || '(no translation)') : 'Tap to reveal translation'}
        </div>
      </div>
    </div>
  );
}

export function ReaderPreview({ spec, speak }: { spec: ReaderSpec; speak: Speak }) {
  const [index, setIndex] = useState(0);
  const count = spec.pages.length;
  const current = Math.min(index, Math.max(0, count - 1));
  const page = spec.pages[current];

  if (!page) {
    return <div className="ed-preview"><div className="ed-preview-empty">Add a page to preview the reader.</div></div>;
  }

  return (
    <div className="ed-preview ed-reader-preview">
      <div className="ed-preview-bar">
        <button type="button" className="ed-mini-btn" onClick={() => setIndex(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous page">◀</button>
        <select className="ed-input ed-preview-jump" value={current} onChange={e => setIndex(Number(e.target.value))} aria-label="Jump to page">
          {spec.pages.map((p, i) => (
            <option key={p.id ?? i} value={i}>Page {i + 1} of {count} — {p.content_chinese.slice(0, 18) || '…'}</option>
          ))}
        </select>
        <button type="button" className="ed-mini-btn" onClick={() => setIndex(Math.min(count - 1, current + 1))} disabled={current >= count - 1} aria-label="Next page">▶</button>
      </div>
      <div className="reader-progress-bar"><div className="reader-progress-fill" style={{ width: `${((current + 1) / count) * 100}%` }} /></div>
      <div className="ed-preview-stage ed-reader-stage">
        <div className="ed-reader-preview-title">
          <span lang="zh-CN">{spec.title_chinese || 'Untitled'}</span>
          <span className="reader-difficulty-badge">{readerDifficultyLabel(spec.difficulty_level)}</span>
        </div>
        <PreviewPage key={`${page.id ?? current}-${current}`} page={page} speak={speak} />
      </div>
      <div className="ed-preview-note">Exactly what the learner sees — tap to reveal; nothing is recorded.</div>
    </div>
  );
}
