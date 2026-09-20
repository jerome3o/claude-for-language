/**
 * Tiny DOM helpers for the vanilla-TS apps: an element builder, text
 * formatting, Chinese speech, toasts and a bottom sheet. No innerHTML — all
 * text is set as text nodes.
 */

export type Child = Node | string | number | null | undefined | false | Child[];

type Handler<E extends Event = Event> = (ev: E) => void;

export interface Props {
  class?: string;
  style?: string;
  id?: string;
  title?: string;
  lang?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  href?: string;
  src?: string;
  alt?: string;
  rows?: number;
  for?: string;
  role?: string;
  'aria-label'?: string;
  'aria-expanded'?: string;
  'aria-pressed'?: string;
  'aria-live'?: string;
  'data-id'?: string;
  onclick?: Handler<MouseEvent>;
  oninput?: Handler<InputEvent>;
  onchange?: Handler<Event>;
  onkeydown?: Handler<KeyboardEvent>;
  onblur?: Handler<FocusEvent>;
  ref?: (el: HTMLElement) => void;
}

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

/** `h('div', { class: 'row' }, child, ...)` */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'ref') continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'style') el.setAttribute('style', String(value));
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key === 'disabled' || key === 'checked') {
        (el as unknown as Record<string, unknown>)[key] = value === true;
      } else if (key === 'value') {
        (el as unknown as { value: string }).value = String(value);
      } else el.setAttribute(key, String(value));
    }
    props.ref?.(el);
  }
  for (const c of children) append(el, c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(el: Element, ...children: Child[]): void {
  clear(el);
  for (const c of children) append(el, c);
}

export function initials(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/);
  if (/[㐀-鿿]/.test(n)) return n.slice(-2);
  return parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
}

export function avatar(name: string | null | undefined, picture: string | null | undefined, small = false): HTMLElement {
  const el = h('span', { class: `avatar${small ? ' avatar-sm' : ''}`, 'aria-label': name ?? '' });
  if (picture) el.appendChild(h('img', { src: picture, alt: '' }));
  else el.textContent = initials(name);
  return el;
}

// ---------- Formatting ----------

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (w < 9) return `${w} weeks ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function minutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 1 ? '<1 min' : `${m} min`;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : `${Math.round(v <= 1 && v > 0 ? v * 100 : v)}%`;
}

export const RATING_LABEL: Record<number, string> = { 0: 'Again', 1: 'Hard', 2: 'Good', 3: 'Easy' };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- Speech ----------

/** Speak Chinese with the browser voice (pages have no TTS clips). */
export function speakZh(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.8;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('zh'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

let audioEl: HTMLAudioElement | null = null;
/** Play a clip by URL, falling back to speech for the given text. */
export function playAudio(url: string | null | undefined, fallbackText: string): void {
  if (!url) {
    speakZh(fallbackText);
    return;
  }
  if (!audioEl) audioEl = new Audio();
  audioEl.pause();
  audioEl.src = url;
  audioEl.play().catch(() => speakZh(fallbackText));
}

/** Absolute URL for an R2 key (or an already absolute URL). */
export function mediaUrl(base: string, key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^(https?:)?\/\//.test(key) || key.startsWith('data:') || key.startsWith('blob:')) return key;
  return `${base}${key.replace(/^\/+/, '')}`;
}

export function playButton(onPlay: () => void, small = true, label = 'Play'): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn btn-icon${small ? ' btn-sm' : ''}`,
      'aria-label': label,
      title: label,
      onclick: (e) => {
        e.stopPropagation();
        onPlay();
      },
    },
    '▶',
  );
}

// ---------- Textarea auto-grow ----------

export function autoGrow(ta: HTMLTextAreaElement): void {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(44, ta.scrollHeight + 2)}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

export interface TextFieldOptions {
  label?: string;
  value: string;
  placeholder?: string;
  zh?: boolean;
  multiline?: boolean;
  small?: boolean;
  onInput: (value: string) => void;
}

/** A labelled input/textarea bound to a state setter (no re-render on input). */
export function textField(o: TextFieldOptions): HTMLElement {
  const cls = `${o.multiline ? 'textarea' : 'input'}${o.zh ? ' input-zh' : ''}${o.small ? ' input-sm' : ''}`;
  const control = o.multiline
    ? h('textarea', {
        class: cls,
        rows: 1,
        placeholder: o.placeholder,
        oninput: (e) => o.onInput((e.target as HTMLTextAreaElement).value),
        ref: (el) => autoGrow(el as HTMLTextAreaElement),
      })
    : h('input', {
        class: cls,
        type: 'text',
        placeholder: o.placeholder,
        oninput: (e) => o.onInput((e.target as HTMLInputElement).value),
      });
  (control as HTMLInputElement | HTMLTextAreaElement).value = o.value;
  return h('label', { class: 'field' }, o.label ? h('span', { class: 'label' }, o.label) : null, control);
}

// ---------- Toasts ----------

let toastHost: HTMLElement | null = null;
export function toast(message: string, kind: 'ok' | 'danger' = 'ok', ms = 2600): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: `toast${kind === 'danger' ? ' toast-danger' : ''}` }, message);
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Sheet ----------

export interface Sheet {
  body: HTMLElement;
  close: () => void;
}

/** A bottom sheet (centred dialog ≥640px). Returns the body to fill. */
export function openSheet(title: string): Sheet {
  const body = h('div', { class: 'sheet-body' });
  let backdrop: HTMLElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  backdrop = h(
    'div',
    {
      class: 'sheet-backdrop',
      onclick: (e) => {
        if (e.target === backdrop) close();
      },
    },
    h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-title' }, h('h2', null, title), h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onclick: close }, '✕')),
      body,
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  return { body, close };
}

/** Run an async action on a button, showing a spinner and re-enabling it. */
export async function busy(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  btn.classList.add('busy');
  btn.disabled = true;
  try {
    await fn();
  } finally {
    btn.classList.remove('busy');
    btn.disabled = false;
  }
}

/** A "Delete" button that asks for a second tap before firing. */
export function confirmButton(label: string, onConfirm: () => void, cls = 'btn btn-sm btn-danger'): HTMLButtonElement {
  let armed = false;
  let timer = 0;
  const btn: HTMLButtonElement = h(
    'button',
    {
      class: cls,
      onclick: () => {
        if (!armed) {
          armed = true;
          btn.textContent = 'Sure?';
          timer = window.setTimeout(() => {
            armed = false;
            btn.textContent = label;
          }, 3000);
          return;
        }
        window.clearTimeout(timer);
        onConfirm();
      },
    },
    label,
  );
  return btn;
}

export function problemsNotice(problems: string[]): HTMLElement {
  return h(
    'div',
    { class: 'notice notice-danger', role: 'alert' },
    h('strong', null, problems.length === 1 ? 'One thing to fix before saving' : `${problems.length} things to fix before saving`),
    h('ul', null, ...problems.map((p) => h('li', null, p))),
  );
}
