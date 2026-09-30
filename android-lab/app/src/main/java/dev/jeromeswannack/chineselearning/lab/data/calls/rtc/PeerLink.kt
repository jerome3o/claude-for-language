package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

import android.util.Log
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallSignal
import dev.jeromeswannack.chineselearning.lab.data.api.IceServerDto
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerListener
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerSession
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerStats
import dev.jeromeswannack.chineselearning.lab.ui.calls.VideoHandle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsReport
import org.webrtc.RtpParameters
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import kotlin.coroutines.resume

/**
 * One WebRTC connection to the other participant — a port of frontend/src/services/calls/peer.ts,
 * so a phone and a browser negotiate by the same rules:
 *
 * The first negotiation has exactly ONE offerer (the impolite side, picked by client id). The
 * offerer creates one audio and one video transceiver; the answerer attaches its tracks to the
 * transceivers the offer created. Camera flips happen inside the capturer and screen share is
 * `setTrack`, so there is no renegotiation in practice; if one happens, perfect-negotiation rules
 * handle a collision. Signals are applied one at a time, in arrival order.
 *
 * Round 2 (PR B): screen sharing has its OWN video transceiver (the third m-line), so the other person
 * sees my camera AND my screen: the offerer creates audio, video (camera), video (screen); the
 * answerer adopts them in that order ([TransceiverRoles]). Incoming video on the screen transceiver
 * is their screen ([PeerListener.onRemoteScreen]), the rest their camera. An older app offers one
 * video m-line: then [screenChannel] is false, a share replaces the camera like before and their
 * screen arrives on the camera stream.
 *
 * Round 2: the CallController drives ICE restarts ([restartIce], from the link's health and
 * backoff — this class never restarts on its own), a mic or camera that appears mid-call goes
 * onto the existing transceiver ([setAudio] / [setVideo]), the video sender's encoding follows the
 * bandwidth estimate ([setVideoEncoding]) and the audio sender is marked high priority.
 */
