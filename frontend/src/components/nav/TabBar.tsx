import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useNavRole } from './useNavRole';
import { tabsFor, activeTab, isImmersiveRoute, TabId } from './tabs';
import './TabBar.css';

/**
 * Keeps the document in step with the bar:
 *  - `html.has-tab-bar` adds bottom padding (and scroll-padding, so a focused
 *    input is scrolled clear of the bar) while the bar is on screen;
 *  - `html.tab-bar-keyboard` is set when the visual viewport is much shorter
 *    than the layout viewport. That gap is 0 on Android (the viewport meta
 *    uses interactive-widget=resizes-content, so the keyboard shrinks
 *    innerHeight and a `position: fixed; bottom: 0` bar simply follows) and
 *    0 on desktop. On iOS Safari the layout viewport keeps its height while
 *    the keyboard is up, so the gap is the keyboard height — the bar is then
 *    hidden instead of sitting under the keyboard or eating the little space
 *    left above it. Pinch-zoom also shrinks the visual viewport, so the check
 *    is skipped unless the scale is 1.
 */
function useTabBarLayout(visible: boolean) {
  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.classList.add('has-tab-bar');

    const vv = window.visualViewport;
    const update = () => {
      let gap = 0;
      if (vv && Math.abs(vv.scale - 1) < 0.01) {
        gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      }
      root.classList.toggle('tab-bar-keyboard', gap > 100);
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.classList.remove('has-tab-bar', 'tab-bar-keyboard');
    };
  }, [visible]);
}

function TabIcon({ id }: { id: TabId }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (id) {
    case 'study':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
        </svg>
      );
    case 'decks':
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'tutor':
      return (
        <svg {...common}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case 'students':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'progress':
      return (
        <svg {...common}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M3 12h18" />
          <path d="M3 18h18" />
        </svg>
      );
  }
}

/**
 * Bottom tab bar. Rendered by <Header /> so it appears on exactly the pages
 * that have chrome, and returns null on immersive routes (/study, quests,
 * readers, editors, chat) — see isImmersiveRoute.
 */
export function TabBar() {
  const { pathname } = useLocation();
  const role = useNavRole();
  const visible = !isImmersiveRoute(pathname);
  useTabBarLayout(visible);
  if (!visible) return null;

  const tabs = tabsFor(role);
  const active = activeTab(tabs, pathname);

  return (
    <nav className="tab-bar" aria-label="Main" data-testid="tab-bar">
      <div className="tab-bar-inner">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              to={tab.to}
              className={`tab-bar-item${isActive ? ' tab-bar-item-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              data-tab={tab.id}
            >
              <TabIcon id={tab.id} />
              <span className="tab-bar-label">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
