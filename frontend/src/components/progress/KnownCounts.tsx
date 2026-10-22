import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  weekDayLabel, weekLabel, signedCount, paceLabel, paceTrendLabel,
  type KnownProgress, type KnownPoint, type KnownCounts, type KnownRate, type KnownChartMode, type SeriesPace, type WeekGain,
} from '@shared/progress';
import {
  cachedKnownProgress, loadKnownProgress, loadKnownChartMode, saveKnownChartMode,
} from '../../services/knownProgress';
import { track } from '../../services/analytics';
import './KnownCounts.css';

/**
 * "Characters known" / "Words known" on the Progress page, with their history — computed on
 * the device from the local notes, cards and review events (shared/progress/known.ts), so
 * it works offline and needs no server round trip. The last result shows at once; the
 * fresh one replaces it when the worker is done.
 */
export function KnownCountsSection() {
  const query = useQuery({
    queryKey: ['knownProgress'],
    queryFn: () => loadKnownProgress(),
    networkMode: 'always',
    staleTime: 60_000,
    initialData: cachedKnownProgress,
    initialDataUpdatedAt: 0,
  });
  const [explain, setExplain] = useState(false);

  if (query.isLoading) {
    return (
      <section className="known-section" aria-busy="true">
        <KnownHeader explain={explain} onToggle={() => setExplain(!explain)} />
        <div className="known-tiles">
          <div className="known-tile known-tile--loading" />
          <div className="known-tile known-tile--loading" />
        </div>
      </section>
    );
  }
  if (!query.data) return null;
  return <KnownCountsView data={query.data} explain={explain} onToggleExplain={() => setExplain(!explain)} />;
}

function KnownHeader({ explain, onToggle }: { explain: boolean; onToggle: () => void }) {
  return (
    <div className="known-header">
      <h2>Characters &amp; words</h2>
      <button
        type="button"
        className="known-help"
        aria-expanded={explain}
        aria-label="What do these numbers mean?"
        onClick={onToggle}
      >
        ?
      </button>
    </div>
  );
}

