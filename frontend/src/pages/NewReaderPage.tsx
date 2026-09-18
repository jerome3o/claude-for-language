import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createBlankReader } from '../api/client';
import { Loading } from '../components/Loading';
import { InlineError } from '../components/Toast';

/**
 * `/readers/new/edit` — "Create New" on the Readers list lands here, which
 * creates a blank reader and jumps straight into its editor. The title
 * fields sit at the top of the editor, so there is no title modal first.
 */
export function NewReaderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-invokes effects in dev
    started.current = true;
    createBlankReader({
      title_chinese: '新故事',
      title_english: 'New story',
      difficulty_level: 'beginner',
    })
      .then(reader => {
        queryClient.invalidateQueries({ queryKey: ['readers'] });
        navigate(`/readers/${reader.id}/edit`, { replace: true });
      })
      .catch(err => {
        setError(err instanceof Error && err.message ? err.message : "Couldn't create a new reader.");
      });
  }, [navigate, queryClient]);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '600px' }}>
        {error ? (
          <>
            <InlineError message={`Couldn't create a new reader — ${error}`} />
            <Link to="/readers" className="btn btn-secondary">← Back to readers</Link>
          </>
        ) : (
          <Loading message="Creating your reader…" />
        )}
      </div>
    </div>
  );
}
