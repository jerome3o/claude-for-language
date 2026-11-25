/**
 * The street's object models (docs/VR_WORLDS.md). Each is drawn in its object's own frame — the origin
 * is the middle of the object's collider (index.tsx) — and faces +Z unless its object turns it. All
 * procedural; every sign and label is invented (no real shop, brand or logo).
 *
 * The crossing button and the street lamp tell the rest of the street what they're doing through
 * `street` (below): the signal heads on both sides of the road and every lamp along it follow them.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CatmullRomCurve3, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, TubeGeometry, Vector3, type Group, type Mesh } from 'three';
import { Ball, Box, Cyl, Lathe, RBox, bottleProfile, cupProfile, labelTexture, mat, stripeTexture } from '../kit';
import type { ModelProps } from '../types';
import { Merged } from './merge';
import { canvasTex, fitText, goodsTex, signTex, walkerTex } from './textures';

/** What the crossing button and the lamp switch are doing (shared by every model that shows it). */
export const street = { green: false, lampsOn: false };

type V3 = [number, number, number];

const glowCache = new Map<string, MeshBasicMaterial>();
/** A lit lamp / screen: unshaded, not tone mapped (it glows at dusk). */
export function glow(color: string, map?: ReturnType<typeof canvasTex>): MeshBasicMaterial {
  const k = `${color}:${map?.uuid ?? ''}`;
  let g = glowCache.get(k);
  if (!g) {
    g = new MeshBasicMaterial({ color, map: map ?? null, toneMapped: false });
    glowCache.set(k, g);
  }
  return g;
}

/** A printed surface (signs, labels): a standard material with the texture as its map. */
const printCache = new Map<string, MeshStandardMaterial>();
export function print(map: ReturnType<typeof canvasTex>, opts: { emissive?: number; roughness?: number; transparent?: boolean; doubleSide?: boolean } = {}): MeshStandardMaterial {
  const k = `${map.uuid}:${JSON.stringify(opts)}`;
  let p = printCache.get(k);
  if (!p) {
    p = new MeshStandardMaterial({
      map, roughness: opts.roughness ?? 0.6, transparent: !!opts.transparent, side: opts.doubleSide ? DoubleSide : undefined,
      ...(opts.emissive ? { emissive: '#ffffff', emissiveMap: map, emissiveIntensity: opts.emissive } : {}),
    });
    printCache.set(k, p);
  }
  return p;
}

function Plane({ size, material, position, rotation }: { size: [number, number]; material: THREE_Material; position?: V3; rotation?: V3 }) {
  return (
    <mesh position={position} rotation={rotation} material={material}>
      <planeGeometry args={size} />
    </mesh>
  );
}
type THREE_Material = MeshStandardMaterial | MeshBasicMaterial;

const torusCache = new Map<string, TorusGeometry>();
function torus(r: number, tube: number, arc = Math.PI * 2, seg = 24) {
  const k = `${r}:${tube}:${arc}:${seg}`;
  let g = torusCache.get(k);
  if (!g) {
    g = new TorusGeometry(r, tube, 8, seg, arc);
    torusCache.set(k, g);
  }
  return g;
}

// ── the crossing ─────────────────────────────────────────────────────────

/** 斑马线: white bars across the road (one transparent plane). */
export function ZebraModel() {
  const tex = useMemo(() => canvasTex('zebra', 64, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const n = 7;
    const step = h / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = 'rgba(244,242,234,0.93)';
      ctx.fillRect(0, i * step + step * 0.2, w, step * 0.6);
      // worn patches
      ctx.fillStyle = 'rgba(70,70,74,0.35)';
      ctx.fillRect(((i * 37) % 50), i * step + step * 0.3, 6, step * 0.2);
    }
  }), []);
  const material = useMemo(() => new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), [tex]);
  return <Plane size={[2.6, 3.9]} material={material} position={[0, 0.0045, 0]} rotation={[-Math.PI / 2, 0, 0]} />;
}

const POLE = mat('metal', '#5d6670', { roughness: 0.45 });
const HOUSING = mat('plastic', '#1d1f23', { roughness: 0.5 });

/** One pedestrian signal head (both faces) whose little man follows the crossing button. */
export function WalkerHead({ position }: { position?: V3 }) {
  const faces = useRef<Mesh[]>([]);
  const red = useMemo(() => glow('#ffffff', walkerTex(false)), []);
  const green = useMemo(() => glow('#ffffff', walkerTex(true)), []);
  const dim = useMemo(() => mat('plastic', '#141416', { roughness: 0.3 }), []);
  useFrame(({ clock }) => {
    // Green flashes for its last part like the real ones? It stays green (the task waits for him).
    const g = street.green;
    const blink = g && Math.sin(clock.elapsedTime * 3) > 0.995;
    faces.current.forEach((f, i) => {
      if (!f) return;
      f.material = i % 2 === 0 ? (g ? dim : red) : (g && !blink ? green : dim);
    });
  });
  return (
    <group position={position}>
      <RBox size={[0.28, 0.56, 0.2]} radius={0.02} material={HOUSING} />
      {[1, -1].map((side) => (
        <group key={side} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
          {[0.13, -0.13].map((y, k) => (
            <mesh key={y} ref={(m) => { if (m) faces.current[(side > 0 ? 0 : 2) + k] = m; }} position={[0, y, 0.101]} material={k === 0 ? red : dim}>
              <planeGeometry args={[0.22, 0.22]} />
            </mesh>
          ))}
          <Box size={[0.26, 0.02, 0.08]} position={[0, 0.255, 0.13]} material={HOUSING} cast={false} />
        </group>
      ))}
    </group>
  );
}

/** The car signals (red / amber / green) facing along the road: red while walkers have green. */
export function CarSignal({ position, rotation }: { position?: V3; rotation?: V3 }) {
  const lamps = useRef<Mesh[]>([]);
  const off = useMemo(() => [mat('plastic', '#3b1512', { roughness: 0.3 }), mat('plastic', '#3a2c10', { roughness: 0.3 }), mat('plastic', '#0f3018', { roughness: 0.3 })], []);
  const on = useMemo(() => [glow('#ff3b30'), glow('#ffb020'), glow('#36e07a')], []);
  useFrame(() => {
    const g = street.green;
    lamps.current.forEach((l, i) => {
      if (l) l.material = (i === 0 && g) || (i === 2 && !g) ? on[i] : off[i];
    });
  });
  return (
    <group position={position} rotation={rotation}>
      <RBox size={[0.3, 0.86, 0.22]} radius={0.03} material={HOUSING} />
      {[0.27, 0, -0.27].map((y, i) => (
        <group key={y}>
          <mesh ref={(m) => { if (m) lamps.current[i] = m; }} position={[0, y, 0.105]} material={off[i]}>
            <circleGeometry args={[0.095, 20]} />
          </mesh>
          <Cyl r={0.11} h={0.1} open position={[0, y + 0.03, 0.15]} rotation={[Math.PI / 2 - 0.25, 0, 0]} material={mat('plastic', '#1d1f23', { doubleSide: true })} cast={false} segments={14} />
        </group>
      ))}
    </group>
  );
}

/**
 * 红绿灯: the pole on this side of the crossing — the walkers' signal (both faces), an arm over the road
 * with the car signals. The collider is the pole + the walkers' head (index.tsx).
 */
