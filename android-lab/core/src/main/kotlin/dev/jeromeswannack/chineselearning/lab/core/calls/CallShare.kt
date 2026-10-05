package dev.jeromeswannack.chineselearning.lab.core.calls

/**
 * Port of shared/calls/share.ts — screen sharing, the sharer's side (Jerome's lesson with Minghui,
 * 5 Oct 2026):
 *
 * - **Sound**: a share asks for the tab's / system's sound and sends it on its own audio
 *   transceiver (web). The Lab app RECEIVES it (its WebRTC plays every remote audio track) but
 *   can't send any — its WebRTC takes audio from the microphone only — so a Lab share always
 *   carries [ShareAudio.NONE] and the sharer sees [shareAudioNote].
 * - **No mirror**: the sharer's own screen tile shows a compact card ("You're sharing your
 *   screen · Stop") instead of their own screen ([myShareTile]); drawing on it or "Show it here"
 *   brings the screen back. The other person still has the share on their stage.
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-share.ts → CallsShareParityTest).
 */
object CallShare {
    enum class Platform(val wire: String) { WEB("web"), LAB("lab") }

    /** `ShareAudio`: does my share carry sound. */
    enum class ShareAudio(val wire: String) {
        SHARED("shared"), NONE("none");

        companion object {
            fun of(wire: String?): ShareAudio? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `MyShareTile`: what MY screen tile shows while I share. */
    enum class MyShareTile(val wire: String) { CARD("card"), FULL("full") }

    fun shareAudioOf(audioTracks: Int): ShareAudio = if (audioTracks > 0) ShareAudio.SHARED else ShareAudio.NONE

    const val SHARE_AUDIO_NOTE_WEB = "Sound isn’t shared — share a Chrome tab and tick “Also share tab audio”"
    const val SHARE_AUDIO_NOTE_LAB = "Sound isn’t shared from the app — to share sound, share a Chrome tab from a computer and tick “Also share tab audio”"
    const val SHARE_AUDIO_ON = "🔊 Sound is shared too"

    /** The sharer's note about sound (null = sound is shared). */
    fun shareAudioNote(audio: ShareAudio, platform: Platform): String? = when {
        audio == ShareAudio.SHARED -> null
        platform == Platform.LAB -> SHARE_AUDIO_NOTE_LAB
        else -> SHARE_AUDIO_NOTE_WEB
    }

    /** The sound line on the sharer's card: on, or the note. */
    fun shareAudioLine(audio: ShareAudio, platform: Platform): String = shareAudioNote(audio, platform) ?: SHARE_AUDIO_ON

    /** The card, or my screen itself (only while I draw on it, or asked to see it). */
    fun myShareTile(annotating: Boolean, peek: Boolean): MyShareTile = if (annotating || peek) MyShareTile.FULL else MyShareTile.CARD

    const val SHARING_CARD_TITLE = "You’re sharing your screen"
    const val STOP_SHARING_LABEL = "⏹ Stop sharing"
    const val SHOW_MY_SHARE_LABEL = "👁 Show it here"
    const val HIDE_MY_SHARE_LABEL = "Hide my screen"

    private fun first(name: String?, fallback: String): String =
        name?.trim()?.split(Regex("\\s+"))?.firstOrNull()?.takeIf { it.isNotEmpty() } ?: fallback

    /** Under the card's title: who sees it. */
    fun sharingCardSub(otherName: String?): String =
        if (!otherName.isNullOrBlank()) "${first(otherName, "They")} sees it on their screen." else "The other person sees it on their screen."

    /** The viewer's small badge on the shared screen while its sound comes through. */
    fun theirShareSoundLabel(otherName: String?, audio: Boolean): String? {
        if (!audio) return null
        val n = first(otherName, "")
        return if (n.isNotEmpty()) "🔊 Sound from $n’s screen" else "🔊 Sound from the shared screen"
    }
}
