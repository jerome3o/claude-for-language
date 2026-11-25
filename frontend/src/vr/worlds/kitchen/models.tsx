/**
 * The kitchen's object models (the reference world — docs/VR_WORLDS.md). Every model is drawn in its
 * object's own frame: the origin is the middle of the object's collider (index.tsx), so a mug whose
 * collider is a 0.095 m tall cylinder spans y −0.0475 … +0.0475. All procedural (kit/), nothing loaded.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CatmullRomCurve3, TorusGeometry, TubeGeometry, Vector3, type Group, type Mesh } from 'three';
import {
  Ball, Box, Chair, Cyl, Lathe, RBox, Table, WallClock, WindowPane, bottleProfile, bowlProfile, cupProfile,
  labelTexture, mat, plateProfile, potProfile, stripeTexture,
} from '../kit';
import type { ModelProps } from '../types';

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

/** A mug: lathe body, a handle, a coloured band. */
export function Mug({ color = '#f4efe4', band = '#2f7d8c' }: { color?: string; band?: string }) {
  return (
    <group>
      <Lathe profile={cupProfile(0.042, 0.095, 0.005, 0.9)} material={mat('ceramic', color, { doubleSide: true })} />
      <Cyl r={0.0425} h={0.012} open position={[0, 0.02, 0]} material={mat('ceramic', band)} cast={false} />
      <mesh geometry={torus(0.025, 0.006, Math.PI)} material={mat('ceramic', color)} position={[0.045, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow />
    </group>
  );
}

export const CupModel = () => <Mug />;
export const Cup2Model = () => <Mug color="#2f7d8c" band="#f4efe4" />;

/** A rice bowl: white porcelain with a blue rim line. */
export function BowlModel() {
  return (
    <group>
      <Lathe profile={bowlProfile(0.075, 0.07)} material={mat('ceramic', '#f7f5ef', { doubleSide: true })} />
      <mesh geometry={torus(0.073, 0.0025)} material={mat('ceramic', '#2b5fa8')} position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

export function PlateModel() {
  return (
    <group>
      <Lathe profile={plateProfile(0.11, 0.02)} material={mat('ceramic', '#fbfaf6', { doubleSide: true })} />
      <mesh geometry={torus(0.1, 0.002)} material={mat('ceramic', '#2b5fa8')} position={[0, 0.009, 0]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

/** A pair of chopsticks (red-lacquered tops). */
export function ChopsticksModel() {
  return (
    <group>
      {[-0.006, 0.006].map((z, i) => (
        <group key={i} position={[0, 0, z]} rotation={[0, (i ? 1 : -1) * 0.03, 0]}>
          <Cyl r={0.0035} rTop={0.0022} h={0.23} rotation={[0, 0, Math.PI / 2]} material={mat('wood', '#c9a26b')} segments={8} />
          <Cyl r={0.0037} h={0.07} rotation={[0, 0, Math.PI / 2]} position={[-0.08, 0, 0]} material={mat('plastic', '#a3241f', { roughness: 0.25 })} segments={8} />
        </group>
      ))}
    </group>
  );
}

export function SpoonModel() {
  return (
    <group>
      <Box size={[0.1, 0.004, 0.012]} position={[-0.03, 0, 0]} material={mat('steel')} />
      <Ball r={0.02} scale={[1.3, 0.35, 1]} position={[0.045, 0, 0]} material={mat('steel')} />
    </group>
  );
}

export function KnifeModel() {
  return (
    <group>
      <RBox size={[0.14, 0.004, 0.03]} radius={0.0019} position={[0.045, 0, 0]} material={mat('chrome')} />
      <RBox size={[0.1, 0.014, 0.022]} radius={0.006} position={[-0.075, 0, 0]} material={mat('wood', '#3b2618')} />
    </group>
  );
}

export function AppleModel({ color = '#c8232c' }: { color?: string }) {
  return (
    <group>
      <Ball r={0.04} scale={[1, 0.92, 1]} material={mat('food', color, { roughness: 0.35 })} segments={18} />
      <Cyl r={0.003} h={0.022} position={[0, 0.043, 0]} rotation={[0, 0, 0.25]} material={mat('wood', '#5b3a1f')} segments={6} />
      <Ball r={0.012} scale={[1.6, 0.25, 0.8]} position={[0.012, 0.047, 0]} rotation={[0, 0, 0.4]} material={mat('leaf')} segments={8} />
    </group>
  );
}
export const Apple1 = () => <AppleModel />;
export const Apple2 = () => <AppleModel color="#b81d28" />;
export const Apple3 = () => <AppleModel color="#7fb236" />;

/** A banana: a curved tube, yellow with brown tips. */
export function BananaModel() {
  const geom = useMemo(() => {
    const curve = new CatmullRomCurve3([new Vector3(-0.095, 0.012, 0), new Vector3(-0.05, -0.008, 0), new Vector3(0, -0.014, 0), new Vector3(0.05, -0.008, 0), new Vector3(0.095, 0.014, 0)]);
    return new TubeGeometry(curve, 20, 0.018, 8, false);
  }, []);
  return (
    <group>
      <mesh geometry={geom} material={mat('food', '#f2cf3c', { roughness: 0.55 })} castShadow />
      <Ball r={0.008} position={[-0.096, 0.012, 0]} material={mat('food', '#4a3520')} segments={8} />
      <Cyl r={0.006} h={0.025} position={[0.103, 0.02, 0]} rotation={[0, 0, -0.9]} material={mat('food', '#6b5a2a')} segments={6} />
    </group>
  );
}

/** A carton of milk: a box with a gable top and a printed label. */
export function MilkModel() {
  const label = useMemo(() => labelTexture('牛奶', '#ffffff', '#1d4f91', '#3b7ff2'), []);
  return (
    <group>
      <RBox size={[0.07, 0.15, 0.07]} radius={0.004} position={[0, -0.02, 0]} material={mat('paper', '#ffffff', { map: label })} />
      <Box size={[0.07, 0.035, 0.052]} position={[0, 0.07, 0.009]} rotation={[0.45, 0, 0]} material={mat('paper', '#f3f6fb')} />
      <Box size={[0.07, 0.035, 0.052]} position={[0, 0.07, -0.009]} rotation={[-0.45, 0, 0]} material={mat('paper', '#f3f6fb')} />
      <Box size={[0.072, 0.012, 0.006]} position={[0, 0.09, 0]} material={mat('paper', '#e8edf5')} />
    </group>
  );
}

export function EggModel() {
  return <Ball r={0.025} scale={[1, 1.25, 1]} material={mat('food', '#efe3cf', { roughness: 0.6 })} segments={16} />;
}

/** A cooking pot with a lid and two handles. */
export function PotModel() {
  return (
    <group>
      <Lathe profile={potProfile(0.12, 0.12)} material={mat('steel', '#c3c8cf', { doubleSide: true, roughness: 0.3 })} />
      <Cyl r={0.125} rTop={0.06} h={0.03} position={[0, 0.072, 0]} material={mat('steel', '#cfd4da', { roughness: 0.25 })} />
      <Ball r={0.015} position={[0, 0.092, 0]} material={mat('rubber', '#222')} />
      {[-1, 1].map((sx) => (
        <RBox key={sx} size={[0.04, 0.014, 0.05]} radius={0.006} position={[sx * 0.14, 0.04, 0]} material={mat('rubber', '#2a2a2a')} />
      ))}
    </group>
  );
}

export function BreadModel() {
  return (
    <group>
      <RBox size={[0.24, 0.07, 0.12]} radius={0.03} position={[0, -0.02, 0]} material={mat('food', '#c98b45', { roughness: 0.8 })} />
      <Ball r={0.06} scale={[2, 0.7, 1]} position={[0, 0.012, 0]} material={mat('food', '#b8743a', { roughness: 0.75 })} segments={16} />
    </group>
  );
}

export function BoardModel() {
  return (
    <group>
      <RBox size={[0.36, 0.02, 0.24]} radius={0.008} material={mat('wood', '#c49a62', { roughness: 0.55 })} />
      <Cyl r={0.012} h={0.022} position={[0.15, 0, 0]} material={mat('rubber', '#3a2a1a')} segments={10} />
    </group>
  );
}

/** A water bottle: glass, a blue cap, water inside. */
export function BottleModel() {
  return (
    <group>
      <Cyl r={0.03} h={0.13} position={[0, -0.035, 0]} material={mat('liquid', '#bfe3f2', { opacity: 0.55 })} cast={false} />
      <Lathe profile={bottleProfile(0.035, 0.22, 0.012)} material={mat('glass')} />
      <Cyl r={0.0145} h={0.018} position={[0, 0.115, 0]} material={mat('plastic', '#2a6fd6')} segments={12} />
    </group>
  );
}

/** A wicker basket with a handle. */
export function BasketModel() {
  const weave = useMemo(() => stripeTexture('#b8874f', '#9c6b39', 10), []);
  const wall = mat('wood', '#ffffff', { map: weave, roughness: 0.85 });
  return (
    <group>
      <RBox size={[0.34, 0.015, 0.26]} radius={0.006} position={[0, -0.072, 0]} material={wall} />
      <RBox size={[0.34, 0.16, 0.014]} radius={0.006} position={[0, 0, 0.124]} material={wall} />
      <RBox size={[0.34, 0.16, 0.014]} radius={0.006} position={[0, 0, -0.124]} material={wall} />
      <RBox size={[0.014, 0.16, 0.26]} radius={0.006} position={[0.164, 0, 0]} material={wall} />
      <RBox size={[0.014, 0.16, 0.26]} radius={0.006} position={[-0.164, 0, 0]} material={wall} />
      <mesh geometry={torus(0.15, 0.008, Math.PI)} material={mat('wood', '#9c6b39')} position={[0, 0.07, 0]} castShadow />
    </group>
  );
}

export const ChairModel = () => <Chair size={[0.44, 0.9, 0.46]} color="#8c5a35" seatColor="#c4553f" />;

/** A spice jar with a printed character (盐 / 糖). */
export function JarModel({ text, lid }: { text: string; lid: string }) {
  const label = useMemo(() => labelTexture(text, '#fffdf6', '#5a3b1d', lid), [text, lid]);
  return (
    <group>
      <Cyl r={0.038} h={0.1} position={[0, -0.01, 0]} material={mat('paper', '#ffffff', { map: label })} segments={20} />
      <Cyl r={0.04} h={0.022} position={[0, 0.05, 0]} material={mat('plastic', lid)} segments={20} />
    </group>
  );
}
export const SaltModel = () => <JarModel text="盐" lid="#3b7ff2" />;
export const SugarModel = () => <JarModel text="糖" lid="#d9534f" />;

// ── fixed things ─────────────────────────────────────────────────────────

export const TableModel = () => <Table size={[1.3, 0.75, 0.8]} color="#b07a4a" legColor="#7a4f2c" />;

/** The fridge: a hollow cabinet whose door swings open (smoothly) with `states.door`, a light inside. */
export function FridgeModel({ states }: ModelProps) {
  const door = useRef<Group>(null);
  const lamp = useRef<Mesh>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const d = door.current;
    if (!d) return;
    const goal = open ? -1.75 : 0;
    d.rotation.y += (goal - d.rotation.y) * Math.min(1, dt * 7);
    if (lamp.current) lamp.current.visible = d.rotation.y < -0.2;
  });
  const body = mat('painted', '#eef1f4', { roughness: 0.35, metalness: 0.1 });
  const inner = mat('plastic', '#f7f9fb', { roughness: 0.6 });
  const shelf = mat('glass', '#e6f2f7');
  return (
    <group>
      {/* shell */}
      <Box size={[0.72, 1.8, 0.04]} position={[0, 0, -0.355]} material={body} />
      <Box size={[0.04, 1.8, 0.75]} position={[-0.34, 0, 0]} material={body} />
      <Box size={[0.04, 1.8, 0.75]} position={[0.34, 0, 0]} material={body} />
      <Box size={[0.72, 0.04, 0.75]} position={[0, 0.88, 0]} material={body} />
      <Box size={[0.72, 0.08, 0.75]} position={[0, -0.86, 0]} material={body} />
      {/* inside: a light lining, two glass shelves, a crisper drawer, the light */}
      <Box size={[0.63, 1.62, 0.01]} position={[0, 0, -0.33]} material={inner} cast={false} />
      <Box size={[0.64, 0.02, 0.66]} position={[0, 0.05, -0.02]} material={shelf} cast={false} />
      <Box size={[0.64, 0.02, 0.66]} position={[0, -0.4, -0.02]} material={shelf} cast={false} />
      <RBox size={[0.6, 0.16, 0.6]} radius={0.01} position={[0, -0.72, -0.03]} material={mat('glass', '#dbeff7', { opacity: 0.45 })} cast={false} />
      <mesh ref={lamp} position={[0, 0.84, -0.05]} visible={false}>
        <boxGeometry args={[0.3, 0.012, 0.06]} />
        <meshBasicMaterial color="#fffbe8" toneMapped={false} />
      </mesh>
      {/* the door, hinged on the left front edge */}
      <group ref={door} position={[-0.36, 0, 0.375]}>
        <group position={[0.36, 0, 0.025]}>
          <RBox size={[0.72, 1.8, 0.05]} radius={0.012} material={body} />
          <RBox size={[0.025, 0.5, 0.03]} radius={0.01} position={[0.3, 0.25, 0.04]} material={mat('steel')} />
          <Box size={[0.6, 0.06, 0.08]} position={[0, 0.3, -0.06]} material={inner} cast={false} />
          <Box size={[0.6, 0.06, 0.08]} position={[0, -0.25, -0.06]} material={inner} cast={false} />
          <Box size={[0.6, 0.06, 0.08]} position={[0, -0.6, -0.06]} material={inner} cast={false} />
        </group>
      </group>
    </group>
  );
}

/**
 * The counter (台面): base cabinets and a worktop with the sink cut-out, in the counter object's frame
 * (centre at world y 0.45: the worktop is world 0.86–0.90, the cut-out world x −0.7 … −0.1).
 */
export function CounterModel() {
  const top = mat('stone', '#d8d2c6', { roughness: 0.4, repeat: [3, 1] });
  const front = mat('painted', '#f1ece2');
  const handle = mat('steel');
  const n = 6;
  const w = 3.9;
  const dw = w / n;
  return (
    <group>
      <Box size={[w - 0.06, 0.1, 0.5]} position={[0, -0.4, -0.06]} material={mat('rubber', '#3a3a3a')} cast={false} />
      <Box size={[w - 0.02, 0.6, 0.58]} position={[0, -0.05, -0.02]} material={front} receive />
      <Box size={[1.74, 0.16, 0.58]} position={[-1.07, 0.33, -0.02]} material={front} cast={false} />
      <Box size={[1.54, 0.16, 0.58]} position={[1.17, 0.33, -0.02]} material={front} cast={false} />
      <Box size={[0.6, 0.16, 0.02]} position={[0.1, 0.33, 0.27]} material={front} cast={false} />
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[-w / 2 + dw * (i + 0.5), 0.03, 0.285]}>
          <RBox size={[dw - 0.012, 0.72, 0.02]} radius={0.004} material={front} cast={false} />
          <Box size={[0.12, 0.012, 0.012]} position={[0, 0.31, 0.018]} material={handle} cast={false} />
        </group>
      ))}
      <RBox size={[1.75, 0.04, 0.62]} radius={0.006} position={[-1.075, 0.43, 0]} material={top} receive />
      <RBox size={[1.55, 0.04, 0.62]} radius={0.006} position={[1.175, 0.43, 0]} material={top} receive />
      <Box size={[0.6, 0.04, 0.12]} position={[0.1, 0.43, -0.25]} material={top} receive />
      <Box size={[0.6, 0.04, 0.05]} position={[0.1, 0.43, 0.285]} material={top} receive />
    </group>
  );
}

/** A steel sink basin (open top) with a drain. */
export function SinkModel() {
  const steel = mat('steel', '#c6ccd2', { roughness: 0.28 });
  return (
    <group>
      <Box size={[0.58, 0.01, 0.43]} position={[0, -0.09, 0]} material={steel} />
      <Box size={[0.58, 0.19, 0.01]} position={[0, 0, 0.215]} material={steel} />
      <Box size={[0.58, 0.19, 0.01]} position={[0, 0, -0.215]} material={steel} />
      <Box size={[0.01, 0.19, 0.43]} position={[0.29, 0, 0]} material={steel} />
      <Box size={[0.01, 0.19, 0.43]} position={[-0.29, 0, 0]} material={steel} />
      <Cyl r={0.03} h={0.004} position={[0, -0.084, 0]} material={mat('rubber', '#333')} cast={false} />
    </group>
  );
}

/** The tap: a chrome gooseneck; running water when `states.water` is on. */
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
      <Cyl r={0.025} h={0.03} position={[0, -0.085, 0]} material={chrome} />
      <Cyl r={0.012} h={0.2} position={[0, 0.02, 0]} material={chrome} />
      <mesh geometry={torus(0.06, 0.012, Math.PI)} material={chrome} position={[0, 0.12, 0.06]} rotation={[0, Math.PI / 2, 0]} castShadow />
      <Cyl r={0.012} h={0.03} position={[0, 0.105, 0.12]} material={chrome} />
      <RBox size={[0.016, 0.05, 0.016]} radius={0.006} position={[0.04, -0.03, 0]} rotation={[0, 0, on ? -0.6 : 0]} material={chrome} />
      <mesh ref={water} position={[0, -0.05, 0.12]} visible={false}>
        <cylinderGeometry args={[0.007, 0.009, 0.28, 10, 1, true]} />
        <meshStandardMaterial color="#cfeaf7" transparent opacity={0.55} roughness={0.05} />
      </mesh>
    </group>
  );
}