export function TrafficLightModel() {
  return (
    <group>
      <Cyl r={0.06} rTop={0.05} h={3.2} material={POLE} segments={12} />
      <Cyl r={0.12} h={0.12} position={[0, -1.54, 0]} material={POLE} segments={12} />
      <WalkerHead position={[0, 0.75, -0.08]} />
      {/* the arm over the road and the car signals */}
      <Cyl r={0.06} rTop={0.045} h={1.2} position={[0, 2.05, 0]} material={POLE} segments={10} />
      <Box size={[0.07, 0.07, 2.3]} position={[0, 2.62, -1.12]} material={POLE} />
      <CarSignal position={[0.06, 2.2, -2.1]} rotation={[0, Math.PI / 2, 0]} />
      <CarSignal position={[-0.06, 2.2, -1.2]} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

/** 按钮: the crossing button box (过街请按 — press to cross). Pressed = the walkers get green, it beeps. */
export function ButtonModel({ states }: ModelProps) {
  const green = states.signal === 'green';
  useEffect(() => {
    street.green = green;
  }, [green]);
  useEffect(() => () => { street.green = false; }, []);
  const label = useMemo(() => signTex('press', 128, 96, '#f6d230', [['过街', 0.34, '#1b1b1b', 0.3], ['请按', 0.34, '#1b1b1b', 0.72]]), []);
  const wait = useMemo(() => signTex('wait', 128, 40, '#151515', [['请等待', 0.7, '#ffb020', 0.52]]), []);
  const go = useMemo(() => signTex('go', 128, 40, '#151515', [['请通行', 0.7, '#3dff8a', 0.52]]), []);
  return (
    <group>
      <RBox size={[0.14, 0.22, 0.1]} radius={0.015} material={mat('plastic', '#f2c21b', { roughness: 0.4 })} />
      <Plane size={[0.12, 0.09]} material={print(label)} position={[0, 0.055, 0.0505]} />
      <Cyl r={0.032} h={0.022} position={[0, -0.035, 0.055]} rotation={[Math.PI / 2, 0, 0]} material={green ? glow('#6cf0a0') : mat('plastic', '#d8d8d8', { roughness: 0.3 })} segments={18} />
      <Plane size={[0.1, 0.03]} material={green ? glow('#ffffff', go) : print(wait)} position={[0, -0.088, 0.0505]} />
    </group>
  );
}

// ── street furniture ─────────────────────────────────────────────────────

/** A lamp head (shared by the 路灯 object and the decor lamps): lit when `on`. */
export function LampHead({ on }: { on: boolean }) {
  return (
    <group>
      <RBox size={[0.5, 0.12, 0.24]} radius={0.03} material={mat('metal', '#4d555e', { roughness: 0.5 })} />
      <Box size={[0.42, 0.01, 0.18]} position={[0, -0.062, 0]} material={on ? glow('#ffe2a8') : mat('glass', '#d8dde2', { opacity: 0.9 })} cast={false} />
    </group>
  );
}

/** 路灯: a tall pole with an arm over the road. Its light is one of the world's two point lights (always mounted). */
export function StreetLampModel({ states }: ModelProps) {
  const on = states.light === 'on';
  useEffect(() => {
    street.lampsOn = on;
  }, [on]);
  useEffect(() => () => { street.lampsOn = false; }, []);
  return (
    <group>
      <Cyl r={0.07} rTop={0.05} h={4.4} material={POLE} segments={12} />
      <Cyl r={0.13} rTop={0.1} h={0.5} position={[0, -1.95, 0]} material={POLE} segments={12} />
      <Box size={[0.06, 0.06, 0.95]} position={[0, 2.08, -0.45]} rotation={[0.12, 0, 0]} material={POLE} />
      <group position={[0, 2.0, -0.85]}>
        <LampHead on={on} />
      </group>
      <pointLight position={[0, 1.7, -0.85]} color="#ffc98a" intensity={on ? 9 : 0} distance={11} decay={1.4} />
    </group>
  );
}

/** 公交车站: the shelter — a roof, glass back and side, a lit poster, the stop's name on the roof edge. */
export function BusShelterModel() {
  const poster = useMemo(() => signTex('poster', 256, 384, '#1f5aa6', [
    ['文明乘车', 0.12, '#ffffff', 0.2], ['排队上车', 0.12, '#ffe066', 0.38], ['先下后上', 0.09, '#ffffff', 0.6], ['城市公交', 0.07, '#cfe0ff', 0.85],
  ], '#ffffff'), []);
  const name = useMemo(() => signTex('stopname', 512, 64, '#0f4c8a', [['人民路站  ·  RENMIN RD', 0.62, '#ffffff', 0.52]]), []);
  const frame = mat('metal', '#8b939c', { roughness: 0.35 });
  return (
    <group>
      <RBox size={[3.3, 0.1, 1.5]} radius={0.03} position={[0, 1.2, 0.1]} material={mat('metal', '#c4ccd4', { roughness: 0.4 })} />
      <Plane size={[3.0, 0.1]} material={print(name, { emissive: 1.2 })} position={[0, 1.2, 0.857]} />
      <Box size={[3.2, 2.0, 0.03]} position={[0, 0, -0.6]} material={mat('glass', '#cfe3ea', { opacity: 0.25 })} cast={false} />
      <Box size={[0.03, 2.0, 1.1]} position={[-1.6, 0, -0.05]} material={mat('glass', '#cfe3ea', { opacity: 0.25 })} cast={false} />
      <Merged id="shelter-frame" material={frame} cast parts={[
        { box: [0.08, 2.5, 0.08], at: [-1.58, -0.05, 0.72] }, { box: [0.08, 2.5, 0.08], at: [1.58, -0.05, 0.72] },
        { box: [0.08, 2.5, 0.08], at: [-1.58, -0.05, -0.6] }, { box: [0.08, 2.5, 0.08], at: [1.58, -0.05, -0.6] },
        { box: [3.2, 0.05, 0.05], at: [0, 1.0, -0.6] }, { box: [3.2, 0.05, 0.05], at: [0, -0.98, -0.6] },
      ]} />
      {/* the lit poster panel at the right end of the back */}
      <RBox size={[0.9, 1.35, 0.1]} radius={0.02} position={[1.0, 0.05, -0.56]} material={frame} />
      <Plane size={[0.8, 1.2]} material={glow('#ffffff', poster)} position={[1.0, 0.05, -0.505]} />
    </group>
  );
}

/** 站牌: the stop sign — the stop's name and the routes that call here. */
export function BusSignModel() {
  const face = useMemo(() => canvasTex('bus-sign', 256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0f4c8a';
    ctx.fillRect(0, 0, w, 70);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, '公交车站', w / 2, 36, 44, w * 0.9);
    ctx.fillStyle = '#0f4c8a';
    fitText(ctx, '人民路站', w / 2, 104, 36, w * 0.9);
    const routes: Array<[string, string, string]> = [['18路', '火车站 → 花园路', '#d9342b'], ['42路', '东门 → 人民广场', '#2b7bd9'], ['夜班N3', '市医院 → 大学城', '#5b3aa6']];
    routes.forEach(([n, line, c], i) => {
      const y = 150 + i * 72;
      ctx.fillStyle = c;
      ctx.fillRect(14, y, 84, 52);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, n, 56, y + 27, 30, 78);
      ctx.fillStyle = '#333';
      fitText(ctx, line, 172, y + 27, 22, 140, 500);
    });
    ctx.fillStyle = '#666';
    fitText(ctx, '首班 6:00  末班 22:30', w / 2, h - 18, 18, w * 0.9, 500);
  }, { text: '公交车站人民路站18路火车站花园路42路东门人民广场夜班N3市医院大学城首班末班' }), []);
  return (
    <group>
      <Cyl r={0.04} h={2.6} material={POLE} segments={10} />
      <RBox size={[0.62, 0.95, 0.05]} radius={0.015} position={[0, 0.65, 0]} material={mat('metal', '#d4d9de')} />
      <Plane size={[0.58, 0.87]} material={print(face, { emissive: 0.5 })} position={[0, 0.65, 0.027]} />
      <Plane size={[0.58, 0.87]} material={print(face, { emissive: 0.5 })} position={[0, 0.65, -0.027]} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

/** 长椅: wooden slats on cast-metal legs. */
export function BenchModel() {
  const wood = mat('wood', '#9a6a42', { roughness: 0.6 });
  const iron = mat('metal', '#2f3438', { roughness: 0.5 });
  return (
    <group>
      <Merged id="bench-slats" material={wood} cast receive parts={[
        { box: [1.7, 0.035, 0.12], at: [0, 0.01, 0.14] }, { box: [1.7, 0.035, 0.12], at: [0, 0.01, 0] }, { box: [1.7, 0.035, 0.12], at: [0, 0.01, -0.14] },
        { box: [1.7, 0.1, 0.03], at: [0, 0.2, -0.2], rot: [-0.12, 0, 0] }, { box: [1.7, 0.1, 0.03], at: [0, 0.34, -0.215], rot: [-0.12, 0, 0] },
      ]} />
      <Merged id="bench-legs" material={iron} cast parts={[
        { box: [0.05, 0.42, 0.06], at: [-0.75, -0.215, 0.15] }, { box: [0.05, 0.42, 0.06], at: [-0.75, -0.215, -0.15] },
        { box: [0.05, 0.42, 0.06], at: [0.75, -0.215, 0.15] }, { box: [0.05, 0.42, 0.06], at: [0.75, -0.215, -0.15] },
        { box: [0.05, 0.04, 0.4], at: [-0.75, -0.02, 0] }, { box: [0.05, 0.04, 0.4], at: [0.75, -0.02, 0] },
        { box: [0.05, 0.42, 0.04], at: [-0.75, 0.22, -0.2], rot: [-0.12, 0, 0] }, { box: [0.05, 0.42, 0.04], at: [0.75, 0.22, -0.2], rot: [-0.12, 0, 0] },
      ]} />
    </group>
  );
}

// ── the convenience shop (街角便利店 — invented) ─────────────────────────

/** 便利店: the shop's lit sign board. */
export function ShopSignModel() {
  const face = useMemo(() => canvasTex('shop-sign', 1024, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#0f8a6a');
    g.addColorStop(1, '#16a37c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff8a1f';
    ctx.fillRect(0, h - 18, w, 18);
    // the shop's own mark: a round corner sign with 角
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(80, 56, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f8a6a';
    fitText(ctx, '角', 80, 58, 50, 70);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, '街角便利店', 470, 58, 78, 560);
    ctx.fillStyle = '#ffe9a8';
    fitText(ctx, '24小时营业', 880, 58, 40, 220);
  }, { text: '角街角便利店24小时营业' }), []);
  return (
    <group>
      <RBox size={[5.3, 0.62, 0.14]} radius={0.03} material={mat('metal', '#e9ecef')} />
      <Plane size={[5.2, 0.56]} material={print(face, { emissive: 1.6, roughness: 0.4 })} position={[0, 0, 0.071]} />
    </group>
  );
}

/** 门: a glass shop door hinged on the left; swings inwards with `states.door`. */
export function ShopDoorModel({ states }: ModelProps) {
  const door = useRef<Group>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const d = door.current;
    if (!d) return;
    const goal = open ? -Math.PI / 2 : 0;
    d.rotation.y += (goal - d.rotation.y) * Math.min(1, dt * 6);
  });
  const push = useMemo(() => signTex('push', 64, 64, '#c8102e', [['推', 0.7, '#ffffff', 0.54]]), []);
  const pull = useMemo(() => signTex('pull', 64, 64, '#c8102e', [['拉', 0.7, '#ffffff', 0.54]]), []);
  const openSign = useMemo(() => signTex('open', 192, 64, '#ffffff', [['营业中', 0.62, '#0f8a6a', 0.54]], '#0f8a6a'), []);
  const frame = mat('metal', '#3e464e', { roughness: 0.35 });
  return (
    <group ref={door} position={[-0.5, 0, 0]}>
      <group position={[0.5, 0, 0]}>
        <Box size={[0.92, 2.0, 0.015]} material={mat('glass', '#cfe6ee', { opacity: 0.22 })} cast={false} />
        <Merged id="door-frame" material={frame} cast parts={[
          { box: [1.0, 0.06, 0.05], at: [0, 1.02, 0] }, { box: [1.0, 0.12, 0.05], at: [0, -0.99, 0] },
          { box: [0.05, 2.1, 0.05], at: [-0.475, 0, 0] }, { box: [0.05, 2.1, 0.05], at: [0.475, 0, 0] },
          { box: [0.03, 0.45, 0.03], at: [0.36, 0.05, -0.06] }, { box: [0.03, 0.45, 0.03], at: [0.36, 0.05, 0.06] },
        ]} />
        {/* outside (−Z) says push, inside says pull: the door swings in */}
        <Plane size={[0.12, 0.12]} material={print(push)} position={[0.25, 0.1, -0.012]} rotation={[0, Math.PI, 0]} />
        <Plane size={[0.12, 0.12]} material={print(pull)} position={[0.25, 0.1, 0.012]} />
        <Plane size={[0.3, 0.1]} material={print(openSign)} position={[0, 0.55, -0.03]} rotation={[0, Math.PI, 0]} />
        <Plane size={[0.3, 0.1]} material={print(openSign)} position={[0, 0.55, -0.029]} />
      </group>
    </group>
  );
}

