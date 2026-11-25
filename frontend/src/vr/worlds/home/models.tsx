/**
 * The apartment's object models (docs/VR_WORLDS.md). Every model is drawn in its object's own frame:
 * the origin is the middle of the object's collider (index.tsx), so a book whose collider is a 3 cm
 * thick box spans y −0.015 … +0.015. All procedural (kit/ + ./textures), nothing downloaded.
 *
 * Animated with their states: the TV's screen and glow, the floor / desk lamps (the world's two point
 * lights — always mounted, intensity 0 when off), the curtains gathering, the air conditioner's flap
 * and cool air, the front door, the wardrobe's sliding door, the washing machine's door, the laptop's
 * lid and the tap's water.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, DoubleSide, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, TorusGeometry, Vector3,
  type BufferGeometry, type Group, type Mesh,
} from 'three';
import {
  Ball, Box, Chair, Cyl, Lathe, RBox, Sign, Table, WallClock, bowlProfile, cupProfile, labelTexture, mat, seeded, stripeTexture, woodTexture,
} from '../kit';
import type { ModelProps } from '../types';
import { MergedBoxes, type MergedBox } from './merged';
import {
  bookCoverTexture, calendarTexture, cityViewTexture, glowTexture, laptopScreenTexture, lcdTexture, plateTexture, tvScreenTexture,
} from './textures';

type V3 = [number, number, number];

const torusCache = new Map<string, TorusGeometry>();
function torus(r: number, tube: number, arc = Math.PI * 2) {
  const k = `${r}:${tube}:${arc}`;
  let g = torusCache.get(k);
  if (!g) {
    g = new TorusGeometry(r, tube, 8, 24, arc);
    torusCache.set(k, g);
  }
  return g;
}

/** A crumpled lump (paper ball, dirty socks): an icosphere pushed in and out, seeded. */
const crumpleCache = new Map<number, BufferGeometry>();
function crumple(seed: number): BufferGeometry {
  let g = crumpleCache.get(seed);
  if (!g) {
    const geo = new IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    const rnd = seeded(seed);
    const v = new Vector3();
    // Shared vertices must move together: displace by a function of the direction.
    const bumps = Array.from({ length: 7 }, () => ({ d: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), k: (rnd() - 0.5) * 0.45 }));
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      let s = 1;
      for (const b of bumps) s += b.k * Math.max(0, v.dot(b.d)) ** 3;
      pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
    }
    geo.computeVertexNormals();
    g = geo;
    crumpleCache.set(seed, g);
  }
  return g;
}

const flatMats = new Map<string, MeshStandardMaterial>();
function flatMat(color: string, roughness = 0.9) {
  const k = `${color}:${roughness}`;
  let m = flatMats.get(k);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, flatShading: true });
    flatMats.set(k, m);
  }
  return m;
}

/** Eases a ref'd number towards a goal each frame (open / close animations). */
function ease(cur: number, goal: number, dt: number, speed = 6) {
  return cur + (goal - cur) * Math.min(1, dt * speed);
}

// ── living room: fixed ───────────────────────────────────────────────────

/** The sofa: base, two seat cushions, backrest + back cushions, arms (back / arms are Scene colliders). */
export function SofaModel() {
  const fabric = mat('fabric', '#7d9184');
  const dark = mat('fabric', '#6a7d70');
  const leg = mat('wood', '#4a3220');
  return (
    <group>
      <Box size={[1.9, 0.08, 0.66]} position={[0, -0.185, -0.03]} material={leg} cast={false} />
      <RBox size={[2.0, 0.22, 0.8]} radius={0.03} position={[0, -0.035, -0.03]} material={dark} />
      {[-0.4, 0.4].map((x) => <RBox key={x} size={[0.79, 0.15, 0.56]} radius={0.05} segments={3} position={[x, 0.15, 0.07]} material={fabric} receive cast={false} />)}
      <RBox size={[2.0, 0.65, 0.22]} radius={0.04} position={[0, 0.3, -0.32]} material={dark} />
      {[-0.4, 0.4].map((x) => <RBox key={x} size={[0.76, 0.36, 0.16]} radius={0.07} segments={3} position={[x, 0.4, -0.13]} rotation={[-0.15, 0, 0]} material={fabric} cast={false} />)}
      {[-0.9, 0.9].map((x) => <RBox key={x} size={[0.2, 0.62, 0.8]} radius={0.06} segments={3} position={[x, 0.085, -0.03]} material={fabric} />)}
    </group>
  );
}

const TABLE_FRAME: MergedBox[] = [
  ...([[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]] as Array<[number, number]>).map(([x, z]): MergedBox => ({ size: [0.05, 0.38, 0.05], at: [x, 0, z], color: '#5a3b25' })),
  { size: [1.0, 0.02, 0.5], at: [0, -0.13, 0], color: '#5a3b25' },
];

export function CoffeeTableModel() {
  const top = mat('wood', '#6e4a2f', { repeat: [2, 1], roughness: 0.45 });
  return (
    <group>
      <RBox size={[1.1, 0.04, 0.6]} radius={0.012} position={[0, 0.19, 0]} material={top} receive />
      <MergedBoxes boxes={TABLE_FRAME} map={woodTexture('#ffffff')} roughness={0.6} cast />
      {/* a couple of magazines on the lower shelf */}
      <Box size={[0.24, 0.012, 0.3]} position={[-0.25, -0.114, 0.02]} rotation={[0, 0.2, 0]} material={mat('paper', '#d9534f')} cast={false} />
    </group>
  );
}

/** A low TV cabinet: white body, a walnut top, two drawers and an open niche in the middle. */
export function TvCabinetModel() {
  const body = mat('painted', '#f1eee8');
  const wood = mat('wood', '#7a5236', { repeat: [2, 1] });
  const handle = mat('steel', '#9aa1a8');
  return (
    <group>
      <Box size={[1.76, 0.44, 0.4]} position={[0, -0.02, -0.005]} material={body} receive />
      <RBox size={[1.8, 0.04, 0.42]} radius={0.008} position={[0, 0.23, 0]} material={wood} receive />
      <Box size={[1.7, 0.04, 0.36]} position={[0, -0.23, -0.02]} material={mat('rubber', '#3a3a3a')} cast={false} />
      {[-0.58, 0.58].map((x) => (
        <group key={x} position={[x, -0.02, 0.2]}>
          <RBox size={[0.56, 0.38, 0.02]} radius={0.004} material={body} cast={false} />
          <Box size={[0.16, 0.012, 0.012]} position={[0, 0.12, 0.016]} material={handle} cast={false} />
        </group>
      ))}
      <Box size={[0.56, 0.36, 0.02]} position={[0, -0.02, -0.17]} material={mat('wood', '#5a3c26')} cast={false} />
      {/* a set-top box in the niche, its little green light */}
      <RBox size={[0.3, 0.05, 0.2]} radius={0.006} position={[0, -0.19, 0.02]} material={mat('plastic', '#1d1f22', { roughness: 0.3 })} cast={false} />
      <Box size={[0.012, 0.006, 0.004]} position={[0.1, -0.18, 0.122]} material={mat('glow', '#7dffb0', { emissive: '#3dff8a' })} cast={false} />
    </group>
  );
}

