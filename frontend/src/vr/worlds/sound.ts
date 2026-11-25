/**
 * Sound in VR worlds (docs/VR_WORLDS.md "Sound"): spatial effects from a small pool of PositionalAudio
 * voices (impacts per material, scaled by impact speed; pickup / drop / throw / use), UI sounds
 * (success chime, finish, click, hint) and one ambience loop per world. Files are the self-made CC0
 * mp3s in /vr/sfx/ (scripts/audio/generate-vr-sfx.mjs) — same origin, cached by the browser.
 */
import { Audio, AudioListener, PositionalAudio, type Object3D, type Vector3 } from 'three';
import type { WorldMaterial } from '@shared/vr-worlds';
import type { AmbienceId } from './types';

export const SFX_BASE = '/vr/sfx/';
export type UiSound = 'pickup' | 'drop' | 'throw' | 'teleport' | 'click' | 'use' | 'success' | 'finish' | 'hint' | 'open' | 'water';

/** Impact loudness from the speed things meet at (m/s): silent below ~0.3, full by ~4. */
export function impactVolume(speed: number): number {
  if (!Number.isFinite(speed) || speed < 0.3) return 0;
  return Math.min(1, ((speed - 0.3) / 3.7) ** 0.8);
}

const POOL = 10;
const MIN_GAP_MS = 70;

export class SoundEngine {
  readonly listener = new AudioListener();
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private pool: PositionalAudio[] = [];
  private next = 0;
  private ambience: Audio | null = null;
  private loops = new Map<string, PositionalAudio>();
  private lastImpact = new Map<string, number>();
  /** No impacts until the world has settled (things placed slightly above tables drop on load). */
  mutedUntil = 0;

  attach(camera: Object3D, scene: Object3D) {
    if (this.listener.parent !== camera) camera.add(this.listener);
    if (this.pool.length === 0) {
      for (let i = 0; i < POOL; i++) {
        const a = new PositionalAudio(this.listener);
        a.setRefDistance(0.8);
        a.setRolloffFactor(1.4);
        a.setDistanceModel('inverse');
        scene.add(a);
        this.pool.push(a);
      }
    }
  }

  /** Browsers start audio suspended until a gesture: call from a click / Enter VR. */
  unlock() {
    const ctx = this.listener.context;
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  }

  private load(name: string): Promise<AudioBuffer | null> {
    const hit = this.buffers.get(name);
    if (hit) return Promise.resolve(hit);
    let p = this.loading.get(name);
    if (!p) {
      p = fetch(`${SFX_BASE}${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.listener.context.decodeAudioData(b))
        .then((buf) => {
          this.buffers.set(name, buf);
          return buf;
        })
        .catch(() => null);
      this.loading.set(name, p);
    }
    return p;
  }

  preload(names: readonly string[]) {
    for (const n of names) void this.load(n);
  }

  /** A sound at a place in the world (or at the listener when no place). */
  play(name: string, at?: Vector3 | null, volume = 1, rate = 1) {
    const buf = this.buffers.get(name);
    if (!buf) {
      void this.load(name);
      return;
    }
    if (this.listener.context.state !== 'running') return;
    const voice = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    if (!voice) return;
    if (voice.isPlaying) voice.stop();
    if (at) voice.position.copy(at);
    else voice.position.copy(this.listener.getWorldPosition(voice.position));
    voice.updateMatrixWorld();
    voice.setBuffer(buf);
    voice.setLoop(false);
    voice.setVolume(volume);
    voice.setPlaybackRate(rate);
    voice.play();
  }

  /** Something hit something: the material's sound, louder (and a touch higher) when faster. */
  impact(material: WorldMaterial, at: Vector3, speed: number, key: string) {
    const now = performance.now();
    if (now < this.mutedUntil) return;
    const v = impactVolume(speed);
    if (v <= 0) return;
    const last = this.lastImpact.get(key) ?? 0;
    if (now - last < MIN_GAP_MS) return;
    this.lastImpact.set(key, now);
    this.play(`impact-${material}`, at, 0.25 + 0.75 * v, 0.9 + Math.random() * 0.2 + v * 0.05);
  }

  /** A loop that sits on an object (a running tap); `null` stops it. */
  loop(key: string, name: string | null, at?: Vector3) {
    const cur = this.loops.get(key);
    if (!name) {
      if (cur?.isPlaying) cur.stop();
      return;
    }
    void this.load(name).then((buf) => {
      if (!buf) return;
      let a = this.loops.get(key);
      if (!a) {
        a = new PositionalAudio(this.listener);
        a.setRefDistance(0.6);
        this.pool[0]?.parent?.add(a);
        this.loops.set(key, a);
      }
      if (at) a.position.copy(at);
      a.updateMatrixWorld();
      if (a.isPlaying) return;
      a.setBuffer(buf);
      a.setLoop(true);
      a.setVolume(0.55);
      if (this.listener.context.state === 'running') a.play();
    });
  }

  setAmbience(id: AmbienceId, volume = 0.45) {
    if (id === 'none') return;
    void this.load(`amb-${id}`).then((buf) => {
      if (!buf) return;
      if (!this.ambience) this.ambience = new Audio(this.listener);
      const a = this.ambience;
      if (a.isPlaying) a.stop();
      a.setBuffer(buf);
      a.setLoop(true);
      a.setVolume(volume);
      if (this.listener.context.state === 'running') a.play();
    });
  }

  /** After unlock: start the ambience / loops that were waiting for it. */
  resumeLoops() {
    if (this.ambience && !this.ambience.isPlaying && this.ambience.buffer) this.ambience.play();
    for (const a of this.loops.values()) if (!a.isPlaying && a.buffer && a.getLoop()) a.play();
  }

  dispose() {
    if (this.ambience?.isPlaying) this.ambience.stop();
    for (const a of [...this.pool, ...this.loops.values()]) {
      if (a.isPlaying) a.stop();
      a.removeFromParent();
    }
    this.pool = [];
    this.loops.clear();
    this.listener.removeFromParent();
    // three.js shares ONE AudioContext for the page: never close it (the next world would be silent).
  }
}

export const ALL_SFX: readonly string[] = [
  'pickup', 'drop', 'throw', 'teleport', 'click', 'use', 'success', 'finish', 'hint', 'open',
  'impact-wood', 'impact-glass', 'impact-metal', 'impact-plastic', 'impact-cloth', 'impact-paper', 'impact-ceramic', 'impact-food', 'impact-stone',
];
