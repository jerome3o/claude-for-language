/**
 * 📱 Phone practice (docs/PHONE_PRACTICE.md): the list of tasks, grouped by app, easy → hard,
 * with this device's status (done, best time, in progress). Plays are kept on the device only.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUNDLED_SCENARIOS, formatDuration, PHONE_APPS, type PhoneAppId } from '@shared/phone';
import { scenarioStatuses, type ScenarioStatus } from '../services/phonePractice';
import { track } from '../services/analytics';
import { AppIcon } from '../phone/AppIcon';
import '../phone/phone.css';

const ORDER: PhoneAppId[] = ['rail', 'ride', 'food', 'chat', 'movie', 'dine'];
const LEVEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function PhonePracticePage() {
  const [status, setStatus] = useState<Record<string, ScenarioStatus>>({});
  useEffect(() => {
    let live = true;
    void scenarioStatuses().then((s) => {
      if (!live) return;
      setStatus(s);
      track('phone.open', { scenarios: BUNDLED_SCENARIOS.length, done: Object.values(s).filter((x) => x.done).length });
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="container phone-list" data-testid="phone-practice-page">
      <h1>📱 Phone practice</h1>
      <p className="phone-list-intro">
        Real-life tasks on a simulated Chinese phone — book a train, call a car, order lunch, pay a friend back. The apps are made up, but their screens, words and steps work like the
        real ones. Long-press any Chinese to look it up; 💡 shows the next step.
      </p>
      {ORDER.map((app) => {
        const list = BUNDLED_SCENARIOS.filter((s) => s.apps[0] === app);
        if (list.length === 0) return null;
        return (
          <section key={app} className="phone-list-app">
            <h2>
              <AppIcon app={app} size="small" />
              <span>
                {PHONE_APPS[app].name}
                <small>{PHONE_APPS[app].kind_en}</small>
              </span>
            </h2>
            {list.map((s) => {
              const st = status[s.id];
              return (
                <Link key={s.id} to={`/phone/${s.id}`} className="phone-list-row" data-testid="phone-scenario" data-scenario={s.id}>
                  <span className="phone-list-main">
                    <b>{s.title.en}</b>
                    <small lang="zh-CN">{s.title.zh}</small>
                  </span>
                  <span className="phone-list-side">
                    <span className={`ph-level ph-level-${s.difficulty}`}>{LEVEL[s.difficulty]}</span>
                    <small>
                      {st?.done ? `✓ Done${st.best_ms ? ` · best ${formatDuration(st.best_ms)}` : ''}` : st?.in_progress ? 'In progress' : `~${s.minutes ?? 5} min`}
                    </small>
                  </span>
                </Link>
              );
            })}
          </section>
        );
      })}
      <p className="phone-list-note">Your plays are saved on this device only. App names, shops, drivers and banks are all fictional.</p>
    </div>
  );
}