/** The TV: a slim screen on a stand; the weather forecast and a blue glow on the wall when it is on. */
export function TvModel({ states }: ModelProps) {
  const on = states.power === 'on';
  const screen = useMemo(() => new MeshStandardMaterial({ color: '#05070a', roughness: 0.18, metalness: 0.2, emissive: '#ffffff', emissiveMap: tvScreenTexture(), emissiveIntensity: 0 }), []);
  const glow = useMemo(() => new MeshBasicMaterial({ map: glowTexture('#6fa8ff'), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const level = useRef(0);
  useFrame(({ clock }, dt) => {
    level.current = ease(level.current, on ? 1 : 0, dt, 5);
    const flicker = 1 + 0.04 * Math.sin(clock.elapsedTime * 7.3) * Math.sin(clock.elapsedTime * 2.1);
    screen.emissiveIntensity = level.current * 1.05 * flicker;
    glow.opacity = level.current * 0.45 * flicker;
  });
  const black = mat('plastic', '#151618', { roughness: 0.35 });
  return (
    <group>
      <RBox size={[0.42, 0.02, 0.18]} radius={0.006} position={[0, -0.38, 0]} material={black} />
      <Box size={[0.06, 0.1, 0.03]} position={[0, -0.32, -0.02]} material={black} />
      <RBox size={[1.2, 0.7, 0.04]} radius={0.008} position={[0, 0.04, 0]} material={black} />
      <mesh position={[0, 0.045, 0.0205]} material={screen}>
        <planeGeometry args={[1.16, 0.65]} />
      </mesh>
      <mesh position={[0, 0.06, -0.09]} material={glow} renderOrder={2}>
        <planeGeometry args={[2.2, 1.4]} />
      </mesh>
      {!on && <Box size={[0.01, 0.006, 0.004]} position={[0.5, -0.298, 0.021]} material={mat('glow', '#ff4a3a', { emissive: '#ff2a1a' })} cast={false} />}
    </group>
  );
}

/** Board heights of the bookshelf (object frame): the bottom, three shelves, the top. */
export const SHELF_BOARDS = [-0.89, -0.445, 0, 0.445, 0.89];

export function BookshelfModel() {
  const wood = mat('wood', '#b08458');
  return (
    <group>
      <Box size={[0.02, 1.8, 0.32]} position={[-0.44, 0, 0]} material={wood} />
      <Box size={[0.02, 1.8, 0.32]} position={[0.44, 0, 0]} material={wood} />
      <Box size={[0.9, 1.8, 0.02]} position={[0, 0, -0.15]} material={mat('wood', '#9a7048')} cast={false} />
      {SHELF_BOARDS.map((y) => <Box key={y} size={[0.86, 0.02, 0.3]} position={[0, y, 0.01]} material={wood} receive cast={false} />)}
    </group>
  );
}

/** The floor lamp: a weighted base, a pole, a fabric shade that glows; the living room's point light. */
export function FloorLampModel({ states }: ModelProps) {
  const on = states.light === 'on';
  return (
    <group>
      <Cyl r={0.16} h={0.03} position={[0, -0.785, 0]} material={mat('metal', '#2f3236', { roughness: 0.4 })} />
      <Cyl r={0.012} h={1.3} position={[0, -0.12, 0]} material={mat('metal', '#2f3236', { roughness: 0.4 })} segments={10} />
      <Cyl r={0.21} rTop={0.16} h={0.28} open position={[0, 0.65, 0]} material={on ? mat('fabric', '#f6e7c6', { doubleSide: true, emissive: '#ffc77a', emissiveIntensity: 0.85 }) : mat('fabric', '#f3e6c8', { doubleSide: true })} cast={false} />
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.04, 14, 10]} />
        <meshStandardMaterial color={on ? '#fff3c4' : '#d9d4c8'} emissive={on ? '#ffd88a' : '#000000'} emissiveIntensity={on ? 2.2 : 0} toneMapped={!on} />
      </mesh>
      {/* Always mounted (intensity 0 when off): adding / removing a light recompiles every material. */}
      <pointLight position={[0, 0.5, 0]} color="#ffd29a" intensity={on ? 2.4 : 0} distance={6} decay={1.5} />
    </group>
  );
}

/** A window (faces +Z): the city outside, a white frame (one merged mesh), glass. */
function HomeWindow({ w, h, seed }: { w: number; h: number; seed: number }) {
  const view = useMemo(() => cityViewTexture(seed), [seed]);
  const frame = useMemo<MergedBox[]>(() => {
    const c = '#f5f2ea';
    return [
      { size: [w + 0.08, 0.05, 0.08], at: [0, h / 2, 0], color: c },
      { size: [w + 0.14, 0.05, 0.14], at: [0, -h / 2, 0.03], color: c },
      { size: [0.05, h, 0.08], at: [-w / 2, 0, 0], color: c },
      { size: [0.05, h, 0.08], at: [w / 2, 0, 0], color: c },
      { size: [0.035, h, 0.05], at: [0, 0, 0], color: c },
      { size: [w, 0.03, 0.05], at: [0, h * 0.18, 0], color: c },
    ];
  }, [w, h]);
  return (
    <group>
      <mesh position={[0, 0, -0.045]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={view} toneMapped={false} />
      </mesh>
      <MergedBoxes boxes={frame} roughness={0.55} />
      <mesh position={[0, 0, -0.01]} material={mat('glass')}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}
export const LivingWindowModel = () => <HomeWindow w={1.56} h={1.26} seed={1} />;
export const BedroomWindow = () => <HomeWindow w={1.16} h={1.06} seed={2} />;

/** A pleated curtain panel (a plane folded by a sine), shared geometry. */
const pleatCache = new Map<string, PlaneGeometry>();
function pleats(w: number, h: number, folds: number, depth: number): PlaneGeometry {
  const k = `${w}:${h}:${folds}:${depth}`;
  let g = pleatCache.get(k);
  if (!g) {
    g = new PlaneGeometry(w, h, folds * 6, 1);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(((x + w / 2) / w) * Math.PI * 2 * folds) * depth);
    }
    g.computeVertexNormals();
    pleatCache.set(k, g);
  }
  return g;
}

/** Two curtain panels on a rod: drawn closed, gathered at the sides when open (eased). */
export function CurtainsModel({ states }: ModelProps) {
  const open = states.curtain === 'open';
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const t = useRef(open ? 1 : 0);
  useFrame((_, dt) => {
    t.current = ease(t.current, open ? 1 : 0, dt, 4);
    const s = 1 - 0.64 * t.current;
    const cx = 0.5 + 0.32 * t.current;
    if (left.current) {
      left.current.scale.x = s;
      left.current.position.x = -cx;
    }
    if (right.current) {
      right.current.scale.x = s;
      right.current.position.x = cx;
    }
  });
  const geo = pleats(1.0, 1.66, 9, 0.025);
  const cloth = mat('fabric', '#8fa6b8', { doubleSide: true });
  const metal = mat('metal', '#6b5a46', { roughness: 0.35 });
  return (
    <group>
      <Cyl r={0.012} h={2.24} position={[0, 0.84, -0.02]} rotation={[0, 0, Math.PI / 2]} material={metal} segments={10} cast={false} />
      <Ball r={0.025} position={[-1.12, 0.84, -0.02]} material={metal} segments={10} cast={false} />
      <Ball r={0.025} position={[1.12, 0.84, -0.02]} material={metal} segments={10} cast={false} />
      <mesh ref={left} geometry={geo} material={cloth} position={[-0.5, -0.02, 0]} castShadow />
      <mesh ref={right} geometry={geo} material={cloth} position={[0.5, -0.02, 0]} castShadow />
    </group>
  );
}

/** A split air conditioner high on the wall (faces +Z): the flap opens and cool air drifts out when on. */
export function AcModel({ states }: ModelProps) {
  const on = states.power === 'on';
  const flap = useRef<Group>(null);
  const air = useRef<Group>(null);
  const airMat = useMemo(() => new MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }), []);
  const level = useRef(0);
  useFrame(({ clock }, dt) => {
    level.current = ease(level.current, on ? 1 : 0, dt, 2.5);
    if (flap.current) flap.current.rotation.x = level.current * 0.75;
    const a = air.current;
    if (a) {
      a.visible = level.current > 0.02;
      a.children.forEach((c, i) => {
        const k = (clock.elapsedTime * 0.35 + i / 3) % 1;
        c.position.set(0, -0.15 - k * 0.55, 0.12 + k * 0.35);
        c.scale.set(1 + k * 0.6, 1, 1);
      });
      airMat.opacity = 0.12 * level.current;
    }
  });
  const shell = mat('plastic', '#f4f6f7', { roughness: 0.35 });
  return (
    <group>
      <RBox size={[0.9, 0.3, 0.22]} radius={0.05} segments={3} material={shell} />
      <Box size={[0.82, 0.035, 0.02]} position={[0, -0.12, 0.1]} material={mat('plastic', '#2a2d31')} cast={false} />
      <group ref={flap} position={[0, -0.105, 0.075]}>
        <Box size={[0.8, 0.012, 0.07]} position={[0, -0.006, 0.035]} material={shell} cast={false} />
      </group>
      {on && (
        <mesh position={[0.3, 0.06, 0.111]}>
          <planeGeometry args={[0.1, 0.037]} />
          <meshBasicMaterial map={lcdTexture('26°')} toneMapped={false} />
        </mesh>
      )}
      <Box size={[0.008, 0.008, 0.004]} position={[0.37, 0.06, 0.11]} material={on ? mat('glow', '#7dffb0', { emissive: '#3dff8a' }) : mat('plastic', '#888888')} cast={false} />
      <group ref={air} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} material={airMat} rotation={[-0.9, 0, 0]}>
            <planeGeometry args={[0.7, 0.18]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** The wall calendar: the month page (二〇二六年 十一月), a backing board, a nail. */
export function CalendarModel() {
  const page = useMemo(() => calendarTexture(), []);
  return (
    <group>
      <Box size={[0.3, 0.42, 0.006]} position={[0, 0, -0.004]} material={mat('paper', '#e9e2d0')} cast={false} />
      <mesh position={[0, 0, 0.0005]}>
        <planeGeometry args={[0.29, 0.41]} />
        <meshStandardMaterial map={page} roughness={0.9} />
      </mesh>
      <Cyl r={0.004} h={0.3} position={[0, 0.2, 0.004]} rotation={[0, 0, Math.PI / 2]} material={mat('metal', '#8a8f96')} segments={8} cast={false} />
      <Cyl r={0.006} h={0.02} position={[0, 0.23, -0.004]} rotation={[Math.PI / 2, 0, 0]} material={mat('metal', '#5a5f66')} segments={8} cast={false} />
    </group>
  );
}

/**
 * The front door in the right wall (panel along Z, the room on −X): hinged at its −Z edge, it swings
 * into the room. Inside: 福 upside down (福到了 — luck has arrived); outside: the flat number 302.
 */
export function FrontDoorModel({ states }: ModelProps) {
  const hinge = useRef<Group>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const h = hinge.current;
    if (h) h.rotation.y = ease(h.rotation.y, open ? -Math.PI / 2 : 0, dt, 5);
  });
  const wood = mat('wood', '#7a4b2e', { roughness: 0.5 });
  const trim = mat('wood', '#8d5a38', { roughness: 0.5 });
  const chrome = mat('chrome');
  const plate = useMemo(() => plateTexture('302'), []);
  return (
    <group>
      <group ref={hinge} position={[0, 0, -0.45]}>
        <group position={[0, 0, 0.45]}>
          <RBox size={[0.05, 2.05, 0.9]} radius={0.008} material={wood} />
          {[-0.45, 0.5].map((y) => <Box key={y} size={[0.012, 0.72, 0.64]} position={[-0.028, y, 0]} material={trim} cast={false} />)}
          {[-0.45, 0.5].map((y) => <Box key={`o${y}`} size={[0.012, 0.72, 0.64]} position={[0.028, y, 0]} material={trim} cast={false} />)}
          <group position={[-0.036, 0.5, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <group rotation={[0, 0, Math.PI]}>
              <group rotation={[0, 0, Math.PI / 4]}>
                <Sign text="福" size={[0.3, 0.3]} bg="#c8102e" fg="#ffd35c" />
              </group>
            </group>
          </group>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.045, -0.03, 0.34]}>
              <Cyl r={0.025} h={0.012} rotation={[0, 0, Math.PI / 2]} material={chrome} segments={14} cast={false} />
              <RBox size={[0.025, 0.022, 0.13]} radius={0.008} position={[s * 0.02, 0, -0.05]} material={chrome} cast={false} />
            </group>
          ))}
          <Cyl r={0.008} h={0.07} position={[0, 0.55, 0.1]} rotation={[0, 0, Math.PI / 2]} material={chrome} segments={10} cast={false} />
          <mesh position={[0.0265, 0.3, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[0.16, 0.08]} />
            <meshStandardMaterial map={plate} roughness={0.4} metalness={0.3} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** A shoe cabinet (faces +Z): louvred doors, a wooden top. */
export function ShoeCabinetModel() {
  const body = mat('painted', '#ece6da');
  const slats = useMemo(() => stripeTexture('#dcd3c3', '#f1ece2', 18), []);
  const door = mat('painted', '#ffffff', { map: slats });
  return (
    <group>
      <Box size={[0.98, 0.84, 0.36]} position={[0, 0.0, -0.01]} material={body} receive />
      <RBox size={[1.0, 0.03, 0.38]} radius={0.006} position={[0, 0.435, 0]} material={mat('wood', '#8a5d3b')} receive />
      <Box size={[0.94, 0.05, 0.3]} position={[0, -0.425, -0.02]} material={mat('rubber', '#3a3a3a')} cast={false} />
      {[-0.245, 0.245].map((x) => (
        <group key={x} position={[x, 0.02, 0.18]}>
          <RBox size={[0.48, 0.78, 0.02]} radius={0.004} material={door} cast={false} />
          <Box size={[0.012, 0.1, 0.012]} position={[x < 0 ? 0.2 : -0.2, 0.25, 0.016]} material={mat('steel')} cast={false} />
        </group>
      ))}
    </group>
  );
}

const HOOK_PINS: MergedBox[] = [-0.11, -0.037, 0.037, 0.11].flatMap((x): MergedBox[] => [
  { size: [0.008, 0.008, 0.045], at: [x, 0.1, 0.0], color: '#c9a54a' },
  { size: [0.01, 0.016, 0.008], at: [x, 0.106, 0.022], color: '#c9a54a' },
]);

/** A key board by the door (faces +Z): four brass hooks and the ledge the keys hang on. */
export function KeyHookModel() {
  const wood = mat('wood', '#6e4a2f');
  return (
    <group>
      <RBox size={[0.34, 0.16, 0.015]} radius={0.005} position={[0, 0.06, -0.037]} material={wood} cast={false} />
      <Box size={[0.32, 0.03, 0.09]} material={wood} />
      <Box size={[0.32, 0.03, 0.012]} position={[0, 0.02, 0.039]} material={wood} />
      <MergedBoxes boxes={HOOK_PINS} roughness={0.35} receive={false} />
    </group>
  );
}

/** A pedal bin with its lid propped open. */
export function BinModel() {
  const body = mat('plastic', '#5f9e78', { roughness: 0.4 });
  return (
    <group>
      <Lathe profile={[[0, -0.3], [0.16, -0.3], [0.18, 0.3], [0.17, 0.3], [0.15, -0.285], [0, -0.285]]} material={mat('plastic', '#5f9e78', { roughness: 0.4, doubleSide: true })} />
      <mesh geometry={torus(0.178, 0.008)} position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} material={body} />
      <RBox size={[0.1, 0.02, 0.06]} radius={0.008} position={[0, -0.29, 0.19]} material={mat('rubber', '#2b2b2b')} cast={false} />
      <group position={[0, 0.31, -0.17]} rotation={[-1.25, 0, 0]}>
        <Cyl r={0.18} h={0.015} position={[0, 0, 0.17]} material={body} />
      </group>
    </group>
  );
}

