import { useState } from 'react';
import { liveCheckIssues, parseCheckIssues } from '@shared/cards/check';
import { applyNoteIssue, dismissNoteIssue } from '../../api/cardChecks';
import { track } from '../../services/analytics';
import type { Note } from '../../types';
import { CheckIssueBlock } from './CheckIssueBlock';

/**
 * The open word-check issues of one note (`note.check_issues`), each with Apply
 * fix / Dismiss. `onChanged` gets the note as the server now has it.
 */
export function NoteCheckIssues({
  note,
  onChanged,
}: {
  note: Pick<Note, 'id' | 'hanzi' | 'pinyin' | 'english' | 'check_issues'>;
  onChanged: (note: Note) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const issues = liveCheckIssues(parseCheckIssues(note.check_issues), note);
  if (!issues.length) return null;

  const run = async (id: string, apply: boolean) => {
    const issue = issues.find(i => i.id === id);
    setBusyId(id);
    setError(null);
    try {
      const res = apply ? await applyNoteIssue(note.id, id) : await dismissNoteIssue(note.id, id);
      if (issue) track(apply ? 'deck.check_issue_applied' : 'deck.check_issue_dismissed', { field: issue.field, kind: issue.kind, where: 'deck' });
      onChanged(res.note);
    } catch (e) {
      setError({ id, message: navigator.onLine ? (e instanceof Error ? e.message : 'Could not save') : 'You are offline — try again when connected' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="note-check-issues" data-testid="note-check-issues">
      {issues.map(issue => (
        <CheckIssueBlock
          key={issue.id}
          issue={issue}
          busy={busyId === issue.id}
          error={error?.id === issue.id ? error.message : null}
          onApply={() => void run(issue.id, true)}
          onDismiss={() => void run(issue.id, false)}
        />
      ))}
    </div>
  );
}
