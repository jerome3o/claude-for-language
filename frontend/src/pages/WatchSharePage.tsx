import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { parseYouTubeVideoId } from '@shared/watch';

/**
 * `/watch/share?text=&url=&title=` — the installed app's share target (manifest.json `share_target`,
 * docs/WATCH.md): YouTube's Share puts the link in `text` (sometimes `url`); the player opens it.
 */
export function WatchSharePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = parseYouTubeVideoId(params.get('url') ?? '') ?? parseYouTubeVideoId(params.get('text') ?? '') ?? parseYouTubeVideoId(params.get('title') ?? '');

  useEffect(() => {
    if (id) navigate(`/watch/${id}?source=share`, { replace: true });
  }, [id, navigate]);

  if (id) return null;
  return (
    <div className="watch-page">
      <h1 className="watch-title">📺 Watch</h1>
      <p className="watch-problem" role="alert">
        That wasn't a YouTube video link. Share a video from the YouTube app, or paste its link on the Watch page.
      </p>
      <Link to="/watch" className="btn btn-primary">
        Go to Watch
      </Link>
    </div>
  );
}
