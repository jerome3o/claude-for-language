/**
 * Building blocks of the simulated apps: the top bar, list cells, buttons, bottom sheets,
 * dialogs, steppers, tabs, text fields with the voice input 🎤 the real apps have, stars.
 * Every string inside them is Chinese (the simulated UI never shows English).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ZH } from '@shared/phone/copy';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import { useBackHandler, usePhone } from './runtime';

export function AppBar(props: { title: ReactNode; onBack?: () => void; right?: ReactNode; tone?: 'light' | 'accent'; accent?: string; testId?: string }) {
  const accent = props.tone === 'accent';
  return (
    <div className={`ph-bar${accent ? ' ph-bar-accent' : ''}`} style={accent ? { background: props.accent } : undefined} data-testid={props.testId}>
      <div className="ph-bar-side">
        {props.onBack && (
          <button type="button" className="ph-bar-back" aria-label={ZH.back} onClick={props.onBack}>
            ‹
          </button>
        )}
      </div>
      <div className="ph-bar-title">{props.title}</div>
      <div className="ph-bar-side ph-bar-right">{props.right}</div>
    </div>
  );
}

export function Body(props: { children: ReactNode; className?: string; style?: CSSProperties; testId?: string }) {
  return (
    <div className={`ph-body ${props.className ?? ''}`} style={props.style} data-testid={props.testId}>
      {props.children}
    </div>
  );
}

export function Btn(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'line' | 'ghost' | 'grey';
  accent?: string;
  disabled?: boolean;
  block?: boolean;
  small?: boolean;
  testId?: string;
  style?: CSSProperties;
}) {
  const kind = props.kind ?? 'primary';
  const style: CSSProperties = { ...(props.style ?? {}) };
  if (props.accent && kind === 'primary') style.background = props.accent;
  if (props.accent && kind === 'line') {
    style.color = props.accent;
    style.borderColor = props.accent;
  }
  return (
    <button
      type="button"
      className={`ph-btn ph-btn-${kind}${props.block ? ' ph-btn-block' : ''}${props.small ? ' ph-btn-small' : ''}`}
      style={style}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  );
}

export function Cell(props: { label: ReactNode; value?: ReactNode; sub?: ReactNode; onClick?: () => void; arrow?: boolean; testId?: string; icon?: ReactNode }) {
  const content = (
    <>
      {props.icon && <span className="ph-cell-icon">{props.icon}</span>}
      <span className="ph-cell-main">
        <span className="ph-cell-label">{props.label}</span>
        {props.sub && <span className="ph-cell-sub">{props.sub}</span>}
      </span>
      {props.value !== undefined && <span className="ph-cell-value">{props.value}</span>}
      {(props.arrow ?? !!props.onClick) && <span className="ph-cell-arrow">›</span>}
    </>
  );
  return props.onClick ? (
    <button type="button" className="ph-cell" onClick={props.onClick} data-testid={props.testId}>
      {content}
    </button>
  ) : (
    <div className="ph-cell" data-testid={props.testId}>
      {content}
    </div>
  );
}

export function Group(props: { title?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="ph-group" data-testid={props.testId}>
      {props.title && <div className="ph-group-title">{props.title}</div>}
      {props.children}
    </div>
  );
}

/** A bottom sheet over the current screen; back closes it. */
export function Sheet(props: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; testId?: string; tall?: boolean }) {
  useBackHandler(props.open, props.onClose);
  if (!props.open) return null;
  return (
    <div className="ph-sheet-scrim" onClick={props.onClose}>
      <div className={`ph-sheet${props.tall ? ' ph-sheet-tall' : ''}`} onClick={(e) => e.stopPropagation()} data-testid={props.testId} role="dialog">
        {props.title && (
          <div className="ph-sheet-head">
            <span className="ph-sheet-title">{props.title}</span>
            <button type="button" className="ph-sheet-x" aria-label={ZH.cancel} onClick={props.onClose}>
              ✕
            </button>
          </div>
        )}
        <div className="ph-sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

export function Dialog(props: { open: boolean; title?: ReactNode; children?: ReactNode; actions: Array<{ label: string; onClick: () => void; primary?: boolean; testId?: string }>; onClose?: () => void; testId?: string }) {
  useBackHandler(props.open, props.onClose ?? (() => {}));
  if (!props.open) return null;
  return (
    <div className="ph-dialog-scrim">
      <div className="ph-dialog" role="alertdialog" data-testid={props.testId}>
        {props.title && <div className="ph-dialog-title">{props.title}</div>}
        {props.children && <div className="ph-dialog-body">{props.children}</div>}
        <div className="ph-dialog-actions">
          {props.actions.map((a) => (
            <button key={a.label} type="button" className={`ph-dialog-btn${a.primary ? ' ph-dialog-primary' : ''}`} onClick={a.onClick} data-testid={a.testId}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Stepper(props: { value: number; min?: number; max?: number; onChange: (n: number) => void; testId?: string }) {
  const min = props.min ?? 0;
  const max = props.max ?? 99;
  return (
    <span className="ph-stepper" data-testid={props.testId}>
      <button type="button" aria-label="减少" disabled={props.value <= min} onClick={() => props.onChange(Math.max(min, props.value - 1))}>
        −
      </button>
      <span className="ph-stepper-n">{props.value}</span>
      <button type="button" aria-label="增加" disabled={props.value >= max} onClick={() => props.onChange(Math.min(max, props.value + 1))}>
        ＋
      </button>
    </span>
  );
}

export function Tabs<T extends string>(props: { items: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void; accent?: string; testId?: string }) {
  return (
    <div className="ph-tabs" role="tablist" data-testid={props.testId}>
      {props.items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={props.value === t.id}
          className={`ph-tab${props.value === t.id ? ' ph-tab-on' : ''}`}
          style={props.value === t.id && props.accent ? { color: props.accent, borderColor: props.accent } : undefined}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chip(props: { children: ReactNode; on?: boolean; onClick?: () => void; accent?: string; disabled?: boolean; testId?: string }) {
  const style: CSSProperties | undefined = props.on && props.accent ? { borderColor: props.accent, color: props.accent, background: `${props.accent}14` } : undefined;
  return (
    <button type="button" className={`ph-chip${props.on ? ' ph-chip-on' : ''}`} style={style} onClick={props.onClick} disabled={props.disabled} data-testid={props.testId} aria-pressed={props.on}>
      {props.children}
    </button>
  );
}

export function Stars(props: { value: number; size?: number }) {
  const full = Math.round(props.value * 2) / 2;
  return (
    <span className="ph-stars" style={{ fontSize: props.size ? `${props.size}px` : undefined }} aria-label={`${props.value}分`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= full ? 'ph-star-on' : i - 0.5 === full ? 'ph-star-half' : 'ph-star-off'}>
          ★
        </span>
      ))}
    </span>
  );
}

/** The 🎤 of a search box / chat input: dictation into the field (zh), the live words over the phone. */
export function PhoneMic(props: { onText: (text: string) => void; testId?: string; label?: string }) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(false);
  const p = usePhone();
  const d = useVoiceDictation({
    surface: 'phone',
    value,
    onChange: setValue,
    onSubmit: (a) => {
      setActive(false);
      setValue('');
      if (a.text.trim()) props.onText(a.text.trim());
    },
    defaultMode: 'voice',
    lang: 'zh',
    autoSubmit: true,
  });
  useBackHandler(active, () => {
    d.cancel();
    setActive(false);
  });
  useEffect(() => {
    if (!active) return;
    if (d.state.phase === 'failed') {
      p.toast('没听清，请再说一遍');
      setActive(false);
    }
  }, [active, d.state.phase, p]);
  const host = typeof document !== 'undefined' ? document.querySelector('.ph-display') : null;
  return (
    <>
      <button
        type="button"
        className="ph-mic"
        aria-label={props.label ?? '语音输入'}
        data-testid={props.testId}
        onClick={() => {
          if (d.state.blocked) {
            p.toast(d.state.blocked === 'offline' ? '网络不可用，语音输入暂时无法使用' : '无法使用麦克风，请检查权限设置');
            return;
          }
          setActive(true);
          d.say();
        }}
      >
        🎤
      </button>
      {active &&
        host &&
        createPortal(
          <div className="ph-voice" data-testid="phone-voice">
            <div className="ph-voice-card">
              <div className="ph-voice-wave" style={{ transform: `scale(${1 + Math.min(1, d.level) * 0.6})` }}>🎤</div>
              <div className="ph-voice-text">
                {d.finalText || d.partialText ? (
                  <>
                    {d.finalText}
                    <span className="ph-voice-partial">{d.partialText}</span>
                  </>
                ) : d.state.phase === 'finishing' ? (
                  '识别中…'
                ) : (
                  ZH.voiceListening
                )}
              </div>
              <div className="ph-voice-actions">
                <button
                  type="button"
                  onClick={() => {
                    d.cancel();
                    setActive(false);
                  }}
                >
                  {ZH.cancel}
                </button>
                <button type="button" className="ph-voice-stop" onClick={() => d.stop()} disabled={!d.listening}>
                  {ZH.voiceTapToStop}
                </button>
              </div>
            </div>
          </div>,
          host,
        )}
    </>
  );
}

export function SearchBox(props: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; mic?: boolean; onSubmit?: () => void; testId?: string; accent?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus({ preventScroll: true });
  }, [props.autoFocus]);
  return (
    <div className="ph-search">
      <span className="ph-search-icon">🔍</span>
      <input
        ref={ref}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onSubmit?.();
        }}
        data-testid={props.testId}
        lang="zh-CN"
        enterKeyHint="search"
      />
      {props.value && (
        <button type="button" className="ph-search-clear" aria-label="清除" onClick={() => props.onChange('')}>
          ⊗
        </button>
      )}
      {props.mic && <PhoneMic onText={(t) => props.onChange(t.replace(/[。，！？.!?]$/u, ''))} testId={props.testId ? `${props.testId}-mic` : undefined} />}
    </div>
  );
}

export function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: 'text' | 'tel' | 'number'; testId?: string; mic?: boolean; right?: ReactNode; maxLength?: number }) {
  return (
    <label className="ph-field">
      <span className="ph-field-label">{props.label}</span>
      <input
        className="ph-field-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? ZH.inputPlaceholder}
        type={props.type === 'number' ? 'text' : props.type ?? 'text'}
        inputMode={props.type === 'tel' || props.type === 'number' ? 'numeric' : undefined}
        data-testid={props.testId}
        maxLength={props.maxLength}
        lang="zh-CN"
      />
      {props.mic && <PhoneMic onText={(t) => props.onChange(props.value + t)} />}
      {props.right}
    </label>
  );
}

export function Empty(props: { icon?: string; text: string }) {
  return (
    <div className="ph-empty">
      <div className="ph-empty-icon">{props.icon ?? '📭'}</div>
      <div>{props.text}</div>
    </div>
  );
}

export function Price(props: { value: number; size?: 'big' | 'normal'; color?: string }) {
  const v = Math.round(props.value * 100) / 100;
  const [int, dec] = v.toFixed(2).split('.');
  return (
    <span className={`ph-price${props.size === 'big' ? ' ph-price-big' : ''}`} style={props.color ? { color: props.color } : undefined}>
      <small>¥</small>
      {int}
      {dec !== '00' && <small>.{dec.replace(/0$/, '')}</small>}
    </span>
  );
}