/** 柜台: the till counter with a cash register and a pay-by-scan stand. */
export function CounterModel() {
  const front = useMemo(() => signTex('counter-front', 256, 64, '#0f8a6a', [['欢迎光临', 0.55, '#ffffff', 0.52]]), []);
  const qr = useMemo(() => canvasTex('qr', 64, 96, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#16a37c';
    ctx.fillRect(0, 0, w, 20);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, '扫码付款', w / 2, 10, 13, w - 4);
    ctx.fillStyle = '#111';
    let s = 7;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      if ((s >> 8) % 2 || ((x < 2 || x > 5) && (y < 2 || y > 5))) ctx.fillRect(6 + x * 6.5, 28 + y * 7.5, 6.5, 7.5);
    }
  }, { text: '扫码付款' }), []);
  const body = mat('painted', '#eef0ec', { roughness: 0.5 });
  return (
    <group>
      <Box size={[0.56, 0.9, 1.56]} position={[0, -0.025, 0]} material={body} receive />
      <RBox size={[0.6, 0.04, 1.6]} radius={0.01} position={[0, 0.455, 0]} material={mat('wood', '#a77a4c', { roughness: 0.4, repeat: [1, 2] })} receive />
      <Plane size={[1.4, 0.35]} material={print(front)} position={[0.281, 0.05, 0]} rotation={[0, Math.PI / 2, 0]} />
      {/* the register (a <Solid> in the Scene keeps things from passing through it) */}
      <RBox size={[0.32, 0.1, 0.28]} radius={0.015} position={[0, 0.52, 0.55]} material={mat('plastic', '#2b2e33')} />
      <RBox size={[0.26, 0.17, 0.03]} radius={0.01} position={[-0.02, 0.62, 0.55]} rotation={[0, Math.PI / 2, -0.25]} material={mat('plastic', '#2b2e33')} />
      <Plane size={[0.13, 0.22]} material={glow('#bfe6ff')} position={[0.0, 0.62, 0.55]} rotation={[0, Math.PI / 2, -0.25]} />
      <group position={[0.18, 0.54, -0.5]} rotation={[0, Math.PI / 2, 0]}>
        <Box size={[0.1, 0.15, 0.012]} rotation={[-0.2, 0, 0]} material={print(qr)} />
      </group>
    </group>
  );
}

/** 老板: the shop owner behind the counter — a simple, friendly figure (no particular person). */
export function ShopkeeperModel() {
  const skin = mat('food', '#e7b98f', { roughness: 0.6 });
  return (
    <group position={[0, -0.85, 0]}>
      <Merged id="keeper-legs" material={mat('fabric', '#3b4250')} cast parts={[
        { cyl: [0.07, 0.8, 0.075], at: [-0.09, 0.4, 0] }, { cyl: [0.07, 0.8, 0.075], at: [0.09, 0.4, 0] },
      ]} />
      <Cyl r={0.19} rTop={0.21} h={0.62} position={[0, 1.1, 0]} material={mat('fabric', '#f0ede6')} segments={16} />
      <Box size={[0.36, 0.52, 0.02]} position={[0, 1.02, 0.2]} material={mat('fabric', '#0f8a6a')} />
      <Merged id="keeper-arms" material={mat('fabric', '#f0ede6')} cast parts={[
        { cyl: [0.055, 0.52], at: [-0.25, 1.1, 0.03], rot: [0.15, 0, 0.1] }, { cyl: [0.055, 0.52], at: [0.25, 1.1, 0.03], rot: [0.15, 0, -0.1] },
        { ball: [0.05, 10], at: [-0.27, 0.84, 0.0] }, { ball: [0.05, 10], at: [0.27, 0.84, 0.0] },
      ]} />
      <Ball r={0.11} position={[0, 1.55, 0]} material={skin} segments={18} />
      <Ball r={0.115} scale={[1, 0.6, 1]} position={[0, 1.61, -0.015]} material={mat('fabric', '#1e1a18')} segments={14} />
      <Merged id="keeper-face" material={mat('plastic', '#2a2420', { roughness: 0.3 })} parts={[
        { ball: [0.012, 8], at: [-0.04, 1.565, 0.1] }, { ball: [0.012, 8], at: [0.04, 1.565, 0.1] },
        { box: [0.05, 0.008, 0.01], at: [0, 1.51, 0.105] },
      ]} />
    </group>
  );
}

/** 货架: shelves of snacks along the back wall (the grabbable packets sit on its boards). */
export function ShelfModel() {
  const wood = mat('metal', '#e6e8ea', { roughness: 0.5 });
  const levels = [-0.32, 0.16, 0.64];
  return (
    <group>
      <Merged id="shelf-frame" material={wood} receive parts={[
        { box: [2.0, 1.8, 0.03], at: [0, 0, -0.21] },
        { box: [0.03, 1.8, 0.45], at: [-0.985, 0, 0] }, { box: [0.03, 1.8, 0.45], at: [0.985, 0, 0] },
        ...[-0.8, ...levels].map((y): { box: V3; at: V3 } => ({ box: [1.94, 0.03, 0.42], at: [0, y, 0.01] })),
      ]} />
      {levels.map((y, i) => (
        <Plane key={y} size={[1.94, 0.4]} material={print(goodsTex(`shelf-${i}`, 30 + i, 'snacks'))} position={[0, y - 0.48 + 0.2 + 0.02, -0.17]} />
      ))}
      <Plane size={[1.94, 0.22]} material={print(goodsTex('shelf-top', 39, 'snacks'))} position={[0, 0.77, -0.17]} />
      <Merged id="shelf-prices" material={mat('plastic', '#ffd84a')} parts={[-0.8, ...levels].map((y) => ({ box: [1.94, 0.035, 0.005] as V3, at: [0, y - 0.01, 0.225] as V3 }))} />
    </group>
  );
}

