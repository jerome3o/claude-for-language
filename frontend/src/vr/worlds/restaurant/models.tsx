/**
 * The restaurant's object models (docs/VR_WORLDS.md "The contract"). Each is drawn in its object's own
 * frame: the origin is the middle of the object's collider (index.tsx), so a teacup whose collider is a
 * 5 cm cylinder spans y −0.025 … +0.025. All procedural: kit/ shapes + materials, plus ./geom's merged
 * meshes (one draw call for a chair's frame, a plate of dumplings, a tray) and ./textures (the menu,
 * the bill, the scan-to-pay card).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshStandardMaterial, type BufferGeometry, type Group, type Material, type Mesh, type PointLight } from 'three';
import { Ball, Box, Cyl, Lathe, RBox, Sign, bottleProfile, bowlProfile, cupProfile, labelTexture, mat, plateProfile } from '../kit';
import type { ModelProps } from '../types';
import { around, ball, box, cyl, lathe, merged, ring, type Piece } from './geom';
import { billTexture, menuTexture, qrTexture } from './textures';

type V3 = [number, number, number];

/** One merged mesh. */
function G({ g, m, p, r, s, cast = true, receive = false }: { g: BufferGeometry; m: Material; p?: V3; r?: V3; s?: V3 | number; cast?: boolean; receive?: boolean }) {
  return <mesh geometry={g} material={m} position={p} rotation={r} scale={s} castShadow={cast} receiveShadow={receive} />;
}

const PORCELAIN = '#f6f3ec';
const BLUE = '#2b5fa8';
const DARK_WOOD = '#4a2416';
const GOLD = '#d4a640';

const gold = () => mat('metal', GOLD, { roughness: 0.3, metalness: 0.9 });
const porcelain = (double = false) => mat('ceramic', PORCELAIN, double ? { doubleSide: true } : {});

// ── tableware ───────────────────────────────────────────────────────────

/** A round white teapot with a blue band: body, lid, spout and handle merged (collider cylinder r 0.075, h 0.12). */
export function TeapotModel() {
  const body = merged('teapot', () => [
    lathe([[0, -0.06], [0.045, -0.06], [0.062, -0.05], [0.074, -0.02], [0.074, 0.005], [0.064, 0.032], [0.042, 0.048], [0, 0.048]], undefined, undefined, 24),
    cyl(0.038, 0.012, [0, 0.053, 0], { rTop: 0.03, seg: 18 }),
    ball(0.011, [0, 0.064, 0], undefined, 10),
    cyl(0.013, 0.085, [0.088, 0.012, 0], { rTop: 0.007, seg: 10, rot: [0, 0, -0.85] }),
    ring(0.038, 0.008, [-0.074, 0.005, 0], [0, 0, Math.PI / 2], Math.PI, 16),
  ]);
  return (
    <group>
      <G g={body} m={porcelain()} />
      <Cyl r={0.0745} h={0.014} open position={[0, -0.012, 0]} material={mat('ceramic', BLUE)} cast={false} segments={24} />
    </group>
  );
}

/** A small handleless teacup with tea in it (collider cylinder r 0.035, h 0.05). */
export function TeacupModel() {
  return (
    <group>
      <Lathe profile={cupProfile(0.035, 0.05, 0.003, 0.65)} material={porcelain(true)} segments={20} />
      <Cyl r={0.031} h={0.002} position={[0, 0.01, 0]} material={mat('liquid', '#a8702a', { roughness: 0.05 })} cast={false} segments={18} />
    </group>
  );
}