export function KnownCountsView({ data, explain, onToggleExplain, initialMode, tzOffsetMinutes }: {
  data: KnownProgress & { rate?: KnownRate };
  explain: boolean;
  onToggleExplain: () => void;
  /** Tests / screenshots; otherwise the mode remembered on this device. */
  initialMode?: KnownChartMode;
  /** Minutes east of UTC for the week labels (defaults to this device's). */
  tzOffsetMinutes?: number;
}) {
  const [mode, setMode] = useState<KnownChartMode>(() => initialMode ?? loadKnownChartMode());
  const rate = data.rate && data.rate.weeks.length > 0 ? data.rate : null;
  const showChart = data.history.length >= 2;
  const choose = (next: KnownChartMode) => {
    if (next === mode) return;
    setMode(next);
    saveKnownChartMode(next);
    track('progress.known_mode', { mode: next });
  };
  const offset = tzOffsetMinutes ?? -new Date().getTimezoneOffset();
  return (
    <section className="known-section">
      <KnownHeadline counts={data} explain={explain} onToggleExplain={onToggleExplain} />
      {showChart && rate && <KnownModeToggle mode={mode} onChange={choose} />}
      {showChart && (mode === 'rate' && rate
        ? <KnownRateView rate={rate} tzOffsetMinutes={offset} />
        : <KnownChart history={data.history} />)}
      {data.recent_characters.length > 0 && (
        <div className="known-recent">
          <h3>Newest known characters</h3>
          <div className="known-recent-list">
            {data.recent_characters.map((c) => (
              <span key={c.char} className="known-char" title={`Known since ${shortDate(Date.parse(c.known_at))}`}>
                {c.char}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type HeadlineCounts = Pick<KnownProgress, 'characters' | 'words' | 'sentences'>;

/** Header with "?", the two tiles and the sentences line — also on the tutor's student page. */
export function KnownHeadline({ counts, explain, onToggleExplain, subject = 'you' }: {
  counts: HeadlineCounts;
  explain: boolean;
  onToggleExplain: () => void;
  /** Whose numbers: "you" on your own page, "they" on a tutor's student page. */
  subject?: 'you' | 'they';
}) {
  const have = subject === 'you' ? 'you\u2019ve' : 'they\u2019ve';
  return (
    <>
      <KnownHeader explain={explain} onToggle={onToggleExplain} />
      {explain && (
        <p className="known-explain">
          <strong>Known</strong> = {have} remembered it for 3+ weeks: at least one of its cards is
          in review with a memory stability over 21 days. <strong>Learning</strong> = {have} started
          it but it isn&rsquo;t there yet. A <strong>word</strong> is a card of 1–4 characters
          without punctuation (longer cards count as sentences). A <strong>character</strong> is known
          when it appears in any known card, word or sentence.
        </p>
      )}
      <div className="known-tiles">
        <KnownTile value={counts.characters} label="Characters known" />
        <KnownTile value={counts.words} label="Words known" />
      </div>
      {counts.sentences.known + counts.sentences.learning > 0 && (
        <p className="known-sentences">
          Plus {counts.sentences.known} {counts.sentences.known === 1 ? 'sentence' : 'sentences'} known
          {counts.sentences.learning > 0 && ` · ${counts.sentences.learning} learning`}
        </p>
      )}
    </>
  );
}

function KnownTile({ value, label }: { value: KnownCounts; label: string }) {
  return (
    <div className="known-tile">
      <div className="known-value">{value.known.toLocaleString('en-US')}</div>
      <div className="known-label">{label}</div>
      <div className="known-learning">+{value.learning.toLocaleString('en-US')} learning</div>
    </div>
  );
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A round axis maximum (1, 2, 5 × 10ⁿ steps) at or above `max`. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= max) return m * pow;
  }
  return 10 * pow;
}

const W = 340;
const H = 168;
const PAD = { left: 36, right: 44, top: 12, bottom: 22 };

/** Known characters and words over time: two 2px lines on one count axis, tap / hover for a day. */
export function KnownChart({ history }: { history: KnownPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const geo = useMemo(() => {
    const max = niceMax(Math.max(...history.map((h) => Math.max(h.characters.known, h.words.known))));
    const t0 = history[0].at_ms;
    const t1 = history[history.length - 1].at_ms;
    const x = (ms: number) => PAD.left + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
    const path = (pick: (p: KnownPoint) => number) =>
      history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at_ms).toFixed(1)},${y(pick(p)).toFixed(1)}`).join('');
    return {
      max, x, y,
      chars: path((p) => p.characters.known),
      words: path((p) => p.words.known),
      ticks: [0, max / 2, max],
    };
  }, [history]);

  const last = history[history.length - 1];
  const pick = (clientX: number, rect: DOMRect) => {
    const sx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    history.forEach((p, i) => {
      const d = Math.abs(geo.x(p.at_ms) - sx);
      if (d < bestD) { bestD = d; best = i; }
    });
    setActive(best);
  };
  const shown = active == null ? null : history[active];

  // Keep the two end labels apart when the lines end close together.
  let charLabelY = geo.y(last.characters.known);
  let wordLabelY = geo.y(last.words.known);
  if (Math.abs(charLabelY - wordLabelY) < 12) {
    if (charLabelY <= wordLabelY) wordLabelY = charLabelY + 12;
    else charLabelY = wordLabelY + 12;
  }

  return (
    <figure className="known-chart">
      <figcaption className="known-legend">
        <span><i className="known-swatch known-swatch--chars" />Characters</span>
        <span><i className="known-swatch known-swatch--words" />Words</span>
        <span className="known-legend-note">known, over time</span>
      </figcaption>
      <div className="known-chart-frame">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Known characters rose to ${last.characters.known} and known words to ${last.words.known} by ${longDate(last.at_ms)}`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
        >
          {geo.ticks.map((t) => (
            <g key={t}>
              <line className="known-grid" x1={PAD.left} x2={W - PAD.right} y1={geo.y(t)} y2={geo.y(t)} />
              <text className="known-axis" x={PAD.left - 6} y={geo.y(t) + 3.5} textAnchor="end">
                {t.toLocaleString('en-US')}
              </text>
            </g>
          ))}
          <text className="known-axis" x={PAD.left} y={H - 6} textAnchor="start">{shortDate(history[0].at_ms)}</text>
          <text className="known-axis" x={W - PAD.right} y={H - 6} textAnchor="end">Today</text>
          <path className="known-line known-line--words" d={geo.words} />
          <path className="known-line known-line--chars" d={geo.chars} />
          <circle className="known-end known-end--words" cx={geo.x(last.at_ms)} cy={geo.y(last.words.known)} r={4} />
          <circle className="known-end known-end--chars" cx={geo.x(last.at_ms)} cy={geo.y(last.characters.known)} r={4} />
          <text className="known-end-label" x={geo.x(last.at_ms) + 8} y={charLabelY + 4}>{last.characters.known}</text>
          <text className="known-end-label" x={geo.x(last.at_ms) + 8} y={wordLabelY + 4}>{last.words.known}</text>
          {shown && (
            <g pointerEvents="none">
              <line className="known-crosshair" x1={geo.x(shown.at_ms)} x2={geo.x(shown.at_ms)} y1={PAD.top} y2={H - PAD.bottom} />
              <circle className="known-end known-end--words" cx={geo.x(shown.at_ms)} cy={geo.y(shown.words.known)} r={4} />
              <circle className="known-end known-end--chars" cx={geo.x(shown.at_ms)} cy={geo.y(shown.characters.known)} r={4} />
            </g>
          )}
        </svg>
        {shown && (
          <div
            className="known-tooltip"
            // Kept inside the card at the ends of the chart (no sideways page scroll on a phone).
            style={{ left: `${Math.min(78, Math.max(22, (geo.x(shown.at_ms) / W) * 100))}%` }}
            role="status"
          >
            <div className="known-tooltip-date">{longDate(shown.at_ms)}</div>
            <div><i className="known-swatch known-swatch--chars" />{shown.characters.known} characters</div>
            <div><i className="known-swatch known-swatch--words" />{shown.words.known} words</div>
          </div>
        )}
      </div>
    </figure>
  );
}

/** "Total | Per week" — which view of the chart, remembered on this device. */
function KnownModeToggle({ mode, onChange }: { mode: KnownChartMode; onChange: (m: KnownChartMode) => void }) {
  const options: { id: KnownChartMode; label: string }[] = [
    { id: 'total', label: 'Total' },
    { id: 'rate', label: 'Per week' },
  ];
  return (
    <div className="known-mode" role="group" aria-label="Chart shows">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`known-mode-option${mode === o.id ? ' selected' : ''}`}
          aria-pressed={mode === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Per week: the pace of the last 4 weeks (vs the 4 before) and the weekly bars. */
export function KnownRateView({ rate, tzOffsetMinutes }: { rate: KnownRate; tzOffsetMinutes: number }) {
  return (
    <figure className="known-chart known-rate">
      <div className="known-pace">
        {rate.pace ? (
          <>
            <div className="known-pace-caption">Lately (last 4 weeks)</div>
            <PaceLine pace={rate.pace.words} noun="words" />
            <PaceLine pace={rate.pace.characters} noun="characters" />
          </>
        ) : (
          <div className="known-pace-caption">Your pace shows after 4 weeks of reviews.</div>
        )}
      </div>
      <KnownRateChart weeks={rate.weeks} tzOffsetMinutes={tzOffsetMinutes} />
    </figure>
  );
}

function PaceLine({ pace, noun }: { pace: SeriesPace; noun: 'characters' | 'words' }) {
  const trend = paceTrendLabel(pace);
  return (
    <div className="known-pace-line">
      <i className={`known-swatch known-swatch--${noun === 'words' ? 'words' : 'chars'}`} />
      <span className="known-pace-value">{paceLabel(pace.per_week, noun)}</span>
      {trend && (
        <span className={`known-pace-trend known-pace-trend--${pace.trend}`} title="vs the 4 weeks before">
          {trend}
        </span>
      )}
    </div>
  );
}

const RW = 340;
const RPAD = { left: 36, right: 8, top: 18, bottom: 22 };
const PANEL_H = 72;
const PANEL_GAP = 22;
const RH = RPAD.top + PANEL_H * 2 + PANEL_GAP + RPAD.bottom;

/**
 * Newly known per week as two small multiples on ONE count scale (characters above, words
 * below), a bar per week, a zero line for the weeks that went down; tap / hover a week.
 */
export function KnownRateChart({ weeks, tzOffsetMinutes }: { weeks: WeekGain[]; tzOffsetMinutes: number }) {
  const [active, setActive] = useState<number | null>(null);
  const geo = useMemo(() => {
    const values = weeks.flatMap((w) => [w.characters, w.words]);
    const top = niceMax(Math.max(0, ...values));
    const lowest = Math.min(0, ...values);
    // A week that went down gets room below the zero line: at least a quarter of the top, so
    // a small dip is visible and its axis label clears the 0.
    const bottom = lowest < 0 ? -niceMax(Math.max(-lowest, top / 4)) : 0;
    const span = top - bottom;
    const plotW = RW - RPAD.left - RPAD.right;
    const slot = plotW / weeks.length;
    const barW = Math.max(1, Math.min(16, slot - 2));
    const panelTop = (k: number) => RPAD.top + k * (PANEL_H + PANEL_GAP);
    const y = (k: number, v: number) => panelTop(k) + ((top - v) / span) * PANEL_H;
    const cx = (i: number) => RPAD.left + slot * (i + 0.5);
    return { top, bottom, slot, barW, panelTop, y, cx };
  }, [weeks]);

  const pick = (clientX: number, rect: DOMRect) => {
    const sx = ((clientX - rect.left) / rect.width) * RW;
    const i = Math.floor((sx - RPAD.left) / geo.slot);
    setActive(Math.min(weeks.length - 1, Math.max(0, i)));
  };
  const shown = active == null ? null : weeks[active];
  const last = weeks[weeks.length - 1];
  const panels: { key: 'characters' | 'words'; label: string; cls: string }[] = [
    { key: 'characters', label: 'Characters', cls: 'chars' },
    { key: 'words', label: 'Words', cls: 'words' },
  ];
  const ticks = geo.bottom < 0 ? [geo.top, 0, geo.bottom] : [geo.top, 0];

  return (
    <>
      <figcaption className="known-legend">
        <span><i className="known-swatch known-swatch--chars" />Characters</span>
        <span><i className="known-swatch known-swatch--words" />Words</span>
        <span className="known-legend-note">newly known, per week</span>
      </figcaption>
      <div className="known-chart-frame">
        <svg
          viewBox={`0 0 ${RW} ${RH}`}
          role="img"
          aria-label={`Newly known per week. This week so far: ${signedCount(last.characters)} characters, ${signedCount(last.words)} words`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
        >
          {shown && active != null && (
            <rect
              className="known-rate-band"
              x={geo.cx(active) - geo.slot / 2}
              width={geo.slot}
              y={RPAD.top - 14}
              height={PANEL_H * 2 + PANEL_GAP + 14}
              rx={3}
            />
          )}
          {panels.map((panel, k) => (
            <g key={panel.key}>
              <text className="known-rate-panel" x={RPAD.left} y={geo.panelTop(k) - 6}>{panel.label}</text>
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    className={t === 0 ? 'known-zero' : 'known-grid'}
                    x1={RPAD.left} x2={RW - RPAD.right} y1={geo.y(k, t)} y2={geo.y(k, t)}
                  />
                  <text className="known-axis" x={RPAD.left - 6} y={geo.y(k, t) + 3.5} textAnchor="end">
                    {t < 0 ? `−${(-t).toLocaleString('en-US')}` : t.toLocaleString('en-US')}
                  </text>
                </g>
              ))}
              {weeks.map((w, i) => {
                const v = w[panel.key];
                if (v === 0) return null;
                const y0 = geo.y(k, 0);
                const y1 = geo.y(k, v);
                return (
                  <rect
                    key={w.start_ms}
                    className={`known-bar known-bar--${panel.cls}${w.partial ? ' known-bar--partial' : ''}${v < 0 ? ' known-bar--down' : ''}`}
                    x={geo.cx(i) - geo.barW / 2}
                    width={geo.barW}
                    y={Math.min(y0, y1)}
                    height={Math.max(2, Math.abs(y1 - y0))}
                    rx={Math.min(2, geo.barW / 2)}
                  />
                );
              })}
            </g>
          ))}
          <text className="known-axis" x={RPAD.left} y={RH - 6} textAnchor="start">
            {weekDayLabel(weeks[0].start_ms, tzOffsetMinutes)}
          </text>
          <text className="known-axis" x={RW - RPAD.right} y={RH - 6} textAnchor="end">This week</text>
        </svg>
        {shown && active != null && (
          <div
            className="known-tooltip"
            style={{ left: `${Math.min(74, Math.max(26, (geo.cx(active) / RW) * 100))}%` }}
            role="status"
          >
            <div className="known-tooltip-date">{weekLabel(shown, tzOffsetMinutes)}</div>
            <div><i className="known-swatch known-swatch--chars" />{signedCount(shown.characters)} characters</div>
            <div><i className="known-swatch known-swatch--words" />{signedCount(shown.words)} words</div>
          </div>
        )}
      </div>
    </>
  );
}