/** 冰柜: the drinks fridge with a glass door (opens towards −X) and lit shelves. */
export function ShopFridgeModel({ states }: ModelProps) {
  const door = useRef<Group>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const d = door.current;
    if (!d) return;
    const goal = open ? Math.PI / 2 : 0;
    d.rotation.y += (goal - d.rotation.y) * Math.min(1, dt * 7);
  });
  const header = useMemo(() => signTex('cold', 256, 48, '#1a5fb4', [['冰 爽 饮 料', 0.6, '#ffffff', 0.52]]), []);
  const body = mat('painted', '#f1f3f5', { roughness: 0.4 });
  return (
    <group>
      <Merged id="fridge-shell" material={body} cast parts={[
        { box: [0.04, 1.9, 0.8], at: [0.28, 0, 0] }, { box: [0.6, 1.9, 0.04], at: [0, 0, 0.38] }, { box: [0.6, 1.9, 0.04], at: [0, 0, -0.38] },
        { box: [0.6, 0.06, 0.8], at: [0, 0.92, 0] }, { box: [0.6, 0.12, 0.8], at: [0, -0.89, 0] },
      ]} />
      <Plane size={[0.76, 0.14]} material={glow('#ffffff', header)} position={[-0.302, 0.84, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <Merged id="fridge-shelves" material={mat('glass', '#dff1f8', { opacity: 0.5 })} parts={[-0.45, 0.05, 0.5].map((y) => ({ box: [0.52, 0.02, 0.72] as V3, at: [0.02, y, 0] as V3 }))} />
      {/* the drinks behind (a picture) and a cold light down the back */}
      {[-0.45, 0.05, 0.5].map((y, i) => (
        <Plane key={y} size={[0.72, 0.34]} material={glow('#e6f3ff', goodsTex(`fridge-${i}`, 50 + i, 'drinks'))} position={[0.255, y + 0.19, 0]} rotation={[0, -Math.PI / 2, 0]} />
      ))}
      <Box size={[0.01, 1.7, 0.04]} position={[0.25, 0, 0.34]} material={glow('#eaf6ff')} cast={false} />
      <group ref={door} position={[-0.3, 0, 0.4]}>
        <group position={[0, 0, -0.4]}>
          <Box size={[0.012, 1.84, 0.74]} material={mat('glass', '#d6eef6', { opacity: 0.25 })} cast={false} />
          <Merged id="fridge-door" material={mat('metal', '#9aa2aa')} parts={[
            { box: [0.04, 1.9, 0.04], at: [0, 0, 0.38] }, { box: [0.04, 1.9, 0.04], at: [0, 0, -0.38] },
            { box: [0.04, 0.04, 0.8], at: [0, 0.93, 0] }, { box: [0.04, 0.06, 0.8], at: [0, -0.92, 0] },
            { box: [0.03, 0.5, 0.025], at: [-0.04, 0.1, -0.33] },
          ]} />
        </group>
      </group>
    </group>
  );
}

/** 取款机: a cash machine set into the shop front (自助银行 — invented, no bank's name). */
export function AtmModel() {
  const screen = useMemo(() => signTex('atm-screen', 192, 144, '#1b4f8f', [['欢迎使用', 0.18, '#ffffff', 0.32], ['请插卡', 0.14, '#ffe066', 0.58], ['或 扫码取款', 0.1, '#cfe0ff', 0.8]]), []);
  const keys = useMemo(() => canvasTex('atm-keys', 96, 96, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
      ctx.fillStyle = '#d6d9dd';
      ctx.fillRect(8 + x * 24, 8 + y * 21, 18, 15);
    }
    ['#d9342b', '#f2b134', '#3aa655'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(80, 8 + i * 21, 12, 15); });
  }), []);
  const top = useMemo(() => signTex('atm-top', 256, 64, '#d9342b', [['自助银行', 0.6, '#ffffff', 0.52]]), []);
  return (
    <group>
      <RBox size={[0.72, 1.7, 0.28]} radius={0.03} material={mat('metal', '#c9ced3', { roughness: 0.35 })} />
      <Plane size={[0.66, 0.16]} material={glow('#ffffff', top)} position={[0, 0.7, 0.141]} />
      <Plane size={[0.38, 0.29]} material={glow('#ffffff', screen)} position={[0, 0.3, 0.142]} />
      <Box size={[0.5, 0.03, 0.16]} position={[0, 0.03, 0.18]} rotation={[0.25, 0, 0]} material={mat('metal', '#8e959c')} />
      <mesh position={[-0.06, 0.05, 0.27]} rotation={[-Math.PI / 2 + 0.25, 0, 0]} material={print(keys)}>
        <planeGeometry args={[0.2, 0.12]} />
      </mesh>
      <Box size={[0.12, 0.012, 0.03]} position={[0.16, 0.12, 0.145]} material={glow('#36e07a')} cast={false} />
      <Box size={[0.24, 0.02, 0.03]} position={[0, -0.2, 0.145]} material={mat('plastic', '#1d1f23')} cast={false} />
    </group>
  );
}

// ── stalls ───────────────────────────────────────────────────────────────

/** 水果摊: a trestle table with two crates under a striped awning, prices on little boards. */
export function FruitStallModel() {
  const awning = useMemo(() => mat('fabric', '#ffffff', { map: stripeTexture('#d9342b', '#f5efe2', 10), doubleSide: true }), []);
  const banner = useMemo(() => signTex('fruit-banner', 512, 96, '#d9342b', [['新鲜水果', 0.62, '#ffe066', 0.52]]), []);
  const price1 = useMemo(() => signTex('price-orange', 128, 80, '#2a2a2a', [['橙子', 0.36, '#ffffff', 0.3], ['6元一斤', 0.3, '#ffe066', 0.74]]), []);
  const price2 = useMemo(() => signTex('price-melon', 128, 80, '#2a2a2a', [['西瓜', 0.36, '#ffffff', 0.3], ['2元一斤', 0.3, '#ffe066', 0.74]]), []);
  const crate = mat('wood', '#c8a06a', { roughness: 0.7 });
  const rims = (cx: number): Array<{ box: V3; at: V3 }> => [
    { box: [0.5, 0.08, 0.02], at: [cx, 0.42, 0.2] }, { box: [0.5, 0.08, 0.02], at: [cx, 0.42, -0.2] },
    { box: [0.02, 0.08, 0.42], at: [cx + 0.25, 0.42, 0] }, { box: [0.02, 0.08, 0.42], at: [cx - 0.25, 0.42, 0] },
  ];
  return (
    <group>
      <RBox size={[1.7, 0.05, 0.85]} radius={0.01} position={[0, 0.355, 0]} material={mat('wood', '#8d6a48', { repeat: [2, 1] })} receive />
      <Merged id="stall-legs" material={mat('metal', '#4b4f55')} cast parts={[
        { box: [0.05, 0.78, 0.05], at: [-0.8, -0.03, -0.38] }, { box: [0.05, 0.78, 0.05], at: [0.8, -0.03, -0.38] },
        { box: [0.05, 0.78, 0.05], at: [-0.8, -0.03, 0.38] }, { box: [0.05, 0.78, 0.05], at: [0.8, -0.03, 0.38] },
        { box: [0.04, 2.04, 0.04], at: [-0.85, 0.6, -0.42] }, { box: [0.04, 2.04, 0.04], at: [0.85, 0.6, -0.42] },
        { box: [0.04, 1.7, 0.04], at: [-0.85, 0.77, 0.5] }, { box: [0.04, 1.7, 0.04], at: [0.85, 0.77, 0.5] },
      ]} />
      <Merged id="stall-crates" material={crate} cast parts={[...rims(0.35), ...rims(-0.55)]} />
      {/* the awning, sloping down towards the customer */}
      <mesh position={[0, 1.63, 0.05]} rotation={[-Math.PI / 2 + 0.22, 0, 0]} material={awning} castShadow>
        <planeGeometry args={[1.9, 1.15]} />
      </mesh>
      <Plane size={[1.9, 0.22]} material={print(banner, { doubleSide: true })} position={[0, 1.4, 0.62]} />
      <Plane size={[0.16, 0.1]} material={print(price1)} position={[0.62, 0.48, 0.21]} rotation={[-0.3, 0, 0]} />
      <Plane size={[0.16, 0.1]} material={print(price2)} position={[-0.25, 0.48, 0.21]} rotation={[-0.3, 0, 0]} />
      {/* bananas and grapes for sale (decor) */}
      <Merged id="stall-bananas" material={mat('food', '#f2cf3c', { roughness: 0.55 })} cast parts={[
        { cyl: [0.017, 0.17], at: [0.05, 0.42, -0.25], rot: [0, 0, 1.3] }, { cyl: [0.017, 0.17], at: [0.05, 0.435, -0.22], rot: [0.2, 0, 1.4] },
        { cyl: [0.017, 0.17], at: [0.05, 0.42, -0.19], rot: [0.35, 0, 1.25] },
      ]} />
      <Merged id="stall-grapes" material={mat('food', '#5b2a6e', { roughness: 0.3 })} cast parts={[
        [0, 0], [0.03, 0.01], [-0.03, 0.01], [0.015, 0.035], [-0.015, 0.035], [0, 0.06], [0.045, 0.04], [-0.045, 0.04],
      ].map(([x, y]) => ({ ball: [0.022, 8] as [number, number], at: [-0.12 + x, 0.42 + 0.06 - y, -0.25] as V3 }))} />
      <Box size={[0.2, 0.07, 0.16]} position={[0.75, 0.415, -0.25]} material={mat('plastic', '#e6e8ea')} />
      <Box size={[0.16, 0.01, 0.13]} position={[0.75, 0.455, -0.25]} material={mat('steel')} />
    </group>
  );
}

