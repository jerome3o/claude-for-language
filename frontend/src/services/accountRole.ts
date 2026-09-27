/**
 * The signed-in account's role, readable outside React (sync, background
 * jobs). AuthContext mirrors /api/auth/me into localStorage (`cached_user`),
 * so this works offline too. A tutor account (users.role = 'tutor') gets no
 * learner automation: no daily story generated for it.
 */
const CACHED_USER_KEY = 'cached_user';

export function isTutorAccountCached(): boolean {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as { role?: string }).role === 'tutor';
  } catch {
    return false;
  }
}
