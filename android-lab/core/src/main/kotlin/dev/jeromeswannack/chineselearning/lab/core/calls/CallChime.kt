package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * Port of shared/calls/chime.ts — call sounds (Minghui, Oct 2026): a soft chime and a short toast
 * when the OTHER person enters the call ("Minghui joined"), a softer, lower one when they leave
 * ("Minghui left"), a gentle bell when the call timer reaches zero ([CallTimer]).
 *
 * From the room's presence events: my own join / reconnects never chime (a welcome only takes
 * note); their reconnect (left, back within [PEER_LEAVE_GRACE_MS]) is silent; a leave is announced
 * after the grace; a return after an announced leave is announced. Sounds can be switched off in
 * the call's ⋯ menu, per device.
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-chime.ts → CallsChimeParityTest).
 */
object CallChime {
    const val PEER_LEAVE_GRACE_MS = 8_000L

    enum class Kind(val wire: String) { JOIN("join"), LEAVE("leave"), TIMER("timer") }

    data class Peer(val clientId: String, val name: String, val here: Boolean, val leftAt: Long?, val announcedLeft: Boolean)

    /** Everyone this device has seen in the call, by user id (insertion order kept, like a JS object). */
    data class State(val peers: Map<String, Peer> = linkedMapOf())

    val EMPTY = State()

    data class Alert(val kind: Kind, val userId: String, val name: String, val text: String)

    data class PeerRef(val clientId: String, val userId: String, val name: String)

    sealed interface Event {
        data class Welcome(val peers: List<PeerRef>) : Event
        data class Joined(val peer: PeerRef) : Event
        data class Left(val clientId: String) : Event
        data object Tick : Event
    }

    private fun firstName(name: String): String = name.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() } ?: "They"

    fun joinedText(name: String): String = "${firstName(name)} joined"
    fun leftText(name: String): String = "${firstName(name)} left"

    data class Step(val state: State, val alerts: List<Alert>)

    fun chimeStep(state: State, event: Event, myUserId: String, now: Long): Step {
        val peers = LinkedHashMap(state.peers)
        val alerts = mutableListOf<Alert>()
        when (event) {
            is Event.Welcome -> {
                for ((userId, p) in peers.entries.toList()) {
                    if (p.here && event.peers.none { it.userId == userId }) peers[userId] = p.copy(here = false, leftAt = now)
                }
                for (p in event.peers) {
                    if (p.userId == myUserId) continue
                    peers[p.userId] = Peer(p.clientId, p.name, here = true, leftAt = null, announcedLeft = false)
                }
            }
            is Event.Joined -> {
                val p = event.peer
                if (p.userId != myUserId) {
                    val prev = peers[p.userId]
                    if (prev == null || (!prev.here && prev.announcedLeft)) alerts += Alert(Kind.JOIN, p.userId, p.name, joinedText(p.name))
                    peers[p.userId] = Peer(p.clientId, p.name, here = true, leftAt = null, announcedLeft = false)
                }
            }
            is Event.Left -> {
                val entry = peers.entries.firstOrNull { it.value.clientId == event.clientId && it.value.here }
                if (entry != null) peers[entry.key] = entry.value.copy(here = false, leftAt = now)
            }
            Event.Tick -> Unit
        }
        for ((userId, p) in peers.entries.toList()) {
            if (!p.here && !p.announcedLeft && p.leftAt != null && now - p.leftAt >= PEER_LEAVE_GRACE_MS) {
                peers[userId] = p.copy(announcedLeft = true)
                alerts += Alert(Kind.LEAVE, userId, p.name, leftText(p.name))
            }
        }
        return Step(State(peers), alerts)
    }

    fun chimeNeedsTick(state: State): Boolean = state.peers.values.any { !it.here && !it.announcedLeft && it.leftAt != null }

    // ------------------------------------------------------------------ the sounds

    data class Tone(val freq: Double, val at: Int, val ms: Int, val gain: Double)

    val CHIME_TONES: Map<Kind, List<Tone>> = mapOf(
        Kind.JOIN to listOf(Tone(659.25, 0, 380, 0.16), Tone(830.61, 140, 520, 0.16)),
        Kind.LEAVE to listOf(Tone(523.25, 0, 380, 0.1), Tone(440.0, 160, 520, 0.1)),
        Kind.TIMER to listOf(Tone(880.0, 0, 700, 0.2), Tone(659.25, 260, 700, 0.2), Tone(880.0, 520, 1100, 0.2)),
    )

    const val CHIME_ATTACK_MS = 12

    /** One sample at [tMs] (sum of the tones: sine × linear attack × exponential decay). */
    fun chimeSample(kind: Kind, tMs: Double): Double {
        var v = 0.0
        for (tone in CHIME_TONES.getValue(kind)) {
            val t = tMs - tone.at
            if (t < 0 || t >= tone.ms) continue
            val env = if (t < CHIME_ATTACK_MS) t / CHIME_ATTACK_MS else exp((-5 * (t - CHIME_ATTACK_MS)) / tone.ms)
            v += tone.gain * env * sin((2 * PI * tone.freq * t) / 1000)
        }
        return v
    }

    fun chimeLengthMs(kind: Kind): Int = CHIME_TONES.getValue(kind).maxOf { it.at + it.ms }

    /** 16-bit mono PCM of a chime at [sampleRate] — what the app plays. */
    fun chimePcm(kind: Kind, sampleRate: Int = 44_100): ShortArray {
        val n = (chimeLengthMs(kind).toLong() * sampleRate / 1000).toInt()
        return ShortArray(n) { i -> (chimeSample(kind, i * 1000.0 / sampleRate).coerceIn(-1.0, 1.0) * Short.MAX_VALUE).toInt().toShort() }
    }

    const val CALL_SOUNDS_KEY = "call-sounds-v1"
    fun callSoundsOn(stored: String?): Boolean = stored != "off"
    const val CALL_SOUNDS_ON_LABEL = "🔔 Call sounds: on"
    const val CALL_SOUNDS_OFF_LABEL = "🔕 Call sounds: off"
    fun callSoundsLabel(on: Boolean): String = if (on) CALL_SOUNDS_ON_LABEL else CALL_SOUNDS_OFF_LABEL
}