/** 推车: the jianbing cart — a hotplate under a little roof, 煎饼果子 on its sign. Fire on = it sizzles. */
export function CartModel({ states }: ModelProps) {
  const on = states.fire === 'on';
  const sign = useMemo(() => signTex('jianbing', 512, 112, '#f2b134', [['煎饼果子', 0.6, '#8a1c12', 0.45], ['加蛋 +1元', 0.22, '#5a2a12', 0.86]], '#8a1c12'), []);
  const steam = useRef<Group>(null);
  useFrame(({ clock }) => {
    const s = steam.current;
    if (!s) return;
    s.visible = on;
    if (on) s.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.4 + i * 0.33) % 1;
      c.position.y = 0.05 + t * 0.5;
      c.scale.setScalar(0.6 + t * 1.4);
      ((c as Mesh).material as MeshStandardMaterial).opacity = 0.28 * (1 - t);
    });
  });
  const steamMats = useMemo(() => [0, 1, 2].map(() => new MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false, roughness: 1 })), []);
  return (
    <group>
      <RBox size={[1.3, 0.9, 0.7]} radius={0.03} material={mat('steel', '#cfd4d9', { roughness: 0.3 })} />
      <Box size={[1.26, 0.25, 0.005]} position={[0, -0.05, 0.352]} material={mat('plastic', '#d9342b')} cast={false} />
      <Merged id="cart-wheels" material={mat('rubber', '#202226')} cast parts={[
        { cyl: [0.16, 0.06, 0.16, 16], at: [-0.45, -0.32, 0.38], rot: [Math.PI / 2, 0, 0] }, { cyl: [0.16, 0.06, 0.16, 16], at: [0.45, -0.32, 0.38], rot: [Math.PI / 2, 0, 0] },
      ]} />
      {/* the round hotplate, glowing under when on */}
      <Cyl r={0.26} h={0.02} position={[-0.15, 0.46, 0]} material={mat('metal', '#26282c', { roughness: 0.4 })} segments={28} />
      <mesh geometry={torus(0.26, 0.012, Math.PI * 2, 28)} position={[-0.15, 0.452, 0]} rotation={[Math.PI / 2, 0, 0]} material={on ? glow('#ff7a2a') : mat('metal', '#3a3c40')} />
      <group ref={steam} position={[-0.15, 0.48, 0]}>
        {steamMats.map((m, i) => (
          <mesh key={i} position={[(i - 1) * 0.06, 0.1, 0]} material={m}>
            <sphereGeometry args={[0.06, 10, 8]} />
          </mesh>
        ))}
      </group>
      <Merged id="cart-sauces" material={mat('plastic', '#b8281e', { roughness: 0.3 })} cast parts={[
        { cyl: [0.03, 0.14], at: [0.4, 0.52, -0.2] }, { cyl: [0.03, 0.14], at: [0.48, 0.52, -0.2] },
      ]} />
      <Merged id="cart-eggs" material={mat('food', '#efe3cf', { roughness: 0.6 })} cast parts={[0, 1, 2, 3, 4, 5].map((i) => ({ ball: [0.022, 10] as [number, number], at: [0.3 + (i % 3) * 0.05, 0.47, 0.12 + Math.floor(i / 3) * 0.05] as V3, scale: [1, 1.25, 1] as V3 }))} />
      <Merged id="cart-roof" material={mat('metal', '#8b939c')} cast parts={[
        { box: [0.04, 0.8, 0.04], at: [-0.66, 0.85, -0.36] }, { box: [0.04, 0.8, 0.04], at: [0.66, 0.85, -0.36] },
        { box: [1.4, 0.05, 0.8], at: [0, 1.25, 0] },
      ]} />
      <Plane size={[1.36, 0.3]} material={print(sign, { emissive: 0.35 })} position={[0, 1.43, 0.0]} />
      <Plane size={[1.36, 0.3]} material={print(sign, { emissive: 0.35 })} position={[0, 1.43, -0.001]} rotation={[0, Math.PI, 0]} />
      <Box size={[1.2, 0.3, 0.008]} position={[0, 0.62, 0.3]} material={mat('glass', '#e6f2f6', { opacity: 0.25 })} cast={false} />
    </group>
  );
}

/** The sorted bins (垃圾分类): blue 可回收物, green 厨余垃圾, grey 其他垃圾 — open top, the lid flipped back. */
function SortedBin({ color, label, icon }: { color: string; label: string; icon: string }) {
  const tex = useMemo(() => canvasTex(`bin:${label}`, 128, 160, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w / 2, 52, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    fitText(ctx, icon, w / 2, 54, 40, 60);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, label, w / 2, 120, 30, w - 10);
  }, { text: label + icon }), [color, label, icon]);
  const body = mat('plastic', color, { roughness: 0.45 });
  return (
    <group>
      <Merged id={`bin-walls:${color}`} material={body} cast receive parts={[
        { box: [0.42, 0.02, 0.38], at: [0, -0.44, 0] },
        { box: [0.44, 0.9, 0.02], at: [0, 0, 0.19] }, { box: [0.44, 0.9, 0.02], at: [0, 0, -0.19] },
        { box: [0.02, 0.9, 0.4], at: [0.21, 0, 0] }, { box: [0.02, 0.9, 0.4], at: [-0.21, 0, 0] },
      ]} />
      <Plane size={[0.32, 0.4]} material={print(tex)} position={[0, 0.05, 0.201]} />
      <RBox size={[0.46, 0.03, 0.42]} radius={0.01} position={[0, 0.62, -0.38]} rotation={[-1.35, 0, 0]} material={body} />
      <Box size={[0.38, 0.02, 0.34]} position={[0, -0.42, 0]} material={mat('plastic', '#1d1f23')} cast={false} />
    </group>
  );
}
export const RecycleBinModel = () => <SortedBin color="#1f6fb5" label="可回收物" icon="♻" />;
export const FoodBinModel = () => <SortedBin color="#2e8b57" label="厨余垃圾" icon="厨" />;
export const OtherBinModel = () => <SortedBin color="#6b7076" label="其他垃圾" icon="其" />;

/** 邮筒: a green post box with a slot and 邮政 on it. */
export function PostBoxModel() {
  const tex = useMemo(() => signTex('post', 128, 192, '#2b7a3d', [['邮政', 0.2, '#ffe066', 0.22], ['信件', 0.13, '#ffffff', 0.52], ['每日 9:00 开箱', 0.08, '#ffffff', 0.8]]), []);
  const green = mat('painted', '#2b7a3d', { roughness: 0.4, metalness: 0.2 });
  return (
    <group>
      <RBox size={[0.48, 1.0, 0.42]} radius={0.04} position={[0, 0.07, 0]} material={green} />
      <Cyl r={0.24} h={0.42} position={[0, 0.57, 0]} rotation={[Math.PI / 2, 0, 0]} material={green} segments={20} />
      <Box size={[0.48, 0.05, 0.42]} position={[0, 0.57, 0]} material={green} />
      <Box size={[0.22, 0.025, 0.02]} position={[0, 0.42, 0.214]} material={mat('rubber', '#0b0c0d')} cast={false} />
      <Plane size={[0.3, 0.45]} material={print(tex)} position={[0, 0.06, 0.211]} />
      <Box size={[0.36, 0.14, 0.36]} position={[0, -0.55, 0]} material={mat('metal', '#2a3a2e')} />
    </group>
  );
}