/** A rice bowl (collider cylinder r 0.07, h 0.065), white porcelain with a coloured rim line. */
export function BowlModel({ rim = BLUE }: { rim?: string }) {
  const line = merged('bowl-rim', () => [ring(0.068, 0.0025, [0, 0.026, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 28), ring(0.04, 0.002, [0, -0.026, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 20)]);
  return (
    <group>
      <Lathe profile={bowlProfile(0.07, 0.065)} material={porcelain(true)} />
      <G g={line} m={mat('ceramic', rim)} cast={false} />
    </group>
  );
}
export const Bowl1 = () => <BowlModel />;
export const Bowl2 = () => <BowlModel rim="#b8322a" />;

/** A bowl of rice: a bowl and a dome of rice (collider cylinder r 0.065, h 0.085). */
export function RiceModel() {
  return (
    <group>
      <Lathe profile={bowlProfile(0.065, 0.06)} material={porcelain(true)} position={[0, -0.0125, 0]} />
      <Ball r={0.058} scale={[1, 0.52, 1]} position={[0, 0.013, 0]} material={mat('food', '#faf7ee', { roughness: 0.92 })} segments={18} />
      <mesh geometry={merged('rice-line', () => [ring(0.063, 0.0025, [0, 0.0, 0], [Math.PI / 2, 0, 0])])} material={mat('ceramic', BLUE)} position={[0, 0.0125, 0]} />
    </group>
  );
}

/** A pair of chopsticks, the lacquered ends together (collider box 0.24 × 0.012 × 0.03). */
export function ChopsticksModel() {
  const sticks = merged('chopsticks', () => [-0.0065, 0.0065].map((z, i) => cyl(0.0034, 0.235, [0, 0, z], { rTop: 0.0022, seg: 8, rot: [0, i ? 0.025 : -0.025, -Math.PI / 2] })));
  const tops = merged('chopstick-tops', () => [-0.0065, 0.0065].map((z) => cyl(0.0037, 0.07, [-0.08, 0, z], { seg: 8, rot: [0, 0, -Math.PI / 2] })));
  return (
    <group>
      <G g={sticks} m={mat('wood', '#cfa874')} />
      <G g={tops} m={mat('plastic', '#8f1d1a', { roughness: 0.25 })} cast={false} />
    </group>
  );
}

/** A celadon chopstick rest: a little bar with rounded ends (collider box 0.06 × 0.02 × 0.024). */
export function ChopstickRestModel() {
  const g = merged('chopstick-rest', () => [box([0.046, 0.01, 0.016], [0, -0.004, 0]), ball(0.01, [-0.024, 0, 0], [1, 0.95, 1.15], 10), ball(0.01, [0.024, 0, 0], [1, 0.95, 1.15], 10)]);
  return <G g={g} m={mat('ceramic', '#8db8a2')} />;
}

/** A porcelain soup spoon (collider box 0.13 × 0.03 × 0.045). */
export function SpoonModel() {
  const g = merged('soup-spoon', () => [
    lathe(bowlProfile(0.022, 0.018, 0.003), [0.03, -0.006, 0], [1.25, 1, 0.95], 16),
    box([0.075, 0.005, 0.013], [-0.032, 0.004, 0], [0, 0, 0.22]),
  ]);
  return <G g={g} m={porcelain(true)} />;
}

/** An empty plate (collider cylinder r 0.11, h 0.02); the second one has a smear of sauce. */
export function PlateModel({ sauce = false }: { sauce?: boolean }) {
  return (
    <group>
      <Lathe profile={plateProfile(0.11, 0.02)} material={porcelain(true)} />
      <mesh geometry={merged('plate-rim', () => [ring(0.1, 0.002, [0, 0.009, 0], [Math.PI / 2, 0, 0])])} material={mat('ceramic', BLUE)} />
      {sauce && <Cyl r={0.045} h={0.001} position={[0.01, -0.005, 0.006]} scale={[1.4, 1, 0.7]} material={mat('liquid', '#5a2410', { roughness: 0.1 })} cast={false} segments={16} />}
    </group>
  );
}
export const Plate1 = () => <PlateModel />;
export const Plate2 = () => <PlateModel sauce />;

/** A condiment bottle with a printed label (collider cylinder r 0.03, h 0.18): soy sauce, vinegar. */
export function CondimentBottle({ text, glass, cap, band }: { text: string; glass: string; cap: string; band: string }) {
  const label = useMemo(() => labelTexture(text, '#fbf6e8', '#5a1a10', band), [text, band]);
  return (
    <group>
      <Lathe profile={bottleProfile(0.03, 0.18, 0.011)} material={mat('plastic', glass, { roughness: 0.08 })} segments={18} />
      <Cyl r={0.0305} h={0.06} open position={[0, -0.03, 0]} material={mat('paper', '#ffffff', { map: label })} cast={false} segments={18} />
      <Cyl r={0.0125} h={0.014} position={[0, 0.087, 0]} material={mat('plastic', cap)} segments={12} />
    </group>
  );
}
export const SoyModel = () => <CondimentBottle text="酱油" glass="#2a140a" cap="#c8102e" band="#c8102e" />;
export const VinegarModel = () => <CondimentBottle text="醋" glass="#1e1814" cap="#e0a81c" band="#2a7a3a" />;

/** A glass jar of chilli oil with a red lid (collider cylinder r 0.032, h 0.075). */
export function ChilliModel() {
  const label = useMemo(() => labelTexture('辣', '#fff4e0', '#b3200f', '#e0a81c'), []);
  return (
    <group>
      <Cyl r={0.028} h={0.05} position={[0, -0.01, 0]} material={mat('liquid', '#a3200d', { roughness: 0.1 })} cast={false} segments={16} />
      <Cyl r={0.031} h={0.061} position={[0, -0.007, 0]} material={mat('glass')} segments={18} />
      <Cyl r={0.0315} h={0.03} open position={[0, -0.012, 0]} material={mat('paper', '#ffffff', { map: label })} cast={false} segments={18} />
      <Cyl r={0.033} h={0.014} position={[0, 0.0305, 0]} material={mat('plastic', '#c8102e', { roughness: 0.3 })} segments={18} />
    </group>
  );
}

/** A box of tissues with one pulled up (collider box 0.2 × 0.08 × 0.11). */
export function TissuesModel() {
  const label = useMemo(() => labelTexture('纸巾', '#fdfbf6', '#2f6f8f', '#7fc2c9'), []);
  return (
    <group>
      <RBox size={[0.2, 0.08, 0.11]} radius={0.008} material={mat('paper', '#ffffff', { map: label })} />
      <Ball r={0.034} scale={[1.3, 0.75, 0.6]} position={[0, 0.045, 0]} material={mat('paper', '#ffffff')} segments={10} />
    </group>
  );
}

/** A little holder of toothpicks (collider cylinder r 0.024, h 0.065). */
export function ToothpicksModel() {
  const picks = merged('toothpicks', () => around(9, 0.011).map(([x, z, a]) => cyl(0.0012, 0.06, [x, 0.012, z], { seg: 4, rot: [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12] })));
  return (
    <group>
      <Cyl r={0.024} rTop={0.021} h={0.045} position={[0, -0.01, 0]} material={mat('ceramic', '#2f4f6f', { roughness: 0.3 })} segments={16} />
      <G g={picks} m={mat('wood', '#e7cf9e')} cast={false} />
    </group>
  );
}

// ── food ────────────────────────────────────────────────────────────────

/** A bamboo steamer, open (collider: a slatted base + four walls ~0.24 across, 0.08 high). */
export function SteamerModel() {
  const bands = merged('steamer-bands', () => [ring(0.121, 0.005, [0, 0.036, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 28), ring(0.121, 0.005, [0, -0.028, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 28)]);
  return (
    <group>
      <Cyl r={0.12} h={0.07} open position={[0, 0.003, 0]} material={mat('wood', '#d8b373', { doubleSide: true })} segments={24} />
      <G g={bands} m={mat('wood', '#a77a3e')} />
      <Cyl r={0.118} h={0.01} position={[0, -0.034, 0]} material={mat('wood', '#c9a161')} segments={24} receive />
      <Cyl r={0.108} h={0.002} position={[0, -0.028, 0]} material={mat('paper', '#efe6cc')} cast={false} segments={20} />
    </group>
  );
}

/** A steamed bun with its pleated top (collider cylinder r 0.034, h 0.045). */
export function BaoziModel() {
  const g = merged('baozi', () => [
    lathe([[0, -0.0225], [0.029, -0.0225], [0.034, -0.016], [0.034, -0.004], [0.028, 0.011], [0.016, 0.019], [0.005, 0.0225], [0, 0.0225]], undefined, undefined, 18),
    ...around(6, 0.008).map(([x, z, a]) => box([0.002, 0.008, 0.012], [x, 0.022, z], [0, a, 0.5])),
  ]);
  return <G g={g} m={mat('food', '#f7f0e1', { roughness: 0.88 })} />;
}

/** A plate of eight dumplings (collider cylinder r 0.11, h 0.04). */
export function DumplingsModel() {
  const dumplings = merged('dumplings', () => [
    ...around(7, 0.064).map(([x, z, a]) => ({ ...ball(0.022, [x, 0.0, z], [1.45, 0.62, 0.78], 12), r: [0, a + Math.PI / 2, 0] as V3 })),
    ball(0.022, [0, 0.004, 0], [1.45, 0.62, 0.78], 12),
  ]);
  return (
    <group>
      <Lathe profile={plateProfile(0.11, 0.016)} material={porcelain(true)} position={[0, -0.012, 0]} />
      <G g={dumplings} m={mat('food', '#f1e6cc', { roughness: 0.55 })} />
    </group>
  );
}

/** 红烧鱼 on an oval plate: the fish in a glossy sauce with spring onion (collider box 0.32 × 0.05 × 0.2). */
export function FishModel() {
  const fish = merged('fish-dish', () => [
    ball(0.05, [-0.01, 0.0, 0], [2.15, 0.5, 0.75], 18),
    cyl(0.034, 0.055, [0.115, 0.0, 0], { rTop: 0.004, seg: 10, rot: [0, 0, Math.PI / 2] }),
    box([0.03, 0.003, 0.006], [-0.02, 0.024, 0], [0, 0.4, 0]),
  ]);
  const onion = merged('fish-onion', () => Array.from({ length: 9 }, (_, i) => box([0.026, 0.003, 0.004], [-0.07 + i * 0.017, 0.026 - Math.abs(i - 4) * 0.002, (i % 3 - 1) * 0.012], [0, i * 0.7, 0])));
  return (
    <group>
      <Lathe profile={plateProfile(0.1, 0.016)} material={porcelain(true)} position={[0, -0.017, 0]} scale={[1.6, 1, 1]} />
      <Cyl r={0.075} h={0.002} scale={[1.7, 1, 1]} position={[0, -0.013, 0]} material={mat('liquid', '#6b2410', { roughness: 0.08 })} cast={false} segments={20} />
      <G g={fish} m={mat('food', '#8f3a18', { roughness: 0.25 })} />
      <G g={onion} m={mat('leaf', '#5fa83a')} cast={false} />
    </group>
  );
}

/** A takeaway box with leftovers in it (collider box 0.13 × 0.07 × 0.1). */
export function LeftoversModel() {
  const boxG = merged('leftover-box', () => [
    box([0.13, 0.004, 0.1], [0, -0.033, 0]),
    box([0.13, 0.066, 0.003], [0, 0, 0.0485]), box([0.13, 0.066, 0.003], [0, 0, -0.0485]),
    box([0.003, 0.066, 0.1], [0.0635, 0, 0]), box([0.003, 0.066, 0.1], [-0.0635, 0, 0]),
    box([0.13, 0.003, 0.07], [0, 0.04, -0.085], [-1.0, 0, 0]),
  ]);
  const greens = merged('leftover-greens', () => [ball(0.022, [-0.03, -0.012, 0.015], [1.2, 0.5, 0.8], 8), ball(0.018, [-0.035, -0.01, -0.02], [1.3, 0.4, 0.7], 8)]);
  const meat = merged('leftover-meat', () => [ball(0.016, [0.025, -0.014, 0.012], [1, 0.6, 1], 8), ball(0.014, [0.035, -0.015, -0.018], [1.2, 0.6, 0.9], 8), ball(0.012, [0.005, -0.016, -0.005], [1, 0.6, 1], 8)]);
  return (
    <group>
      <G g={boxG} m={mat('paper', '#f3efe4', { doubleSide: true })} />
      <G g={greens} m={mat('leaf', '#4c8a32')} cast={false} />
      <G g={meat} m={mat('food', '#7a3416', { roughness: 0.35 })} cast={false} />
    </group>
  );
}

// ── drinks ──────────────────────────────────────────────────────────────

/** A drinks bottle with a label and a cap (beer: collider cylinder r 0.033, h 0.25; soda r 0.03, h 0.2). */
function DrinkBottle({ r, h, glass, label, cap, opacity = 0.82 }: { r: number; h: number; glass: string; label: ReturnType<typeof labelTexture>; cap: string; opacity?: number }) {
  return (
    <group>
      <Lathe profile={bottleProfile(r, h, r * 0.36)} material={mat('glass', glass, { opacity, roughness: 0.06 })} segments={18} />
      <Cyl r={r + 0.0006} h={h * 0.3} open position={[0, -h * 0.16, 0]} material={mat('paper', '#ffffff', { map: label })} cast={false} segments={18} />
      <Cyl r={r * 0.42} h={0.012} position={[0, h / 2 - 0.004, 0]} material={mat('metal', cap, { roughness: 0.35 })} segments={12} />
    </group>
  );
}
export function BeerModel() {
  const label = useMemo(() => labelTexture('啤酒', '#f7efd6', '#8a1b12', '#c8102e'), []);
  return <DrinkBottle r={0.033} h={0.25} glass="#2f7a3a" label={label} cap={GOLD} />;
}
export function SodaModel() {
  const label = useMemo(() => labelTexture('汽水', '#fff7ea', '#d4561a', '#ffb43c'), []);
  return <DrinkBottle r={0.03} h={0.2} glass="#e8a53a" label={label} cap="#d8dde3" opacity={0.7} />;
}

// ── paper, trays, gadgets ───────────────────────────────────────────────

/** The bill on a black leather pad with a clip (collider box 0.11 × 0.012 × 0.16). */
export function BillModel() {
  const tex = useMemo(() => billTexture(), []);
  return (
    <group>
      <RBox size={[0.11, 0.006, 0.16]} radius={0.002} position={[0, -0.003, 0]} material={mat('rubber', '#1d1b1a', { roughness: 0.6 })} />
      <Box size={[0.094, 0.002, 0.138]} position={[0, 0.0012, 0.006]} material={mat('paper', '#ffffff', { map: tex })} cast={false} />
      <Box size={[0.05, 0.006, 0.014]} position={[0, 0.003, -0.07]} material={mat('chrome')} cast={false} />
    </group>
  );
}

/** A waiter's tray: base and a low rim, one mesh (collider: base + four rims, 0.42 × 0.3). */
export function TrayModel() {
  const g = merged('tray', () => [
    box([0.42, 0.012, 0.3], [0, -0.012, 0]),
    box([0.42, 0.036, 0.012], [0, 0.006, 0.144]), box([0.42, 0.036, 0.012], [0, 0.006, -0.144]),
    box([0.012, 0.036, 0.3], [0.204, 0.006, 0]), box([0.012, 0.036, 0.3], [-0.204, 0.006, 0]),
  ]);
  return <G g={g} m={mat('plastic', '#5b3a26', { roughness: 0.45 })} receive />;
}

/** The waiter call button (呼叫器): a puck with a red button; its ring blinks while calling. */
export function CallButtonModel({ states }: ModelProps) {
  const led = useMemo(() => new MeshStandardMaterial({ color: new Color('#ff5a4a'), emissive: new Color('#ff2a1a'), emissiveIntensity: 0, roughness: 0.3 }), []);
  const calling = states.call === 'on';
  useFrame(({ clock }) => {
    led.emissiveIntensity = calling ? (Math.sin(clock.elapsedTime * 9) > 0 ? 2.4 : 0.3) : 0;
  });
  const body = merged('call-body', () => [lathe([[0, -0.02], [0.044, -0.02], [0.045, -0.012], [0.04, 0.008], [0.03, 0.014], [0, 0.014]], undefined, undefined, 22)]);
  const ledRing = merged('call-led', () => [ring(0.034, 0.003, [0, 0.009, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 24)]);
  return (
    <group>
      <G g={body} m={mat('plastic', '#f4f4f1', { roughness: 0.35 })} />
      <Cyl r={0.022} h={0.01} position={[0, 0.016, 0]} material={mat('plastic', '#d0201a', { roughness: 0.25 })} segments={18} />
      <mesh geometry={ledRing} material={led} />
    </group>
  );
}

/** A 招财猫: a white porcelain cat with a red collar and gold bell, its left paw waving (collider box 0.12 × 0.17 × 0.1). */
export function LuckyCatModel() {
  const paw = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (paw.current) paw.current.rotation.x = -0.25 + 0.35 * Math.sin(clock.elapsedTime * 3.2);
  });
  const white = merged('cat-white', () => [
    ball(0.05, [0, -0.04, 0], [1, 1.05, 0.88], 16),
    ball(0.045, [0, 0.035, 0.004], [1.12, 0.96, 0.95], 16),
    cyl(0.016, 0.03, [-0.03, 0.078, 0], { rTop: 0.001, seg: 6, rot: [0, 0, 0.3] }),
    cyl(0.016, 0.03, [0.03, 0.078, 0], { rTop: 0.001, seg: 6, rot: [0, 0, -0.3] }),
    ball(0.016, [0.027, -0.03, 0.04], [1, 1.2, 1], 10),
    box([0.11, 0.012, 0.09], [0, -0.079, 0]),
  ]);
  const face = merged('cat-face', () => [ball(0.005, [-0.017, 0.042, 0.043], [1.3, 0.6, 0.6], 6), ball(0.005, [0.017, 0.042, 0.043], [1.3, 0.6, 0.6], 6), ball(0.0045, [0, 0.03, 0.047], [1, 0.8, 0.6], 6)]);
  const red = merged('cat-collar', () => [ring(0.03, 0.006, [0, 0.0, 0.006], [Math.PI / 2 - 0.25, 0, 0], Math.PI * 2, 20), box([0.11, 0.01, 0.09], [0, -0.072, 0])]);
  const goldG = merged('cat-gold', () => [ball(0.009, [0, -0.008, 0.035], undefined, 10), cyl(0.022, 0.004, [-0.02, -0.035, 0.045], { rot: [Math.PI / 2, 0, 0.2], seg: 16 })]);
  return (
    <group>
      <G g={white} m={porcelain()} />
      <G g={face} m={mat('plastic', '#222222')} cast={false} />
      <G g={red} m={mat('ceramic', '#c8102e')} cast={false} />
      <G g={goldG} m={gold()} cast={false} />
      <group ref={paw} position={[-0.038, 0.0, 0.015]}>
        <Cyl r={0.013} h={0.06} position={[0, 0.03, 0]} material={porcelain()} segments={10} />
        <Ball r={0.015} position={[0, 0.062, 0.002]} material={porcelain()} segments={10} />
      </group>
    </group>
  );
}

/** The "scan to pay" stand: an acrylic stand with the QR card (collider box 0.1 × 0.13 × 0.05). */
export function QrStandModel() {
  const tex = useMemo(() => qrTexture(), []);
  return (
    <group>
      <Box size={[0.09, 0.115, 0.003]} position={[0, 0.006, 0]} rotation={[-0.14, 0, 0]} material={mat('paper', '#ffffff', { map: tex, roughness: 0.4 })} />
      <RBox size={[0.1, 0.012, 0.05]} radius={0.004} position={[0, -0.059, 0]} material={mat('glass', '#e8f2f5', { opacity: 0.6 })} cast={false} />
    </group>
  );
}

/** A dark wooden restaurant chair with a red cushion (faces +Z; collider seat + back, 0.9 high). */
export function ChairModel() {
  const frame = merged('rest-chair', () => {
    const p: Piece[] = [];
    for (const x of [-0.19, 0.19]) for (const z of [-0.2, 0.2]) p.push(box([0.035, 0.45, 0.035], [x, -0.225, z]));
    p.push(box([0.44, 0.035, 0.46], [0, -0.0, 0]));
    for (const x of [-0.19, 0.19]) p.push(box([0.035, 0.44, 0.035], [x, 0.22, -0.2]));
    p.push(box([0.46, 0.05, 0.04], [0, 0.42, -0.205]), box([0.13, 0.3, 0.018], [0, 0.2, -0.205]));
    p.push(box([0.38, 0.02, 0.02], [0, -0.33, 0.2]), box([0.38, 0.02, 0.02], [0, -0.33, -0.2]), box([0.02, 0.02, 0.38], [-0.19, -0.37, 0]), box([0.02, 0.02, 0.38], [0.19, -0.37, 0]));
    return p;
  });
  return (
    <group>
      <G g={frame} m={mat('wood', '#5a2a18')} />
      <RBox size={[0.4, 0.03, 0.4]} radius={0.012} position={[0, 0.032, 0.01]} material={mat('fabric', '#9b1c1c')} cast={false} />
    </group>
  );
}

// ── furniture and fixed things ──────────────────────────────────────────

/** The big round table with a cream tablecloth on a pedestal (top at the collider's top, 0.76 m). */
export function RoundTableModel() {
  const cloth = merged('round-cloth', () => [cyl(0.765, 0.012, [0, 0.374, 0], { seg: 40 }), cyl(0.775, 0.2, [0, 0.27, 0], { seg: 40, open: true, rTop: 0.766 })]);
  const stand = merged('round-stand', () => [cyl(0.06, 0.62, [0, -0.04, 0], { seg: 16 }), cyl(0.32, 0.045, [0, -0.3575, 0], { rTop: 0.27, seg: 28 }), cyl(0.3, 0.012, [0, 0.13, 0], { seg: 24 })]);
  return (
    <group>
      <G g={cloth} m={mat('fabric', '#f3ebdc', { doubleSide: true })} receive />
      <G g={stand} m={mat('wood', DARK_WOOD)} />
    </group>
  );
}

/** The lazy Susan (转盘): a glass disc on a bearing; it turns while `states.spin` is turning. */
export function LazySusanModel({ states }: ModelProps) {
  const disc = useRef<Group>(null);
  const speed = useRef(0);
  const turning = states.spin === 'turning';
  useFrame((_, dt) => {
    speed.current += ((turning ? 0.9 : 0) - speed.current) * Math.min(1, dt * 2.5);
    if (disc.current) disc.current.rotation.y += speed.current * dt;
  });
  const trim = merged('susan-trim', () => [
    ring(0.414, 0.006, [0, 0.019, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 48),
    ...around(8, 0.37).map(([x, z]) => cyl(0.012, 0.002, [x, 0.012, z], { seg: 10 })),
  ]);
  return (
    <group>
      <Cyl r={0.11} rTop={0.1} h={0.024} position={[0, -0.012, 0]} material={mat('wood', '#4a2416')} segments={24} />
      <group ref={disc}>
        <Cyl r={0.42} h={0.014} position={[0, 0.018, 0]} material={mat('glass', '#d3ecec', { opacity: 0.38 })} segments={48} cast={false} />
        <G g={trim} m={gold()} cast={false} />
      </group>
    </group>
  );
}

/** A square table, dark lacquered wood (top 0.9 × 0.9 at 0.75 m). */
export function SquareTableModel() {
  const legs = merged('square-legs', () => [
    ...[-0.39, 0.39].flatMap((x) => [-0.39, 0.39].map((z) => box([0.05, 0.71, 0.05], [x, -0.02, z]))),
    box([0.8, 0.07, 0.02], [0, 0.3, 0.4]), box([0.8, 0.07, 0.02], [0, 0.3, -0.4]), box([0.02, 0.07, 0.8], [0.4, 0.3, 0]), box([0.02, 0.07, 0.8], [-0.4, 0.3, 0]),
  ]);
  return (
    <group>
      <RBox size={[0.9, 0.04, 0.9]} radius={0.008} position={[0, 0.355, 0]} material={mat('wood', '#6b3420', { roughness: 0.4 })} receive />
      <G g={legs} m={mat('wood', DARK_WOOD)} />
    </group>
  );
}

/** The cash desk: a red-lacquered front with gold trim and a 收银台 plaque, a granite top. */
export function CashierModel() {
  const trim = merged('cashier-trim', () => [box([1.5, 0.02, 0.012], [0, 0.32, 0.296]), box([1.5, 0.02, 0.012], [0, -0.38, 0.296]), box([0.02, 0.7, 0.012], [-0.74, -0.03, 0.296]), box([0.02, 0.7, 0.012], [0.74, -0.03, 0.296])]);
  return (
    <group>
      <Box size={[1.48, 0.86, 0.58]} position={[0, -0.03, -0.005]} material={mat('wood', '#7a2216', { roughness: 0.35 })} receive />
      <Box size={[1.46, 0.08, 0.54]} position={[0, -0.46, -0.02]} material={mat('rubber', '#1e1a18')} cast={false} />
      <RBox size={[1.56, 0.04, 0.64]} radius={0.006} position={[0, 0.48, 0]} material={mat('stone', '#3a3634', { roughness: 0.3 })} receive />
      <G g={trim} m={gold()} cast={false} />
      <Sign text="收银台" size={[0.62, 0.17]} bg="#2a0f0a" fg="#f2c35a" position={[0, 0.08, 0.292]} />
    </group>
  );
}

/** The menu board over the hatch (collider box 1.7 × 0.75 × 0.05). */
export function MenuBoardModel() {
  const tex = useMemo(() => menuTexture(), []);
  const frame = merged('menu-frame', () => [box([1.74, 0.05, 0.05], [0, 0.375, 0]), box([1.74, 0.05, 0.05], [0, -0.375, 0]), box([0.05, 0.8, 0.05], [-0.845, 0, 0]), box([0.05, 0.8, 0.05], [0.845, 0, 0])]);
  return (
    <group>
      <mesh position={[0, 0, 0.0]}>
        <planeGeometry args={[1.66, 0.71]} />
        <meshStandardMaterial map={tex} roughness={0.6} emissive="#2a0a05" emissiveIntensity={0.4} />
      </mesh>
      <G g={frame} m={mat('wood', '#3a1f10')} cast={false} />
    </group>
  );
}

/** The serving hatch: a steel ledge, a wooden frame round the opening, order slips on a rail (the ledge is the collider). */
export function HatchModel() {
  const steel = merged('hatch-steel', () => [box([1.5, 0.04, 0.26], [0, 0, 0]), box([1.2, 0.016, 0.016], [0, 0.69, -0.11])]);
  const frame = merged('hatch-frame', () => [box([1.62, 0.07, 0.05], [0, 0.765, -0.11]), box([0.07, 0.8, 0.05], [-0.74, 0.37, -0.11]), box([0.07, 0.8, 0.05], [0.74, 0.37, -0.11])]);
  const slips = merged('hatch-slips', () => [-0.42, -0.24, -0.05, 0.2].map((x, i) => box([0.065, 0.095, 0.002], [x, 0.635 - (i % 2) * 0.008, -0.1], [0, 0, (i - 1.5) * 0.06])));
  return (
    <group>
      <G g={steel} m={mat('steel', '#c9ced3', { roughness: 0.25 })} receive />
      <G g={frame} m={mat('wood', '#5a2a18')} cast={false} />
      <G g={slips} m={mat('paper', '#fffdf2')} cast={false} />
    </group>
  );
}

/** The glass-door drinks fridge: lit inside, cans and a crate of bottles; the door swings open with `states.door`. */
export function FridgeModel({ states }: ModelProps) {
  const door = useRef<Group>(null);
  const open = states.door === 'open';
  useFrame((_, dt) => {
    const d = door.current;
    if (!d) return;
    const goal = open ? -1.75 : 0;
    d.rotation.y += (goal - d.rotation.y) * Math.min(1, dt * 6);
  });
  const shell = merged('fridge-shell', () => [box([0.72, 1.9, 0.04], [0, 0, -0.33]), box([0.04, 1.9, 0.7], [-0.34, 0, 0]), box([0.04, 1.9, 0.7], [0.34, 0, 0]), box([0.72, 0.04, 0.7], [0, 0.93, 0]), box([0.72, 0.1, 0.7], [0, -0.9, 0])]);
  const shelves = merged('fridge-shelves', () => [box([0.64, 0.02, 0.6], [0, -0.25, -0.02]), box([0.64, 0.02, 0.6], [0, 0.3, -0.02])]);
  const leds = merged('fridge-leds', () => [box([0.012, 1.7, 0.012], [-0.31, 0, 0.3]), box([0.012, 1.7, 0.012], [0.31, 0, 0.3]), box([0.6, 0.012, 0.03], [0, 0.89, 0.0])]);
  const cansA = merged('fridge-cans-a', () => [-0.24, -0.08, 0.08, 0.24].map((x) => cyl(0.032, 0.12, [x, 0.37, -0.15], { seg: 14 })));
  const cansB = merged('fridge-cans-b', () => [-0.24, -0.08, 0.08, 0.24].map((x) => cyl(0.032, 0.12, [x, 0.37, 0.0], { seg: 14 })));
  const crate = merged('fridge-crate', () => [box([0.5, 0.012, 0.34], [0, -0.844, -0.05]), box([0.5, 0.15, 0.012], [0, -0.77, 0.116]), box([0.5, 0.15, 0.012], [0, -0.77, -0.216]), box([0.012, 0.15, 0.34], [0.244, -0.77, -0.05]), box([0.012, 0.15, 0.34], [-0.244, -0.77, -0.05])]);
  const crateBottles = merged('fridge-crate-bottles', () => [-0.18, -0.06, 0.06, 0.18].flatMap((x) => [-0.12, 0.02].map((z) => lathe(bottleProfile(0.03, 0.25, 0.011), [x, -0.72, z], undefined, 12))));
  const doorFrame = merged('fridge-door', () => [box([0.72, 0.16, 0.04], [0, 0.87, 0]), box([0.72, 0.08, 0.04], [0, -0.91, 0]), box([0.05, 1.9, 0.04], [-0.335, 0, 0]), box([0.05, 1.9, 0.04], [0.335, 0, 0])]);
  return (
    <group>
      <G g={shell} m={mat('painted', '#eef1f3', { roughness: 0.35 })} />
      <Box size={[0.63, 1.7, 0.01]} position={[0, 0, -0.305]} material={mat('plastic', '#f7f9fb', { roughness: 0.6 })} cast={false} />
      <G g={shelves} m={mat('glass', '#e2f1f6')} cast={false} />
      <mesh geometry={leds}>
        <meshBasicMaterial color="#eaf6ff" toneMapped={false} />
      </mesh>
      <G g={cansA} m={mat('metal', '#c8102e', { roughness: 0.3, metalness: 0.6 })} cast={false} />
      <G g={cansB} m={mat('metal', '#2a62b8', { roughness: 0.3, metalness: 0.6 })} cast={false} />
      <G g={crate} m={mat('plastic', '#e8b01c')} cast={false} />
      <G g={crateBottles} m={mat('glass', '#2f7a3a', { opacity: 0.85 })} cast={false} />
      {/* the door, hinged on its left front edge */}
      <group ref={door} position={[-0.36, 0, 0.35]}>
        <group position={[0.36, 0, 0.02]}>
          <G g={doorFrame} m={mat('painted', '#c8102e', { roughness: 0.35 })} />
          <Box size={[0.62, 1.66, 0.01]} position={[0, -0.02, 0]} material={mat('glass', '#dff0f6', { opacity: 0.22 })} cast={false} />
          <RBox size={[0.025, 0.6, 0.03]} radius={0.01} position={[0.29, -0.05, 0.035]} material={mat('steel')} />
          <Sign text="冰镇饮料" size={[0.6, 0.12]} bg="#c8102e" fg="#ffffff" position={[0, 0.87, 0.021]} />
        </group>
      </group>
    </group>
  );
}

/** A red silk lantern with gold caps and a tassel; the first one carries the room's warm point light. */
export function LanternModel({ light = false }: { light?: boolean }) {
  const lamp = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    if (lamp.current) lamp.current.intensity = 1.6 + 0.12 * Math.sin(clock.elapsedTime * 7.3) * Math.sin(clock.elapsedTime * 2.1);
  });
  const ribs = merged('lantern-ribs', () => around(8, 0, 0).map(([, , a]) => ({ ...ring(0.201, 0.004, [0, 0, 0], [0, a / 2, 0], Math.PI * 2, 24), s: [1, 1.1, 1] as V3 })));
  const caps = merged('lantern-caps', () => [
    cyl(0.085, 0.045, [0, 0.235, 0], { rTop: 0.075, seg: 18 }),
    cyl(0.075, 0.045, [0, -0.235, 0], { rTop: 0.085, seg: 18 }),
    cyl(0.004, 0.44, [0, 0.48, 0], { seg: 6 }),
    cyl(0.018, 0.03, [0, -0.275, 0], { seg: 10 }),
  ]);
  const tassel = merged('lantern-tassel', () => around(12, 0.012).map(([x, z]) => cyl(0.003, 0.17, [x, -0.37, z], { seg: 4 })));
  return (
    <group>
      <Ball r={0.2} scale={[1, 1.1, 1]} material={mat('fabric', '#d41a1f', { emissive: '#ff3a18', emissiveIntensity: 0.65 })} segments={22} cast={false} />
      <G g={ribs} m={mat('wood', '#7a0f0f')} cast={false} />
      <G g={caps} m={gold()} cast={false} />
      <G g={tassel} m={mat('fabric', '#c8102e')} cast={false} />
      {/* Always mounted (intensity only changes): adding / removing a light recompiles every material. */}
      {light && <pointLight ref={lamp} position={[0, -0.32, 0]} color="#ffb37a" intensity={1.6} distance={4.5} decay={1.4} />}
    </group>
  );
}
export const Lantern1 = () => <LanternModel light />;
export const Lantern2 = () => <LanternModel />;

/** A wall fan facing into the room (+x); blades spin and the head sweeps while `states.power` is on. */
export function FanModel({ states }: ModelProps) {
  const head = useRef<Group>(null);
  const blades = useRef<Group>(null);
  const spin = useRef(0);
  const sweep = useRef(0);
  const on = states.power === 'on';
  useFrame((_, dt) => {
    spin.current += ((on ? 22 : 0) - spin.current) * Math.min(1, dt * (on ? 1.2 : 0.6));
    if (blades.current) blades.current.rotation.z += spin.current * dt;
    if (on) sweep.current += dt * 0.5;
    if (head.current) head.current.rotation.y = 0.55 * Math.sin(sweep.current);
  });
  const guard = merged('fan-guard', () => [
    ring(0.19, 0.005, [0, 0, 0.06], [0, 0, 0], Math.PI * 2, 32), ring(0.12, 0.003, [0, 0, 0.07], [0, 0, 0], Math.PI * 2, 24),
    ring(0.19, 0.005, [0, 0, -0.03], [0, 0, 0], Math.PI * 2, 32),
    ...Array.from({ length: 14 }, (_, i) => box([0.38, 0.003, 0.003], [0, 0, 0.068], [0, 0, (i / 14) * Math.PI])),
    ...Array.from({ length: 8 }, (_, i) => box([0.004, 0.004, 0.09], [Math.cos((i / 8) * Math.PI * 2) * 0.19, Math.sin((i / 8) * Math.PI * 2) * 0.19, 0.015])),
  ]);
  const bladeG = merged('fan-blades', () => [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2;
    return ball(0.08, [Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.02], [1.05, 0.5, 0.06], 12);
  }).map((p, i) => ({ ...p, r: [0, 0, (i / 3) * Math.PI * 2] as V3 })));
  const body = merged('fan-body', () => [ball(0.06, [0, 0, -0.05], [1, 1, 1.3], 14), cyl(0.03, 0.03, [0, 0, 0.03], { rot: [Math.PI / 2, 0, 0], seg: 14 })]);
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <Box size={[0.12, 0.18, 0.03]} position={[0, -0.05, -0.115]} material={mat('plastic', '#ecebe6')} />
      <Cyl r={0.016} h={0.1} position={[0, -0.05, -0.07]} rotation={[Math.PI / 2, 0, 0]} material={mat('plastic', '#ecebe6')} segments={10} />
      <group ref={head} position={[0, 0.03, -0.02]}>
        <G g={body} m={mat('plastic', '#f2f1ec', { roughness: 0.35 })} />
        <group ref={blades} position={[0, 0, 0.02]}>
          <G g={bladeG} m={mat('plastic', '#7db4dc', { roughness: 0.3, opacity: 0.85 })} cast={false} />
        </group>
        <G g={guard} m={mat('chrome', '#e6e8ea')} cast={false} />
      </group>
    </group>
  );
}

