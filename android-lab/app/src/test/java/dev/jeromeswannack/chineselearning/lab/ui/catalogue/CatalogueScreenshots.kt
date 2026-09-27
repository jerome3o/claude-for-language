package dev.jeromeswannack.chineselearning.lab.ui.catalogue

import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config

/** The exercise catalogue: every type, filtered, copying, dark. */
class CatalogueScreenshots : LabScreenshotTest() {
    @Test fun all() = shoot("catalogue-01-all") { CatalogueScreen(CatalogueUi(), CatalogueActions()) }

    @Test fun speaking() = shoot("catalogue-02-speaking") { CatalogueScreen(CatalogueUi(skill = "speaking"), CatalogueActions()) }

    @Test fun writingCopying() = shoot("catalogue-03-writing-copying") {
        CatalogueScreen(CatalogueUi(skill = "writing", copying = "sentence_making"), CatalogueActions())
    }

    @Test fun listeningError() = shoot("catalogue-04-listening-error", dark = true) {
        CatalogueScreen(CatalogueUi(skill = "listening", error = "Could not copy the sample: No connection — try again when you're online."), CatalogueActions())
    }

    @Config(qualifiers = "w412dp-h3000dp-xxhdpi")
    @Test fun allTall() = shoot("catalogue-05-all-full") { CatalogueScreen(CatalogueUi(), CatalogueActions()) }
}
