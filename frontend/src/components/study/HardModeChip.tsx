import { useEffect, useRef, useState } from 'react';
import {
  HARD_MODES, HARD_MODE_CHIP, HARD_MODE_OPTION, HARD_MODE_OPTION_HINT, HARD_MODE_TITLE, hardModeChipLabel, type HardMode,
} from '@shared/study/hardMode';
import { PASS_HARD_MODE_OPTION, PASS_HARD_MODE_OPTION_HINT, PASS_HARD_MODE_TITLE, passHardModeChipLabel } from '@shared/homework/pass-angles';
import { useHardMode, usePassHardMode, writeHardMode, writePassHardMode } from '../../services/hardModePrefs';
import { track } from '../../services/analytics';
import './HardModeChip.css';

/**
 * The study session's header chip (docs/STUDY_SESSION.md "Hard mode"): 🎯 Off / Red / All — a tap opens
 * a tiny menu with the three choices, so Hard mode goes off in one more tap when he just wants to get
 * through homework, and "Red cards only" is right there. Per device (services/hardModePrefs.ts); the
 * card on screen follows at once.
 *
 * `pass`: the homework pass's own chip (shared/homework/pass-angles.ts, docs/HOMEWORK.md §3e) — the same
 * chip over the pass's setting (All words · Words I miss · Off; default All), the session's untouched.
 */
export function HardModeChip({ pass = false }: { pass?: boolean }) {
  const sessionMode = useHardMode();
  const passMode = usePassHardMode();
  const mode = pass ? passMode : sessionMode;
  const option = pass ? PASS_HARD_MODE_OPTION : HARD_MODE_OPTION;
  const hint = pass ? PASS_HARD_MODE_OPTION_HINT : HARD_MODE_OPTION_HINT;
  const label = pass ? passHardModeChipLabel(mode) : hardModeChipLabel(mode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const choose = (next: HardMode) => {
    setOpen(false);
    if (next === mode) return;
    if (pass) {
      writePassHardMode(next);
      track('homework.pass_hard_mode', { mode: next, where: 'header' });
      return;
    }
    writeHardMode(next);
    track('study.hard_mode', { action: 'set', mode: next, where: 'header' });
  };
  return (
    <div className="hard-mode-chip-wrap" ref={ref}>
      <button
        type="button"
        className={`hard-mode-chip hard-mode-chip--${mode}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="hard-mode-chip"
        data-mode={mode}
      >
        {/* "🎯 Red"; in a tight header (.study-topbar--fit-N) only 🎯 and the state as a dot. */}
        <span className="hard-mode-chip-icon" aria-hidden="true">{HARD_MODE_CHIP[mode].slice(0, HARD_MODE_CHIP[mode].indexOf(' '))}</span>
        <span className="hard-mode-chip-text">{HARD_MODE_CHIP[mode].slice(HARD_MODE_CHIP[mode].indexOf(' '))}</span>
        <span className="hard-mode-chip-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="hard-mode-menu" role="menu" aria-label={pass ? PASS_HARD_MODE_TITLE : HARD_MODE_TITLE} data-testid="hard-mode-menu">
          <div className="hard-mode-menu-title">🎯 {pass ? PASS_HARD_MODE_TITLE : HARD_MODE_TITLE}</div>
          {HARD_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              className={`hard-mode-option${m === mode ? ' is-on' : ''}`}
              onClick={() => choose(m)}
              data-testid={`hard-mode-option-${m}`}
            >
              <span className="hard-mode-option-check" aria-hidden="true">{m === mode ? '✓' : ''}</span>
              <span className="hard-mode-option-text">
                <span className="hard-mode-option-name">{option[m]}</span>
                <span className="hard-mode-option-hint">{hint[m]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
