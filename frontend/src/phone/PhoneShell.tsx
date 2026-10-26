/**
 * The phone itself: status bar, home screen of app icons, the open apps (each a stack of screens
 * kept mounted, so switching apps keeps where you were), notification banners, the toast, the
 * pay sheet, the recents switcher and the Android-style navigation bar (◁ back · ○ home ·
 * ▢ recents) with the task card 📋 and the hint 💡 at its ends. Fills the screen on a phone;
 * a phone-sized frame on a desktop (phone.css).
 */
import { useRef, useState, type ReactNode } from 'react';
import { DOCK_ORDER, HOME_SCREEN_ORDER, PHONE_APPS, zhMonthDay, zhWeekdayLong, type PhoneAppId } from '@shared/phone';
import type { ExplorerItem } from '@shared/explorer';
import { usePhone } from './runtime';
import { PaySheet } from './PaySheet';
import { useLongPressWords } from './longPress';
import { APP_COMPONENTS } from './apps';
import { AppIcon } from './AppIcon';

export { AppIcon };

function StatusBar() {
  const p = usePhone();
  return (
    <div className={`ph-status${p.current ? ' ph-status-app' : ''}`} data-testid="phone-status">
      <span className="ph-status-time">{p.clock.time}</span>
      <span className="ph-status-icons" aria-hidden>
        {p.online ? <span className="ph-status-net">5G</span> : <span className="ph-status-net ph-status-off">无服务</span>}
        <span className="ph-status-signal">{p.online ? '▂▄▆█' : '▂___'}</span>
        <span className="ph-status-wifi">{p.online ? '◠' : ''}</span>
        <span className="ph-status-battery">
          <span style={{ width: '78%' }} />
        </span>
        <span className="ph-status-pct">78</span>
      </span>
    </div>
  );
}

function unreadFor(app: PhoneAppId, p: ReturnType<typeof usePhone>): number {
  if (app === 'chat') {
    const read = new Set(p.events.filter((e) => e.type === 'chat.read').map((e) => String(e.contact)));
    return (p.spec.world.chat?.threads ?? []).filter((t) => !read.has(t.contact)).reduce((n, t) => n + (t.unread ?? 0), 0);
  }
  if (app === 'sms') {
    // Messages that arrived since the app was last opened.
    let n = 0;
    for (const e of p.events) {
      if (e.type === 'sms') n++;
      else if (e.type === 'app.open' && e.app === 'sms') n = 0;
    }
    return p.current === 'sms' ? 0 : n;
  }
  return 0;
}

function HomeScreen() {
  const p = usePhone();
  const scenarioApps = new Set(p.spec.apps);
  return (
    <div className="ph-home" data-testid="phone-home">
      <div className="ph-home-widget">
        <div className="ph-home-clock">{p.clock.time}</div>
        <div className="ph-home-date">
          {zhMonthDay(p.clock.date)} {zhWeekdayLong(p.clock.date)}
        </div>
      </div>
      <div className="ph-home-grid">
        {HOME_SCREEN_ORDER.map((app) => (
          <button key={app} type="button" className={`ph-home-app${scenarioApps.has(app) ? ' ph-home-app-task' : ''}`} onClick={() => p.openApp(app)} data-testid={`home-app-${app}`}>
            <AppIcon app={app} badge={unreadFor(app, p)} />
            <span>{PHONE_APPS[app].name}</span>
          </button>
        ))}
        {(['相机', '图库', '设置', '日历'] as const).map((name, i) => (
          <button key={name} type="button" className="ph-home-app ph-home-app-dim" onClick={() => p.toast('本次练习不需要这个应用')}>
            <span className="ph-icon" style={{ background: ['#596275', '#e77f67', '#8395a7', '#f8a5c2'][i] }}>
              {['◉', '▣', '⚙', '历'][i]}
            </span>
            <span>{name}</span>
          </button>
        ))}
      </div>
      <div className="ph-dock">
        {DOCK_ORDER.map((app) => (
          <button key={app} type="button" className="ph-home-app" onClick={() => p.openApp(app)} data-testid={`home-app-${app}`} aria-label={PHONE_APPS[app].name}>
            <AppIcon app={app} badge={unreadFor(app, p)} />
          </button>
        ))}
      </div>
    </div>
  );
}

