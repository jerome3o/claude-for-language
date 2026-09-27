package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * The WebRTC signalling payload relayed by the room (web: `SignalData` in services/calls/peer.ts):
 * `{ description: { type, sdp } }` or `{ candidate: RTCIceCandidateInit | null }`. The browser
 * sends `candidate: null` (and `candidate: { candidate: "" }`) for end-of-candidates.
 */
sealed interface CallSignal {
    data class Description(val type: String, val sdp: String) : CallSignal
    data class Candidate(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int, val usernameFragment: String? = null) : CallSignal
    data object EndOfCandidates : CallSignal

    fun toJson(): JsonElement = when (this) {
        is Description -> buildJsonObject { put("description", buildJsonObject { put("type", type); put("sdp", sdp) }) }
        is Candidate -> buildJsonObject {
            put("candidate", buildJsonObject {
                put("candidate", candidate)
                put("sdpMid", sdpMid?.let { JsonPrimitive(it) } ?: JsonNull)
                put("sdpMLineIndex", sdpMLineIndex)
                usernameFragment?.let { put("usernameFragment", it) }
            })
        }
        EndOfCandidates -> buildJsonObject { put("candidate", JsonNull) }
    }

    companion object {
        fun parse(el: JsonElement?): CallSignal? {
            val o = el as? JsonObject ?: return null
            (o["description"] as? JsonObject)?.let { d ->
                val type = (d["type"] as? JsonPrimitive)?.content ?: return null
                val sdp = (d["sdp"] as? JsonPrimitive)?.content ?: return null
                if (type !in setOf("offer", "answer", "pranswer", "rollback")) return null
                return Description(type, sdp)
            }
            if (!o.containsKey("candidate")) return null
            val c = o["candidate"]
            if (c == null || c is JsonNull) return EndOfCandidates
            val co = c as? JsonObject ?: return null
            val cand = (co["candidate"] as? JsonPrimitive)?.content.orEmpty()
            if (cand.isEmpty()) return EndOfCandidates
            val mid = (co["sdpMid"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val index = (co["sdpMLineIndex"] as? JsonPrimitive)?.intOrNull ?: 0
            return Candidate(cand, mid, index, (co["usernameFragment"] as? JsonPrimitive)?.takeIf { it.isString }?.content)
        }
    }
}