/** A gas hob: black glass, two burners, knobs; blue flames when `states.fire` is on. */
export function StoveModel({ states }: ModelProps) {
  const flames = useRef<Group>(null);
  const on = states.fire === 'on';
  useFrame(({ clock }) => {
    const f = flames.current;
    if (!f) return;
    f.visible = on;
    if (on) f.children.forEach((c, i) => c.scale.setScalar(0.85 + 0.25 * Math.abs(Math.sin(clock.elapsedTime * 13 + i * 1.7))));
  });
  const burners: Array<[number, number]> = [[-0.15, 0], [0.15, 0]];
  return (
    <group>
      <RBox size={[0.62, 0.03, 0.52]} radius={0.008} material={mat('plastic', '#121418', { roughness: 0.12 })} receive />
      {burners.map(([x, z], i) => (
        <group key={i} position={[x, 0.018, z]}>
          <mesh geometry={torus(0.06, 0.008)} rotation={[Math.PI / 2, 0, 0]} material={mat('metal', '#3a3d42')} />
          <Cyl r={0.035} h={0.012} material={mat('metal', '#2a2c30')} />
          {[0, 1, 2, 3].map((k) => (
            <Box key={k} size={[0.13, 0.01, 0.012]} position={[0, 0.012, 0]} rotation={[0, (k * Math.PI) / 4, 0]} material={mat('metal', '#25272b')} cast={false} />
          ))}
        </group>
      ))}
      <group ref={flames} visible={false}>
        {burners.flatMap(([x, z]) => Array.from({ length: 10 }, (_, k) => {
          const a = (k / 10) * Math.PI * 2;
          return (
            <mesh key={`${x}:${k}`} position={[x + Math.cos(a) * 0.045, 0.04, z + Math.sin(a) * 0.045]}>
              <coneGeometry args={[0.008, 0.035, 6]} />
              <meshBasicMaterial color="#5aa9ff" transparent opacity={0.85} toneMapped={false} />
            </mesh>
          );
        }))}
      </group>
      {[-0.2, -0.07, 0.07, 0.2].map((x) => (
        <Cyl key={x} r={0.018} h={0.018} position={[x, 0.01, 0.23]} material={mat('metal', '#b9bec5')} segments={14} />
      ))}
    </group>
  );
}

