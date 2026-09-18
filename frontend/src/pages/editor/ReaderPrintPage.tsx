/**
 * Print view for a graded reader: one sheet per page with the illustration
 * (if any), the Chinese, pinyin underneath and the English below, then a
 * glossary. Reached from the editor (which passes its current, possibly
 * unsaved spec via location.state) or directly.
 *
 * Route: /readers/:id/print
 */

import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReaderSpec, ReaderPageSpec } from '@shared/reader';
import { readerDifficultyLabel, readerVocabRows } from '@shared/reader';
import { getReaderSpec } from '../../api/readerEditor';
import { useCachedImageUrl } from '../../hooks/useCachedImageUrl';
import { Loading, ErrorMessage } from '../../components/Loading';
import './LessonPrintPage.css';
import './ReaderPrintPage.css';

function PrintPage({ page, n }: { page: ReaderPageSpec; n: number }) {
  const imageUrl = useCachedImageUrl(page.image_url ?? null);
  return (
    <section className="rp-sheet">
      <div className="rp-num">{n}</div>
      {imageUrl && <img className="rp-image" src={imageUrl} alt="" />}
      <p className="rp-hanzi" lang="zh-CN">{page.content_chinese}</p>
      {page.content_pinyin?.trim() && <p className="rp-pinyin">{page.content_pinyin}</p>}
      {page.content_english?.trim() && <p className="rp-english">{page.content_english}</p>}
    </section>
  );
}

export function PrintableReader({ spec }: { spec: ReaderSpec }) {
  const vocab = readerVocabRows(spec);
  return (
    <article className="rp-reader">
      <header className="rp-cover">
        <h1 lang="zh-CN">{spec.title_chinese}</h1>
        <div className="rp-subtitle">{spec.title_english}</div>
        <div className="rp-meta">
          {readerDifficultyLabel(spec.difficulty_level)}
          {spec.topic?.trim() ? ` · ${spec.topic.trim()}` : ''}
          {` · ${spec.pages.length} page${spec.pages.length === 1 ? '' : 's'}`}
        </div>
      </header>
      {spec.pages.map((page, i) => <PrintPage key={page.id ?? i} page={page} n={i + 1} />)}
      {vocab.length > 0 && (
        <section className="rp-glossary">
          <h2>Glossary</h2>
          <table>
            <tbody>
              {vocab.map(v => (
                <tr key={v.hanzi}><td lang="zh-CN">{v.hanzi}</td><td className="rp-glossary-pinyin">{v.pinyin}</td><td>{v.english}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}

export function ReaderPrintPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const passed = (location.state as { spec?: ReaderSpec } | null)?.spec ?? null;

  const query = useQuery({
    queryKey: ['reader-spec', id],
    queryFn: () => getReaderSpec(id),
    enabled: !passed,
    retry: 1,
  });
  const spec = passed ?? query.data?.spec ?? null;

  if (!spec && query.isLoading) return <Loading message="Loading reader…" />;
  if (!spec) return <div className="page"><div className="container"><ErrorMessage message="Reader not found" /></div></div>;

  return (
    <div className="pr-page rp-page">
      <div className="pr-toolbar no-print">
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Back</button>
        {passed && <span className="pr-toolbar-note">Showing the editor's current (unsaved) version.</span>}
        <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
      </div>
      <PrintableReader spec={spec} />
    </div>
  );
}
