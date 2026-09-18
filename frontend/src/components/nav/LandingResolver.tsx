import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { useNavRole, useDueCount } from './useNavRole';
import { resolveLanding, LANDING_PATHS } from './landing';

/**
 * Wraps the `/` page. On the app's *initial* entry (opening the PWA, a cold
 * load, the widget) it applies the "Start on" preference / the automatic
 * rule; navigating back to `/` from inside the app (the Study tab) always
 * shows the study home, otherwise a tutor could never reach it.
 *
 * "Initial" = react-router's default location key, which only the first
 * history entry of a page load carries.
 */
export function LandingResolver({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const role = useNavRole();
  const { dueCount, isLoading } = useDueCount();
  // On a fresh device IndexedDB is empty until the first sync finishes: an
  // empty count then is "not loaded yet", not "nothing due".
  const { isInitialized } = useNetwork();

  if (location.key !== 'default') return <>{children}</>;

  const target = resolveLanding(user?.landing_page, role.hasStudents, dueCount, isLoading || !isInitialized);
  if (target !== 'study') {
    return <Navigate to={LANDING_PATHS[target]} replace />;
  }
  return <>{children}</>;
}
