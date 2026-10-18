import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { memeMonthLabel, memeMonthLabelZh, type MemeIssueSummary } from '@shared/meme-review';
import { useNetwork } from '../contexts/NetworkContext';
import { generateMemeIssue, type MemeIssueList } from '../api/memeReview';
import { cachedMemeList, cachedMemeMonths, offlineMemeSummaries, refreshMemeList } from '../services/memeReview';
import './MemeReviewPage.css';

const POLL_MS = 5000;

function IssueRow({ issue, onDevice }: { issue: MemeIssueSummary; onDevice: boolean }) {
  const body = (
    <>
      <div className="meme-row-month">
        <span lang="zh-CN">{memeMonthLabelZh(issue.month)}</span>
        <span className="meme-row-month-en">{memeMonthLabel(issue.month)}</span>
        {onDevice && <span className="meme-row-badge" title="On this device">✓</span>}
      </div>
      {issue.status === 'ready' ? (
        <>
          <div className="meme-row-title" lang="zh-CN">{issue.title}</div>
          {issue.title_en && <div className="meme-row-sub">{issue.title_en}</div>}
          <div className="meme-row-chips">
            {issue.preview.map((h) => <span key={h} className="meme-chip" lang="zh-CN">{h}</span>)}
            {issue.item_count > issue.preview.length && <span className="meme-chip meme-chip--more">+{issue.item_count - issue.preview.length}</span>}
          </div>
        </>
      ) : issue.status === 'generating' ? (
        <div className="meme-row-sub">🔎 Being researched…</div>
      ) : (
        <div className="meme-row-sub">This issue didn’t come out.</div>
      )}
    </>
  );
  return issue.status === 'ready' ? (
    <Link to={`/meme-review/${issue.month}?from=list`} className="meme-row" data-testid="meme-issue-row">{body}</Link>
  ) : (
    <div className={`meme-row meme-row--${issue.status}`} data-testid="meme-issue-row">{body}</div>
  );
}

/** `/meme-review` — 梗 Meme review (prototype): one issue a month. */
export function MemeReviewPage() {
  const { isOnline } = useNetwork();
  const [list, setList] = useState<MemeIssueList | null>(null);
  const [offlineRows, setOfflineRows] = useState<MemeIssueSummary[] | null>(null);
  const [onDevice, setOnDevice] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await refreshMemeList().catch(() => null);
    if (fresh) setList(fresh);
    return fresh;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [cached, months, offline] = await Promise.all([cachedMemeList(), cachedMemeMonths(), offlineMemeSummaries()]);
      if (!alive) return;
      if (cached) setList(cached);
      setOnDevice(months);
      setOfflineRows(offline);
      if (navigator.onLine) await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // While an issue is being researched: poll the list.
  const generating = list?.issues.some((i) => i.status === 'generating') ?? false;
  useEffect(() => {
    if (!generating || !isOnline) return;
    const t = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(t);
  }, [generating, isOnline, refresh]);

  const current = list?.current_month ?? null;
  const currentRow = current ? list?.issues.find((i) => i.month === current) : undefined;
  const canStart = !!list?.can_generate && !!current && (!currentRow || currentRow.status === 'failed');

  const generate = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await generateMemeIssue(current);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start it.');
    } finally {
      setBusy(false);
    }
  };

  const rows = isOnline || !offlineRows ? list?.issues ?? offlineRows ?? [] : offlineRows;

  return (
    <div className="container meme-page" data-testid="meme-review-page">
      <h1 className="meme-title">
        梗 Meme review <span className="meme-proto">prototype</span>
      </h1>
      <p className="meme-blurb">
        What the Chinese internet has been saying lately — one issue a month, researched by Claude with real sources:
        what each 梗 means, where it came from, who says it and whether <em>you</em> should. Links go to the original videos and posts.
      </p>
      {!isOnline && <p className="meme-muted">Offline — issues you’ve opened before still work; links need internet.</p>}

      {canStart && (
        <div className="meme-admin" data-testid="meme-generate">
          <p>No issue for {memeMonthLabel(current!)} yet{currentRow?.status === 'failed' ? ' (the last try failed)' : ''}. It normally appears on the 1st.</p>
          <button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={busy || !isOnline}>
            {busy ? 'Starting…' : 'Generate now (admin)'}
          </button>
          <p className="meme-muted">About 5–15 minutes and roughly $1–3 (Claude + web searches + pictures).</p>
          {error && <p className="meme-error" role="alert">{error}</p>}
        </div>
      )}

      {list === null && offlineRows === null ? (
        <p className="meme-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="meme-empty" data-testid="meme-empty">
          <div className="meme-empty-icon" aria-hidden>🌀</div>
          <p>No issues yet — the first one comes out on the 1st of the month.</p>
        </div>
      ) : (
        <div className="meme-list">
          {rows.map((i) => <IssueRow key={i.month} issue={i} onDevice={onDevice.has(i.month)} />)}
        </div>
      )}
      <p className="meme-muted meme-footnote">
        A prototype: written by Claude from web search results and checked by code (every link must come from the search), not by an editor.
        Memes move fast — when something looks off, ask your tutor.
      </p>
    </div>
  );
}
