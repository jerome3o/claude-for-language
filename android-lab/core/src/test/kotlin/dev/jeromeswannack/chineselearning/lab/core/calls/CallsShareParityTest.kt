package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallShare.Platform
import dev.jeromeswannack.chineselearning.lab.core.calls.CallShare.ShareAudio
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Calls: CallShare reproduces shared/calls/share.ts exactly (parity/fixtures/calls-share.ts). */
class CallsShareParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-share.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun platform(s: String?) = Platform.entries.first { it.wire == s }

    @Test fun labels() {
        val l = root["labels"]!!.jsonObject
        assertEquals(str(l["SHARE_AUDIO_NOTE_WEB"]), CallShare.SHARE_AUDIO_NOTE_WEB)
        assertEquals(str(l["SHARE_AUDIO_NOTE_LAB"]), CallShare.SHARE_AUDIO_NOTE_LAB)
        assertEquals(str(l["SHARE_AUDIO_ON"]), CallShare.SHARE_AUDIO_ON)
        assertEquals(str(l["SHARING_CARD_TITLE"]), CallShare.SHARING_CARD_TITLE)
        assertEquals(str(l["STOP_SHARING_LABEL"]), CallShare.STOP_SHARING_LABEL)
        assertEquals(str(l["SHOW_MY_SHARE_LABEL"]), CallShare.SHOW_MY_SHARE_LABEL)
        assertEquals(str(l["HIDE_MY_SHARE_LABEL"]), CallShare.HIDE_MY_SHARE_LABEL)
    }

    @Test fun audioAndNotes() {
        for (e in root["audioOf"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["audio"]), CallShare.shareAudioOf(o["n"]!!.jsonPrimitive.int).wire)
        }
        val notes = root["notes"]!!.jsonArray
        assertTrue(notes.size == 4)
        for (e in notes) {
            val o = e.jsonObject
            val audio = ShareAudio.of(str(o["audio"]))!!
            val p = platform(str(o["platform"]))
            assertEquals(str(o["note"]), CallShare.shareAudioNote(audio, p), "note $o")
            assertEquals(str(o["line"]), CallShare.shareAudioLine(audio, p), "line $o")
        }
    }

    @Test fun myTile() {
        for (e in root["tiles"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["tile"]), CallShare.myShareTile(o["annotating"]!!.jsonPrimitive.boolean, o["peek"]!!.jsonPrimitive.boolean).wire, "$o")
        }
    }

    @Test fun words() {
        for (e in root["subs"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["sub"]), CallShare.sharingCardSub(str(o["name"])), "$o")
        }
        for (e in root["sound"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["label"]), CallShare.theirShareSoundLabel(str(o["name"]), o["audio"]!!.jsonPrimitive.boolean), "$o")
        }
    }
}
