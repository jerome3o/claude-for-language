import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listUpNextApi } from '../../api/upNext';
import './upNext.css';

/** The student page's "↑ Up next · 4 words" row → the tutor's view of the student's list. */
export function StudentUpNextLink({ relId, studentName }: { relId: string; studentName: string }) {
  const q = useQuery({ queryKey: ['student-up-next', relId], queryFn: () => listUpNextApi(relId), staleTime: 60_000 });
  const n = q.data?.up_next.length ?? 0;
  const first = q.data?.up_next.slice(0, 3).map((e) => e.hanzi).join('、');
  return (
    <Link to={`/connections/${relId}/up-next`} className="upnext-student-link" data-testid="student-upnext-link">
      <span className="upnext-student-link-title">↑ Up next{q.data ? ` · ${n} ${n === 1 ? 'word' : 'words'}` : ''}</span>
      <span className="upnext-student-link-desc">
        {n > 0 ? `${first}${n > 3 ? '…' : ''} — introduced first, in this order` : `Choose the words ${studentName} learns next`}
      </span>
      <span className="nav-row-chevron" aria-hidden="true">›</span>
    </Link>
  );
}
