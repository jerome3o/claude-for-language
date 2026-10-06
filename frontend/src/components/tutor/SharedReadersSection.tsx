import { useQuery } from '@tanstack/react-query';
import { nextRevisitLabel } from '../../utils/revisitLabel';
import { removalMenuLabel } from '@shared/homework';
import { listSharedReaders } from '../../api/tutorDashboard';
import { OverflowMenu } from './OverflowMenu';
import './homework-tutor.css';
import { plural, shortDate } from './format';

/**
 * Graded readers the tutor sent this student (shared_readers) with whether
 * they read them, and "Remove from <student>'s readers". Renders nothing
 * while there are none.
 */
export function SharedReadersSection({
  relId,
  studentName,
  onRemove,
}: {
  relId: string;
  studentName: string;
  onRemove: (reader: { id: string; title: string }) => void;
}) {
  const readers = useQuery({ queryKey: ['shared-readers', relId], queryFn: () => listSharedReaders(relId), retry: 1 });
  const rows = readers.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="td-nested-section" data-testid="shared-readers">
      <h3 className="td-subhead">Readers</h3>
      <div className="shared-decks-list">
        {rows.map((r) => {
          const title = r.source_title_chinese || r.target_title_chinese || r.source_title_english || 'Reader';
          return (
            <div key={r.id} className="shared-deck-item">
              <div className="shared-deck-info">
                <span className="shared-deck-name" lang="zh">📖 {title}</span>
                <span className="shared-deck-meta">
                  sent {shortDate(r.shared_at)} ·{' '}
                  {r.target_deleted
                    ? 'they deleted their copy'
                    : `${plural(r.page_count ?? 0, 'page')} · ${(r.read_count ?? 0) === 0 ? 'not read yet' : `read ${r.read_count}×`}${nextRevisitLabel(r) ? ` · ${nextRevisitLabel(r)}` : ''}`}
                </span>
              </div>
              <OverflowMenu
                label={`More for ${title}`}
                items={[{ label: removalMenuLabel('reader', studentName), danger: true, onClick: () => onRemove({ id: r.id, title }) }]}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
