/**
 * One WebRTC connection to the other participant.
 *
 * The first negotiation has exactly ONE offerer (the impolite side, picked by
 * client id), so the two peers never collide on the opening offer — glare
 * recovery with implicit rollback proved unreliable (the rolled-back side's
 * ICE candidates could go missing). The offerer creates one audio and one
 * video transceiver; the answerer attaches its tracks to the transceivers
 * the offer created. Later renegotiations (ICE restarts — camera, flipped
 * camera, screen share and turning a device on mid-call are all
 * `replaceTrack`) still use the perfect-negotiation rules, so a collision then
 * is handled too. Signals are applied one at a time, in arrival order.
 *
 * Screen sharing has its own video transceiver (the third m-line), so the
 * other person can see my camera AND my screen at once. A peer whose offer has
 * only one video m-line (an older app) gets the screen on the camera
 * transceiver instead, like before (`screenChannel` false).
 *
 * Staying up (shared/calls/connection.ts): the link watches its own health —
 * `disconnected` gets a grace period, then an ICE restart; `failed` restarts at
 * once; later restarts back off — but only while the signalling socket is open
 * (`signallingOpen()`), re-checked when it comes back (`signallingChanged()`).
 * The remote stream is never replaced, so the video element keeps its last
 * frame through a drop. Every ~4 s it reads the stats: the route in use (host /
 * srflx / relay, udp / tcp / tls) and the outgoing bitrate estimate, which sets
 * the camera's resolution (`videoEncodingFor`).
 */

import {
  initialLinkHealth,
  linkHealthOn,
  nextIceRestartAt,
  videoEncodingFor,
  type CallDiagKind,
  type LinkHealth,
  newLinkId,
  type PcState,
  type VideoSource,
} from '@shared/calls';

/**
 * `link` = the sending link's id (connection.ts `linkSignalAction`); a fresh
 * link opens with `hello` so the other side knows to start over too, and an
 * offerer still waiting for an answer sends its offer again on a hello.
 */
export type SignalData = (
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null }
  | { hello: true }
) & { link?: string };

export interface PeerLinkOptions {
  iceServers: RTCIceServer[];
  /** The polite side answers the first offer; the impolite side makes it. */
  polite: boolean;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  videoSource?: VideoSource;
  /** My shared screen (sent on the screen transceiver). */
  screenTrack?: MediaStreamTrack | null;
  /** Returns false when the signalling socket is down (the signal is lost). */
  sendSignal: (data: SignalData) => boolean | void;
  onRemoteStream: (stream: MediaStream) => void;
  /** Their shared screen (a stream of its own; only live while they share). */
  onRemoteScreen?: (stream: MediaStream) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onHealth?: (health: LinkHealth) => void;
  /** Is the room socket open right now (ICE restarts wait for it). */
  signallingOpen?: () => boolean;
  onDiag?: (kind: CallDiagKind, detail: string) => void;
}

const STATS_EVERY_MS = 4000;

export class PeerLink {
  readonly pc: RTCPeerConnection;
  /** This link's id, on every signal it sends. */
  readonly id = newLinkId();
  /** The other side's link this one talks to (bound by the first signal that carries an id). */
  remoteLink: string | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private audio: RTCRtpTransceiver | null = null;
  private video: RTCRtpTransceiver | null = null;
  private screen: RTCRtpTransceiver | null = null;
  private screenTrack: MediaStreamTrack | null;
  private readonly remoteScreen = new MediaStream();
  private audioTrack: MediaStreamTrack | null;
  private videoTrack: MediaStreamTrack | null;
  private videoSource: VideoSource;
  private readonly remote = new MediaStream();
  private signalChain: Promise<void> = Promise.resolve();
  private healthValue: LinkHealth = initialLinkHealth(Date.now());
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private scale = 1;
  private route = '';
  private closed = false;

  private readonly opts: PeerLinkOptions;