/** 树: a street tree — trunk and a few clumps of leaves. */
export function TreeModel() {
  return (
    <group>
      <Cyl r={0.12} rTop={0.08} h={3.2} material={mat('wood', '#5d4632', { roughness: 0.9 })} segments={10} />
      <Merged id="tree-branches" material={mat('wood', '#5d4632', { roughness: 0.9 })} cast parts={[
        { cyl: [0.05, 1.0, 0.03, 8], at: [0.3, 1.2, 0], rot: [0, 0, -0.7] }, { cyl: [0.05, 1.0, 0.03, 8], at: [-0.25, 1.3, 0.15], rot: [0.3, 0, 0.7] },
      ]} />
      <Merged id="tree-crown" material={mat('leaf', '#3f7d33', { roughness: 0.8 })} cast parts={[
        { ball: [0.85, 14], at: [0, 1.75, 0] }, { ball: [0.6, 12], at: [0.6, 1.5, 0.2] }, { ball: [0.65, 12], at: [-0.5, 1.6, -0.25] },
        { ball: [0.55, 12], at: [0.1, 2.3, 0.3] }, { ball: [0.5, 12], at: [0.2, 1.4, -0.6] },
      ]} />
    </group>
  );
}

/** 花坛: a stone flower bed with soil and flowers. */
export function PlanterModel() {
  return (
    <group>
      <Merged id="planter-walls" material={mat('stone', '#bdb6ab', { roughness: 0.85 })} cast receive parts={[
        { box: [1.4, 0.4, 0.12], at: [0, 0, 0.64] }, { box: [1.4, 0.4, 0.12], at: [0, 0, -0.64] },
        { box: [0.12, 0.4, 1.16], at: [0.64, 0, 0] }, { box: [0.12, 0.4, 1.16], at: [-0.64, 0, 0] },
      ]} />
      <Box size={[1.16, 0.3, 1.16]} position={[0, -0.05, 0]} material={mat('stone', '#4a3626', { roughness: 1 })} receive />
      <Merged id="planter-leaves" material={mat('leaf', '#4f8f3a')} parts={Array.from({ length: 14 }, (_, i) => ({
        ball: [0.09, 8] as [number, number], at: [Math.cos(i * 2.4) * (0.25 + (i % 3) * 0.12), 0.14, Math.sin(i * 2.4) * (0.25 + (i % 3) * 0.12)] as V3, scale: [1, 0.6, 1] as V3,
      }))} />
      <Merged id="planter-flowers" material={mat('food', '#e8507a', { roughness: 0.5 })} parts={Array.from({ length: 10 }, (_, i) => ({
        ball: [0.035, 8] as [number, number], at: [Math.cos(i * 1.9 + 0.5) * (0.3 + (i % 2) * 0.15), 0.2, Math.sin(i * 1.9 + 0.5) * (0.3 + (i % 2) * 0.15)] as V3,
      }))} />
      <Merged id="planter-flowers-y" material={mat('food', '#f2c233', { roughness: 0.5 })} parts={Array.from({ length: 8 }, (_, i) => ({
        ball: [0.03, 8] as [number, number], at: [Math.cos(i * 2.7 + 1.1) * (0.38 + (i % 2) * 0.1), 0.19, Math.sin(i * 2.7 + 1.1) * (0.38 + (i % 2) * 0.1)] as V3,
      }))} />
    </group>
  );
}

