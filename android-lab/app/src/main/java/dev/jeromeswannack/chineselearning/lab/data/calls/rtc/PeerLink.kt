package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

import android.util.Log
import dev.jeromeswannack.chineselearning.lab.core.calls.CallSignal
import dev.jeromeswannack.chineselearning.lab.data.api.IceServerDto
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerListener
import dev.jeromeswannack.chineselearning.lab.ui.calls.PeerSession
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
 */
class PeerLink(
    factory: PeerConnectionFactory,
    iceServers: List<IceServerDto>,
    private val polite: Boolean,
    private val audioTrack: AudioTrack?,
    private var videoTrack: VideoTrack?,
    private val listener: PeerListener,
) : PeerSession {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val signals = Channel<CallSignal>(Channel.UNLIMITED)
    @Volatile private var makingOffer = false
    private var ignoreOffer = false
    private var audio: RtpTransceiver? = null
    private var video: RtpTransceiver? = null
    @Volatile private var closed = false

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
            listener.onConnectionState(newState.name.lowercase())
            if (newState == PeerConnection.PeerConnectionState.FAILED && !closed) pc.restartIce()
        }
        override fun onTrack(transceiver: RtpTransceiver) {
            (transceiver.receiver.track() as? VideoTrack)?.let { listener.onRemoteVideo(it) }
        }
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
            (receiver.track() as? VideoTrack)?.let { listener.onRemoteVideo(it) }
        }
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
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

    /** Answerer: adopt the transceivers the offer created and send our tracks on them. */
    private fun adoptTransceivers() {
        if (audio != null && video != null) return
        for (t in pc.transceivers) {
            when (t.mediaType) {
                MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO -> if (audio == null) audio = t
                MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO -> if (video == null) video = t
                else -> Unit
            }
        }
        audio?.let { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV; it.sender.setTrack(audioTrack, false) }
        video?.let { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV; it.sender.setTrack(videoTrack, false) }
    }

    override fun setVideo(video: VideoHandle?) {
        val track = video as? VideoTrack
        videoTrack = track
        if (!closed) this.video?.sender?.setTrack(track, false)
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