// ── living room: things to pick up ───────────────────────────────────────

export function RemoteModel() {
  return (
    <group>
      <RBox size={[0.05, 0.022, 0.17]} radius={0.008} material={mat('plastic', '#1d1f22', { roughness: 0.4 })} />
      <Box size={[0.034, 0.004, 0.09]} position={[0, 0.011, 0.02]} material={mat('rubber', '#55595f')} cast={false} />
      <Cyl r={0.007} h={0.005} position={[0, 0.012, -0.06]} material={mat('rubber', '#d83a2e')} segments={12} cast={false} />
    </group>
  );
}

/** A book lying flat: cover, page block, the printed front with its title. */
function BookModel({ title, bg, fg }: { title: string; bg: string; fg: string }) {
  const cover = useMemo(() => bookCoverTexture(title, bg, fg), [title, bg, fg]);
  return (
    <group>
      <RBox size={[0.15, 0.03, 0.21]} radius={0.003} material={mat('paper', bg, { roughness: 0.6 })} />
      <mesh position={[0, 0.0152, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.146, 0.206]} />
        <meshStandardMaterial map={cover} roughness={0.6} />
      </mesh>
    </group>
  );
}
export const Book1 = () => <BookModel title="唐诗" bg="#8b1e1e" fg="#f2d38a" />;
export const Book2 = () => <BookModel title="西游记" bg="#1f4e79" fg="#ffffff" />;
export const Book3 = () => <BookModel title="汉语" bg="#2e6b3f" fg="#f5e9c8" />;
export const Book4 = () => <BookModel title="三国演义" bg="#5b3a1d" fg="#f2d38a" />;

