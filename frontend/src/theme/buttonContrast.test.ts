import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Buttons must read as buttons (Jerome: "in dark mode a lot of the buttons that are a darker
 * colour end up having no outline"). WCAG 1.4.11 non-text contrast: a non-primary button's
 * outline ≥ 3:1 against every surface it sits on, light and dark token sets alike.
 * The Lab app's twin: android-lab/app/src/test/…/ui/theme/ThemeContrastTest.kt.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const indexCss = read('../index.css');
const practiceCss = read('../pages/PracticePage.css');

/** The custom properties declared in the first block whose selector is exactly [selector]. */
function tokens(css: string, selector: string): Record<string, string> {
  const re = new RegExp(`(^|\\n)${selector.replace(/[[\]()'.]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`no ${selector} block`);
  const out: Record<string, string> = {};
  for (const [, name, value] of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const light = tokens(indexCss, ':root');
const dark = { ...light, ...tokens(indexCss, ":root[data-theme='dark']") };
/** The Lab app's dark surfaces (Theme.kt), what the web's dark set is built against. */
const LAB_DARK_SURFACES = { background: '#111113', card: '#1c1c20', faint: '#26262c' };

describe('button outline contrast', () => {
  it('contrast() matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#e5e7eb', '#ffffff')).toBeLessThan(1.3); // the old secondary border
  });

  it('light: the outline is ≥ 3:1 on the page, a card and every button fill', () => {
    for (const s of ['--color-surface', '--color-background', '--btn-bg', '--btn-disabled-bg']) {
      expect(contrast(light['--btn-outline'], light[s]), `outline on ${s}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('dark: the outline is ≥ 3:1 on the dark surfaces and button fills', () => {
    for (const s of ['--btn-bg', '--btn-disabled-bg']) {
      expect(contrast(dark['--btn-outline'], dark[s]), `outline on ${s}`).toBeGreaterThanOrEqual(3);
    }
    for (const [name, hex] of Object.entries(LAB_DARK_SURFACES)) {
      expect(contrast(dark['--btn-outline'], hex), `outline on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('a disabled label stays readable on its grey fill, both themes', () => {
    expect(contrast(light['--btn-disabled-text'], light['--btn-disabled-bg'])).toBeGreaterThanOrEqual(3);
    expect(contrast(dark['--btn-disabled-text'], dark['--btn-disabled-bg'])).toBeGreaterThanOrEqual(3);
  });

  it('the primary fill keeps its white label ≥ 4.5:1', () => {
    expect(contrast('#ffffff', light['--color-primary'])).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary and practice buttons use the outline token; disabled ones are dashed', () => {
    expect(indexCss).toMatch(/\.btn-secondary\s*\{[^}]*border:\s*1px solid var\(--btn-outline\)/);
    expect(indexCss).toMatch(/\.btn-secondary:disabled\s*\{[^}]*border:\s*1px dashed var\(--btn-outline\)/);
    expect(practiceCss).toMatch(/\.practice-btn\s*\{[^}]*border:\s*1px solid var\(--btn-outline\)/);
    expect(practiceCss).toMatch(/\.practice-btn\.primary:disabled\s*\{[^}]*border:\s*1px dashed var\(--btn-outline\)/);
  });
});