/** The pendant lamp over the table (hung from the ceiling 0.65 m above its centre): warm light when `states.light` is on. */
export function LampModel({ states }: ModelProps) {
  const on = states.light === 'on';
  return (
    <group>
      <Cyl r={0.004} h={0.6} position={[0, 0.35, 0]} material={mat('rubber', '#222')} cast={false} />
      <Cyl r={0.19} rTop={0.05} h={0.16} open position={[0, 0, 0]} material={mat('metal', '#2f4a5a', { doubleSide: true, roughness: 0.5 })} />
      <mesh position={[0, -0.05, 0]}>
        <sphereGeometry args={[0.05, 14, 10]} />
        <meshStandardMaterial color={on ? '#fff3c4' : '#d9d4c8'} emissive={on ? '#ffd88a' : '#000000'} emissiveIntensity={on ? 2.2 : 0} toneMapped={!on} />
      </mesh>
      {/* Always mounted (intensity 0 when off): adding / removing a light recompiles every material. */}
      <pointLight position={[0, -0.15, 0]} color="#ffd9a0" intensity={on ? 2.6 : 0} distance={5} decay={1.6} />
    </group>
  );
}

export const WindowModel = () => <WindowPane size={[0.96, 0.76]} />;
export const ClockModel = () => <group rotation={[0, Math.PI / 2, 0]}><WallClock r={0.15} /></group>;

/** An open pedal bin. */
export function BinModel() {
  const body = mat('steel', '#9aa3ab', { roughness: 0.35 });
  return (
    <group>
      <Lathe profile={[[0, -0.3], [0.16, -0.3], [0.18, 0.3], [0.17, 0.3], [0.15, -0.285], [0, -0.285]]} material={mat('steel', '#9aa3ab', { doubleSide: true, roughness: 0.35 })} />
      <mesh geometry={torus(0.178, 0.008)} position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} material={body} />
      <RBox size={[0.1, 0.02, 0.06]} radius={0.008} position={[0, -0.29, 0.19]} material={mat('rubber', '#2b2b2b')} />
      <Cyl r={0.15} h={0.005} position={[0, -0.27, 0]} material={mat('plastic', '#2c2f33')} cast={false} />
    </group>
  );
}