function CushionModel({ color, button }: { color: string; button: string }) {
  return (
    <group>
      <RBox size={[0.38, 0.14, 0.38]} radius={0.065} segments={3} material={mat('fabric', color)} />
      <Cyl r={0.018} h={0.01} position={[0, 0.068, 0]} material={mat('fabric', button)} segments={10} cast={false} />
    </group>
  );
}
export const Cushion1 = () => <CushionModel color="#c45f3e" button="#8e3d25" />;
export const Cushion2 = () => <CushionModel color="#d6b04a" button="#9a7a24" />;

export function PhoneModel() {
  return (
    <group>
      <RBox size={[0.075, 0.01, 0.155]} radius={0.004} material={mat('plastic', '#26282c', { roughness: 0.3 })} />
      <mesh position={[0, 0.0052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.068, 0.146]} />
        <meshStandardMaterial color="#0e1622" roughness={0.08} metalness={0.4} />
      </mesh>
    </group>
  );
}

export function ChargerModel() {
  const white = mat('plastic', '#f2f2f0', { roughness: 0.45 });
  return (
    <group>
      <RBox size={[0.05, 0.04, 0.05]} radius={0.006} material={white} />
      {[-0.008, 0.008].map((z) => <Box key={z} size={[0.016, 0.003, 0.004]} position={[-0.033, 0, z]} material={mat('steel')} cast={false} />)}
      <mesh geometry={torus(0.045, 0.0025)} position={[0.07, -0.017, 0]} rotation={[Math.PI / 2, 0, 0]} material={white} />
    </group>
  );
}

/** A Chinese teacup (no handle): white porcelain, a blue band, tea inside. */
export function TeacupModel() {
  return (
    <group>
      <Lathe profile={cupProfile(0.04, 0.07, 0.004, 0.62)} material={mat('ceramic', '#f7f5ef', { doubleSide: true })} />
      <Cyl r={0.0405} rTop={0.0405} h={0.012} open position={[0, 0.02, 0]} material={mat('ceramic', '#2b5fa8')} cast={false} />
      <Cyl r={0.035} h={0.002} position={[0, 0.018, 0]} material={mat('liquid', '#b07a2a', { roughness: 0.05 })} cast={false} segments={16} />
    </group>
  );
}

function PaperBallModel({ seed }: { seed: number }) {
  return <mesh geometry={crumple(seed)} scale={0.034} material={flatMat('#f1eee4')} castShadow />;
}
export const PaperBall1 = () => <PaperBallModel seed={3} />;
export const PaperBall2 = () => <PaperBallModel seed={9} />;

const KEY_PARTS: MergedBox[] = [
  { size: [0.02, 0.004, 0.02], at: [-0.006, 0, -0.01], yaw: 0.15, color: '#c9a54a' },
  { size: [0.04, 0.003, 0.009], at: [0.022, 0, -0.012], yaw: 0.15, color: '#c9a54a' },
  { size: [0.018, 0.004, 0.018], at: [-0.004, -0.003, 0.012], yaw: -0.25, color: '#b8bec5' },
  { size: [0.038, 0.003, 0.008], at: [0.022, -0.003, 0.017], yaw: -0.25, color: '#b8bec5' },
  { size: [0.026, 0.008, 0.02], at: [-0.033, -0.004, 0.016], color: '#c8102e' },
];

/** A ring of keys: two keys and a red fob. */
export function KeysModel() {
  const steel = mat('steel', '#b8bec5');
  return (
    <group>
      <mesh geometry={torus(0.014, 0.0025)} position={[-0.028, 0, 0]} rotation={[Math.PI / 2, 0, 0]} material={steel} />
      <MergedBoxes boxes={KEY_PARTS} roughness={0.3} cast />
    </group>
  );
}