function AppView({ app }: { app: PhoneAppId }) {
  const p = usePhone();
  const stack = p.stacks[app] ?? [];
  const Comp = APP_COMPONENTS[app];
  const visible = p.current === app;
  return (
    <div className={`ph-app ph-app-${app}`} hidden={!visible} data-testid={`app-${app}`} style={{ ['--accent' as string]: PHONE_APPS[app].accent }}>
      {stack.map((screen, i) => (
        <div key={screen.key} className={`ph-layer${i === stack.length - 1 ? ' ph-layer-top' : ''}${i > 0 ? ' ph-layer-pushed' : ''}`} hidden={i !== stack.length - 1} data-screen={screen.name}>
          <Comp screen={screen} />
        </div>
      ))}
    </div>
  );
}

function Banners() {
  const p = usePhone();
  if (p.notifications.length === 0) return null;
  return (
    <div className="ph-banners">
      {p.notifications.slice(0, 2).map((n) => (
        <button
          key={n.id}
          type="button"
          className="ph-banner"
          data-testid="phone-notification"
          onClick={() => {
            p.dismissNotification(n.id);
            p.emit({ type: 'notification.open', app: n.app });
            if (n.open) p.openApp(n.open.app, n.open.screen, n.open.params);
          }}
        >
          <AppIcon app={n.app} size="small" />
          <span className="ph-banner-text">
            <span className="ph-banner-head">
              <b>{n.title}</b>
              <small>现在</small>
            </span>
            <span className="ph-banner-body">{n.body}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Recents({ onClose }: { onClose: () => void }) {
  const p = usePhone();
  return (
    <div className="ph-recents" onClick={onClose} data-testid="phone-recents">
      {p.recents.length === 0 ? (
        <div className="ph-recents-empty">近期没有使用的应用</div>
      ) : (
        <div className="ph-recents-row">
          {p.recents.map((app) => (
            <button
              key={app}
              type="button"
              className="ph-recents-card"
              onClick={(e) => {
                e.stopPropagation();
                p.openApp(app);
                onClose();
              }}
            >
              <span className="ph-recents-head">
                <AppIcon app={app} size="small" />
                {PHONE_APPS[app].name}
              </span>
              <span className="ph-recents-shot" style={{ background: `linear-gradient(180deg, ${PHONE_APPS[app].colors[0]}22, #fff)` }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PhoneShell(props: { onWord: (item: ExplorerItem) => void; onTask: () => void; onHint: () => void; hintBadge?: boolean; side?: ReactNode; overlay?: ReactNode }) {
  const p = usePhone();
  const display = useRef<HTMLDivElement>(null);
  const [recents, setRecents] = useState(false);
  useLongPressWords(display, props.onWord);
  return (
    <div className="ph-stage">
      {props.side}
      <div className="ph-frame" data-testid="phone-frame">
        <div className="ph-display" ref={display} lang="zh-CN">
          <StatusBar />
          <div className="ph-screen">
            <HomeScreen />
            {p.recents.map((app) => (
              <AppView key={app} app={app} />
            ))}
            {recents && <Recents onClose={() => setRecents(false)} />}
          </div>
          <Banners />
          {p.toastText && (
            <div className="ph-toast" role="status" data-testid="phone-toast">
              {p.toastText}
            </div>
          )}
          <PaySheet />
          {props.overlay}
          <nav className="ph-nav" aria-label="手机导航" data-no-explore>
            <button type="button" className="ph-nav-aid" onClick={props.onTask} aria-label="Task" data-testid="phone-task-button">
              📋
            </button>
            <button type="button" onClick={() => (recents ? setRecents(false) : p.back())} aria-label="返回" data-testid="phone-back">
              ◁
            </button>
            <button
              type="button"
              onClick={() => {
                setRecents(false);
                p.goHome();
              }}
              aria-label="主屏幕"
              data-testid="phone-home-button"
            >
              ○
            </button>
            <button type="button" onClick={() => setRecents((v) => !v)} aria-label="最近任务" data-testid="phone-recents-button">
              ▢
            </button>
            <button type="button" className={`ph-nav-aid${props.hintBadge ? ' ph-nav-aid-dot' : ''}`} onClick={props.onHint} aria-label="Hint" data-testid="phone-hint-button">
              💡
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
