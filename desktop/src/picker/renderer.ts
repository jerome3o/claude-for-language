/**
 * The share picker: Entire screen / Window tabs with live thumbnails, Share /
 * Cancel. Sharing an ENTIRE screen also lets her draw on it (the overlay);
 * a window can only be drawn on inside the call. On macOS without the Screen
 * Recording permission it says how to turn it on instead.
 */

import type { PickerPayload, PickerSource } from '../ipc';

interface PickerHost {
  onSources(listener: (payload: PickerPayload) => void): void;
  choose(id: string | null): void;
  openSettings(): void;
  relaunch(): void;
}

const host = (window as unknown as { pickerHost: PickerHost }).pickerHost;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let payload: PickerPayload | null = null;
let tab: 'screen' | 'window' = 'screen';
let selected: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render() {
  if (!payload) return;
  const grid = $('grid');
  grid.replaceChildren();
  const list = payload.sources.filter((s) => s.kind === tab);
  // macOS gives every source with no picture (or only our own windows) until Screen Recording is allowed.
  const blocked = payload.platform === 'darwin' && (payload.permission === 'denied' || payload.permission === 'restricted' || payload.sources.every((s) => !s.thumbnail));
  $('permission').hidden = !blocked;
  $('hint').textContent =
    tab === 'screen' ? 'Share a whole screen to draw on it — your drawings and your student’s show over everything on that screen.' : 'A window: your student sees just this window. Drawing works in the call window only.';
  for (const tabBtn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) tabBtn.classList.toggle('active', tabBtn.dataset.tab === tab);
  if (list.length === 0) grid.append(el('p', 'empty', tab === 'screen' ? 'No screens found.' : 'No windows to share.'));
  for (const s of list) grid.append(card(s));
  ($('share') as HTMLButtonElement).disabled = !selected || !list.some((s) => s.id === selected);
}

function card(s: PickerSource): HTMLElement {
  const b = el('button', `source${selected === s.id ? ' selected' : ''}`);
  b.type = 'button';
  b.dataset.id = s.id;
  const thumb = el('div', 'thumb');
  if (s.thumbnail) {
    const img = el('img');
    img.src = s.thumbnail;
    img.alt = '';
    thumb.append(img);
  } else thumb.append(el('span', 'nothumb', s.kind === 'screen' ? '🖥️' : '🪟'));
  const label = el('div', 'label');
  if (s.icon) {
    const icon = el('img', 'icon');
    icon.src = s.icon;
    icon.alt = '';
    label.append(icon);
  }
  label.append(el('span', 'name', s.name));
  b.append(thumb, label);
  b.addEventListener('click', () => {
    selected = s.id;
    render();
  });
  b.addEventListener('dblclick', () => host.choose(s.id));
  return b;
}

for (const tabBtn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  tabBtn.addEventListener('click', () => {
    tab = tabBtn.dataset.tab === 'window' ? 'window' : 'screen';
    render();
  });
}
$('share').addEventListener('click', () => selected && host.choose(selected));
$('cancel').addEventListener('click', () => host.choose(null));
$('open-settings').addEventListener('click', () => host.openSettings());
$('relaunch').addEventListener('click', () => host.relaunch());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') host.choose(null);
  if (e.key === 'Enter' && selected) host.choose(selected);
});

host.onSources((p) => {
  payload = p;
  const screens = p.sources.filter((s) => s.kind === 'screen');
  tab = screens.length ? 'screen' : 'window';
  selected = screens.length === 1 ? screens[0].id : null;
  render();
});
