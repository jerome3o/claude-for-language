# Handwriting & stroke-order practice

Minghui asked: *"Is it possible to add a feature where students can follow stroke orders to
practice writing characters in the app?"* This is the research and the preview that answers it:
the student draws a character stroke by stroke and every stroke is checked **as it is drawn** —
the right stroke, in the right order, in the right direction.

**Where to try it:** More → Practice → **Write characters (preview)** (`/practice/strokes`,
`?text=你好` deep-links a word), or on the back of any study card **⋯ → Write it**. Works in the
web app, the installed PWA and the hybrid Android app (it loads the same site). Not yet in the
native Lab app (see the end).

---

## 1. Stroke data: options and licences

| Source | What it has | Coverage | Licence | Verdict |
|---|---|---|---|---|
| **Make Me a Hanzi** (`skishore/makemeahanzi`) `graphics.txt` | Per character: SVG outline path per stroke + a **median** (centre line, in writing order and direction) | ~9,500 characters, simplified + traditional | **Arphic Public License** (the outlines are derived from Arphic's PL fonts) | The canonical open dataset; everything below derives from it |
| Make Me a Hanzi `dictionary.txt` | Decomposition, radical, etymology, pinyin | same | LGPL (from cjklib) — separate from the graphics | Not used (not needed for writing) |
| **hanzi-writer-data** (npm, v2.0.1) | MMAH graphics repackaged as one JSON per character: `strokes`, `medians`, `radStrokes` | 9,574 files, ~2 KB each (~1 KB gzipped), 32 MB total | Arphic Public License (`ARPHICPL.TXT` in the package) | **Chosen** — same data, easiest to ship, versioned on npm |
| **hanzi-writer** (npm, v3.7) | JS renderer: stroke animation, quiz mode with a median matcher | — | MIT | Not shipped; its matching criteria were adapted (see §3) |
| AnimCJK | Animated SVGs (Japanese, simplified and traditional Chinese, Korean) | large | Mixed (Arphic PL for data derived from Arphic fonts, LGPL for the rest — check its README per file) | Useful for traditional/Taiwan forms later; no medians, so grading is harder |
| KanjiVG | Stroke-order SVGs | Japanese kanji only | CC BY-SA 3.0 | Not suitable — Japanese stroke orders and forms differ from Chinese for some characters |
| Pleco / Skritter data | Stroke orders | extensive | Proprietary | Not available to us |

### Licence check (not legal advice)

The Arphic Public License is a copyleft licence written for fonts; MMAH's stroke data is a
derivative of those fonts and carries it. It allows copying and redistributing the data "in any
medium" **as long as `ARPHICPL.TXT` is kept with every copy**, and modified versions must be
distributed under the same licence (freely available). Consequences for us:

- Serving the data from our own origin is fine. The build copies the licence next to it
  (`/strokes/ARPHICPL.TXT`), and the practice page credits Make Me a Hanzi / hanzi-writer-data /
  Arphic Technology with a link to that file.
- The licence covers the **data**, not our application code, which only reads it.
- If we ever fix or add characters, those edited files must be published under the APL too.
- The matcher in `shared/strokes/match.ts` is our own code; it follows the criteria of
  hanzi-writer's quiz (MIT), credited in the code comment and on the page.

### Delivery: lazy per character, cached on the device

- `strokeDataPlugin` in `frontend/vite.config.ts` copies every file of the `hanzi-writer-data`
  devDependency into the build as `/strokes/<code point in hex>.json` (ASCII URLs; 你 →
  `4f60.json`) plus the licence; the dev server serves the same paths from `node_modules`.
  They go out with the Pages deploy — no R2 upload step, no third-party CDN at runtime.
- `frontend/src/services/strokeData.ts` fetches a character the first time it is written and
  keeps it in its **own** IndexedDB database (`stroke-data`: `chars`, `missing`) — separate from
  `ChineseLearningDB`, so no Dexie version bump and nothing extra in backups. Memory → IndexedDB →
  network; Pages' SPA fallback (HTML with 200) is recognised as "missing".
- The files are **not** in the service-worker precache (that would add ~20 MB to every install).
  Instead the practice page shows "N of M characters from your decks are saved on this device"
  with **Save all** (`prefetchStrokeData`, 6 in flight, ~2 KB per character) for the train.

**Coverage.** 9,574 characters: all 6,763 of GB2312 (checked) plus common
traditional ones, i.e. everything a learner meets in HSK 1–6 and well beyond. A character that is
not in the set (rare, or not a Han ideograph) is skipped with a note; punctuation and Latin
letters in a word are ignored.

---

## 2. What the preview does

- **Trace** — the character in light grey, the stroke order animated first (numbered, each
  stroke painted inside its outline; start writing to skip it). Draw over it.
- **From memory** — an empty 米字格 grid with the pinyin and English as the prompt.
- **Per stroke, immediately:**
  - correct → the ink is replaced by the real stroke painted in (240 ms) with a green bloom, a
    soft pluck that climbs in pitch stroke by stroke, a haptic tick;
  - **wrong order** → "That's stroke 5 — stroke 3 comes first." (the drawing matched a later
    stroke);
  - **backwards** → "Right stroke, other direction — start from the dot." + the start dot;
  - **too short** → "Keep going — draw stroke 3 all the way to its end.";
  - anything else → "Not quite — try stroke 3 again."; rejected ink shakes red and fades.
  - Help escalates: after **2** misses a pulsing start dot + direction arrow, after **3** the
    expected stroke is painted in blue on a loop (counts as a hint), after **5** it is filled in
    for you in amber and you move on (counts as revealed). **💡 Hint** shows it on demand;
    **▶ Watch** replays the order; **↺ Restart** redoes the character.
- **Per character:** the pad glows (green perfect / lime good / amber practice), a short chord,
  then the next character of the word. **Summary:** each character with one dot per stroke
  (first try / after a miss / with a hint / shown), mistakes, hints, the kinds of slips, time;
  Again, switch to the other mode, Done.
- Sound can be muted (🔊, remembered per device); `prefers-reduced-motion` stops the loops.
- Input: pointer events with `touch-action: none` (finger, stylus, mouse), coalesced events for
  smooth fast strokes, one pointer at a time (a resting palm doesn't start a second stroke).

### Code

| File | What |
|---|---|
| `shared/strokes/types.ts` | Data + **result shapes** (`StrokeResult`, `CharacterWritingResult`, `WritingExerciseResult`) |
| `shared/strokes/geometry.ts` | Resampling, Fréchet distance, Procrustes shape normalisation, direction similarity, `compactStroke` |
| `shared/strokes/match.ts` | `matchStroke(points, data, expected)` → `correct` / `backwards` / `wrong_order` (+ which stroke) / `too_short` / `wrong` / `ignored` |
| `shared/strokes/quiz.ts` | The per-character state machine (`createQuiz`, `submitStroke`, `requestHint`, `revealStroke`, hint escalation, grading, `summarizeCharacter` / `summarizeExercise`, `mistakeMessage`) |
| `shared/strokes/data.ts` | `strokeDataFile`, `parseCharStrokeData`, brush/median paths, stroke start + direction |
| `shared/strokes/strokes.test.ts` | Unit tests on real characters (十 三 口 人 你 八, fixtures in `__fixtures__/`) |
| `frontend/src/components/strokes/StrokePad.tsx` | The SVG pad (grid, outline, demo, painted strokes, hints, ink) — presentational |
| `frontend/src/components/strokes/WritingExercise.tsx` | **The pluggable exercise**: loads data, runs the quiz per character, summary |
| `frontend/src/components/strokes/WritingSheet.tsx` | Full-screen sheet used from the study card |
| `frontend/src/pages/StrokePracticePage.tsx` | `/practice/strokes` |
| `e2e/tests/stroke-practice.spec.ts` | Data served; wrong order called out; 十 written to the summary |

### Result shape (what a lesson or a tutor review would store)

```jsonc
{
  "text": "你好", "mode": "recall", "grade": "good",
  "started_at": 1790000000000, "finished_at": 1790000012300, "skipped": [],
  "characters": [{
    "character": "你", "mode": "recall", "grade": "good", "accuracy": 0.86,
    "mistakes": 0, "hints": 1, "revealed": 0, "ms": 6100,
    "strokes": [
      { "index": 0, "misses": 0, "mistakes": [], "hinted": false, "revealed": false, "ms": 700,
        "drawn": [[283, 713], [251, 640], …] },          // ≤ 24 points, data space — replayable
      { "index": 2, "misses": 0, "mistakes": [], "hinted": true, "revealed": false, "ms": 2300, … },
      …
    ]
  }]
}
```

Grades: **perfect** = no mistakes, no hints; **good** = nothing revealed, ≤ 1 hint, mistakes ≤
max(1, 25 % of the strokes); otherwise **practice**. A word's grade is its weakest character.

---

## 3. Grading: hanzi-writer's quiz vs our own matcher

hanzi-writer's quiz matches each drawing against the **current** stroke's median: mean distance
to the median, start/end within 250 units (of the 1024 box), average direction cosine > 0,
Fréchet distance of the normalised shapes (over ±11° rotations) ≤ 0.4, length ≥ 35 %; it reports
a match or a mistake (3.x adds `isBackwards`). Using it directly would mean its own DOM renderer
inside React, no way to say *which* stroke was drawn out of order, and nothing to port to Kotlin.

So `shared/strokes/match.ts` re-implements the same per-stroke test (same thresholds) and adds
classification:

1. taps (< 24 units) are ignored, not mistakes;
2. the expected stroke matches → correct, unless a **later** stroke fits clearly better
   (mean distance < 40 % — parallel strokes like 三 / 目 would otherwise pass) → wrong order, or an
   **already written** stroke fits clearly better → wrong (going over a finished stroke);
3. the reversed drawing matches → backwards;
4. some later stroke matches → wrong order, naming it;
5. right start, right direction, near the median but short → too short; else wrong.

The first stroke in From-memory mode gets a looser distance (nothing on the pad to anchor it).

**Evaluation** on 400 random characters from the dataset (4,630 strokes), synthetic handwriting
= the median resampled with ±40-unit offset and wobble:

| Drawing | Result |
|---|---|
| the right stroke | 99.85 % accepted (misses: tiny dots in very dense characters) |
| the right stroke, whole character written 25 % smaller (From memory) | 97 % accepted, 2 % called wrong order |
| the right stroke reversed | 99.85 % "backwards" |
| the next stroke instead | 99.9 % "wrong order" |
| the previous (already written) stroke again | 0.1 % accepted (13 % before the "already written" check) |

Real handwriting will be messier than this; `leniency` in `QuizOptions` is the tuning knob.

---

## 4. Limitations

- **Traditional / Taiwan / Hong Kong forms.** Traditional characters are in the set, but the
  orders follow mainland conventions; Taiwan's standard (教育部) differs for some characters.
  A Taiwan variant would need another source (e.g. AnimCJK's traditional set, checked per file).
- **Rare characters** outside the ~9,500 are skipped with a note.
- **Shape quality isn't judged**: proportion, balance, 顿笔 / hook finish and stroke width are not
  assessed — only which stroke, which order, which direction, roughly where. Stroke *types*
  (横 竖 撇 点 折 …) aren't named in the feedback (the data has no type labels; they could be
  derived from medians).
- **Finger vs stylus.** Tuned for a finger on a ~400 px pad. A stylus is more precise and would
  allow a stricter leniency; a very small or very offset character in From-memory mode can be
  judged "wrong order" (see the 97 % row). The Pixel Fold unfolded gives a bigger pad (max 440 px).
- **Nothing is saved yet.** Results are computed (`onComplete`) but not stored or synced, so the
  tutor can't see them. Stroke timing includes thinking time.
- The page is not part of the SRS; it's practice on demand.

---

## 5. Recommended path to the full feature

1. **Mini-lesson exercise `write`** — `{ type: 'write', hanzi, pinyin?, english?, mode?:
   'trace' | 'recall' }` in `shared/lesson`, rendered with `<WritingExercise text=… pinyin=…
   english=… initialMode=… allowModeSwitch={false} onComplete=…>`; the lesson's score from
   `result.grade` / `accuracy`. The component already works offline and reports the result;
   coordinate with whoever owns the exercise-type registry.
2. **Record attempts for the tutor** — an append-only `writing_attempts` table (id from the
   client, user, note_id?, text, mode, result JSON incl. the compact `drawn` ink), queued in
   IndexedDB and uploaded in sync like review events; a **Handwriting** section on the student
   page (replay the ink stroke by stroke over the outline, marks like recordings: listened /
   needs work + comment shown on the card), a `list_student_writing` MCP tool, and "struggles
   with stroke order" in Insights.
3. **SRS "write" card type** (opt-in per deck — it is slow): a fourth card `meaning_to_writing`
   (English + pinyin → write from memory), the rating pre-selected from the grade (perfect → Good,
   practice → Again) but confirmed by the learner; needs `CardType` in both type files,
   `insertCardsForNote`, the budget (it would compete with new cards) and the Lab app.
4. **Native Lab version** — port `shared/strokes` to `android-lab/core` with golden vectors
   generated from the TS (like FSRS: fixtures of drawings → verdicts), draw on a Compose `Canvas`
   with `pointerInput`, parse outlines with `PathParser`, paint strokes with a clipped, dashed
   path animation; stylus via `MotionEvent.getToolType`, low-latency ink with
   `androidx.graphics:graphics-core` front-buffered rendering. Row in `android-lab/PARITY.md`.
5. **Tune with real handwriting** — log `drawn` + verdict for Jerome's and Minghui's attempts,
   adjust thresholds per mode, maybe a "strict" setting for stylus users; add a Taiwan data set if
   a student needs traditional forms.
