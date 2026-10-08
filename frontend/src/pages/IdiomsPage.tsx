import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { STARTER_IDIOMS, idiomKeyProblem, normalizeIdiomHanzi, type IdiomSummary } from '@shared/idioms';
import { useNetwork } from '../contexts/NetworkContext';
import { cachedIdioms, localIdiomList, refreshIdiomList } from '../services/idioms';
import './IdiomsPage.css';

const KIND = new Map(STARTER_IDIOMS.map((s) => [s.hanzi, s.kind]));

function Tile({ idiom, offline, cached }: { idiom: IdiomSummary; offline: boolean; cached: boolean }) {
  const unavailable = offline && !cached;
  return (
    <Link
      to={`/idioms/${encodeURIComponent(idiom.hanzi)}?from=list`}
      className={`idiom-tile${unavailable ? ' idiom-tile--offline' : ''}`}
      data-testid="idiom-tile"
      aria-label={`${idiom.hanzi}, ${idiom.pinyin}, ${idiom.english}${unavailable ? ' — needs internet' : ''}`}
    >
      <span className="idiom-tile-zh" lang="zh-CN">{idiom.hanzi}</span>
      <span className="idiom-tile-py">{idiom.pinyin}</span>
      <span className="idiom-tile-en">{idiom.english}</span>
      {cached && <span className="idiom-tile-badge" title="On this device">✓</span>}
    </Link>
  );
}

/** `/idioms` — 成语 Idioms (beta): look one up, or browse the starter list. */
export function IdiomsPage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [list, setList] = useState<{ starter: IdiomSummary[]; more: IdiomSummary[] } | null>(null);
  const [onDevice, setOnDevice] = useState<Set<string>>(new Set());
  const [openedRows, setOpenedRows] = useState<IdiomSummary[]>([]);
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const local = await localIdiomList();
      const cached = await cachedIdioms();
      if (!alive) return;
      setList(local);
      setOnDevice(new Set(cached.map((c) => c.hanzi)));
      setOpenedRows(
        cached
          .filter((c) => c.entry && !KIND.has(c.hanzi))
          .map((c) => ({ hanzi: c.hanzi, pinyin: c.entry!.pinyin, english: c.entry!.meaning, status: 'ready' as const, starter: false })),
      );
      if (!navigator.onLine) return;
      const fresh = await refreshIdiomList().catch(() => null);
      if (alive && fresh) setList(fresh);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const lookUp = (e: React.FormEvent) => {
    e.preventDefault();
    const p = idiomKeyProblem(query);
    setProblem(p);
    if (p) return;
    navigate(`/idioms/${encodeURIComponent(normalizeIdiomHanzi(query))}?from=search`);
  };

  const story = list?.starter.filter((s) => KIND.get(s.hanzi) === 'story') ?? [];
  const everyday = list?.starter.filter((s) => KIND.get(s.hanzi) !== 'story') ?? [];
  const offline = !isOnline;

  return (
    <div className="container idioms-page" data-testid="idioms-page">
      <h1 className="idioms-title">
        📜 成语 Idioms <span className="idiom-beta">beta</span>
      </h1>
      <p className="idioms-blurb">
        Four characters, a whole story. Each idiom comes with what it really means, the story behind it (典故) in
        simple Chinese, and how to use it — with a quick check at the end.
      </p>

      <form className="idioms-search" onSubmit={lookUp} role="search">
        <label className="form-label" htmlFor="idiom-search">Look up any 成语</label>
        <div className="idioms-search-row">
          <input
            id="idiom-search"
            className="form-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setProblem(null);
            }}
            placeholder="e.g. 废寝忘食"
            lang="zh-CN"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button type="submit" className="btn btn-primary" disabled={!query.trim()}>Look up</button>
        </div>
        {problem && <p className="idioms-problem" role="alert">{problem}</p>}
        {offline && <p className="idioms-muted">Offline — idioms you’ve opened before still work; new ones need internet.</p>}
      </form>

      {openedRows.length > 0 && (
        <section className="idioms-section">
          <h2 className="idiom-h2">Opened on this device</h2>
          <div className="idiom-grid">
            {openedRows.map((r) => <Tile key={r.hanzi} idiom={r} offline={offline} cached />)}
          </div>
        </section>
      )}

      <section className="idioms-section">
        <h2 className="idiom-h2">With a story · 有典故</h2>
        <div className="idiom-grid">
          {story.map((s) => <Tile key={s.hanzi} idiom={s} offline={offline} cached={onDevice.has(s.hanzi)} />)}
        </div>
      </section>

      <section className="idioms-section">
        <h2 className="idiom-h2">Everyday · 常用</h2>
        <div className="idiom-grid">
          {everyday.map((s) => <Tile key={s.hanzi} idiom={s} offline={offline} cached={onDevice.has(s.hanzi)} />)}
        </div>
      </section>

      {list && list.more.filter((m) => !onDevice.has(m.hanzi)).length > 0 && (
        <section className="idioms-section">
          <h2 className="idiom-h2">Looked up by others</h2>
          <div className="idiom-grid">
            {list.more.filter((m) => !onDevice.has(m.hanzi)).map((m) => <Tile key={m.hanzi} idiom={m} offline={offline} cached={false} />)}
          </div>
        </section>
      )}
      <p className="idioms-muted idioms-footnote">Written by Claude and checked for consistency, not by a dictionary editor — when something looks off, ask your tutor.</p>
    </div>
  );
}
