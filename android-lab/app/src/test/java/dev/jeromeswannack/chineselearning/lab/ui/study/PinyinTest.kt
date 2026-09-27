package dev.jeromeswannack.chineselearning.lab.ui.study

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Pinyin under a typed answer comes from the device's ICU (no network, like pinyin-pro). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PinyinTest {
    @Test fun tonesMarksAndSpaces() {
        assertEquals("dǎ suàn", Pinyin.of("打算"))
        assertEquals("nǐ hǎo", Pinyin.of("你好"))
        assertEquals("", Pinyin.of("  "))
    }
}