/** A pair of house slippers (拖鞋): blue soles, white straps. */
export function SlippersModel() {
  return (
    <group>
      {[-0.06, 0.06].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <RBox size={[0.1, 0.025, 0.27]} radius={0.01} position={[0, -0.0125, 0]} material={mat('plastic', '#3d6fa8', { roughness: 0.6 })} />
          <RBox size={[0.1, 0.035, 0.1]} radius={0.016} position={[0, 0.012, -0.06]} material={mat('fabric', '#e7eef7')} cast={false} />
        </group>
      ))}
    </group>
  );
}

/** A folded umbrella standing on its tip, the J handle up. */
export function UmbrellaModel() {
  return (
    <group>
      <Cyl r={0.004} h={0.05} position={[0, -0.4, 0]} material={mat('metal', '#333')} segments={8} cast={false} />
      <Cyl r={0.008} rTop={0.035} h={0.6} position={[0, -0.075, 0]} material={mat('fabric', '#1f3b6e')} segments={14} />
      <Cyl r={0.006} h={0.12} position={[0, 0.285, 0]} material={mat('metal', '#2a2a2a')} segments={8} cast={false} />
      <mesh geometry={torus(0.03, 0.009, Math.PI)} position={[0.03, 0.345, 0]} material={mat('wood', '#5a3a22')} />
    </group>
  );
}

/** A potted money tree in a blue-and-white pot. */
export function PlantModel() {
  const leaf = mat('leaf', '#3f8a3a');
  const leaf2 = mat('leaf', '#56a046');
  const trunk = mat('wood', '#6b4a2c');
  return (
    <group>
      <Cyl r={0.15} rTop={0.17} h={0.3} position={[0, -0.15, 0]} material={mat('ceramic', '#f3f1ea', { roughness: 0.3 })} segments={20} />
      <Cyl r={0.172} h={0.04} open position={[0, -0.05, 0]} material={mat('ceramic', '#2b5fa8', { roughness: 0.3 })} segments={20} cast={false} />
      <Cyl r={0.16} h={0.01} position={[0, -0.005, 0]} material={mat('stone', '#4a3626')} segments={16} cast={false} />
      <Cyl r={0.02} rTop={0.012} h={0.35} position={[0.02, 0.17, 0]} rotation={[0, 0, -0.12]} material={trunk} segments={8} />
      {([[0.05, 0.38, 0.02, 0.16, 0], [-0.1, 0.3, 0.06, 0.13, 1], [0.11, 0.27, -0.07, 0.12, 1], [-0.05, 0.5, -0.05, 0.13, 0]] as Array<[number, number, number, number, number]>).map(([x, y, z, r, k], i) => (
        <Ball key={i} r={r} position={[x, y, z]} scale={[1, 0.72, 1]} material={k ? leaf2 : leaf} segments={12} />
      ))}
    </group>
  );
}

/** A green watering can: body, a long spout with its rose, a handle. */
export function WateringCanModel() {
  const metal = mat('metal', '#3f8f6b', { roughness: 0.45, metalness: 0.5 });
  return (
    <group>
      <Cyl r={0.06} h={0.16} position={[-0.05, -0.02, 0]} material={metal} segments={18} />
      <Cyl r={0.007} rTop={0.011} h={0.19} position={[0.07, 0.02, 0]} rotation={[0, 0, -1.0]} material={metal} segments={8} cast={false} />
      <Cyl r={0.022} rTop={0.018} h={0.02} position={[0.15, 0.07, 0]} rotation={[0, 0, -1.0]} material={mat('metal', '#c9a54a', { roughness: 0.3 })} segments={12} cast={false} />
      <mesh geometry={torus(0.05, 0.008, Math.PI)} position={[-0.05, 0.06, 0]} material={metal} />
    </group>
  );
}

const CLOCK_FEET: MergedBox[] = [
  { size: [0.008, 0.016, 0.008], at: [-0.026, -0.044, 0], color: '#333333' },
  { size: [0.008, 0.016, 0.008], at: [0.026, -0.044, 0], color: '#333333' },
  { size: [0.006, 0.02, 0.006], at: [0, 0.045, 0], color: '#333333' },
];

/** A twin-bell alarm clock (faces +Z). */
export function AlarmClockModel() {
  const red = mat('metal', '#c0392b', { roughness: 0.35, metalness: 0.6 });
  return (
    <group>
      <group position={[0, -0.005, 0]}>
        <WallClock r={0.042} />
      </group>
      <mesh geometry={torus(0.043, 0.006)} position={[0, -0.005, 0.012]} material={red} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Ball r={0.02} position={[s * 0.028, 0.04, 0]} scale={[1, 0.7, 1]} material={red} segments={12} cast={false} />
        </group>
      ))}
      <MergedBoxes boxes={CLOCK_FEET} roughness={0.4} receive={false} />
    </group>
  );
}

// ── bedroom ───────────────────────────────────────────────────────────────

/** The double bed (its length along X, the head at −X): frame, mattress, quilt cover, headboard. */
export function BedModel() {
  const cover = mat('fabric', '#5f82a8');
  return (
    <group>
      <RBox size={[1.9, 0.25, 1.5]} radius={0.02} position={[0, -0.15, 0]} material={mat('wood', '#9b6b43')} />
      <RBox size={[1.86, 0.3, 1.46]} radius={0.05} segments={3} position={[0, 0.125, 0]} material={mat('fabric', '#f5f3ee')} receive />
      <RBox size={[1.5, 0.03, 1.54]} radius={0.012} position={[0.19, 0.27, 0]} material={cover} receive cast={false} />
      {[-0.775, 0.775].map((z) => <Box key={z} size={[1.5, 0.24, 0.02]} position={[0.19, 0.16, z]} material={cover} cast={false} />)}
      <Box size={[0.02, 0.24, 1.54]} position={[0.945, 0.16, 0]} material={cover} cast={false} />
      <RBox size={[0.08, 1.1, 1.6]} radius={0.03} segments={3} position={[-0.99, 0.275, 0]} material={mat('fabric', '#8a9bb0')} />
    </group>
  );
}

/** A bedside table with two drawers (faces +Z). */
export function NightstandModel() {
  const wood = mat('wood', '#a9764b');
  return (
    <group>
      <Box size={[0.43, 0.46, 0.38]} position={[0, -0.01, -0.005]} material={wood} />
      <RBox size={[0.45, 0.03, 0.4]} radius={0.006} position={[0, 0.235, 0]} material={mat('wood', '#8f6038')} receive />
      {[0.08, -0.13].map((y) => (
        <group key={y} position={[0, y, 0.19]}>
          <RBox size={[0.39, 0.18, 0.02]} radius={0.004} material={mat('wood', '#b98a5a')} cast={false} />
          <Ball r={0.012} position={[0, 0, 0.016]} material={mat('metal', '#c9a54a', { roughness: 0.3 })} segments={8} cast={false} />
        </group>
      ))}
    </group>
  );
}

/**
 * The wardrobe (faces +Z): a carcass (one merged mesh with hanging clothes on the left), a shelf on the
 * right, two sliding doors — open slides the right door behind the left one.
 */
