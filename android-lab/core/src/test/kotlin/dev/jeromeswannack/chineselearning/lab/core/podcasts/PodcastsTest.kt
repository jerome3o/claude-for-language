package dev.jeromeswannack.chineselearning.lab.core.podcasts

import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts.Reveal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The podcast player's rules (Podcasts.kt; docs/PODCASTS.md). Lab-only, so pinned here rather than parity-tested. */
class PodcastsTest {
    @Test
    fun revealGoesChinesePinyinEnglishThenCoversAgain() {
        assertEquals(Reveal.HANZI, Podcasts.nextReveal(Reveal.LISTEN, hasPinyin = true, hasEnglish = true))
        assertEquals(Reveal.PINYIN, Podcasts.nextReveal(Reveal.HANZI, hasPinyin = true, hasEnglish = true))
        assertEquals(Reveal.ENGLISH, Podcasts.nextReveal(Reveal.PINYIN, hasPinyin = true, hasEnglish = true))
        assertEquals(Reveal.LISTEN, Podcasts.nextReveal(Reveal.ENGLISH, hasPinyin = true, hasEnglish = true))
    }

    @Test
    fun revealSkipsStepsTheSegmentHasNot() {
        // English-only line: no pinyin step.
        assertEquals(Reveal.ENGLISH, Podcasts.nextReveal(Reveal.HANZI, hasPinyin = false, hasEnglish = true))
        // Still being translated: Chinese → pinyin → covered.
        assertEquals(Reveal.LISTEN, Podcasts.nextReveal(Reveal.PINYIN, hasPinyin = true, hasEnglish = false))
        assertEquals(Reveal.HANZI, Podcasts.nextReveal(Reveal.LISTEN, hasPinyin = false, hasEnglish = false))
        assertEquals(Reveal.LISTEN, Podcasts.nextReveal(Reveal.HANZI, hasPinyin = false, hasEnglish = false))
    }

    @Test
    fun segmentAtFindsTheOnePlaying() {
        val starts = listOf(0L, 4000L, 9000L, 15000L)
        assertEquals(-1, Podcasts.segmentAt(listOf(500L), 100))
        assertEquals(0, Podcasts.segmentAt(starts, 0))
        assertEquals(0, Podcasts.segmentAt(starts, 3999))
        assertEquals(1, Podcasts.segmentAt(starts, 4000))
        assertEquals(2, Podcasts.segmentAt(starts, 14_999))
        assertEquals(3, Podcasts.segmentAt(starts, 99_999))
        assertEquals(-1, Podcasts.segmentAt(emptyList(), 10))
    }

    @Test
    fun oneSegmentStopsJustAfterItsEndButNeverInTheNext() {
        assertEquals(4250, Podcasts.stopAt(4000, 6000))
        assertEquals(4100, Podcasts.stopAt(4000, 4100))
        assertEquals(4250, Podcasts.stopAt(4000, null))
        assertEquals(0, Podcasts.startAt(50))
        assertEquals(880, Podcasts.startAt(1000))
    }

    @Test
    fun labels() {
        assertEquals("0:00", Podcasts.clock(-5))
        assertEquals("4:05", Podcasts.clock(245_400))
        assertEquals("1:02:03", Podcasts.clock(3_723_000))
        assertEquals("31 min", Podcasts.minutes(1856))
        assertEquals("1 h 05 min", Podcasts.minutes(3900))
        assertEquals("45 s", Podcasts.minutes(45))
        assertNull(Podcasts.minutes(null))
        assertEquals("71 MB", Podcasts.size(74_719_232))
        assertEquals("800 KB", Podcasts.size(819_200))
        assertNull(Podcasts.size(0))
        assertEquals("6 Oct 2026", Podcasts.date("2026-10-06T08:00:00.000Z"))
        assertNull(Podcasts.date("yesterday"))
        assertEquals("Speaker 2", Podcasts.speakerLabel("2", 2))
        assertNull(Podcasts.speakerLabel("1", 1))
        assertEquals("from the start", Podcasts.lessonFromLabel(0))
        assertEquals("from 4:05", Podcasts.lessonFromLabel(245_000))
        assertEquals(3, Podcasts.lessonFrom(3, 10))
        assertEquals(0, Podcasts.lessonFrom(-1, 10))
    }

    @Test
    fun statusLines() {
        assertEquals("Not transcribed yet", Podcasts.statusLine(null, null, null, null, null))
        assertEquals("Translating 12 / 40 — you can start listening", Podcasts.statusLine("translating", null, 12, 40, null))
        assertEquals("Transcribed · 40 segments", Podcasts.statusLine("ready", null, 40, 40, null))
        assertEquals("Couldn't transcribe: too big", Podcasts.statusLine("failed", null, null, null, "too big"))
        assertTrue(Podcasts.isWorking("transcribing"))
        assertFalse(Podcasts.isWorking("ready"))
        assertTrue(Podcasts.isListenable("translating"))
        assertFalse(Podcasts.isListenable("transcribing"))
        assertEquals(0.25f, Podcasts.fraction("translating", 10, 40))
        assertNull(Podcasts.fraction("transcribing", null, null))
    }
}