class PeerLink(
    factory: PeerConnectionFactory,
    iceServers: List<IceServerDto>,
    private val polite: Boolean,
    private var audioTrack: AudioTrack?,
    private var videoTrack: VideoTrack?,
    private var screenTrack: VideoTrack?,
    private val listener: PeerListener,
) : PeerSession {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val signals = Channel<CallSignal>(Channel.UNLIMITED)
    @Volatile private var makingOffer = false
    private var ignoreOffer = false
    private var audio: RtpTransceiver? = null
    private var video: RtpTransceiver? = null
    private var screen: RtpTransceiver? = null
    /** The answerer adopts the offer's transceivers once (getTransceivers() disposes the wrappers it handed out before). */
    private var adopted = false
    @Volatile private var closed = false

    // Incoming video by receiver id, routed to camera / screen once the transceivers' roles are known.
    private val remoteLock = Any()
    private val remoteByReceiver = LinkedHashMap<String, VideoTrack>()
    @Volatile private var cameraReceiverId: String? = null
    @Volatile private var screenReceiverId: String? = null
    private var shownCamera: VideoTrack? = null
    private var shownScreen: VideoTrack? = null

    /** Both sides have a screen transceiver (false with an older app: a share replaces the camera). */
    override val screenChannel: Boolean get() = screen != null

    private val pc: PeerConnection = factory.createPeerConnection(
        PeerConnection.RTCConfiguration(iceServers.flatMap { it.toWebRtc() }).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        },
        Observer(),
    ) ?: error("Could not create the peer connection")

    init {
        if (!polite) {
            // The offerer: adding the transceivers fires onRenegotiationNeeded → offer.
            val init = RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV)
            audio = if (audioTrack != null) pc.addTransceiver(audioTrack, init) else pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, init)
            video = videoTrack?.let { pc.addTransceiver(it, init) } ?: pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, init)
            screen = screenTrack?.let { pc.addTransceiver(it, init) } ?: pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, init)
            cameraReceiverId = runCatching { video?.receiver?.id() }.getOrNull()
            screenReceiverId = runCatching { screen?.receiver?.id() }.getOrNull()
            applyScreenEncoding()
        }
        scope.launch { for (s in signals) apply(s) }
    }

    private inner class Observer : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) = listener.sendSignal(CallSignal.Candidate(c.sdp, c.sdpMid, c.sdpMLineIndex))
        override fun onRenegotiationNeeded() {
            if (closed) return
            scope.launch {
                try {
                    makingOffer = true
                    if (setLocal()) pc.localDescription?.let { listener.sendSignal(CallSignal.Description(it.type.canonicalForm(), it.description)) }
                } finally {
                    makingOffer = false
                }
            }
        }
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            if (!closed) listener.onConnectionState(newState.name.lowercase())
        }
        override fun onTrack(transceiver: RtpTransceiver) = incoming(transceiver.receiver)
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = incoming(receiver)
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            if (!closed) listener.onIceState(state.name.lowercase())
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) = Unit
    }

    override fun handleSignal(signal: CallSignal) {
        signals.trySend(signal)
    }

    private suspend fun apply(signal: CallSignal) {
        if (closed) return
        try {
            when (signal) {
                is CallSignal.Description -> {
                    val offer = signal.type == "offer"
                    val collision = offer && (makingOffer || pc.signalingState() != PeerConnection.SignalingState.STABLE)
                    ignoreOffer = !polite && collision
                    if (ignoreOffer) return
                    if (!setRemote(SessionDescription(SessionDescription.Type.fromCanonicalForm(signal.type), signal.sdp))) return
                    if (offer) {
                        adoptTransceivers()
                        if (setLocal()) pc.localDescription?.let { listener.sendSignal(CallSignal.Description(it.type.canonicalForm(), it.description)) }
                    }
                }
                is CallSignal.Candidate -> {
                    val ok = pc.addIceCandidate(IceCandidate(signal.sdpMid ?: "", signal.sdpMLineIndex, signal.candidate))
                    if (!ok && !ignoreOffer) Log.w(TAG, "ICE candidate refused")
                }
                CallSignal.EndOfCandidates -> Unit
            }
        } catch (e: Exception) {
            Log.e(TAG, "signal handling failed", e)
        }
    }

    /** A video track arrived: remembered by its receiver, shown as their camera or their screen. */
    private fun incoming(receiver: RtpReceiver) {
        if (closed) return
        val track = receiver.track() as? VideoTrack ?: return
        val id = runCatching { receiver.id() }.getOrNull() ?: return
        synchronized(remoteLock) { remoteByReceiver[id] = track }
        routeRemote()
    }

    /** Their camera / screen to the listener (only once the roles are known, and only when they change). */
    private fun routeRemote() {
        val camId = cameraReceiverId ?: return
        val scrId = screenReceiverId
        var cam: VideoTrack? = null
        var scr: VideoTrack? = null
        synchronized(remoteLock) {
            for ((id, t) in remoteByReceiver) {
                if (TransceiverRoles.isRemoteScreen(id, scrId)) scr = t
                else if (id == camId || cam == null) cam = t
            }
            if (cam === shownCamera) cam = null else shownCamera = cam
            if (scr === shownScreen) scr = null else shownScreen = scr
        }
        cam?.let { listener.onRemoteVideo(it) }
        scr?.let { listener.onRemoteScreen(it) }
    }

    /** Answerer: adopt the transceivers the offer created and send our tracks on them. */
    private fun adoptTransceivers() {
        if (audio != null && video != null && (screen != null || adopted)) return
        val list = pc.transceivers
        val roles = TransceiverRoles.adopt(list.map {
            when (it.mediaType) {
                MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO -> TransceiverRoles.Kind.AUDIO
                MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO -> TransceiverRoles.Kind.VIDEO
                else -> null
            }
        })
        adopted = true
        audio = roles.audio?.let(list::get)
        video = roles.camera?.let(list::get)
        screen = roles.screen?.let(list::get)
        cameraReceiverId = runCatching { video?.receiver?.id() }.getOrNull()
        screenReceiverId = runCatching { screen?.receiver?.id() }.getOrNull()
        // An older peer offered one video m-line: a share goes out on the camera transceiver.
        val sends = TransceiverRoles.sends(roles.screenChannel, videoTrack, screenTrack)
        audio?.let { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV; it.sender.setTrack(audioTrack, false) }
        video?.let { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV; it.sender.setTrack(sends.camera, false) }
        screen?.let { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV; it.sender.setTrack(sends.screen, false) }
        prioritiseAudio()
        pendingEncoding?.let { setVideoEncoding(it) }
        applyScreenEncoding()
        routeRemote()
    }

    override fun setVideo(video: VideoHandle?) {
        val track = video as? VideoTrack
        videoTrack = track
        if (screen == null && screenTrack != null) return // legacy share in progress: the camera comes back when it ends
        if (!closed) this.video?.sender?.setTrack(track, false)
        pendingEncoding?.let { setVideoEncoding(it) }
    }

    /** Start / stop sharing my screen: its own transceiver, the camera keeps going (an older peer: it takes the camera's place). */
    override fun setScreen(video: VideoHandle?) {
        val track = video as? VideoTrack
        screenTrack = track
        if (closed) return
        val s = screen
        if (s != null) {
            s.sender.setTrack(track, false)
            applyScreenEncoding()
            return
        }
        this.video?.sender?.setTrack(track ?: videoTrack, false)
        pendingEncoding?.let { setVideoEncoding(it) }
    }

    /** The screen sender keeps its resolution (core CallConnection.videoEncodingFor(SCREEN)). */
    private fun applyScreenEncoding() {
        val sender = screen?.sender ?: return
        if (closed || screenTrack == null) return
        val encoding = CallConnection.videoEncodingFor(CallConnection.VideoSource.SCREEN, null)
        runCatching {
            val p = sender.parameters
            p.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
            p.encodings.forEach {
                it.maxBitrateBps = encoding.maxBitrate
                it.maxFramerate = encoding.maxFramerate
                it.scaleResolutionDownBy = encoding.scaleResolutionDownBy
            }
            sender.parameters = p
        }.onFailure { Log.w(TAG, "screen encoding", it) }
    }

    override fun setAudio(audio: VideoHandle?) {
        val track = audio as? AudioTrack
        audioTrack = track
        if (!closed) this.audio?.sender?.setTrack(track, false)
        prioritiseAudio()
    }

    override fun restartIce() {
        if (!closed) runCatching { pc.restartIce() }.onFailure { Log.w(TAG, "restartIce failed", it) }
    }

    /** Voice first: the audio sender gets high network / bitrate priority. */
    private fun prioritiseAudio() {
        val sender = audio?.sender ?: return
        runCatching {
            val p = sender.parameters
            if (p.encodings.isEmpty()) return
            p.encodings.forEach { it.networkPriority = org.webrtc.Priority.HIGH; it.bitratePriority = 4.0 }
            sender.parameters = p
        }.onFailure { Log.w(TAG, "audio priority", it) }
    }

    private var pendingEncoding: CallConnection.VideoEncoding? = null

    /** The video sender's encoding (core CallConnection.videoEncodingFor), kept and re-applied after a track change. */
    override fun setVideoEncoding(encoding: CallConnection.VideoEncoding) {
        pendingEncoding = encoding
        val sender = video?.sender ?: return
        if (closed) return
        runCatching {
            val p = sender.parameters
            p.degradationPreference = if (encoding.degradationPreference == "maintain-resolution") RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION else RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
            p.encodings.forEach {
                it.maxBitrateBps = encoding.maxBitrate
                it.maxFramerate = encoding.maxFramerate
                it.scaleResolutionDownBy = encoding.scaleResolutionDownBy
            }
            sender.parameters = p
        }.onFailure { Log.w(TAG, "video encoding", it) }
    }

    /**
     * The outgoing bandwidth estimate (the active candidate pair's availableOutgoingBitrate) and the
     * route it takes: "relay/udp via turn", "host", "srflx"… from the local candidate.
     */
    override suspend fun stats(): PeerStats? {
        if (closed) return null
        val report = suspendCancellableCoroutine<RTCStatsReport?> { cont ->
            runCatching { pc.getStats { r -> if (cont.isActive) cont.resume(r) } }.onFailure { if (cont.isActive) cont.resume(null) }
        } ?: return null
        return statsFrom(report.statsMap.values.map { it.type to (it.members + ("__id" to it.id)) })
    }

    private suspend fun setLocal(): Boolean = suspendCancellableCoroutine { cont ->
        pc.setLocalDescription(object : SdpAdapter() {
            override fun onSetSuccess() { if (cont.isActive) cont.resume(true) }
            override fun onSetFailure(error: String?) { Log.e(TAG, "setLocalDescription: $error"); if (cont.isActive) cont.resume(false) }
        })
    }

    private suspend fun setRemote(sd: SessionDescription): Boolean = suspendCancellableCoroutine { cont ->
        pc.setRemoteDescription(object : SdpAdapter() {
            override fun onSetSuccess() { if (cont.isActive) cont.resume(true) }
            override fun onSetFailure(error: String?) { Log.e(TAG, "setRemoteDescription: $error"); if (cont.isActive) cont.resume(false) }
        }, sd)
    }

    override fun close() {
        if (closed) return
        closed = true
        signals.close()
        scope.cancel()
        runCatching { pc.dispose() }
    }

    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(sd: SessionDescription?) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) = Unit
        override fun onSetFailure(error: String?) = Unit
    }

    companion object {
        private const val TAG = "PeerLink"

        /** Pure: (type, members + "__id") of every stats entry → bandwidth + route (unit-tested). */
        fun statsFrom(entries: List<Pair<String, Map<String, Any?>>>): PeerStats {
            fun of(type: String, id: Any?) = entries.firstOrNull { (t, m) -> t == type && id != null && m["__id"] == id }?.second
            val pairId = entries.firstOrNull { it.first == "transport" }?.second?.get("selectedCandidatePairId")
            val pair = of("candidate-pair", pairId)
                ?: entries.firstOrNull { (t, m) -> t == "candidate-pair" && m["nominated"] == true && m["state"] == "succeeded" }?.second
            val bps = (pair?.get("availableOutgoingBitrate") as? Number)?.toDouble()
            val local = of("local-candidate", pair?.get("localCandidateId"))
            val route = local?.let { describeRoute(it["candidateType"] as? String, it["protocol"] as? String, it["relayProtocol"] as? String) }
            return PeerStats(bps, route)
        }

        /** "relay/udp via turn", "relay/tls via turns", "host", "srflx", "prflx". */
        fun describeRoute(candidateType: String?, protocol: String?, relayProtocol: String?): String? {
            val type = candidateType ?: return null
            if (type != "relay") return type
            return "relay/${relayProtocol ?: protocol ?: "?"} via ${if (relayProtocol == "tls") "turns" else "turn"}"
        }

        /** `{ urls: string | string[], username?, credential? }` → WebRTC ice servers. */
        fun IceServerDto.toWebRtc(): List<PeerConnection.IceServer> {
            val list = when (val u = urls) {
                is JsonArray -> u.mapNotNull { (it as? JsonPrimitive)?.content }
                is JsonPrimitive -> listOf(u.content)
                else -> emptyList()
            }
            if (list.isEmpty()) return emptyList()
            val b = PeerConnection.IceServer.builder(list)
            username?.let { b.setUsername(it) }
            credential?.let { b.setPassword(it) }
            return listOf(b.createIceServer())
        }
    }
}
