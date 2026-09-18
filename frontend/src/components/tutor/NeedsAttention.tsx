import { Link } from 'react-router-dom';
import type { NeedsAttentionItem } from '../../types/tutorDashboard';
import { getAudioUrl } from '../../api/client';
import { useAudioPlayer } from '../../hooks/useAudio';
import './tutor-dashboard.css';

/** Wrong characters in red, the ones they got right in normal weight. */
function WrongAnswer({ typed, correct }: { typed: string; correct: string }) {
  return (
    <span>
      {[...typed].map((ch, i) => (
        <span key={i} className={ch === correct[i] ? undefined : 'td-wrong'}>{ch}</span>
      ))}
    </span>
  );
}

function HearButton({ url }: { url: string }) {
  const { isPlaying, play, stop } = useAudioPlayer(getAudioUrl(url));
  return (
    <button
      type="button"
      className={`td-hear ${isPlaying ? 'playing' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isPlaying) stop();
        else play();
      }}
      aria-label={isPlaying ? 'Stop recording' : 'Hear recording'}
    >
      🎤 {isPlaying ? 'stop' : 'hear'}
    </button>
  );
}

function describe(item: NeedsAttentionItem): React.ReactNode {
  const parts: React.ReactNode[] = [];
  if (item.again_count > 0) parts.push(item.again_count > 1 ? `Again ×${item.again_count}` : 'Again');
  else if (item.hard_count > 0) parts.push(item.hard_count > 1 ? `Hard ×${item.hard_count}` : 'Hard');
  if (item.wrong_answers.length > 0) {
    parts.push(
      <span key="typed">
        typed <WrongAnswer typed={item.wrong_answers[0]} correct={item.note.hanzi} />
        {item.wrong_answers.length > 1 ? ` +${item.wrong_answers.length - 1}` : ''}
      </span>
    );
  }
  if (item.recording && parts.length === 0) parts.push('recording waiting');
  else if (item.recordings_unheard > 1) parts.push(`${item.recordings_unheard} recordings waiting`);
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 && ' · '}
      {p}
    </span>
  ));
}

/**
 * Top 3 words from the last 7 days that need the tutor's attention, with the
 * wrong characters typed and a play button for an unheard recording. Links
 * into Insights / Recordings for the rest.
 */
export function NeedsAttention({
  relId,
  items,
  unheardTotal,
}: {
  relId: string;
  items: NeedsAttentionItem[];
  unheardTotal: number;
}) {
  return (
    <div className="td-attention">
      {items.length === 0 ? (
        <div className="td-empty">Nothing needs attention this week{unheardTotal > 0 ? ` — ${unheardTotal} recording${unheardTotal === 1 ? '' : 's'} to hear` : ''}.</div>
      ) : (
        items.map((item) => (
          <Link key={item.note.id} to={`/connections/${relId}/insights`} className="td-attention-row">
            <span className="td-attention-hanzi" lang="zh">{item.note.hanzi}</span>
            <span className="td-attention-main">
              <div className="td-attention-word">{item.note.pinyin} · {item.note.english}</div>
              <div className="td-attention-detail">{describe(item)}</div>
            </span>
            {item.recording ? <HearButton url={item.recording.recording_url} /> : <span className="td-chevron">›</span>}
          </Link>
        ))
      )}
      <Link to={unheardTotal > 0 && items.every((i) => !i.recording) ? `/connections/${relId}/recordings` : `/connections/${relId}/insights`} className="td-attention-footer">
        All words &amp; recordings →
      </Link>
    </div>
  );
}