export function WardrobeModel({ states }: ModelProps) {
  const door = useRef<Group>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const d = door.current;
    if (d) d.position.x = ease(d.position.x, open ? -0.35 : 0.35, dt, 5);
  });
  const carcass = useMemo<MergedBox[]>(() => {
    const out = '#c79f74';
    const inn = '#e7d7c2';
    const boxes: MergedBox[] = [
      { size: [1.4, 2.0, 0.02], at: [0, 0, -0.29], color: inn },
      { size: [0.02, 2.0, 0.6], at: [-0.69, 0, 0], color: out },
      { size: [0.02, 2.0, 0.6], at: [0.69, 0, 0], color: out },
      { size: [1.4, 0.03, 0.6], at: [0, 0.985, 0], color: out },
      { size: [1.4, 0.08, 0.6], at: [0, -0.96, 0], color: out },
      { size: [0.02, 1.9, 0.56], at: [0, 0.01, -0.01], color: inn },
      { size: [0.67, 0.02, 0.54], at: [0.345, 0, -0.02], color: inn },
    ];
    // Hanging clothes (left half): a coat, a dress, a jacket — and their hangers.
    const clothes: Array<[number, number, string]> = [[-0.55, 0.95, '#3c4a5e'], [-0.4, 1.1, '#b5485a'], [-0.24, 0.85, '#d9c39a'], [-0.12, 0.9, '#5b7d5a']];
    for (const [x, h, c] of clothes) {
      boxes.push({ size: [0.05, h, 0.44], at: [x, 0.78 - h / 2, -0.02], color: c });
      boxes.push({ size: [0.012, 0.04, 0.36], at: [x, 0.8, -0.02], color: '#7a5a3a' });
    }
    return boxes;
  }, []);
  const panel = mat('wood', '#d2ae86', { roughness: 0.5 });
  return (
    <group>
      <MergedBoxes boxes={carcass} roughness={0.7} cast />
      <Cyl r={0.01} h={0.66} position={[-0.35, 0.82, -0.02]} rotation={[0, 0, Math.PI / 2]} material={mat('chrome')} segments={8} cast={false} />
      {/* the left door (fixed), with a long mirror */}
      <group position={[-0.35, 0, 0.255]}>
        <RBox size={[0.7, 1.92, 0.025]} radius={0.006} material={panel} />
        <mesh position={[0, 0.05, 0.0135]}>
          <planeGeometry args={[0.46, 1.5]} />
          <primitive object={mat('chrome', '#e3ebf0', { roughness: 0.04 })} attach="material" />
        </mesh>
        <Box size={[0.02, 0.4, 0.015]} position={[0.31, 0, 0.02]} material={mat('steel')} cast={false} />
      </group>
      {/* the right door (slides) */}
      <group ref={door} position={[0.35, 0, 0.285]}>
        <RBox size={[0.7, 1.92, 0.025]} radius={0.006} material={panel} />
        <Box size={[0.02, 0.4, 0.015]} position={[-0.31, 0, 0.02]} material={mat('steel')} cast={false} />
      </group>
    </group>
  );
}

export function DeskModel() {
  return (
    <group>
      <Table size={[1.1, 0.75, 0.55]} color="#c8a27a" legColor="#8a6a48" />
      <Box size={[0.4, 0.1, 0.45]} position={[0.25, 0.28, 0]} material={mat('wood', '#b89068')} cast={false} />
      <Box size={[0.08, 0.012, 0.012]} position={[0.25, 0.28, 0.232]} material={mat('steel')} cast={false} />
    </group>
  );
}

/** A desk lamp: weighted base, a slanted arm, a shade; the bedroom's point light. */
export function DeskLampModel({ states }: ModelProps) {
  const on = states.light === 'on';
  const metal = mat('metal', '#2f6f7a', { roughness: 0.4, metalness: 0.6 });
  return (
    <group>
      <Cyl r={0.07} h={0.02} position={[0, -0.19, 0]} material={metal} segments={16} />
      <Cyl r={0.008} h={0.3} position={[0.02, -0.04, 0]} rotation={[0, 0, 0.15]} material={metal} segments={8} />
      <group position={[-0.01, 0.13, 0]} rotation={[0, 0, 0.9]}>
        <Cyl r={0.06} rTop={0.025} h={0.09} open material={mat('metal', '#2f6f7a', { roughness: 0.4, metalness: 0.6, doubleSide: true })} segments={16} />
        <mesh position={[0, -0.02, 0]}>
          <sphereGeometry args={[0.022, 12, 8]} />
          <meshStandardMaterial color={on ? '#fff3c4' : '#d9d4c8'} emissive={on ? '#ffd88a' : '#000000'} emissiveIntensity={on ? 2.4 : 0} toneMapped={!on} />
        </mesh>
      </group>
      <pointLight position={[-0.06, 0.08, 0]} color="#ffe2b0" intensity={on ? 1.6 : 0} distance={4} decay={1.6} />
    </group>
  );
}

export const ChairModel = () => <Chair size={[0.44, 0.9, 0.46]} color="#8c5a35" seatColor="#5f82a8" />;

/** A laptop (the screen faces +Z when open; the hinge at −Z): the lid opens with `states.lid`. */
export function LaptopModel({ states }: ModelProps) {
  const lid = useRef<Group>(null);
  const open = states.lid === 'open';
  const screen = useMemo(() => new MeshStandardMaterial({ color: '#0b0e14', roughness: 0.15, emissive: '#ffffff', emissiveMap: laptopScreenTexture(), emissiveIntensity: 0 }), []);
  useFrame((_, dt) => {
    const l = lid.current;
    if (!l) return;
    l.rotation.x = ease(l.rotation.x, open ? 1.85 : 0, dt, 5);
    screen.emissiveIntensity = Math.min(1, l.rotation.x / 1.6) * 0.9;
  });
  const shell = mat('metal', '#b9bec5', { roughness: 0.4, metalness: 0.7 });
  return (
    <group>
      <RBox size={[0.32, 0.012, 0.22]} radius={0.004} position={[0, -0.004, 0]} material={shell} />
      <mesh position={[0, 0.0025, -0.02]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.28, 0.1]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.0025, 0.065]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.09, 0.055]} />
        <meshStandardMaterial color="#a3a9b0" roughness={0.3} />
      </mesh>
      {/* the lid: hinged at the back edge (+Z here), lying over the keyboard when closed */}
      <group ref={lid} position={[0, 0.003, 0.11]}>
        <RBox size={[0.32, 0.007, 0.22]} radius={0.003} position={[0, 0.0035, -0.11]} material={shell} />
        <mesh position={[0, -0.0004, -0.11]} rotation={[Math.PI / 2, 0, Math.PI]} material={screen}>
          <planeGeometry args={[0.3, 0.19]} />
        </mesh>
      </group>
    </group>
  );
}

export function PillowModel() {
  return <RBox size={[0.35, 0.12, 0.6]} radius={0.055} segments={3} material={mat('fabric', '#f7f5f0')} />;
}