/** A grey plastic bin with a black liner (collider: hollow, ~0.36 across, 0.6 high). */
export function BinModel() {
  return (
    <group>
      <Lathe profile={[[0, -0.3], [0.155, -0.3], [0.178, 0.3], [0.168, 0.3], [0.146, -0.285], [0, -0.285]]} material={mat('plastic', '#6f7a72', { doubleSide: true, roughness: 0.5 })} />
      <mesh geometry={merged('bin-rim', () => [ring(0.176, 0.01, [0, 0.296, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 28)])} material={mat('plastic', '#1d1d1d', { roughness: 0.7 })} />
      <Cyl r={0.147} h={0.004} position={[0, -0.28, 0]} material={mat('plastic', '#1d1d1d')} cast={false} />
    </group>
  );
}

/** A row of brass coat hooks on a board, with a jacket and an umbrella hanging (faces the room: −z). */
export function CoatHookModel() {
  const hooks = merged('coat-hooks', () => [-0.21, -0.07, 0.07, 0.21].flatMap((x) => [cyl(0.006, 0.05, [x, 0, 0.0], { rot: [Math.PI / 2, 0, 0], seg: 8 }), ball(0.01, [x, 0.012, 0.025], undefined, 8)]));
  const jacket = merged('coat-jacket', () => [
    box([0.34, 0.5, 0.06], [-0.21, -0.3, 0.05], [0.05, 0, 0]),
    box([0.08, 0.46, 0.06], [-0.4, -0.3, 0.05], [0.05, 0, 0.12]), box([0.08, 0.46, 0.06], [-0.02, -0.3, 0.05], [0.05, 0, -0.12]),
    box([0.16, 0.05, 0.05], [-0.21, -0.04, 0.04]),
  ]);
  const umbrella = merged('coat-umbrella', () => [cyl(0.008, 0.58, [0.21, -0.33, 0.035], { rTop: 0.03, seg: 10 }), ring(0.025, 0.006, [0.235, -0.01, 0.035], [0, 0, 0], Math.PI, 10)]);
  return (
    <group rotation={[0, Math.PI, 0]}>
      <RBox size={[0.6, 0.1, 0.025]} radius={0.006} position={[0, 0, -0.025]} material={mat('wood', '#7a4a2a')} />
      <G g={hooks} m={gold()} cast={false} />
      <G g={jacket} m={mat('fabric', '#2c3a52')} />
      <G g={umbrella} m={mat('fabric', '#b02a2a')} />
    </group>
  );
}

/** The fish tank on its cabinet: three goldfish swim, bubbles rise (collider box 0.42 × 1.36 × 1.0). */
export function FishTankModel() {
  const fish = useRef<Array<Mesh | null>>([]);
  const bubbles = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    fish.current.forEach((m, i) => {
      if (!m) return;
      const sp = 0.32 + i * 0.07;
      const ph = t * sp + i * 2.1;
      const z = Math.sin(ph) * (0.36 - i * 0.04);
      const dir = Math.cos(ph) > 0 ? 1 : -1;
      m.position.set(-0.06 + i * 0.06 + 0.03 * Math.sin(t * 0.7 + i), 0.24 + i * 0.09 + 0.02 * Math.sin(t * 1.3 + i * 3), z);
      m.rotation.y = dir > 0 ? 0 : Math.PI;
      m.rotation.z = 0.08 * Math.sin(t * 6 + i);
    });
    if (bubbles.current) bubbles.current.position.y = (t * 0.05) % (0.4 / 14);
  });
  const fishG = merged('goldfish', () => [ball(0.022, [0, 0, 0], [0.75, 0.75, 1.6], 10), cyl(0.02, 0.03, [0, 0, -0.045], { rTop: 0.001, seg: 6, rot: [-Math.PI / 2, 0, 0] })]);
  const plants = merged('tank-plants', () => [
    ...[-0.32, -0.26, 0.28, 0.34].flatMap((z, i) => [cyl(0.012, 0.22 + (i % 2) * 0.08, [0.05 * (i % 2 ? 1 : -1), 0.22 + (i % 2) * 0.04, z], { rTop: 0.002, seg: 5, rot: [0.1 * (i - 1.5), 0, 0.15] }), cyl(0.01, 0.18, [-0.06, 0.2, z + 0.04], { rTop: 0.002, seg: 5, rot: [0, 0, -0.2] })]),
  ]);
  const gravel = merged('tank-gravel', () => [box([0.38, 0.04, 0.96], [0, 0.1, 0]), ball(0.06, [0.05, 0.13, 0.12], [1.4, 0.7, 1], 8), ball(0.04, [-0.08, 0.125, -0.1], [1.2, 0.8, 1], 8)]);
  const bubbleG = merged('tank-bubbles', () => Array.from({ length: 14 }, (_, i) => ball(0.006 + (i % 3) * 0.002, [0.12, 0.13 + (i / 14) * 0.4, -0.38 + (i % 2) * 0.01], undefined, 6)));
  return (
    <group>
      <RBox size={[0.42, 0.76, 1.0]} radius={0.01} position={[0, -0.3, 0]} material={mat('wood', '#3c2014')} receive />
      <Box size={[0.4, 0.56, 0.98]} position={[0, 0.36, 0]} material={mat('glass', '#dff2f2', { opacity: 0.18 })} cast={false} />
      <Box size={[0.38, 0.5, 0.96]} position={[0, 0.34, 0]} material={mat('liquid', '#5da8c4', { opacity: 0.32, roughness: 0.05 })} cast={false} />
      <G g={gravel} m={mat('stone', '#b29c78')} cast={false} />
      <G g={plants} m={mat('leaf', '#3f8f4a')} cast={false} />
      <mesh ref={bubbles} geometry={bubbleG} position={[0, 0, 0]}>
        <meshStandardMaterial color="#e8f8ff" transparent opacity={0.5} roughness={0.1} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { fish.current[i] = m; }} geometry={fishG} material={mat('plastic', i === 1 ? '#f4f0e6' : '#ff7a24', { roughness: 0.3 })} />
      ))}
      <Box size={[0.42, 0.04, 1.0]} position={[0, 0.66, 0]} material={mat('plastic', '#1d1d1d')} cast={false} />
      <mesh position={[0, 0.638, 0]}>
        <boxGeometry args={[0.2, 0.006, 0.9]} />
        <meshBasicMaterial color="#eef8ff" toneMapped={false} />
      </mesh>
    </group>
  );
}
