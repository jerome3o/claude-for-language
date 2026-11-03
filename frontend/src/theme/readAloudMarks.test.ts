import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const css = read('../components/reader/ReadAloud.css');

/**
 * 🎤 Read it aloud's marks on the page (components/reader/ReadAloud.css): Jerome reads them in dark mode and is red /
 * green colour-blind — the characters keep the body ink, each mark is a shape (wavy / solid / dashed)
 * and every mark and tint passes WCAG AA in both token sets. Lab twin: ThemeContrastTest (mark*).
 */
describe('the marks stay readable in both themes (ReadAloud.css tokens)', () => {
  function tokens(selector: string): Record<string, string> {
    const re = new RegExp(`(^|\\n)${selector.replace(/[[\]()'.]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`no ${selector} block`);
    const out: Record<string, string> = {};
    for (const [, name, value] of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
    return out;
  }
  type Rgb = [number, number, number];
  const parse = (c: string): { rgb: Rgb; a: number } => {
    const m = c.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (m) return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
    const h = c.replace('#', '');
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb, a: 1 };
  };
  const over = (top: string, under: string): string => {
    const t = parse(top);
    const u = parse(under).rgb;
    return '#' + t.rgb.map((v, i) => Math.round(v * t.a + u[i] * (1 - t.a)).toString(16).padStart(2, '0')).join('');
  };
  const lum = (hex: string) => parse(hex).rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const light = tokens(':root');
  const dark = tokens(":root[data-theme='dark']");
  // The page card + body ink: the web's light card, the Lab app's dark card (what the dark set is built against).
  const themes = [
    { name: 'light', t: light, card: '#ffffff', ink: '#1f2937' },
    { name: 'dark', t: dark, card: '#1c1c20', ink: '#f5f3ee' },
  ];

  it('every underline is ≥ 3:1 on the card and on its own tint; the ink on a tint ≥ 4.5:1', () => {
    for (const { name, t, card, ink } of themes) {
      for (const [mark, tint] of [['--ra-tone', '--ra-tone-tint'], ['--ra-wrong', '--ra-wrong-tint']]) {
        const bg = over(t[tint], card);
        expect(contrast(t[mark], card), `${name} ${mark} on the card`).toBeGreaterThanOrEqual(3);
        expect(contrast(t[mark], bg), `${name} ${mark} on ${tint}`).toBeGreaterThanOrEqual(3);
        expect(contrast(ink, bg), `${name} ink on ${tint}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the text is never recoloured, and each mark has its own shape', () => {
    expect(css).not.toMatch(/\.ra-char\.ra-(ok|sound)\s*\{/);
    expect(css).toMatch(/\.ra-char\.ra-close\s*\{[^}]*underline wavy/);
    expect(css).toMatch(/\.ra-char\.ra-wrong\s*\{[^}]*underline solid/);
    expect(css).toMatch(/\.ra-char\.ra-missed\s*\{[^}]*underline dashed/);
    for (const rule of css.match(/\.ra-char\.ra-(close|wrong|missed)\s*\{[^}]*\}/g) ?? []) expect(rule).not.toMatch(/(^|[^-])color:\s*#/);
  });
});
