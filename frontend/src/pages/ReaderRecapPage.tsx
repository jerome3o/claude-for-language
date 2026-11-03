import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { recapSourceLabel } from '@shared/study/wordRecap';
import { db } from '../db/database';
import { track } from '../services/analytics';
import { WordRecapPass } from '../components/readerRecap/WordRecapPass';

/**
 * `/readers/:id/recap` — the reader word recap of the reader's latest run (docs/STUDY_SESSION.md
 * "Reader word recap"): offered after the story's finish, or from the Readers list afterwards
 * (`?from=readers`). The pass itself is components/readerRecap/WordRecapPass (shared with the
 * "💬 Ask Claude" chat's recap).
 */
export function ReaderRecapPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const reader = useLiveQuery(async () => (id ? (await db.readers.get(id)) ?? null : null), [id]);
  const from = params.get('from');
  // Opened from the Readers list (the end-of-story offer tracks its own start).
  const onRun = useCallback((words: number) => {
    if (from === 'readers') track('reader.word_recap_start', { from: 'readers', words });
  }, [from]);
  return (
    <WordRecapPass
      runId={id}
      source="reader"
      sourceLabel={recapSourceLabel('reader', reader?.title_chinese)}
      backTo={{ path: '/readers', label: 'Readers' }}
      onRun={onRun}
    />
  );
}
