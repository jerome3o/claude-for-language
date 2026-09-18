/**
 * Compact rendering of a reader diff — pages added / removed / moved /
 * changed (with field detail) plus title / difficulty / topic changes. Used
 * for Claude's proposals in the reader editor chat.
 */

import { ReaderDiff, readerFieldLabel } from '@shared/reader';

function short(value: unknown, max = 50): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function ReaderDiffCard({ diff }: { diff: ReaderDiff }) {
  if (!diff.changed) {
    return <div className="diff-card empty">No changes — the proposal matches the current reader.</div>;
  }
  return (
    <div className="diff-card">
      {diff.meta.map(m => (
        <div key={m.field} className="diff-row meta">
          <span className="diff-badge changed">~</span>
          <span>
            <strong>{readerFieldLabel(m.field)}</strong>: <s>{short(m.before)}</s> → {short(m.after)}
          </span>
        </div>
      ))}
      {diff.pages.map((p, i) => {
        const cls = p.kind;
        const sym = p.kind === 'added' ? '+' : p.kind === 'removed' ? '−' : p.kind === 'moved' ? '↕' : '~';
        const page = p.kind === 'changed' ? p.after : p.page;
        return (
          <div key={`p${i}`} className={`diff-row ${cls}`}>
            <span className={`diff-badge ${cls}`}>{sym}</span>
            <div className="diff-row-body">
              <div className="diff-where">
                Page {p.index + 1}
                {p.kind === 'moved' && <> (from page {p.fromIndex + 1})</>}
                {p.kind === 'changed' && p.fromIndex !== p.index && <> (was page {p.fromIndex + 1})</>}
              </div>
              <span className="diff-exercise-label">
                <span className="diff-exercise-text" lang="zh-CN">{short(page.content_chinese)}</span>
              </span>
              {p.kind === 'changed' && p.fields.length > 0 && (
                <ul className="diff-fields">
                  {p.fields.map(f => (
                    <li key={f.field}>
                      <strong>{readerFieldLabel(f.field)}</strong>: {f.before != null && f.before !== '' && <s>{short(f.before, 40)}</s>}{' '}
                      {f.before != null && f.before !== '' && f.after != null && f.after !== '' && '→ '}
                      {f.after != null && short(f.after, 40)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