/** 电动车: a parked e-bike with a delivery box on the back (an invented 快送 box, no company). */
export function EbikeModel() {
  const box = useMemo(() => signTex('deliver', 128, 96, '#2b7bd9', [['快送', 0.42, '#ffffff', 0.45], ['准时到达', 0.16, '#d6e8ff', 0.8]]), []);
  const shell = mat('plastic', '#e8eaed', { roughness: 0.3 });
  const tyre = mat('rubber', '#1b1c1e');
  return (
    <group position={[0, -0.55, 0]}>
      {[[0, 0.3, -0.58], [0, 0.3, 0.58]].map((p, i) => (
        <group key={i} position={p as V3}>
          <mesh geometry={torus(0.24, 0.06, Math.PI * 2, 22)} rotation={[0, Math.PI / 2, 0]} material={tyre} castShadow />
          <Cyl r={0.12} h={0.07} rotation={[0, 0, Math.PI / 2]} material={mat('metal', '#7a8088')} segments={14} />
        </group>
      ))}
      <RBox size={[0.28, 0.32, 1.1]} radius={0.08} position={[0, 0.48, 0.05]} material={shell} />
      <RBox size={[0.26, 0.1, 0.5]} radius={0.04} position={[0, 0.7, 0.18]} material={mat('rubber', '#2a2b2e')} />
      <Box size={[0.24, 0.05, 0.42]} position={[0, 0.3, -0.12]} material={mat('rubber', '#2a2b2e')} />
      <RBox size={[0.24, 0.6, 0.14]} radius={0.05} position={[0, 0.66, -0.55]} rotation={[-0.25, 0, 0]} material={shell} />
      <Box size={[0.7, 0.04, 0.04]} position={[0, 0.98, -0.62]} material={mat('rubber', '#2a2b2e')} />
      <Ball r={0.06} position={[0, 0.82, -0.65]} material={glow('#fff7d6')} segments={12} cast={false} />
      <Merged id="ebike-mirrors" material={mat('chrome')} parts={[
        { ball: [0.045, 10], at: [-0.3, 1.15, -0.6], scale: [1, 0.7, 0.4] }, { ball: [0.045, 10], at: [0.3, 1.15, -0.6], scale: [1, 0.7, 0.4] },
        { cyl: [0.008, 0.18], at: [-0.28, 1.06, -0.61] }, { cyl: [0.008, 0.18], at: [0.28, 1.06, -0.61] },
      ]} />
      <RBox size={[0.42, 0.36, 0.38]} radius={0.03} position={[0, 0.94, 0.58]} material={mat('plastic', '#2b7bd9')} />
      <Plane size={[0.36, 0.27]} material={print(box)} position={[0.212, 0.94, 0.58]} rotation={[0, Math.PI / 2, 0]} />
      <Plane size={[0.36, 0.27]} material={print(box)} position={[-0.212, 0.94, 0.58]} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

/** 汽车: a parked hatchback (no make), an invented number plate. */
export function CarModel() {
  const plate = useMemo(() => signTex('plate', 256, 80, '#1f4fb0', [['街A · 5208', 0.6, '#ffffff', 0.52]], '#ffffff'), []);
  const paint = mat('painted', '#7f97ad', { roughness: 0.25, metalness: 0.45 });
  const tyre = mat('rubber', '#18191b');
  return (
    <group>
      <RBox size={[4.0, 0.62, 1.76]} radius={0.12} position={[0, -0.3, 0]} material={paint} />
      <RBox size={[2.3, 0.6, 1.6]} radius={0.16} position={[-0.25, 0.37, 0]} material={mat('glass', '#1d2732', { opacity: 0.88, roughness: 0.05 })} />
      <RBox size={[2.36, 0.06, 1.64]} radius={0.03} position={[-0.25, 0.66, 0]} material={paint} />
      {[[-1.3, 0.8], [1.3, 0.8], [-1.3, -0.8], [1.3, -0.8]].map(([x, z], i) => (
        <group key={i} position={[x, -0.42, z]}>
          <Cyl r={0.33} h={0.22} rotation={[Math.PI / 2, 0, 0]} material={tyre} segments={18} />
          <Cyl r={0.19} h={0.23} rotation={[Math.PI / 2, 0, 0]} material={mat('metal', '#b9bec4')} segments={12} cast={false} />
        </group>
      ))}
      <Merged id="car-lights-front" material={glow('#fff4d6')} parts={[{ box: [0.04, 0.1, 0.32], at: [2.0, -0.18, 0.6] }, { box: [0.04, 0.1, 0.32], at: [2.0, -0.18, -0.6] }]} />
      <Merged id="car-lights-back" material={glow('#c21f1f')} parts={[{ box: [0.04, 0.1, 0.3], at: [-2.0, -0.12, 0.62] }, { box: [0.04, 0.1, 0.3], at: [-2.0, -0.12, -0.62] }]} />
      <Plane size={[0.44, 0.14]} material={print(plate)} position={[2.005, -0.4, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Plane size={[0.44, 0.14]} material={print(plate)} position={[-2.005, -0.4, 0]} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

// ── things to pick up ────────────────────────────────────────────────────

/** 报纸: a folded newspaper with columns of text and a headline. */
export function NewspaperModel() {
  const tex = useMemo(() => canvasTex('news', 256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#eeeae0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b3261e';
    fitText(ctx, '城市晚报', w / 2, 30, 40, w - 20);
    ctx.fillStyle = '#222';
    fitText(ctx, '新公园周末开放', w / 2, 80, 26, w - 20);
    for (let c = 0; c < 3; c++) for (let l = 0; l < 14; l++) {
      ctx.fillStyle = '#6a6862';
      ctx.fillRect(12 + c * 80, 110 + l * 14, 70 - ((l * 7 + c * 3) % 5) * 6, 5);
    }
    ctx.fillStyle = '#9aa3ab';
    ctx.fillRect(170, 110, 74, 60);
  }, { text: '城市晚报新公园周末开放' }), []);
  return (
    <group>
      <Box size={[0.32, 0.012, 0.42]} material={mat('paper', '#eeeae0')} />
      <mesh position={[0, 0.0065, 0]} rotation={[-Math.PI / 2, 0, 0]} material={print(tex)}>
        <planeGeometry args={[0.32, 0.42]} />
      </mesh>
    </group>
  );
}

/** 传单: a leaflet for a (made-up) milk-tea shop's opening. */
export function LeafletModel() {
  const tex = useMemo(() => signTex('leaflet', 128, 180, '#ff7aa2', [['新店开业', 0.15, '#ffffff', 0.2], ['奶茶', 0.24, '#fff3a8', 0.48], ['买一送一', 0.13, '#ffffff', 0.78]]), []);
  return (
    <group>
      <Box size={[0.15, 0.006, 0.21]} material={mat('paper', '#ffffff')} />
      <mesh position={[0, 0.0035, 0]} rotation={[-Math.PI / 2, 0, 0]} material={print(tex)}>
        <planeGeometry args={[0.15, 0.21]} />
      </mesh>
    </group>
  );
}

/** 钱包: a brown leather wallet with a stitched edge and a card peeking out. */
export function WalletModel() {
  return (
    <group>
      <RBox size={[0.11, 0.022, 0.09]} radius={0.008} material={mat('fabric', '#6b3f22', { roughness: 0.55 })} />
      <Box size={[0.07, 0.004, 0.05]} position={[0.03, 0.012, 0.01]} material={mat('plastic', '#d9a23a', { roughness: 0.3 })} cast={false} />
      <Box size={[0.112, 0.003, 0.004]} position={[0, 0.006, 0.04]} material={mat('fabric', '#c9a27a')} cast={false} />
    </group>
  );
}

/** 皮球: a red-and-yellow rubber ball. */
export function BallModel() {
  const tex = useMemo(() => stripeTexture('#d9342b', '#f2c233', 6), []);
  return <Ball r={0.11} material={mat('plastic', '#ffffff', { map: tex, roughness: 0.4 })} segments={22} />;
}

/** 雨伞: a folded umbrella along X; open = the canopy spreads out at its tip. */
export function UmbrellaModel({ states }: ModelProps) {
  const open = states.open === 'open';
  const canopy = useMemo(() => mat('fabric', '#2a5db0', { doubleSide: true, roughness: 0.7 }), []);
  return (
    <group>
      <Cyl r={0.006} h={0.86} rotation={[0, 0, Math.PI / 2]} material={mat('metal', '#7c838a')} segments={8} />
      <mesh geometry={torus(0.035, 0.012, Math.PI, 12)} position={[-0.43, 0.035, 0]} rotation={[0, 0, Math.PI]} material={mat('wood', '#5b3a1f')} castShadow />
      {open ? (
        <group position={[0.3, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <Cyl r={0.52} rTop={0.02} h={0.24} open position={[0, 0, 0]} material={canopy} segments={8} />
        </group>
      ) : (
        <Cyl r={0.035} rTop={0.008} h={0.62} position={[0.12, 0, 0]} rotation={[0, 0, -Math.PI / 2]} material={canopy} segments={8} />
      )}
      <Cyl r={0.004} h={0.05} position={[0.45, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('metal', '#7c838a')} segments={6} />
    </group>
  );
}

/** 快递: a taped parcel with a delivery slip. */
export function ParcelModel() {
  const slip = useMemo(() => canvasTex('slip', 128, 96, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    fitText(ctx, '快递单', w / 2, 14, 16, w - 8);
    for (let i = 0; i < 4; i++) ctx.fillRect(8, 30 + i * 12, 80 - i * 10, 4);
    for (let i = 0; i < 26; i++) ctx.fillRect(8 + i * 4, 80, (i % 3) + 1, 12);
  }, { text: '快递单' }), []);
  return (
    <group>
      <RBox size={[0.36, 0.26, 0.28]} radius={0.008} material={mat('paper', '#c49a64', { roughness: 0.85 })} />
      <Box size={[0.362, 0.005, 0.06]} position={[0, 0.129, 0]} material={mat('plastic', '#d9c48a', { roughness: 0.3 })} cast={false} />
      <mesh position={[0.05, 0.131, 0.07]} rotation={[-Math.PI / 2, 0, 0]} material={print(slip)}>
        <planeGeometry args={[0.13, 0.1]} />
      </mesh>
    </group>
  );
}

export function FrisbeeModel() {
  return (
    <group>
      <Cyl r={0.135} rTop={0.12} h={0.03} material={mat('plastic', '#ff7a1f', { roughness: 0.3 })} segments={26} />
      <mesh geometry={torus(0.08, 0.005)} position={[0, 0.0155, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('plastic', '#ffd2a8')} />
    </group>
  );
}

/** 塑料瓶: an empty water bottle (no brand), a blue cap. */
export function PlasticBottleModel() {
  return (
    <group>
      <Lathe profile={bottleProfile(0.033, 0.21, 0.012)} material={mat('glass', '#e3f2f8', { opacity: 0.45 })} segments={16} />
      <Cyl r={0.034} h={0.05} position={[0, -0.02, 0]} open material={mat('plastic', '#2a8fd6', { doubleSide: true })} segments={16} cast={false} />
      <Cyl r={0.014} h={0.018} position={[0, 0.103, 0]} material={mat('plastic', '#2a6fd6')} segments={10} />
    </group>
  );
}

/** 易拉罐: a drink can (an invented orange soda). */
export function CanModel() {
  const label = useMemo(() => labelTexture('汽水', '#ff8a1f', '#ffffff', '#d9342b'), []);
  return (
    <group>
      <Cyl r={0.033} h={0.11} position={[0, -0.004, 0]} material={mat('metal', '#ffffff', { map: label, roughness: 0.3, metalness: 0.5 })} segments={18} />
      <Cyl r={0.03} rTop={0.027} h={0.012} position={[0, 0.055, 0]} material={mat('steel')} segments={18} />
    </group>
  );
}

/** 香蕉皮: a peel, splayed into three flaps. */
export function BananaPeelModel() {
  const geom = useMemo(() => {
    const curve = new CatmullRomCurve3([new Vector3(-0.07, 0.004, 0), new Vector3(-0.02, -0.004, 0), new Vector3(0.04, -0.002, 0), new Vector3(0.075, 0.006, 0)]);
    return new TubeGeometry(curve, 10, 0.012, 6, false);
  }, []);
  const peel = mat('food', '#e8c23c', { roughness: 0.7 });
  return (
    <group>
      {[0, 2.1, -2.1].map((a) => (
        <mesh key={a} geometry={geom} material={peel} rotation={[0, a, 0]} scale={[1, 0.5, 1.4]} position={[Math.cos(a) * 0.02, 0, -Math.sin(a) * 0.02]} castShadow />
      ))}
      <Cyl r={0.008} h={0.025} position={[-0.02, 0.006, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('food', '#5a4320')} segments={6} />
    </group>
  );
}

export function OrangeModel() {
  return (
    <group>
      <Ball r={0.04} material={mat('food', '#f28a1a', { roughness: 0.55 })} segments={16} />
      <Ball r={0.006} position={[0, 0.039, 0]} material={mat('leaf', '#3d6b2a')} segments={6} cast={false} />
    </group>
  );
}

/** 西瓜: dark-green stripes on green. */
export function WatermelonModel() {
  const tex = useMemo(() => canvasTex('melon', 128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#4f9a3c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f5a24';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      for (let y = 0; y <= h; y += 4) ctx.lineTo(i * 12.8 + Math.sin(y * 0.4 + i) * 2.5, y);
      ctx.lineTo(i * 12.8 + 6, h);
      for (let y = h; y >= 0; y -= 4) ctx.lineTo(i * 12.8 + 6 + Math.sin(y * 0.4 + i) * 2.5, y);
      ctx.fill();
    }
  }), []);
  return <Ball r={0.125} scale={[1.18, 1, 1]} material={mat('food', '#ffffff', { map: tex, roughness: 0.35 })} segments={20} />;
}

/** 袋子: a brown paper shopping bag, open at the top, with handles. */
export function BagModel() {
  const paper = mat('paper', '#c9a074', { roughness: 0.8, doubleSide: true });
  const label = useMemo(() => signTex('bag', 128, 96, '#c9a074', [['谢谢惠顾', 0.24, '#6a3e1c', 0.5]]), []);
  return (
    <group>
      <Merged id="bag-walls" material={paper} cast parts={[
        { box: [0.24, 0.01, 0.15], at: [0, -0.105, 0] },
        { box: [0.26, 0.22, 0.008], at: [0, 0, 0.076] }, { box: [0.26, 0.22, 0.008], at: [0, 0, -0.076] },
        { box: [0.008, 0.22, 0.16], at: [0.126, 0, 0] }, { box: [0.008, 0.22, 0.16], at: [-0.126, 0, 0] },
      ]} />
      <Plane size={[0.18, 0.12]} material={print(label)} position={[0, 0, 0.081]} />
      <mesh geometry={torus(0.045, 0.004, Math.PI, 10)} position={[0, 0.11, 0.07]} material={mat('paper', '#8e6440')} />
      <mesh geometry={torus(0.045, 0.004, Math.PI, 10)} position={[0, 0.11, -0.07]} material={mat('paper', '#8e6440')} />
    </group>
  );
}

/** 煎饼: a folded jianbing in a paper wrapper. */
export function JianbingModel() {
  return (
    <group>
      <RBox size={[0.18, 0.05, 0.12]} radius={0.02} material={mat('food', '#e0b45c', { roughness: 0.7 })} />
      <Box size={[0.1, 0.052, 0.122]} position={[-0.045, 0, 0]} material={mat('paper', '#f4efe2')} />
      <Merged id="jianbing-bits" material={mat('leaf', '#4f8f3a')} parts={[{ box: [0.012, 0.004, 0.012], at: [0.03, 0.026, 0.02] }, { box: [0.012, 0.004, 0.012], at: [0.06, 0.026, -0.02] }, { box: [0.012, 0.004, 0.012], at: [0.045, 0.026, 0.035] }]} />
    </group>
  );
}

/** A plastic drinks bottle with a printed label (矿泉水 / 绿茶 — no brand). */
function DrinkBottle({ text, liquid, cap, band }: { text: string; liquid: string; cap: string; band: string }) {
  const label = useMemo(() => labelTexture(text, '#ffffff', '#1d4f3a', band), [text, band]);
  return (
    <group>
      <Lathe profile={bottleProfile(0.033, 0.22, 0.013)} material={mat('glass', '#e8f4f8', { opacity: 0.4 })} segments={16} />
      <Cyl r={0.03} h={0.12} position={[0, -0.035, 0]} material={mat('liquid', liquid, { opacity: 0.6 })} cast={false} segments={14} />
      <Cyl r={0.0335} h={0.06} position={[0, -0.02, 0]} open material={mat('paper', '#ffffff', { map: label, doubleSide: true })} cast={false} segments={16} />
      <Cyl r={0.0145} h={0.018} position={[0, 0.109, 0]} material={mat('plastic', cap)} segments={10} />
    </group>
  );
}
export const WaterModel = () => <DrinkBottle text="矿泉水" liquid="#d7eef8" cap="#2a6fd6" band="#3b9be0" />;
export const TeaModel = () => <DrinkBottle text="绿茶" liquid="#b9d26a" cap="#2e8b57" band="#4fae5a" />;

/** 方便面: a cup of instant noodles (桶) with a printed lid. */
export function NoodlesModel({ color = '#d9342b' }: { color?: string }) {
  const label = useMemo(() => labelTexture('面', '#fff7e6', '#8a1c12', color), [color]);
  return (
    <group>
      <Lathe profile={cupProfile(0.055, 0.11, 0.004, 0.75)} material={mat('paper', '#ffffff', { map: label, doubleSide: true })} segments={18} />
      <Cyl r={0.056} h={0.004} position={[0, 0.054, 0]} material={mat('paper', '#f2e6c8')} segments={18} cast={false} />
    </group>
  );
}
export const Noodles1 = () => <NoodlesModel />;
export const Noodles2 = () => <NoodlesModel color="#2b7bd9" />;

/** 薯片: a puffy bag of crisps (invented flavour). */
export function CrispsModel() {
  const label = useMemo(() => signTex('crisps', 128, 160, '#f2b134', [['薯片', 0.24, '#8a1c12', 0.35], ['番茄味', 0.12, '#5a2a12', 0.62]]), []);
  return (
    <group>
      <RBox size={[0.18, 0.24, 0.07]} radius={0.03} material={mat('plastic', '#f2b134', { roughness: 0.25 })} />
      <Plane size={[0.15, 0.19]} material={print(label, { roughness: 0.3 })} position={[0, 0, 0.0355]} />
    </group>
  );
}

/** 饼干: a box of biscuits. */
export function BiscuitsModel() {
  const label = useMemo(() => signTex('biscuits', 160, 112, '#2b5fa8', [['饼干', 0.42, '#ffffff', 0.45], ['牛奶味', 0.16, '#ffe066', 0.82]]), []);
  return (
    <group>
      <Box size={[0.2, 0.06, 0.14]} material={mat('paper', '#2b5fa8')} />
      <mesh position={[0, 0.0305, 0]} rotation={[-Math.PI / 2, 0, 0]} material={print(label)}>
        <planeGeometry args={[0.19, 0.13]} />
      </mesh>
    </group>
  );
}

/** 锥桶: an orange traffic cone with white reflective bands. */
export function ConeModel() {
  return (
    <group>
      <Box size={[0.36, 0.03, 0.36]} position={[0, -0.345, 0]} material={mat('rubber', '#202226')} />
      <Cyl r={0.15} rTop={0.03} h={0.68} position={[0, 0.01, 0]} material={mat('plastic', '#ff6a1a', { roughness: 0.35 })} segments={18} />
      <Cyl r={0.118} rTop={0.096} h={0.08} position={[0, -0.05, 0]} material={mat('plastic', '#f4f4f4', { roughness: 0.2 })} segments={18} cast={false} />
      <Cyl r={0.08} rTop={0.06} h={0.06} position={[0, 0.15, 0]} material={mat('plastic', '#f4f4f4', { roughness: 0.2 })} segments={18} cast={false} />
    </group>
  );
}

/** 头盔: a half-shell helmet with a visor (the e-bike's). */
export function HelmetModel() {
  return (
    <group>
      <mesh position={[0, -0.065, 0]} material={mat('plastic', '#f2c21b', { roughness: 0.3 })} castShadow>
        <sphereGeometry args={[0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <Box size={[0.2, 0.012, 0.06]} position={[0, -0.055, 0.13]} rotation={[0.25, 0, 0]} material={mat('plastic', '#222')} />
      <Cyl r={0.121} h={0.02} open position={[0, -0.055, 0]} material={mat('plastic', '#222', { doubleSide: true })} segments={18} cast={false} />
    </group>
  );
}

/** 共享单车: a shared bike (an invented teal one, no company), a basket and a rear wheel lock. */
export function BikeModel({ states }: ModelProps) {
  const locked = states.lock === 'locked';
  const frame = mat('painted', '#1fa59a', { roughness: 0.35, metalness: 0.2 });
  const tyre = mat('rubber', '#18191b');
  const tag = useMemo(() => signTex('bike-tag', 128, 48, '#1fa59a', [['扫码骑车', 0.56, '#ffffff', 0.54]]), []);
  return (
    <group>
      {[-0.52, 0.52].map((x) => (
        <group key={x} position={[x, -0.17, 0]}>
          <mesh geometry={torus(0.3, 0.025, Math.PI * 2, 26)} material={tyre} castShadow />
          <Cyl r={0.06} h={0.05} rotation={[Math.PI / 2, 0, 0]} material={mat('metal', '#8e959c')} segments={12} cast={false} />
        </group>
      ))}
      <Merged id="bike-frame" material={frame} cast parts={[
        { cyl: [0.022, 0.62], at: [-0.21, 0.02, 0], rot: [0, 0, 1.1] }, { cyl: [0.022, 0.55], at: [0.22, 0.05, 0], rot: [0, 0, -0.95] },
        { cyl: [0.022, 0.45], at: [-0.38, -0.02, 0], rot: [0, 0, -0.5] }, { cyl: [0.02, 0.62], at: [0.45, 0.08, 0], rot: [0, 0, 0.25] },
        { cyl: [0.02, 0.42], at: [-0.12, 0.15, 0], rot: [0, 0, 0.15] },
      ]} />
      <RBox size={[0.22, 0.06, 0.12]} radius={0.025} position={[-0.16, 0.38, 0]} material={mat('rubber', '#26282b')} />
      <Box size={[0.04, 0.04, 0.56]} position={[0.53, 0.42, 0]} material={mat('rubber', '#26282b')} />
      <RBox size={[0.26, 0.18, 0.3]} radius={0.02} position={[0.7, 0.3, 0]} material={mat('metal', '#d6dade', { roughness: 0.5 })} />
      <Plane size={[0.25, 0.09]} material={print(tag)} position={[0.832, 0.3, 0]} rotation={[0, Math.PI / 2, 0]} />
      <RBox size={[0.1, 0.07, 0.07]} radius={0.015} position={[-0.52, -0.02, 0]} material={locked ? mat('plastic', '#d9342b') : mat('plastic', '#36c07a')} />
      <Box size={[0.025, 0.012, 0.072]} position={[-0.52, 0.02, 0]} material={glow(locked ? '#ff6050' : '#6cf0a0')} cast={false} />
    </group>
  );
}