/** The quilt, folded at the foot of the bed. */
export function BlanketModel() {
  const stripes = useMemo(() => stripeTexture('#e7b7a3', '#f6dfd3', 8), []);
  return (
    <group>
      <RBox size={[0.5, 0.1, 1.3]} radius={0.04} segments={3} material={mat('fabric', '#ffffff', { map: stripes })} />
      <Box size={[0.502, 0.006, 1.24]} position={[0, 0.0, 0]} material={mat('fabric', '#c98f78')} cast={false} />
    </group>
  );
}

/** A folded shirt: body, collar, button placket. */
export function ShirtModel() {
  return (
    <group>
      <RBox size={[0.28, 0.05, 0.24]} radius={0.012} material={mat('fabric', '#9cc3e6')} />
      {[-1, 1].map((s) => <Box key={s} size={[0.06, 0.012, 0.045]} position={[s * 0.03, 0.027, -0.085]} rotation={[0, s * 0.5, 0]} material={mat('fabric', '#ffffff')} cast={false} />)}
      <Box size={[0.014, 0.002, 0.17]} position={[0, 0.026, 0.02]} material={mat('fabric', '#cfe2f3')} cast={false} />
    </group>
  );
}

export function TrousersModel() {
  return (
    <group>
      <RBox size={[0.26, 0.06, 0.24]} radius={0.012} material={mat('fabric', '#2c3e5c')} />
      <Box size={[0.26, 0.012, 0.03]} position={[0, 0.026, -0.105]} material={mat('fabric', '#1f2d44')} cast={false} />
      <Box size={[0.004, 0.002, 0.2]} position={[0.03, 0.0305, 0.01]} material={mat('fabric', '#40567a')} cast={false} />
    </group>
  );
}

/** A pair of socks, rolled. */
export function SocksModel() {
  return (
    <group>
      {[-0.026, 0.026].map((z) => (
        <group key={z} position={[0, 0, z]}>
          <Cyl r={0.022} h={0.13} rotation={[0, 0, Math.PI / 2]} material={mat('fabric', '#f4f4f2')} segments={12} />
          <Cyl r={0.0225} h={0.02} open position={[0.04, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('fabric', '#c8102e')} segments={12} cast={false} />
        </group>
      ))}
    </group>
  );
}

/** Dirty clothes: crumpled. */
export function DirtyShirtModel() {
  return (
    <group>
      <mesh geometry={crumple(21)} scale={[0.09, 0.028, 0.08]} material={flatMat('#d7c9ad', 0.95)} castShadow />
      <mesh geometry={crumple(22)} scale={[0.05, 0.02, 0.04]} position={[0.04, 0.012, 0.02]} material={flatMat('#bfae8d', 0.95)} />
    </group>
  );
}
export function DirtySocksModel() {
  return (
    <group>
      <mesh geometry={crumple(31)} scale={[0.055, 0.024, 0.03]} position={[0, 0, -0.02]} material={flatMat('#8d8f93', 0.95)} castShadow />
      <mesh geometry={crumple(32)} scale={[0.05, 0.022, 0.03]} position={[0.005, 0.005, 0.022]} material={flatMat('#7b7d82', 0.95)} />
    </group>
  );
}

// ── bathroom ──────────────────────────────────────────────────────────────

/** A vessel washbasin on the counter (an oval porcelain bowl). */
export function BasinModel() {
  return (
    <group>
      <Lathe profile={bowlProfile(0.17, 0.14, 0.012)} scale={[1.29, 1, 1]} material={mat('ceramic', '#fbfaf7', { doubleSide: true })} />
      <Cyl r={0.022} h={0.004} position={[0, -0.064, 0]} material={mat('chrome')} cast={false} segments={14} />
    </group>
  );
}

/** A tall chrome faucet over the basin; water runs when `states.water` is on. */
export function TapModel({ states }: ModelProps) {
  const water = useRef<Mesh>(null);
  const on = states.water === 'on';
  useFrame(({ clock }) => {
    const w = water.current;
    if (!w) return;
    w.visible = on;
    if (on) w.scale.set(1 + 0.08 * Math.sin(clock.elapsedTime * 30), 1, 1 + 0.08 * Math.cos(clock.elapsedTime * 27));
  });
  const chrome = mat('chrome');
  return (
    <group>
      <Cyl r={0.026} h={0.02} position={[0, -0.16, 0]} material={chrome} segments={16} cast={false} />
      <Cyl r={0.014} h={0.28} position={[0, -0.02, 0]} material={chrome} segments={14} />
      <Cyl r={0.011} h={0.15} position={[0, 0.12, 0.07]} rotation={[Math.PI / 2, 0, 0]} material={chrome} segments={12} />
      <Cyl r={0.012} h={0.03} position={[0, 0.105, 0.14]} material={chrome} segments={12} cast={false} />
      <RBox size={[0.014, 0.012, 0.06]} radius={0.005} position={[0, 0.135, -0.03]} rotation={[on ? 0.5 : 0, 0, 0]} material={chrome} cast={false} />
      <mesh ref={water} position={[0, -0.03, 0.14]} visible={false}>
        <cylinderGeometry args={[0.006, 0.008, 0.24, 10, 1, true]} />
        <meshStandardMaterial color="#cfeaf7" transparent opacity={0.55} roughness={0.05} />
      </mesh>
    </group>
  );
}

/** The bathroom mirror: a dark frame, a reflective glass, a soft light strip over it. */
export function MirrorModel() {
  return (
    <group>
      <RBox size={[0.7, 0.85, 0.02]} radius={0.01} position={[0, 0, -0.005]} material={mat('metal', '#3a3d42', { roughness: 0.4 })} cast={false} />
      <mesh position={[0, 0, 0.0055]}>
        <planeGeometry args={[0.64, 0.79]} />
        <primitive object={mat('chrome', '#e3ebf0', { roughness: 0.03 })} attach="material" />
      </mesh>
      <Box size={[0.5, 0.015, 0.02]} position={[0, 0.44, 0.01]} material={mat('glow', '#fff6e0')} cast={false} />
    </group>
  );
}

export function ToiletModel() {
  const white = mat('ceramic', '#fbfaf7');
  return (
    <group>
      <RBox size={[0.36, 0.38, 0.5]} radius={0.12} segments={3} position={[0, -0.185, 0.065]} material={white} />
      <RBox size={[0.38, 0.025, 0.46]} radius={0.012} position={[0, 0.017, 0.07]} material={white} cast={false} />
      <RBox size={[0.37, 0.02, 0.44]} radius={0.012} position={[0, 0.04, 0.07]} material={mat('ceramic', '#f1efe9')} cast={false} />
      <RBox size={[0.4, 0.4, 0.18]} radius={0.03} position={[0, 0.155, -0.225]} material={white} />
      <Cyl r={0.025} h={0.008} position={[0, 0.358, -0.225]} material={mat('chrome')} segments={14} cast={false} />
    </group>
  );
}

/**
 * The front-loading washing machine (faces +Z): a white shell (merged), the drum, a control panel, and a
 * round door hinged on its left edge that swings out with `states.door`.
 */
export function WasherModel({ states }: ModelProps) {
  const hinge = useRef<Group>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const h = hinge.current;
    if (h) h.rotation.y = ease(h.rotation.y, open ? -Math.PI / 2 : 0, dt, 5);
  });
  const shell = useMemo<MergedBox[]>(() => {
    const c = '#f5f6f7';
    return [
      { size: [0.6, 0.04, 0.6], at: [0, 0.405, 0], color: c },
      { size: [0.6, 0.1, 0.6], at: [0, -0.375, 0], color: '#e4e6e8' },
      { size: [0.6, 0.85, 0.04], at: [0, 0, -0.28], color: c },
      { size: [0.04, 0.85, 0.6], at: [-0.28, 0, 0], color: c },
      { size: [0.04, 0.85, 0.6], at: [0.28, 0, 0], color: c },
      { size: [0.6, 0.205, 0.04], at: [0, 0.3025, 0.28], color: c },
      { size: [0.6, 0.11, 0.04], at: [0, -0.27, 0.28], color: c },
    ];
  }, []);
  const lcd = useMemo(() => lcdTexture('00:45'), []);
  const chrome = mat('chrome');
  return (
    <group>
      <MergedBoxes boxes={shell} roughness={0.35} cast />
      <Cyl r={0.2} h={0.5} open position={[0, -0.01, 0.01]} rotation={[Math.PI / 2, 0, 0]} material={mat('steel', '#7e858c', { doubleSide: true, roughness: 0.4 })} cast={false} />
      <mesh position={[0.1, 0.32, 0.301]}>
        <planeGeometry args={[0.12, 0.045]} />
        <meshBasicMaterial map={lcd} toneMapped={false} />
      </mesh>
      <Cyl r={0.035} h={0.02} position={[-0.15, 0.31, 0.305]} rotation={[Math.PI / 2, 0, 0]} material={chrome} segments={16} cast={false} />
      <Box size={[0.13, 0.05, 0.01]} position={[0.2, 0.36, 0.302]} material={mat('plastic', '#d9dde1')} cast={false} />
      <group ref={hinge} position={[-0.26, -0.0075, 0.31]}>
        <group position={[0.26, 0, 0]}>
          <RBox size={[0.5, 0.4, 0.025]} radius={0.01} material={mat('plastic', '#eceef0', { roughness: 0.35 })} />
          <mesh geometry={torus(0.17, 0.022)} position={[0, 0, 0.018]} material={chrome} />
          <mesh position={[0, 0, 0.02]}>
            <circleGeometry args={[0.155, 28]} />
            <primitive object={mat('glass', '#2a3640', { opacity: 0.55 })} attach="material" />
          </mesh>
          <RBox size={[0.03, 0.08, 0.025]} radius={0.008} position={[0.21, 0, 0.025]} material={mat('plastic', '#c9cdd2')} cast={false} />
        </group>
      </group>
    </group>
  );
}

