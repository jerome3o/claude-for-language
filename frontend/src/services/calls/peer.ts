/**
 * One WebRTC connection to the other participant.
 *
 * The first negotiation has exactly ONE offerer (the impolite side, picked by
 * client id), so the two peers never collide on the opening offer — glare
 * recovery with implicit rollback proved unreliable (the rolled-back side's
 * ICE candidates could go missing). The offerer creates one audio and one
 * video transceiver; the answerer attaches its tracks to the transceivers
 * the offer created. Later renegotiations (rare — camera, flipped camera and
 * screen share are all `replaceTrack`) still use the perfect-negotiation
 * rules, so a collision then is handled too. Signals are applied one at a
 * time, in arrival order.
 */

export type SignalData =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null };

export interface PeerLinkOptions {
  iceServers: RTCIceServer[];
  /** The polite side answers the first offer; the impolite side makes it. */
  polite: boolean;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  sendSignal: (data: SignalData) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
}

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private audio: RTCRtpTransceiver | null = null;
  private video: RTCRtpTransceiver | null = null;
  private audioTrack: MediaStreamTrack | null;
  private videoTrack: MediaStreamTrack | null;
  private readonly remote = new MediaStream();
  private signalChain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: PeerLinkOptions) {
    this.audioTrack = opts.audioTrack;
    this.videoTrack = opts.videoTrack;
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });

    this.pc.ontrack = (event) => {
      if (!this.remote.getTracks().includes(event.track)) this.remote.addTrack(event.track);
      opts.onRemoteStream(this.remote);
    };
    this.pc.onicecandidate = ({ candidate }) => opts.sendSignal({ candidate: candidate ? candidate.toJSON() : null });
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) opts.sendSignal({ description: this.pc.localDescription.toJSON() });
      } catch (err) {
        console.error('[calls] negotiation failed:', err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onconnectionstatechange = () => {
      opts.onConnectionState(this.pc.connectionState);
      if (this.pc.connectionState === 'failed') this.pc.restartIce();
    };

    if (!opts.polite) {
      // The offerer: adding the transceivers fires negotiationneeded → offer.
      this.audio = this.pc.addTransceiver(this.audioTrack ?? 'audio', { direction: 'sendrecv' });
      this.video = this.pc.addTransceiver(this.videoTrack ?? 'video', { direction: 'sendrecv' });
    }
  }

  /** Answerer: adopt the transceivers the offer created and send our tracks on them. */
  private async adoptTransceivers(): Promise<void> {
    if (this.audio && this.video) return;
    for (const t of this.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      if (kind === 'audio' && !this.audio) this.audio = t;
      else if (kind === 'video' && !this.video) this.video = t;
    }
    for (const [t, track] of [[this.audio, this.audioTrack], [this.video, this.videoTrack]] as const) {
      if (!t) continue;
      t.direction = 'sendrecv';
      await t.sender.replaceTrack(track);
    }
  }

  handleSignal(data: SignalData): Promise<void> {
    this.signalChain = this.signalChain.then(() => this.applySignal(data));
    return this.signalChain;
  }

  private async applySignal(data: SignalData): Promise<void> {
    try {
      if ('description' in data && data.description) {
        const description = data.description;
        const collision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
        this.ignoreOffer = !this.opts.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await this.adoptTransceivers();
          await this.pc.setLocalDescription();
          if (this.pc.localDescription) this.opts.sendSignal({ description: this.pc.localDescription.toJSON() });
        }
      } else if ('candidate' in data) {
        try {
          await this.pc.addIceCandidate(data.candidate ?? undefined);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('[calls] signal handling failed:', err);
    }
  }

  async setAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.audioTrack = track;
    await this.audio?.sender.replaceTrack(track);
  }

  async setVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    this.videoTrack = track;
    await this.video?.sender.replaceTrack(track);
  }

  close(): void {
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}
