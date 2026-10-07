# Lab UI kit

Shared Compose pieces in `app/src/main/java/…/lab/ui/kit/`. Use them so every screen
feels like the study screen Jerome likes ("so fast and slick"): warm paper background,
rounded cards, springy presses, inline notices instead of alerts. Colours come from
`Lab.colors` (theme tokens, light + dark) and `Palette` (the web's rating / queue colours).

**Adding to the kit**: put a new shared piece in a NEW file under `ui/kit/` (e.g.
`kit/Progress.kt`) rather than editing an existing kit file another package may be
touching, and add a line to the table below.

| Piece | File | Use it for |
|---|---|---|
| `LabScreen(title, onBack?, subtitle?, actions) { items… }` | `Scaffold.kt` | Every list-shaped screen: title row, ← back, insets, keyboard, 720dp max width on the unfolded Fold. Body is a `LazyColumn` scope. |
| `LabScreenFrame { }` + `ScreenTitle(…)` | `Scaffold.kt` | Screens that lay out their own body (players, editors, two-pane ≥ 640dp). Pads every system bar incl. the bottom: on an immersive route (no tab bar) a bottom button stays above the gesture / navigation bar; while the tab bar shows, `ShellFrame` has consumed that inset, so it is 0 there. Never add `navigationBarsPadding()` yourself inside it. |
| `Modifier.studyCardSurface(…)`, `studyHanziSize(hanzi)`, `StudyCardFlip`, `studyCardTransition(rating)`, `AnswerTile(label, color) { }` | `StudyCard.kt` | The study card's look, shared by the study session and the homework pass: the card surface, hanzi sizes, the flip spring, card-to-card transition, and the 66dp colored answer tiles of the bottom bar (the ratings, Not yet / Got it). |
| `SectionHeader(title)` | `Rows.kt` | Muted group heading. |
| `LabCard { }` + `RowDivider()` | `Rows.kt` | A rounded group of rows. |
| `NavSection(title, rows = listOf({ … }, …))` | `Rows.kt` | Header + card + dividers in one call (the More page groups). |
| `NavRow(icon, label, desc?, badge?, danger?, external?, trailing?, onClick?)` | `Rows.kt` | The 56dp row: emoji · label + one line · chevron (↗ when it opens the main app). |
| `ToggleRow(icon, label, checked, desc?) { }` | `Rows.kt` | Settings switches (whole row toggles). |
| `CountBadge(text)` / `StatusPill(text, color)` | `Rows.kt`, `States.kt` | Unread counts; "due today" / "overdue" labels. |
| `PrimaryPill(label, modifier, enabled?, color?) { }` | `Buttons.kt` | The one main action on a screen (accent, springy). Give it `.height(56.dp)`. |
| `SecondaryPill(label, danger?) { }` | `Buttons.kt` | Quieter action next to a PrimaryPill. |
| `DoneForGoodButton(enabled) { }` | `DoneForGoodButton.kt` | "✓ Done for good · don't bring it back" under the rating bar of a finished mini lesson / graded reader ("revisit later": retire it). Quiet full-width outline, 48dp. |
| `Modifier.bouncyClickable { }` | `Buttons.kt` | Any big tappable surface (cards, hero tiles): sinks and springs back, no ripple. |
| `LabChip(label, selected?) { }` / `ChipRow { }` | `Chips.kt` | Filters, quick actions (coach chips), choices. |
| `InlineNotice(text, kind, actionLabel?, onAction?)` | `States.kt` | Every error / info / offline message in the flow — never a Toast or `AlertDialog` for a failure. Kinds: Info, Success, Warning, Error, Offline. |
| `OfflineNotice(updatedAt?)` | `States.kt` | "You're offline — showing what's on this phone (from 2 h ago)". |
| `LoadingState(text?)` / `EmptyState(emoji, title, body?, action?)` / `ErrorState(message, onRetry?)` | `States.kt` | Full-width states. Prefer cached data over a spinner. |
| `LoadableContent(loadable, onRetry, isEmpty, empty) { data -> }` | `States.kt` | Renders a `Loadable<T>` from `app.cachedResource(…)`: cached data first, notice above it on failure/offline, spinner only when nothing is cached. |
| `LabModalSheet(onDismiss) { content }` | `Sheets.kt` | **The** modal bottom sheet: every Lab sheet (`LabBottomSheet`, `LabFormSheet`, `LabSheetFrame`, a one-off list sheet) goes through it — never call Material3's `ModalBottomSheet` directly. M3 1.3 draws sheets edge to edge and pads only the bottom inset, so a tall sheet slid under the status bar (the character sheet's × under the clock); `Modifier.sheetBelowStatusBar()` caps the body so the sheet stays below the status bar / cutout + 8dp and its content scrolls inside. Tested: `SheetInsetsTest` (real status-bar inset dispatched to the sheet's window). |
| `LabBottomSheet(onDismiss, title?) { rows }` | `Sheets.kt` | ⋯ menus and pickers without a Save-type button (the web's bottom sheets). A form with Save / Add / Send uses `LabFormSheet` (below). |
| `ConfirmDialog(title, text, confirmLabel, onConfirm, onDismiss, danger?)` | `Sheets.kt` | Consequential actions (delete, sign out with unsynced work). |
| `SheetScaffold(header?, footer, footerAbove?) { content }` | `SheetScaffold.kt` | **Every form with a primary action** (Save / Add / Send / Create / Assign / Remove). Header fixed, only the content scrolls (`weight(1f, fill = false)` + `verticalScroll`), the footer row is pinned OUTSIDE the scroll with `imePadding()` + `navigationBarsPadding()`, card background, and a hairline + soft shadow only while `canScrollForward`. Put buttons in `footer` (RowScope: `Modifier.weight(1f).height(52.dp)`; Cancel beside the primary, destructive keeps `Palette.Again`), the action's error / offline notice in `footerAbove` so it shows where the tap was. `footer = null` for a pick-a-row step. Needs a bounded height: never put it inside another vertical scroll (or a `LabBottomSheet`, which scrolls). Long pickers (decks, students) go in the content — they scroll, the button never moves. Tested: `StickyFooterTest` (412×600dp). |
| `LabFormSheet(onDismiss, title?, footer, footerAbove?) { content }` | `SheetScaffold.kt` | A form bottom sheet = `LabModalSheet` + `SheetScaffold`. Use it instead of `LabBottomSheet` whenever the sheet has a Save-type button. |
| `LabSheetFrame(onDismiss) { FooForm(…) }` | `SheetScaffold.kt` | A bare (non-scrolling) sheet for a reusable `FooForm` that is itself a `SheetScaffold` (EditCardForm, NoteEditForm, DeckSettingsForm, SendHomeworkContent, InviteForm…), so screenshot tests can render the form alone. |
| `LazySheetScaffold(…)` / `StickyFooter(moreAbove, above?) { buttons }` | `SheetScaffold.kt` | The same with a `LazyColumn` body / the pinned bar alone under a screen's own `weight(1f)` list (Paste a list, homework draft Assign). |
| `FormScreen(title, footer) { content }` / `LazyFormScreen(title, footer) { items }` | `SheetScaffold.kt` | Full-screen forms (Generate with Claude, Generate reader): `LabScreenFrame` + title + scrolling body + footer pinned at the bottom of the page. |
| `AnkiExportSheet(target) { onDismiss }` (+ stateless `AnkiExportContent(ui, actions)`) | `AnkiExportSheet.kt` | "Export to Anki" for a deck / lesson spec / reader (`AnkiExportTarget`): options, progress, result, Share → AnkiDroid / Save to Downloads. The .apkg is built on the phone (`data/anki/`). Hold `var anki by remember { mutableStateOf<AnkiExportTarget?>(null) }` and place the sheet in the route. |
| `MarkdownText(src, modifier?, style?, color?)` | `Markdown.kt` (+ `MarkdownParser.kt`) | **Every** piece of Markdown-ish text: Claude answers and chats, fun_facts, coach critiques, sentence breakdowns, agent summaries. The web's react-markdown + remark-gfm subset: headings, paragraphs (a newline is a line break), **bold** / *italic* / ~~strike~~ / `code`, links + autolinks, bullet / numbered / task lists (nested), > quotes, --- rules, fenced code, GFM tables (header shaded, short / CJK columns never wrap, the rest share the width, sideways scroll with an edge fade when too wide). Colours are translucent `Lab.colors` ink / accent, so it reads on any surface in light + dark. Never throws, so a streaming reply renders as it grows. Pure parser tests: `MarkdownParserTest`; shots: `MarkdownScreenshots`. `markdownLite(src)` (`Text.kt`) flattens it into one AnnotatedString only where a single `Text` is unavoidable. |
| `ConfettiRain`, `SparkBurst`, `ShakeState` | `ui/fx/Effects.kt` | Celebrations, streak sparks, wrong-answer shake. |
| `app.haptics.tick() / correct() / wrong() / celebrate()`, `app.sounds.play(Sfx.…)` | `fx/Haptics.kt`, `fx/Sounds.kt` | Feel. Every moment that should feel good gets a haptic; respect the toggles (they are checked inside). |
| `PlaceholderScreen(path, onBack?) { openInMainApp }` | `ui/placeholder/` | A route whose native screen isn't built yet. |
| `WritingExercise(text, pinyin?, english?, initialMode, allowModeSwitch, autoDemo, hideCharacters, onComplete, onDone?, doneLabel)` | `ui/strokes/WritingExercise.kt` | Handwriting with stroke-order feedback for a word (loads stroke data offline-first via `StrokeStore`, runs the quiz, shows the summary). `onComplete` gets a core `WritingExerciseResult`; **in a lesson only `StrokeQuiz.writtenFromMemory(result)` counts as correct** (start with `initialMode = WritingMode.RECALL`). Package B's handwriting / dictation exercises. |
| `WritingSheet(text, onClose, pinyin?, english?, onComplete)` | `ui/strokes/WritingExercise.kt` | Full-screen "✍️ Write it" over the study card (package A's ⋯ menu). |
| `WritingPad(data, showOutline, completed, justCompleted, hint, demoKey, celebrate, onStroke → InkOutcome)` | `ui/strokes/WritingPad.kt` | The bare 米字格 pad (Canvas: outlines, painted strokes, hints, demo, ink) if you need your own flow; `WritingController` + `WritingRunView` are the run without the loading. |
| `SentenceBreakdownView(breakdown, current, playing, playingAll, actions)` | `ui/analyze/AnalyzeScreen.kt` | A sentence stepped through chunk by chunk (hanzi ↔ pinyin ↔ English), from `POST /api/sentence/analyze`. |
| `ExplorableText(text, source, segments?, …)` · `rememberExplorerTap(source)` · `LocalExplorer.current?.open(item, source)` | `ui/explorer/` | Chinese a learner reads: every word (with matching word segments) or character opens the language explorer (Character / Word views on one stack, hosted by the shell; inside the explorer a tap pushes). docs/LANGUAGE_EXPLORER.md. |
| `QuestSpeech(app).speak(text, onEnd?)` | `ui/quests/QuestSpeech.kt` | Any Chinese line through `/api/practice/tts`, clip cached for offline, device voice as the fallback. |

## Rules of thumb

- **Stateless screen + ViewModel**: `FooScreen(ui: FooUi, actions: FooActions)` renders from a
  data class; the ViewModel (or the `composable { }` block in your `<Feature>Nav.kt`) wires
  it. That is what makes it screenshot-testable.
- **Touch targets ≥ 44dp**, body text ≥ 16sp, phone first (412dp), then check the
  unfolded width (841dp) — `LabScreen` caps the column at 720dp for you.
- **Motion**: springs (`Spring.DampingRatioMediumBouncy`) for presses and pills, 150–250 ms
  fades for content. Navigation transitions come from the shell — don't add your own.
- **Offline**: render from Room / `JsonCache` first, refresh behind it, and say so with
  `OfflineNotice` when the refresh couldn't run. Writes go through the `Outbox`.
- **Copy**: reuse the web's words for the same feature (labels, empty states, errors).

## Screenshots

```kotlin
class ReadersScreenshots : LabScreenshotTest() {
    @Test fun list() = shoot("readers-01-list") { ReadersScreen(sampleUi, ReadersActions()) }
    @Test fun inShell() = shootInShell("readers-02-tab", active = TabId.MORE) { ReadersScreen(sampleUi, ReadersActions()) }
}
```

`app/src/test/…/lab/testing/LabScreenshotTest.kt` (`shoot`, `shootInShell`, `PHONE`,
`UNFOLDED`, `dark = true`) and `Samples.kt` (real hanzi). Name shots `<feature>-NN-<state>`.
`./gradlew :app:recordRoborazziDebug` writes `app/screenshots/*.png` — look at every one
before you report, and copy the ones the PR needs into `docs/pr-screenshots/<dir>/`.