  constructor(opts: PeerLinkOptions) {
    this.opts = opts;
    this.audioTrack = opts.audioTrack;
    this.videoTrack = opts.videoTrack;
    this.videoSource = opts.videoSource ?? 'camera';
    this.screenTrack = opts.screenTrack ?? null;
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers, bundlePolicy: 'max-bundle' });
    const send = opts.sendSignal;
    this.opts = { ...opts, sendSignal: (data: SignalData) => send({ ...data, link: this.id }) };
    opts = this.opts;

    this.pc.ontrack = (event) => {
      // The second video m-line is their screen.
      const videos = this.pc.getTransceivers().filter((t) => t.receiver.track.kind === 'video');
      if (event.track.kind === 'video' && videos.indexOf(event.transceiver) === 1) {
        if (!this.remoteScreen.getTracks().includes(event.track)) this.remoteScreen.addTrack(event.track);
        opts.onRemoteScreen?.(this.remoteScreen);
        return;
      }
      if (!this.remote.getTracks().includes(event.track)) this.remote.addTrack(event.track);
      opts.onRemoteStream(this.remote);
    };
    this.pc.onicecandidate = ({ candidate }) => {
      opts.sendSignal({ candidate: candidate ? candidate.toJSON() : null });
    };
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
      const state = this.pc.connectionState;
      opts.onConnectionState(state);
      opts.onDiag?.('pc', state);
      this.setHealth(linkHealthOn(this.healthValue, { type: 'pc', state: state as PcState, at: Date.now() }));
      if (state === 'connected') void this.readStats(true);
    };
    this.pc.oniceconnectionstatechange = () => opts.onDiag?.('ice', this.pc.iceConnectionState);

    if (!opts.polite) {
      // The offerer: adding the transceivers fires negotiationneeded → offer.
      this.audio = this.pc.addTransceiver(this.audioTrack ?? 'audio', { direction: 'sendrecv' });
      this.video = this.pc.addTransceiver(this.videoTrack ?? 'video', { direction: 'sendrecv' });
      this.screen = this.pc.addTransceiver(this.screenTrack ?? 'video', { direction: 'sendrecv' });
      void this.applyEncodings();
    }
    this.statsTimer = setInterval(() => void this.readStats(false), STATS_EVERY_MS);
    // A fresh link announces itself: the other side's link, if it is an older one, starts over too.
    opts.sendSignal({ hello: true });
  }

  /**
   * Their socket (or mine) came back and this link was kept: say hello again
   * (they re-send an offer of theirs I may have missed) and re-send mine if it
   * is still unanswered (it may have gone to their old socket).
   */
  resume(): void {
    if (this.closed) return;
    this.opts.sendSignal({ hello: true });
    if (this.pc.signalingState === 'have-local-offer' && this.pc.localDescription) {
      this.opts.sendSignal({ description: this.pc.localDescription.toJSON() });
    }
  }

  get health(): LinkHealth {
    return this.healthValue;
  }

  get remoteStream(): MediaStream {
    return this.remote;
  }

  get remoteScreenStream(): MediaStream {
    return this.remoteScreen;
  }

  /** Both sides have a screen transceiver (false with an older peer: the screen replaces the camera). */
  get screenChannel(): boolean {
    return !!this.screen;
  }

  private setHealth(h: LinkHealth) {
    this.healthValue = h;
    this.opts.onHealth?.(h);
    this.scheduleRestart();
  }

  /** The room socket opened or closed: a restart that waited for it can go now. */
  signallingChanged(): void {
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.closed) return;
    const at = nextIceRestartAt(this.healthValue, this.opts.signallingOpen ? this.opts.signallingOpen() : true);
    if (at === null) return;
    this.restartTimer = setTimeout(() => this.restartIce(), Math.max(0, at - Date.now()));
  }

  /** Ask for new ICE candidates (a new route) without dropping the connection. */
  restartIce(): void {
    if (this.closed) return;
    this.restartTimer = null;
    this.opts.onDiag?.('restart', `ICE restart #${this.healthValue.restarts + 1} (${this.pc.connectionState})`);
    try {
      this.pc.restartIce();
    } catch (err) {
      console.error('[calls] restartIce failed:', err);
    }
    this.setHealth(linkHealthOn(this.healthValue, { type: 'restarted', at: Date.now() }));
  }

  /** Answerer: adopt the transceivers the offer created and send our tracks on them. */
  private async adoptTransceivers(): Promise<void> {
    if (this.audio && this.video && this.screen) return;
    for (const t of this.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      if (kind === 'audio' && !this.audio) this.audio = t;
      else if (kind === 'video' && !this.video) this.video = t;
      else if (kind === 'video' && this.video !== t && !this.screen) this.screen = t;
    }
    // An older peer offered one video m-line: a share goes out on the camera transceiver.
    const legacyShare = !this.screen && this.screenTrack;
    for (const [t, track] of [[this.audio, this.audioTrack], [this.video, legacyShare ? this.screenTrack : this.videoTrack], [this.screen, this.screenTrack]] as const) {
      if (!t) continue;
      t.direction = 'sendrecv';
      await t.sender.replaceTrack(track);
    }
    await this.applyEncodings();
  }

  handleSignal(data: SignalData): Promise<void> {
    this.signalChain = this.signalChain.then(() => this.applySignal(data));
    return this.signalChain;
  }

  private async applySignal(data: SignalData): Promise<void> {
    if (this.closed) return;
    if (data.link && !this.remoteLink) this.remoteLink = data.link;
    try {
      if ('hello' in data) {
        // Their (new) link is listening: an offer of mine still unanswered may never have reached it.
        if (this.pc.signalingState === 'have-local-offer' && this.pc.localDescription) {
          this.opts.sendSignal({ description: this.pc.localDescription.toJSON() });
        }
        return;
      }
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

  /** Start / stop sharing my screen (its own transceiver; the camera keeps going). */
  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    this.screenTrack = track;
    if (this.screen) {
      await this.screen.sender.replaceTrack(track);
      await this.applyEncodings();
      return;
    }
    // An older peer: the screen takes the camera's place while it lasts.
    await this.video?.sender.replaceTrack(track ?? this.videoTrack);
    this.videoSource = track ? 'screen' : 'camera';
    await this.applyEncodings();
  }

  async setVideoTrack(track: MediaStreamTrack | null, source: VideoSource = 'camera'): Promise<void> {
    this.videoTrack = track;
    if (!this.screen && this.screenTrack) return; // legacy share in progress: the camera comes back when it ends
    this.videoSource = source;
    this.scale = 1;
    await this.video?.sender.replaceTrack(track);
    await this.applyEncodings();
  }

  /** Camera: keep the frame rate, drop resolution under congestion. Screen: keep it sharp. Audio first. */
  private async applyEncodings(availableBps: number | null = null): Promise<void> {
    const video = this.video?.sender;
    if (video && typeof video.getParameters === 'function') {
      const want = videoEncodingFor(this.videoSource, availableBps, this.scale);
      try {
        const params = video.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        const enc = params.encodings[0];
        const same =
          enc.maxBitrate === want.maxBitrate &&
          enc.maxFramerate === want.maxFramerate &&
          (enc.scaleResolutionDownBy ?? 1) === want.scaleResolutionDownBy &&
          params.degradationPreference === want.degradationPreference;
        if (!same) {
          enc.maxBitrate = want.maxBitrate;
          enc.maxFramerate = want.maxFramerate;
          enc.scaleResolutionDownBy = want.scaleResolutionDownBy;
          params.degradationPreference = want.degradationPreference;
          await video.setParameters(params);
          if (want.scaleResolutionDownBy !== this.scale && availableBps !== null) {
            this.opts.onDiag?.('media', `camera ${want.scaleResolutionDownBy === 1 ? 'full' : `1/${want.scaleResolutionDownBy}`} resolution (~${Math.round(availableBps / 1000)} kbps up)`);
          }
          this.scale = want.scaleResolutionDownBy;
        }
      } catch {
        /* some browsers refuse parameters before negotiation — tried again on the next stats tick */
      }
    }
    const screen = this.screen?.sender;
    if (screen && typeof screen.getParameters === 'function' && this.screenTrack) {
      const want = videoEncodingFor('screen', null);
      try {
        const params = screen.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        if (params.encodings[0].maxBitrate !== want.maxBitrate || params.degradationPreference !== want.degradationPreference) {
          params.encodings[0].maxBitrate = want.maxBitrate;
          params.encodings[0].maxFramerate = want.maxFramerate;
          params.degradationPreference = want.degradationPreference;
          await screen.setParameters(params);
        }
      } catch {
        /* retried on the next stats tick */
      }
    }
    const audio = this.audio?.sender;
    if (audio && typeof audio.getParameters === 'function') {
      try {
        const params = audio.getParameters();
        if (params.encodings?.length && params.encodings[0].networkPriority !== 'high') {
          params.encodings[0].priority = 'high';
          params.encodings[0].networkPriority = 'high';
          await audio.setParameters(params);
        }
      } catch {
        /* not supported */
      }
    }
  }

  /** The route in use (logged when it changes) and the upload estimate (sets the camera's resolution). */
  private async readStats(force: boolean): Promise<void> {
    if (this.closed || this.pc.connectionState !== 'connected') return;
    try {
      const report = await this.pc.getStats();
      let pair: RTCIceCandidatePairStats | null = null;
      report.forEach((s) => {
        if (s.type === 'transport' && (s as RTCTransportStats).selectedCandidatePairId) {
          pair = report.get((s as RTCTransportStats).selectedCandidatePairId!) as RTCIceCandidatePairStats;
        }
      });
      if (!pair) {
        report.forEach((s) => {
          const p = s as RTCIceCandidatePairStats & { selected?: boolean };
          if (s.type === 'candidate-pair' && (p.nominated || p.selected) && p.state === 'succeeded' && !pair) pair = p;
        });
      }
      const selected = pair as (RTCIceCandidatePairStats & { availableOutgoingBitrate?: number }) | null;
      if (selected) {
        const local = report.get(selected.localCandidateId) as { candidateType?: string; protocol?: string; relayProtocol?: string } | undefined;
        const remote = report.get(selected.remoteCandidateId) as { candidateType?: string } | undefined;
        const route = `${local?.candidateType ?? '?'}${local?.candidateType === 'relay' ? ` (TURN over ${local?.relayProtocol ?? '?'})` : ''}/${local?.protocol ?? '?'} → ${remote?.candidateType ?? '?'}`;
        const rtt = selected.currentRoundTripTime;
        if (route !== this.route || force) {
          this.route = route;
          this.opts.onDiag?.('route', `${route}${typeof rtt === 'number' ? `, rtt ${Math.round(rtt * 1000)} ms` : ''}`);
        }
        const bps = typeof selected.availableOutgoingBitrate === 'number' ? selected.availableOutgoingBitrate : null;
        await this.applyEncodings(bps);
      }
    } catch {
      /* stats are best-effort */
    }
  }

  close(): void {
    this.closed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.close();
  }
}
