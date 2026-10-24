# 🎬 Clips v2 — readable type, karaoke captions, lo-fi music, interactive beats, swipe fix

Phone viewport 412×915 @2× (web: Playwright against a local worker in E2E mode, a 2.4 s tone standing in for TTS; Lab: Roborazzi).
**Before** (the first clips PR): `docs/pr-screenshots/clips-feed/` (web) and `docs/pr-screenshots/clips-lab/` (Lab) — e.g. `clips-feed/16-paper-title.png`, `17-chalk-title.png`, `18-comic-title.png`, `14-ink-story.png` for the old curly fonts.

## Web

![neon — a sentence scene, Chinese in a heavy sans](web/01-theme-neon.png)
neon — a sentence scene, Chinese in a heavy sans

![paper — was Songti serif + Georgia; now sans (Georgia only on the English title line)](web/02-theme-paper.png)
paper — was Songti serif + Georgia; now sans (Georgia only on the English title line)

![chalk — was Kaiti + Chalkboard/cursive; now sans, the dashed chalk cards stay](web/03-theme-chalk.png)
chalk — was Kaiti + Chalkboard/cursive; now sans, the dashed chalk cards stay

![comic — was Comic Sans; now a heavy sans, halftone + hard shadows stay](web/04-theme-comic.png)
comic — was Comic Sans; now a heavy sans, halftone + hard shadows stay

![sunset — no blurred glass (it broke the swipe), tinted cards instead](web/05-theme-sunset.png)
sunset — no blurred glass (it broke the swipe), tinted cards instead

![mono — hanzi were weight 300; now 800](web/06-theme-mono.png)
mono — hanzi were weight 300; now 800

![ink — was Kaiti brush; now sans, the ink wash + seal stay](web/07-theme-ink.png)
ink — was Kaiti brush; now sans, the ink wash + seal stay

![retro — was Courier for everything; now sans, monospace only for HUD / headline accents](web/08-theme-retro.png)
retro — was Courier for everything; now sans, monospace only for HUD / headline accents

![Karaoke caption mid-line: 有 being said (bigger, underlined, yellow, pinyin under it), past words dimmed](web/09-karaoke-mid-word.png)
Karaoke caption mid-line: 有 being said (bigger, underlined, yellow, pinyin under it), past words dimmed

![A sentence being read in place: 时候 active](web/10-karaoke-sentence.png)
A sentence being read in place: 时候 active

![Quiz waits — "👆 Tap an answer" (no more timer running out)](web/11-quiz-waiting.png)
Quiz waits — "👆 Tap an answer" (no more timer running out)

![Quiz answered: ✓ Right! + explanation + Next ›](web/12-quiz-right.png)
Quiz answered: ✓ Right! + explanation + Next ›

![listen (muted): the line is hidden; "Show the Chinese" fallback; English options](web/13-listen-waiting.png)
listen (muted): the line is hidden; "Show the Chinese" fallback; English options

![listen answered: the line shows with pinyin + English](web/14-listen-right.png)
listen answered: the line shows with pinyin + English

![order: shuffled tiles with pinyin, "👆 Tap the words in order"](web/15-order-waiting.png)
order: shuffled tiles with pinyin, "👆 Tap the words in order"

![order: two tiles placed (tap a placed tile to take it back)](web/16-order-half.png)
order: two tiles placed (tap a placed tile to take it back)

![order wrong: the right sentence (read aloud, karaoke), yours struck through](web/17-order-wrong.png)
order wrong: the right sentence (read aloud, karaoke), yours struck through

![reveal: the English side, "Tap to flip ↻"](web/18-reveal-front.png)
reveal: the English side, "Tap to flip ↻"

![reveal flipped: the Chinese (read aloud) + the note](web/19-reveal-flipped.png)
reveal flipped: the Chinese (read aloud) + the note

![speak: hear it, 🎤 Say it (the Coach's practise pipeline)](web/20-speak-waiting.png)
speak: hear it, 🎤 Say it (the Coach's practise pipeline)

![speak after 6 s: Skip ›](web/21-speak-skip.png)
speak after 6 s: Skip ›

## Lab app

![neon title (Robolectric renders Roboto; on the phone Noto Sans CJK)](lab/clips-01-neon-title.png)
neon title (Robolectric renders Roboto; on the phone Noto Sans CJK)

![quiz waiting](lab/clips-05-neon-quiz.png)
quiz waiting

![quiz answered wrong](lab/clips-06-neon-quiz-answered.png)
quiz answered wrong

![ink story (sans now)](lab/clips-11-ink-story.png)
ink story (sans now)

![ink big word](lab/clips-12-ink-big-word.png)
ink big word

![paper title](lab/clips-13-paper-title.png)
paper title

![chalk compare](lab/clips-14-chalk-compare.png)
chalk compare

![comic title](lab/clips-15-comic-title.png)
comic title

![sunset compare](lab/clips-16-sunset-compare.png)
sunset compare

![mono title](lab/clips-17-mono-title.png)
mono title

![retro compare](lab/clips-18-retro-compare.png)
retro compare

![karaoke caption (什 active, pinyin under it)](lab/clips-23-karaoke-caption.png)
karaoke caption (什 active, pinyin under it)

![karaoke in a sentence](lab/clips-24-karaoke-sentence.png)
karaoke in a sentence

![listen waiting](lab/clips-25-listen-waiting.png)
listen waiting

![listen right](lab/clips-26-listen-right.png)
listen right

![order waiting (Skip shown)](lab/clips-27-order-waiting.png)
order waiting (Skip shown)

![order wrong](lab/clips-28-order-wrong.png)
order wrong

![reveal front](lab/clips-29-reveal-front.png)
reveal front

![reveal flipped (ink)](lab/clips-30-reveal-flipped.png)
reveal flipped (ink)

![speak waiting](lab/clips-31-speak-waiting.png)
speak waiting

![speak listening (live words)](lab/clips-32-speak-listening.png)
speak listening (live words)
