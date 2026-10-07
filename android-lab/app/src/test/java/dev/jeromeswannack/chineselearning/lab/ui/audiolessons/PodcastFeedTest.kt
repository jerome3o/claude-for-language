package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import org.junit.Assert.assertEquals
import org.junit.Test

/** The masked feed link (the web's maskFeedUrl in PodcastFeedSection.tsx). */
class PodcastFeedTest {
    @Test fun masksTheTokenOnly() {
        val token = "o_SLkX2f9QdW3bq7Lm0pZr8Tn4Yc6Hv1Ja5Ue2Gtcg8"
        assertEquals(
            "https://api.example/api/podcast/o_SL…tcg8/feed.xml",
            PodcastFeed.mask("https://api.example/api/podcast/$token/feed.xml"),
        )
        assertEquals("https://api.example/other", PodcastFeed.mask("https://api.example/other"))
    }
}
