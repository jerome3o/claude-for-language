import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const index = read('../index.css');

/**
 * The answer diff's marks — the slim answer diff (components/study/AnswerDiff.css), the "You said" row (YouSaid.css),
 * the multiple-choice answer (index.css `.diff-*`), a mini lesson's marked answer and 🎤 Read it aloud on a reader page
 * (components/reader/ReadAloud.css) — are COLOUR ONLY (Jerome, Nov 2026: "we don't need the outlines and the color and
 * the underlines … make the colors a little bit more subtle as well. Not too subtle"). So:
 * - the colours are the `--mark-*` tokens of index.css, in both themes, never a one-off hex in a mark rule;
 * - a mark rule draws no box, outline, tint, strike or underline;
 * - every mark is ≥ 4.5:1 on the card and on a result surface's tint, and the four stay apart from each other and from
 *   the body ink.
 * Lab twin: ThemeContrastTest (mark*) + ResultColorsGuardTest.
 */
describe('the answer diff marks: colour only, readable in both themes', () => {
  function tokens(selector: string): Record<string, string> {
    const re = new RegExp(`(^|\\n)${selector.replace(/[[\]()'.]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`);
    const m = index.match(re);
    if (!m) throw new Error(`no ${selector} block`);
    const out: Record<string, string> = {};
    for (const [, name, value] of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
    return out;
  }
  type Rgb = [number, number, number];
  const rgb = (h: string): Rgb => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16)) as Rgb;
  const over = (top: string, alpha: number, under: string): string => {
    const t = rgb(top);
    const u = rgb(under);
    return '#' + t.map((v, i) => Math.round(v * alpha + u[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
  };
  const lum = (hex: string) => rgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const light = tokens(':root');
  const dark = tokens(":root[data-theme='dark']");
  const MARKS = ['--mark-wrong', '--mark-tone', '--mark-extra', '--mark-missing'];
  // Where the marks sit: the web's card (light) / the Lab app's dark card, and the "You said" result surface (8% of
  // its state's colour over the card — `.result-surface`).
  const themes = [
    { name: 'light', t: light, ink: '#1f2937', surfaces: ['#ffffff', over(light['--result-wrong'], 0.08, '#ffffff'), over(light['--result-close'], 0.08, '#ffffff')] },
    { name: 'dark', t: dark, ink: '#f5f3ee', surfaces: ['#1c1c20', over(dark['--result-wrong'], 0.08, '#1c1c20'), over(dark['--result-close'], 0.08, '#1c1c20')] },
  ];

  it('the tokens exist in both themes as plain colours', () => {
    for (const { t } of themes) for (const m of MARKS) expect(t[m], m).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('every mark is ≥ 4.5:1 on the card and on a result surface', () => {
    for (const { name, t, surfaces } of themes) {
      for (const m of MARKS) for (const s of surfaces) expect(contrast(t[m], s), `${name} ${m} on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the marks stay apart: from the body ink, and from each other', () => {
    for (const { name, t, ink } of themes) {
      for (const m of MARKS) expect(contrast(t[m], ink), `${name} ${m} vs ink`).toBeGreaterThanOrEqual(1.5);
      for (const a of MARKS) for (const b of MARKS) {
        if (a >= b) continue;
        const [x, y] = [rgb(t[a]), rgb(t[b])];
        const distance = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
        expect(distance, `${name} ${a} vs ${b}`).toBeGreaterThan(60);
      }
    }
  });

  it('not fluorescent: the old neon rose / lemon / yellow box are gone', () => {
    const neon = /#fb7185|#fde047|#fde68a|#be123c|#a16207/i;
    for (const { t } of themes) for (const m of MARKS) expect(t[m]).not.toMatch(neon);
  });

  const MARK_RULES: [string, RegExp][] = [
    ['../components/study/AnswerDiff.css', /\.adiff--\w+[^{]*\{[^}]*\}/g],
    ['../components/study/YouSaid.css', /\.spoken-mark--\w+[^{]*\{[^}]*\}/g],
    ['../components/reader/ReadAloud.css', /\.ra-char\.ra-\w+[^{]*\{[^}]*\}/g],
    ['../components/lessons/LessonFeedback.css', /\.lesson-marked-(answer|model)[^{]*\{[^}]*\}/g],
    ['../index.css', /\.diff-(correct|wrong|expected|skipped)\s*\{[^}]*\}/g],
  ];

  it.each(MARK_RULES)('%s: the marks are colour only (no box, tint, strike or underline)', (file, re) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = css.match(re) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule, rule).not.toMatch(/text-decoration\s*:\s*(underline|line-through)|border\s*:|box-shadow|outline\s*:|background(-color)?\s*:\s*(?!none|transparent)/);
      expect(rule, rule).not.toMatch(/(^|[^-])color:\s*#/);
    }
  });

  it('the read-aloud legend shows a sample character in each colour', () => {
    const tsx = read('../components/reader/ReadAloud.tsx');
    expect(tsx).toMatch(/ra-swatch ra-char ra-\$\{k\}`\} aria-hidden="true" lang="zh-CN">字</);
  });
});