/** A woven plastic laundry basket (walls in one merged mesh). */
export function LaundryBasketModel() {
  const weave = useMemo(() => stripeTexture('#9fb7c9', '#c5d6e2', 14), []);
  const walls = useMemo<MergedBox[]>(() => [
    { size: [0.4, 0.02, 0.32], at: [0, -0.19, 0] },
    { size: [0.4, 0.38, 0.015], at: [0, 0, 0.1525] },
    { size: [0.4, 0.38, 0.015], at: [0, 0, -0.1525] },
    { size: [0.015, 0.38, 0.32], at: [0.1925, 0, 0] },
    { size: [0.015, 0.38, 0.32], at: [-0.1925, 0, 0] },
  ], []);
  return (
    <group>
      <MergedBoxes boxes={walls} map={weave} roughness={0.6} cast />
      {([[0, 0.16, 0.42, 0.025], [0, -0.16, 0.42, 0.025], [0.2, 0, 0.025, 0.34], [-0.2, 0, 0.025, 0.34]] as Array<[number, number, number, number]>).map(([x, z, w, d]) => (
        <Box key={`${x}:${z}`} size={[w, 0.025, d]} position={[x, 0.19, z]} material={mat('plastic', '#7f9cb2')} cast={false} />
      ))}
    </group>
  );
}

export function TowelModel() {
  const stripes = useMemo(() => stripeTexture('#7fb3c9', '#e8f1f5', 6), []);
  return <RBox size={[0.3, 0.06, 0.22]} radius={0.02} segments={3} material={mat('fabric', '#ffffff', { map: stripes })} />;
}

export function ToothbrushModel() {
  return (
    <group>
      <RBox size={[0.15, 0.012, 0.014]} radius={0.005} position={[-0.02, -0.002, 0]} material={mat('plastic', '#3fa9f5', { roughness: 0.3 })} />
      <RBox size={[0.035, 0.01, 0.012]} radius={0.004} position={[0.075, -0.003, 0]} material={mat('plastic', '#3fa9f5', { roughness: 0.3 })} />
      <Box size={[0.03, 0.01, 0.011]} position={[0.075, 0.006, 0]} material={mat('plastic', '#f4f8fb')} cast={false} />
    </group>
  );
}

/** A tube of toothpaste (牙膏 on the label), lying down. */
export function ToothpasteModel() {
  const label = useMemo(() => labelTexture('牙膏', '#ffffff', '#c8102e', '#2f7dd1'), []);
  return (
    <group>
      <Cyl r={0.02} h={0.13} position={[0.01, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.85]} material={mat('plastic', '#ffffff', { map: label })} segments={16} />
      <Box size={[0.014, 0.004, 0.044]} position={[-0.075, 0, 0]} material={mat('plastic', '#f2f2f2')} cast={false} />
      <Cyl r={0.012} h={0.022} position={[0.085, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('plastic', '#2f7dd1')} segments={12} cast={false} />
    </group>
  );
}

export function BathCupModel() {
  return <Lathe profile={cupProfile(0.035, 0.1, 0.003, 0.85)} material={mat('plastic', '#8fd0c0', { doubleSide: true, roughness: 0.35 })} />;
}

/** A row of shampoo / shower-gel bottles (decor for the shower shelf, labelled). */
export function Bottle({ text, color, position }: { text: string; color: string; position: V3 }) {
  const label = useMemo(() => labelTexture(text, '#ffffff', '#333333', color), [text, color]);
  return (
    <group position={position}>
      <Cyl r={0.03} h={0.16} material={mat('plastic', '#ffffff', { map: label })} segments={14} cast={false} />
      <Cyl r={0.014} h={0.03} position={[0, 0.095, 0]} material={mat('plastic', color)} segments={10} cast={false} />
    </group>
  );
}

/** Decor curtains, gathered at both sides of a window (the bedroom's: not an object). */
export function GatheredCurtains({ width, height, color = '#c9d6e3' }: { width: number; height: number; color?: string }) {
  const geo = pleats(0.36, height, 4, 0.025);
  const cloth = mat('fabric', color, { doubleSide: true });
  const metal = mat('metal', '#6b5a46', { roughness: 0.35 });
  return (
    <group>
      <Cyl r={0.01} h={width + 0.3} position={[0, height / 2 + 0.04, 0]} rotation={[0, 0, Math.PI / 2]} material={metal} segments={8} cast={false} />
      <mesh geometry={geo} material={cloth} position={[-width / 2 - 0.05, 0, 0.03]} />
      <mesh geometry={geo} material={cloth} position={[width / 2 + 0.05, 0, 0.03]} />
    </group>
  );
}
