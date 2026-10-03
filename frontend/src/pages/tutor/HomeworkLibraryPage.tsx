import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getRelationshipLibrary, getTutorLibrary } from '../../api/homeworkLibrary';
import { HomeworkLibraryList } from '../../components/tutor/library/HomeworkLibraryList';
import { Loading } from '../../components/Loading';
import '../../components/tutor/library/homework-library.css';

/**
 * The homework library (docs/HOMEWORK.md §9): everything the tutor sent —
 * decks, lessons, readers, links — with sent / due dates, % and status.
 * `/connections/:relId/homework` = one student, `/homework-library` = all.
 */
export function HomeworkLibraryPage() {
  const { relId } = useParams<{ relId?: string }>();
  const query = useQuery({
    queryKey: ['homework-library', relId ?? 'all'],
    queryFn: () => (relId ? getRelationshipLibrary(relId) : getTutorLibrary()),
    staleTime: 30_000,
  });
  const students = query.data && 'students' in query.data ? (query.data.students as Array<{ student_name: string }>) : null;
  const studentName = relId ? query.data?.items[0]?.student_name : null;

  return (
    <div className="page">
      <div className="container" data-testid="homework-library-page">
        <div className="hl-page-head">
          <h1>{relId ? `Homework${studentName ? ` · ${studentName}` : ''}` : 'Homework library'}</h1>
          {relId ? <Link to={`/connections/${relId}`}>‹ Student</Link> : <Link to="/connections">‹ Students</Link>}
        </div>
        <p className="td-muted">
          {relId ? 'Everything you sent' : `Everything you sent ${students && students.length > 1 ? `your ${students.length} students` : 'your students'}`} — words, lessons, readers and links, newest first. Tap one to open, edit, update their copy, move the date or remove it.
        </p>
        {query.isLoading && <Loading message="Loading homework…" />}
        {query.isError && <div className="td-error">Couldn't load the homework. {(query.error as Error).message}</div>}
        {query.data && <HomeworkLibraryList items={query.data.items} today={query.data.today} showStudent={!relId} onChanged={() => void query.refetch()} />}
      </div>
    </div>
  );
}
