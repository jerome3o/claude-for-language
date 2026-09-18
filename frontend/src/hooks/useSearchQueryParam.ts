import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Name of the URL parameter that carries a search query (`/search?q=…`, `/decks?q=…`). */
export const SEARCH_QUERY_PARAM = 'q';

/**
 * Read the search query out of a URL's query string. Pure, so it can be
 * unit-tested and reused outside React (deep links, the Android
 * PROCESS_TEXT intent). Whitespace-only values count as "no query".
 */
export function readSearchQueryParam(search: string | URLSearchParams): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return (params.get(SEARCH_QUERY_PARAM) ?? '').trim();
}

/**
 * Build the next query string for a new search value, keeping every other
 * parameter. An empty value removes `q` entirely so the URL stays clean.
 */
export function writeSearchQueryParam(search: string | URLSearchParams, value: string): URLSearchParams {
  const next = new URLSearchParams(typeof search === 'string' ? search : search.toString());
  const trimmed = value.trim();
  if (trimmed) next.set(SEARCH_QUERY_PARAM, trimmed);
  else next.delete(SEARCH_QUERY_PARAM);
  return next;
}

/**
 * `?q=` ↔ state, shared by every page that hosts a search box.
 *
 * Returns the current query from the URL and a setter that rewrites the URL
 * in place (history *replace*, so typing doesn't spam the back stack). Pages
 * keep their own debounced/local input state if they want instant typing;
 * this hook is only the URL half, so `/decks?q=你好` and `/search?q=你好`
 * both open with the query filled in.
 */
export function useSearchQueryParam(): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = readSearchQueryParam(searchParams);
  const setQuery = useCallback(
    (value: string) => {
      setSearchParams(prev => writeSearchQueryParam(prev, value), { replace: true });
    },
    [setSearchParams]
  );
  return [query, setQuery];
}
