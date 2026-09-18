import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * The Search page is now the search field at the top of the Decks tab.
 * `/search` (and `/search?q=…`) redirect there so old links and the native
 * shell's shortcuts keep working.
 */
export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  return <Navigate to={`/decks${q ? `?q=${encodeURIComponent(q)}` : ''}`} replace />;
}
