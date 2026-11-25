/**
 * The market's object models (docs/VR_WORLDS.md "The contract"). Each is drawn in its object's own
 * frame — the origin is the middle of the object's collider (index.tsx) — and is fully procedural:
 * produce from lathes, tubes and instanced clusters (pieces.tsx), labels and signs from canvases
 * (textures.ts, kit). The two scales really weigh what's on them (weigh.ts).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Quaternion, Vector3, type Group, type PointLight } from 'three';
import { Ball, Box, Cyl, Lathe, RBox, Sign, labelTexture, mat, stripeTexture } from '../kit';
import type { ModelProps } from '../types';
import { Cluster, cone, cylinder, halfDisc, lathe, podProfile, sphere, torus, tube, type Inst } from './pieces';
import { crateTexture, dialTexture, lcdCanvas, priceBoardTexture, qrTexture, sackTexture, tartanTexture, watermelonTexture } from './textures';
import { JIN_PER_KG, jinReading, useWeighed } from './weigh';

type V3 = [number, number, number];

/** A thin rod between two points (chains, frames, handles). */
function Rod({ from, to, r, material }: { from: V3; to: V3; r: number; material: ReturnType<typeof mat> }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const dir = b.clone().sub(a);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: a.add(b).multiplyScalar(0.5), quat: q, len: dir.length() };
  }, [from, to]);
  return <mesh geometry={cylinder(r, 1, 6)} material={material} position={pos} quaternion={quat} scale={[1, len, 1]} castShadow />;
}

// ── vegetables ───────────────────────────────────────────────────────────

/** 西红柿: glossy red, a little flattened, a green star calyx. */
export function TomatoModel({ color = '#d42a1d' }: { color?: string }) {
  return (
    <group>
      <Ball r={0.038} scale={[1, 0.84, 1]} material={mat('food', color, { roughness: 0.22 })} segments={18} />
      <mesh geometry={cone(0.017, 0.006, 5)} material={mat('leaf', '#3f7a2a')} position={[0, 0.032, 0]} scale={[1, 0.6, 1]} />
      <Cyl r={0.0025} h={0.012} position={[0, 0.038, 0]} material={mat('leaf', '#4b6b2a')} segments={5} cast={false} />
    </group>
  );
}
export const Tomato1 = () => <TomatoModel />;
export const Tomato2 = () => <TomatoModel color="#c92218" />;
export const Tomato3 = () => <TomatoModel color="#dc4a22" />;

/** 黄瓜: long, dark green, a dried yellow flower at the tip (lying along z). */
export function CucumberModel() {
  const g = lathe('cucumber', podProfile(0.21, [0.011, 0.015, 0.017, 0.017, 0.017, 0.016, 0.014, 0.01]), 12);
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh geometry={g} material={mat('food', '#2f5d22', { roughness: 0.55 })} castShadow />
      <Ball r={0.005} position={[0, 0.106, 0]} material={mat('food', '#e0c140')} segments={6} cast={false} />
    </group>
  );
}

/** 茄子: a long purple Chinese eggplant with its green cap (lying along z). */
export function EggplantModel() {
  const g = lathe('eggplant', podProfile(0.23, [0.014, 0.019, 0.022, 0.024, 0.026, 0.027, 0.026, 0.02]), 14);
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh geometry={g} material={mat('food', '#4b1d5e', { roughness: 0.18 })} castShadow />
      <mesh geometry={cone(0.019, 0.04, 6)} material={mat('leaf', '#3d6b2c')} position={[0, -0.1, 0]} rotation={[Math.PI, 0, 0]} />
      <Cyl r={0.004} h={0.03} position={[0, -0.13, 0]} material={mat('leaf', '#4e6b30')} segments={5} cast={false} />
    </group>
  );
}

/** 胡萝卜: an orange taper with a tuft of green tops (lying along x). */
export function CarrotModel() {
  const g = lathe('carrot', [[0, -0.075], [0.004, -0.06], [0.008, -0.03], [0.012, 0.01], [0.015, 0.05], [0.016, 0.07], [0.01, 0.078], [0, 0.08]], 10);
  return (
    <group rotation={[0, 0, -Math.PI / 2]}>
      <mesh geometry={g} material={mat('food', '#ea7a1d', { roughness: 0.6 })} castShadow />
      <Cluster
        geometry={cone(0.004, 0.06, 4)}
        material={mat('leaf', '#ffffff')}
        items={[-0.4, 0, 0.4].map((a) => ({ p: [Math.sin(a) * 0.012, 0.105, 0], r: [0, 0, a], c: '#4f8f3a' }) as Inst)}
      />
    </group>
  );
}

/** 白菜: a napa cabbage — pale ribs, frilly green tips (lying along z). */
export function CabbageModel() {
  const inner = lathe('cabbage', [[0, -0.17], [0.045, -0.165], [0.062, -0.12], [0.07, -0.04], [0.071, 0.04], [0.066, 0.11], [0.05, 0.155], [0.02, 0.17], [0, 0.17]], 16);
  const leaf = lathe('cabbage-leaf', [[0.058, -0.02], [0.073, 0.02], [0.074, 0.08], [0.068, 0.13], [0.052, 0.163], [0.022, 0.176], [0, 0.178]], 16);
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh geometry={inner} material={mat('food', '#eef1dc', { roughness: 0.6 })} castShadow />
      <mesh geometry={leaf} material={mat('leaf', '#8fbf5a', { roughness: 0.65 })} castShadow />
      {[0, 2.1, 4.2].map((a) => (
        <Box key={a} size={[0.012, 0.25, 0.004]} position={[Math.sin(a) * 0.069, -0.02, Math.cos(a) * 0.069]} rotation={[0, a, 0]} material={mat('food', '#f7f8ea')} cast={false} />
      ))}
    </group>
  );
}

/** 土豆: a lumpy tan potato. */
export function PotatoModel({ squash = 1 }: { squash?: number }) {
  return (
    <group>
      <Ball r={0.034} scale={[1.25, 0.9 * squash, 1]} material={mat('stone', '#b8925f', { roughness: 0.92 })} segments={12} />
      <Ball r={0.018} scale={[1, 0.8, 1]} position={[0.024, 0.006, 0.008]} material={mat('stone', '#b8925f', { roughness: 0.92 })} segments={8} />
    </group>
  );
}
export const Potato1 = () => <PotatoModel />;
export const Potato2 = () => <PotatoModel squash={0.9} />;

/** 葱: a bunch of spring onions with a red rubber band (lying along z). */
export function ScallionModel() {
  const stems: Inst[] = [-0.012, -0.004, 0.004, 0.012, -0.008, 0.008].map((x, i) => ({ p: [x, i > 3 ? 0.006 : -0.003, 0], r: [Math.PI / 2, 0, 0] }) as Inst);
  return (
    <group>
      <Cluster geometry={cylinder(0.0055, 0.13, 6)} material={mat('food', '#f2f3e4', { roughness: 0.5 })} items={stems.map((s) => ({ ...s, p: [s.p[0], s.p[1], 0.11] }))} />
      <Cluster geometry={cylinder(0.0045, 0.23, 6, 0.0025)} material={mat('leaf', '#4f9a3a')} items={stems.map((s, i) => ({ ...s, p: [s.p[0] * 1.3, s.p[1], -0.06], r: [Math.PI / 2 - (i % 3) * 0.04, 0, 0] }))} />
      <mesh geometry={torus(0.018, 0.003, Math.PI * 2, 12)} material={mat('rubber', '#c8102e')} position={[0, 0, 0.05]} />
    </group>
  );
}

/** 大蒜: a head of garlic — a fat bulb with a pointed top and a root tuft. */
export function GarlicModel() {
  const g = lathe('garlic', [[0, -0.024], [0.02, -0.022], [0.029, -0.012], [0.03, 0.0], [0.026, 0.012], [0.014, 0.02], [0.004, 0.025], [0, 0.026]], 14);
  return (
    <group>
      <mesh geometry={g} material={mat('food', '#efe6dc', { roughness: 0.7 })} castShadow />
      <Cyl r={0.008} h={0.004} position={[0, -0.024, 0]} material={mat('food', '#8a6a42')} segments={8} cast={false} />
    </group>
  );
}

/** 辣椒: a curved red chilli with a green stem (along z). */
export function ChiliModel() {
  const g = tube('chili', [[0, 0.002, -0.05], [0, 0, -0.02], [0, -0.003, 0.015], [0.004, 0.002, 0.045]], 0.0085, 12);
  return (
    <group>
      <mesh geometry={g} material={mat('food', '#c41616', { roughness: 0.2 })} castShadow />
      <mesh geometry={cone(0.008, 0.014, 6)} material={mat('leaf', '#3a6b25')} position={[0, 0.002, -0.054]} rotation={[-Math.PI / 2, 0, 0]} />
    </group>
  );
}

// ── fruit ────────────────────────────────────────────────────────────────

/** 西瓜: a round melon with wavy dark stripes. */
export function WatermelonModel() {
  return (
    <group>
      <mesh geometry={sphere(0.12, 24)} scale={[1, 0.92, 1]} material={mat('food', '#ffffff', { map: watermelonTexture(), roughness: 0.35 })} castShadow />
      <Cyl r={0.004} h={0.02} position={[0, 0.115, 0]} rotation={[0.3, 0, 0]} material={mat('wood', '#6b5a2a')} segments={5} cast={false} />
    </group>
  );
}

/** 葡萄: a bunch of purple grapes lying on its side (stem towards −x). */
export function GrapesModel() {
  const items = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    let k = 0;
    for (let i = 0; i < 6; i++) {
      const x = -0.055 + i * 0.022;
      const ring = Math.max(1, Math.round(4 - i * 0.5));
      const rad = 0.03 - i * 0.004;
      for (let j = 0; j < ring + 2; j++) {
        const a = (j / (ring + 2)) * Math.PI * 2 + i;
        out.push({ p: [x, Math.sin(a) * rad * 0.7, Math.cos(a) * rad], s: 0.9 + ((k++ * 37) % 10) / 50, c: k % 3 ? '#4a2659' : '#5d3270' });
      }
    }
    return out;
  }, []);
  return (
    <group>
      <Cluster geometry={sphere(0.0135, 10)} material={mat('food', '#ffffff', { roughness: 0.25 })} items={items} />
      <Cyl r={0.003} h={0.05} position={[-0.075, 0.006, 0]} rotation={[0, 0, Math.PI / 2]} material={mat('wood', '#6e5a35')} segments={5} cast={false} />
    </group>
  );
}

/** 草莓: a clear punnet of strawberries. */
export function StrawberriesModel() {
  const berries = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      out.push({ p: [-0.05 + i * 0.033, 0.004 + ((i + j) % 2) * 0.008, -0.03 + j * 0.03], r: [Math.PI + ((i * 3 + j) % 3) * 0.3, i, 0.2 * j], s: 0.9 + ((i + j) % 3) * 0.08, c: (i + j) % 2 ? '#d4141f' : '#e02a26' });
    }
    return out;
  }, []);
  return (
    <group>
      <RBox size={[0.15, 0.05, 0.1]} radius={0.006} position={[0, -0.007, 0]} material={mat('glass', '#e8f4f8', { opacity: 0.35 })} cast={false} />
      <Cluster geometry={cone(0.014, 0.03, 8)} material={mat('food', '#ffffff', { roughness: 0.3 })} items={berries} />
      <Cluster geometry={cone(0.012, 0.006, 5)} material={mat('leaf', '#4f8f3a')} items={berries.map((b) => ({ p: [b.p[0], b.p[1] + 0.016, b.p[2]], s: 1 }))} cast={false} />
    </group>
  );
}

/** 苹果. */
export function AppleModel({ color = '#c8232c' }: { color?: string }) {
  return (
    <group>
      <Ball r={0.04} scale={[1, 0.92, 1]} material={mat('food', color, { roughness: 0.35 })} segments={18} />
      <Cyl r={0.003} h={0.022} position={[0, 0.043, 0]} rotation={[0, 0, 0.25]} material={mat('wood', '#5b3a1f')} segments={6} cast={false} />
    </group>
  );
}
export const Apple1 = () => <AppleModel />;
export const Apple2 = () => <AppleModel color="#e0b23a" />;

/** 烂苹果: a rotten apple — brown, slumped, with dark soft patches and a fleck of mould. */
export function RottenAppleModel() {
  return (
    <group>
      <Ball r={0.04} scale={[1.02, 0.82, 0.97]} material={mat('food', '#7c5a2c', { roughness: 0.85 })} segments={16} />
      <Cluster
        geometry={sphere(0.016, 8)}
        material={mat('food', '#ffffff', { roughness: 0.95 })}
        items={[{ p: [0.028, 0.006, 0.012], s: [1, 0.8, 1], c: '#3b2612' }, { p: [-0.018, 0.018, -0.024], s: [0.8, 0.6, 0.8], c: '#2f1d0e' }, { p: [0.0, -0.01, 0.034], s: [0.5, 0.4, 0.5], c: '#d9d4bf' }]}
        cast={false}
      />
      <Cyl r={0.003} h={0.02} position={[0, 0.034, 0]} rotation={[0, 0, 0.6]} material={mat('wood', '#3a2a18')} segments={5} cast={false} />
    </group>
  );
}

/** 橙子: a dimpled orange. */
export function OrangeModel() {
  return (
    <group>
      <Ball r={0.038} material={mat('stone', '#f0861a', { roughness: 0.55 })} segments={16} />
      <Ball r={0.004} position={[0, 0.037, 0]} material={mat('leaf', '#5d7a2a')} segments={6} cast={false} />
    </group>
  );
}

/** 梨: a yellow-green pear. */
export function PearModel() {
  const g = lathe('pear', [[0, -0.05], [0.022, -0.048], [0.034, -0.032], [0.035, -0.014], [0.027, 0.006], [0.019, 0.022], [0.016, 0.036], [0.011, 0.046], [0, 0.05]], 16);
  return (
    <group>
      <mesh geometry={g} material={mat('food', '#d7cf5f', { roughness: 0.45 })} castShadow />
      <Cyl r={0.0025} h={0.018} position={[0.002, 0.056, 0]} rotation={[0, 0, -0.3]} material={mat('wood', '#5b3a1f')} segments={5} cast={false} />
    </group>
  );
}

/** 香蕉: a bunch (一把) of five bananas fanned from the crown. */
export function BananaBunchModel() {
  const g = tube('banana', [[-0.09, 0.012, 0], [-0.045, -0.008, 0], [0, -0.012, 0], [0.045, -0.006, 0], [0.085, 0.014, 0]], 0.0165, 16);
  const fingers = useMemo<Inst[]>(() => [-0.5, -0.25, 0, 0.25, 0.5].map((a, i) => ({ p: [0.01, (i % 2) * 0.014, a * 0.1], r: [0, a * 0.5, 0] }) as Inst), []);
  return (
    <group>
      <Cluster geometry={g} material={mat('food', '#f0cf3a', { roughness: 0.55 })} items={fingers} />
      <RBox size={[0.03, 0.03, 0.06]} radius={0.01} position={[-0.088, 0.016, 0]} material={mat('food', '#7d8a3a')} cast={false} />
    </group>
  );
}

// ── tofu, eggs, dry goods, tools ────────────────────────────────────────

export function TofuModel() {
  return (
    <group>
      <RBox size={[0.11, 0.05, 0.11]} radius={0.006} material={mat('food', '#f4efe0', { roughness: 0.6 })} />
      <Box size={[0.111, 0.002, 0.111]} position={[0, 0.0125, 0]} material={mat('food', '#e7e0cc', { roughness: 0.7 })} cast={false} />
    </group>
  );
}

export function EggModel() {
  return <Ball r={0.025} scale={[1, 1.25, 1]} material={mat('food', '#d8b089', { roughness: 0.6 })} segments={14} />;
}

/** 菜刀: a Chinese cleaver — a big rectangular blade, a wooden handle (along x). */
export function CleaverModel() {
  return (
    <group>
      <RBox size={[0.18, 0.004, 0.09]} radius={0.0019} position={[0.045, -0.004, 0]} material={mat('steel', '#c9cfd5', { roughness: 0.3 })} />
      <Box size={[0.18, 0.006, 0.008]} position={[0.045, -0.003, -0.041]} material={mat('metal', '#5d6268')} cast={false} />
      <RBox size={[0.1, 0.02, 0.026]} radius={0.008} position={[-0.085, 0.0, -0.025]} material={mat('wood', '#4a2f1c')} />
    </group>
  );
}

/** A small clear bag of dry goods with a printed label and a twisted top. */
function DryBag({ text, h, fill, band }: { text: string; h: number; fill: string; band: string }) {
  const label = useMemo(() => labelTexture(text, '#fffdf4', band, band), [text, band]);
  return (
    <group>
      <RBox size={[0.1, h - 0.03, 0.08]} radius={0.02} position={[0, -0.015, 0]} material={mat('food', fill, { roughness: 0.8 })} />
      <Box size={[0.07, 0.05, 0.002]} position={[0, -0.01, 0.041]} material={mat('paper', '#ffffff', { map: label })} cast={false} />
      <mesh geometry={cone(0.025, 0.035, 8)} material={mat('plastic', '#f6f2ea', { opacity: 0.8 })} position={[0, h / 2 - 0.016, 0]} rotation={[Math.PI, 0, 0]} />
    </group>
  );
}
export const PeanutsModel = () => <DryBag text="花生" h={0.15} fill="#c79a5c" band="#b0412e" />;
export const DatesModel = () => <DryBag text="红枣" h={0.13} fill="#8e1f1c" band="#c8102e" />;

/** 大米: a 10-jin woven sack lying flat. */
export function RiceModel() {
  const tex = useMemo(() => sackTexture('大米'), []);
  return (
    <group>
      <RBox size={[0.3, 0.1, 0.2]} radius={0.035} material={mat('fabric', '#ffffff', { map: tex, roughness: 0.95 })} receive />
      <Box size={[0.012, 0.06, 0.2]} position={[-0.148, 0, 0]} material={mat('fabric', '#d9cfb5')} cast={false} />
    </group>
  );
}

/** 塑料袋: a red translucent market bag, open at the top, two loop handles. */
export function BagModel() {
  const red = mat('plastic', '#e8505a', { opacity: 0.58, doubleSide: true, roughness: 0.3 });
  return (
    <group>
      <Box size={[0.24, 0.01, 0.16]} position={[0, -0.125, 0]} material={red} cast={false} />
      <RBox size={[0.24, 0.26, 0.012]} radius={0.004} position={[0, 0, 0.075]} material={red} />
      <RBox size={[0.24, 0.26, 0.012]} radius={0.004} position={[0, 0, -0.075]} material={red} />
      <RBox size={[0.012, 0.26, 0.16]} radius={0.004} position={[0.115, 0, 0]} material={red} cast={false} />
      <RBox size={[0.012, 0.26, 0.16]} radius={0.004} position={[-0.115, 0, 0]} material={red} cast={false} />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={torus(0.045, 0.006, Math.PI, 12)} material={red} position={[0, 0.13, s * 0.075]} />
      ))}
    </group>
  );
}

/** 篮子: a red woven plastic shopping basket with a handle. */
export function BasketModel() {
  const wall = mat('plastic', '#ffffff', { map: crateTexture('#c8322a'), roughness: 0.5 });
  return (
    <group>
      <RBox size={[0.34, 0.015, 0.26]} radius={0.006} position={[0, -0.072, 0]} material={mat('plastic', '#a82620')} />
      <RBox size={[0.34, 0.16, 0.014]} radius={0.006} position={[0, 0, 0.124]} material={wall} />
      <RBox size={[0.34, 0.16, 0.014]} radius={0.006} position={[0, 0, -0.124]} material={wall} />
      <RBox size={[0.014, 0.16, 0.26]} radius={0.006} position={[0.164, 0, 0]} material={wall} />
      <RBox size={[0.014, 0.16, 0.26]} radius={0.006} position={[-0.164, 0, 0]} material={wall} />
      <mesh geometry={torus(0.15, 0.009, Math.PI, 18)} material={mat('plastic', '#a82620')} position={[0, 0.075, 0]} castShadow />
    </group>
  );
}

// ── fixed things ─────────────────────────────────────────────────────────

/**
 * A stall counter (摊): tiled sides, a worktop, a kick and a number plate. Drawn facing +z (the
 * object's yaw turns it to the aisle); `size` = the collider box [width, height, depth].
 */
export function StallModel({ size, top, tile, plate, topKind = 'wood' }: { size: V3; top: string; tile: string; plate: string; topKind?: 'wood' | 'steel' | 'tile' }) {
  const [w, h, d] = size;
  const topMat = topKind === 'steel' ? mat('steel', top, { roughness: 0.32 }) : topKind === 'tile' ? mat('tile', top, { tiles: 4, grout: '#c9c6bd', repeat: [w * 3, d * 3] }) : mat('wood_planks', top, { repeat: [w, d] });
  return (
    <group>
      <Box size={[w - 0.02, h - 0.12, d - 0.03]} position={[0, -0.02, -0.01]} material={mat('tile', tile, { tiles: 4, grout: '#d8d6cf', repeat: [Math.max(1, w * 4), 3] })} receive />
      <Box size={[w - 0.06, 0.08, d - 0.08]} position={[0, -h / 2 + 0.04, -0.03]} material={mat('rubber', '#3d403f')} cast={false} />
      <RBox size={[w + 0.03, 0.05, d + 0.03]} radius={0.008} position={[0, h / 2 - 0.025, 0]} material={topMat} receive />
      <Box size={[w + 0.035, 0.03, 0.02]} position={[0, h / 2 - 0.06, d / 2 + 0.01]} material={mat('painted', '#2f6f4f')} cast={false} />
      <Sign text={plate} size={[0.24, 0.12]} bg="#1c5a9b" fg="#ffffff" position={[w / 2 - 0.25, 0.08, d / 2 - 0.004]} />
    </group>
  );
}
export const VegStallModel = () => <StallModel size={[2.3, 0.85, 0.9]} top="#9b7650" tile="#eef2ee" plate="12号" />;
export const FruitStallModel = () => <StallModel size={[2.3, 0.85, 0.9]} top="#b89b74" tile="#f3ecdc" plate="15号" />;
export const TofuStallModel = () => <StallModel size={[2.0, 0.85, 0.8]} top="#eef0ef" tile="#e1edf3" plate="8号" topKind="tile" />;
export const DryStallModel = () => <StallModel size={[1.4, 0.8, 0.9]} top="#c9ccd0" tile="#f1e6d2" plate="20号" topKind="steel" />;

/** 电子秤: white base, steel pan, an LCD on a little post that reads what's on it in 斤. */
export function ScaleModel() {
  const anchor = useRef<Group>(null);
  const lcd = useMemo(() => lcdCanvas(), []);
  useWeighed(anchor, HALF_SCALE, OFF_SCALE, (kg) => lcd.draw(jinReading(kg)));
  return (
    <group ref={anchor}>
      <RBox size={[0.3, 0.045, 0.26]} radius={0.01} position={[0, -0.0075, 0]} material={mat('plastic', '#eef0f2', { roughness: 0.4 })} />
      <RBox size={[0.27, 0.012, 0.22]} radius={0.004} position={[0, 0.024, -0.01]} material={mat('steel', '#d5dade', { roughness: 0.25 })} />
      <Box size={[0.03, 0.08, 0.02]} position={[0, 0.03, 0.14]} material={mat('plastic', '#dfe3e6')} cast={false} />
      <group position={[0, 0.085, 0.152]} rotation={[-0.25, 0, 0]}>
        <RBox size={[0.15, 0.06, 0.02]} radius={0.006} material={mat('plastic', '#2b2f33')} cast={false} />
        <mesh position={[0, 0, 0.0105]}>
          <planeGeometry args={[0.13, 0.045]} />
          <meshBasicMaterial map={lcd.texture} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
const HALF_SCALE: V3 = [0.15, 0.17, 0.13];
const OFF_SCALE: V3 = [0, 0.2, 0];

/** 秤: a hanging dial scale — a steel pan on three chains, a round dial whose needle swings to the weight. */
export function HangingScaleModel() {
  const anchor = useRef<Group>(null);
  const needle = useRef<Group>(null);
  const kg = useWeighed(anchor, HALF_PAN, OFF_PAN);
  useFrame((_, dt) => {
    const n = needle.current;
    if (!n) return;
    const jin = Math.min(20, kg.current * JIN_PER_KG);
    const goal = -(-Math.PI * 0.75 + (jin / 20) * Math.PI * 1.5);
    // a springy needle: eases with a little overshoot feel
    n.rotation.z += (goal - n.rotation.z) * Math.min(1, dt * 6);
  });
  const steel = mat('steel', '#cdd2d7', { roughness: 0.3, doubleSide: true });
  const chain = mat('metal', '#8d9298');
  const dialY = 0.42;
  return (
    <group ref={anchor}>
      <Lathe profile={[[0, -0.024], [0.12, -0.024], [0.15, 0.02], [0.145, 0.02], [0.116, -0.018], [0, -0.018]]} material={steel} segments={24} />
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => (
        <Rod key={a} from={[Math.sin(a) * 0.145, 0.02, Math.cos(a) * 0.145]} to={[0, dialY - 0.1, 0]} r={0.0022} material={chain} />
      ))}
      <Rod from={[0, dialY - 0.1, 0]} to={[0, dialY - 0.075, 0]} r={0.005} material={chain} />
      <group position={[0, dialY, 0]}>
        <Cyl r={0.08} h={0.045} rotation={[Math.PI / 2, 0, 0]} material={mat('painted', '#c8302c', { roughness: 0.4 })} />
        <mesh position={[0, 0, 0.0235]}>
          <circleGeometry args={[0.07, 32]} />
          <meshStandardMaterial map={dialTexture()} roughness={0.5} />
        </mesh>
        <group ref={needle} position={[0, 0, 0.026]} rotation={[0, 0, Math.PI * 0.75]}>
          <Box size={[0.004, 0.058, 0.002]} position={[0, 0.026, 0]} material={mat('painted', '#c8102e')} cast={false} />
        </group>
        <Cyl r={0.006} h={0.006} position={[0, 0, 0.028]} rotation={[Math.PI / 2, 0, 0]} material={mat('metal', '#333')} cast={false} />
      </group>
      <Rod from={[0, dialY + 0.08, 0]} to={[0, 1.0, 0]} r={0.004} material={chain} />
      <mesh geometry={torus(0.018, 0.004, Math.PI * 1.5, 12)} material={chain} position={[0, dialY + 0.095, 0]} rotation={[0, Math.PI / 2, 0]} />
    </group>
  );
}
const HALF_PAN: V3 = [0.15, 0.15, 0.15];
const OFF_PAN: V3 = [0, 0.16, 0];

/** 二维码: an acrylic stand with the (invented) pay code — faces +z. */
export function QrModel() {
  const tex = useMemo(() => qrTexture(), []);
  return (
    <group>
      <Box size={[0.17, 0.225, 0.006]} position={[0, 0.006, 0]} rotation={[-0.12, 0, 0]} material={mat('glass', '#eaf6ff', { opacity: 0.4 })} cast={false} />
      <mesh position={[0, 0.006, 0.0045]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[0.15, 0.2]} />
        <meshStandardMaterial map={tex} roughness={0.5} />
      </mesh>
      <RBox size={[0.18, 0.02, 0.06]} radius={0.006} position={[0, -0.11, -0.005]} material={mat('plastic', '#1aa260')} />
    </group>
  );
}

/** 钱箱: a blue tin cash box; its lid lifts on `states.lid`, coins and notes inside (faces +z). */
export function CashBoxModel({ states }: ModelProps) {
  const lid = useRef<Group>(null);
  const open = states.lid === 'open';
  useFrame((_, dt) => {
    const l = lid.current;
    if (!l) return;
    const goal = open ? -1.9 : 0;
    l.rotation.x += (goal - l.rotation.x) * Math.min(1, dt * 7);
  });
  const tin = mat('painted', '#2d63a8', { roughness: 0.35, metalness: 0.4 });
  const coins = useMemo<Inst[]>(() => Array.from({ length: 14 }, (_, i) => ({ p: [-0.09 + (i % 7) * 0.03, -0.025 + Math.floor(i / 7) * 0.004, 0.04 - Math.floor(i / 7) * 0.02 + (i % 2) * 0.006], r: [0.1 * (i % 3), 0, 0.08 * (i % 2)], c: i % 3 ? '#cfd3d6' : '#d8b04a' }) as Inst), []);
  return (
    <group>
      <Box size={[0.26, 0.006, 0.2]} position={[0, -0.037, 0]} material={tin} cast={false} />
      <Box size={[0.26, 0.07, 0.006]} position={[0, -0.005, 0.097]} material={tin} />
      <Box size={[0.26, 0.07, 0.006]} position={[0, -0.005, -0.097]} material={tin} />
      <Box size={[0.006, 0.07, 0.2]} position={[0.127, -0.005, 0]} material={tin} cast={false} />
      <Box size={[0.006, 0.07, 0.2]} position={[-0.127, -0.005, 0]} material={tin} cast={false} />
      <Cluster geometry={cylinder(0.012, 0.003, 10)} material={mat('metal', '#ffffff', { roughness: 0.35 })} items={coins} cast={false} />
      <Box size={[0.12, 0.004, 0.06]} position={[0.05, -0.02, -0.05]} rotation={[0, 0.1, 0]} material={mat('paper', '#7fb07a')} cast={false} />
      <Box size={[0.12, 0.004, 0.06]} position={[0.04, -0.016, -0.045]} rotation={[0, -0.15, 0]} material={mat('paper', '#c96a6a')} cast={false} />
      <group ref={lid} position={[0, 0.032, -0.1]}>
        <RBox size={[0.27, 0.014, 0.205]} radius={0.004} position={[0, 0.005, 0.1]} material={tin} />
        <Box size={[0.06, 0.012, 0.012]} position={[0, 0.012, 0.2]} material={mat('chrome')} cast={false} />
      </group>
    </group>
  );
}

/** 电风扇: a pedestal fan; the blades spin and the head sweeps while `states.power` is on (faces +z). */
export function FanModel({ states }: ModelProps) {
  const blades = useRef<Group>(null);
  const head = useRef<Group>(null);
  const spin = useRef(0);
  const sweep = useRef(0);
  const on = states.power === 'on';
  useFrame((_, dt) => {
    spin.current += ((on ? 26 : 0) - spin.current) * Math.min(1, dt * (on ? 1.2 : 0.6));
    if (blades.current) blades.current.rotation.z -= spin.current * dt;
    if (on) sweep.current += dt;
    if (head.current) head.current.rotation.y = 0.35 + Math.sin(sweep.current * 0.6) * 0.55;
  });
  const white = mat('plastic', '#eef1f3', { roughness: 0.4 });
  const cage = mat('metal', '#c3c8cd', { roughness: 0.4 });
  return (
    <group>
      <Cyl r={0.15} rTop={0.13} h={0.04} position={[0, -0.68, 0]} material={white} />
      <Cyl r={0.013} h={1.05} position={[0, -0.13, 0]} material={mat('chrome')} />
      <group ref={head} position={[0, 0.48, 0]}>
        <RBox size={[0.08, 0.08, 0.12]} radius={0.03} position={[0, 0, -0.05]} material={white} />
        <group position={[0, 0, 0.04]}>
          <mesh geometry={torus(0.14, 0.004, Math.PI * 2, 28)} material={cage} />
          <mesh geometry={torus(0.09, 0.003, Math.PI * 2, 20)} material={cage} position={[0, 0, 0.02]} />
          <Cyl r={0.025} h={0.02} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.03]} material={mat('plastic', '#3a7bd5')} cast={false} />
          <group ref={blades} position={[0, 0, 0.012]}>
            {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => (
              <RBox key={a} size={[0.06, 0.12, 0.006]} radius={0.0029} position={[Math.sin(a) * 0.065, Math.cos(a) * 0.065, 0]} rotation={[0.25, 0, -a]} material={mat('plastic', '#7fb6f0', { opacity: 0.85 })} cast={false} />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

/** 灯泡: a bare bulb on its cord; warm light while `states.light` is on (the one point light it owns). */
export function BulbModel({ states }: ModelProps) {
  const on = states.light === 'on';
  const light = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    // a faint flicker, like a market bulb on a long cable
    if (light.current) light.current.intensity = on ? 3.4 + Math.sin(clock.elapsedTime * 11) * 0.06 : 0;
  });
  return (
    <group>
      <Cyl r={0.004} h={0.68} position={[0, 0.41, 0]} material={mat('rubber', '#1e1e1e')} cast={false} />
      <Cyl r={0.017} h={0.05} position={[0, 0.05, 0]} material={mat('plastic', '#2b2b2b')} cast={false} />
      <mesh position={[0, -0.02, 0]} scale={[1, 1.25, 1]}>
        <sphereGeometry args={[0.038, 16, 12]} />
        <meshStandardMaterial color={on ? '#fff2c8' : '#d8d2c4'} emissive={on ? '#ffcf7a' : '#000000'} emissiveIntensity={on ? 2.4 : 0} toneMapped={!on} roughness={0.2} />
      </mesh>
      {/* Always mounted (intensity 0 when off): adding / removing a light recompiles every material. */}
      <pointLight ref={light} position={[0, -0.12, 0]} color="#ffd59a" intensity={on ? 3.4 : 0} distance={6} decay={1.5} />
    </group>
  );
}

/** 遮阳棚: a striped canvas awning over a stall with a scalloped valance on the aisle side (`side` ±1 in x). */
export function AwningModel({ side, a, b }: { side: 1 | -1; a: string; b: string }) {
  const tex = useMemo(() => stripeTexture(a, b, 8, [1, 3]), [a, b]);
  const canvas = mat('fabric', '#ffffff', { map: tex, doubleSide: true, roughness: 0.9 });
  const scallops = useMemo<Inst[]>(() => Array.from({ length: 16 }, (_, i) => ({ p: [0, 0, -1.25 + (i + 0.5) * (2.5 / 16)], r: [0, Math.PI / 2, 0], c: i % 2 ? a : b }) as Inst), [a, b]);
  return (
    <group>
      <Box size={[1.2, 0.012, 2.5]} rotation={[0, 0, -side * 0.08]} material={canvas} cast={false} receive />
      <Box size={[0.006, 0.12, 2.5]} position={[side * 0.6, -0.1, 0]} material={canvas} cast={false} />
      <Cluster geometry={halfDisc(0.078)} material={mat('fabric', '#ffffff', { doubleSide: true })} items={scallops} position={[side * 0.6, -0.16, 0]} cast={false} />
    </group>
  );
}
export const AwningVegModel = () => <AwningModel side={1} a="#2f8f5b" b="#f4f1e6" />;
export const AwningFruitModel = () => <AwningModel side={-1} a="#d9483b" b="#f8f1e2" />;

/** 垃圾桶: a green market bin (open), a 垃圾 label. */
export function BinModel() {
  return (
    <group>
      <Lathe profile={[[0, -0.33], [0.17, -0.33], [0.19, 0.31], [0.2, 0.33], [0.185, 0.33], [0.172, -0.31], [0, -0.31]]} material={mat('plastic', '#2f7d45', { doubleSide: true, roughness: 0.5 })} segments={20} />
      <Cyl r={0.15} h={0.004} position={[0, -0.3, 0]} material={mat('plastic', '#222')} cast={false} />
      <Sign text="垃圾" size={[0.16, 0.08]} bg="#f6f4ea" fg="#2f7d45" position={[0, 0.08, 0.186]} rotation={[-0.03, 0, 0]} />
    </group>
  );
}

/** 推车: a flatbed hand cart — steel frame, four wheels, a handle at +z. */
export function CartModel() {
  const steel = mat('metal', '#5f6b74', { roughness: 0.45 });
  const wheels = useMemo<Inst[]>(() => [[-0.31, -0.42], [0.31, -0.42], [-0.31, 0.42], [0.31, 0.42]].map(([x, z]) => ({ p: [x, -0.19, z], r: [0, 0, Math.PI / 2] }) as Inst), []);
  return (
    <group>
      <RBox size={[0.62, 0.04, 1.0]} radius={0.01} position={[0, 0.25, 0]} material={mat('wood_planks', '#8a6a48', { repeat: [1, 2] })} receive />
      <Box size={[0.64, 0.05, 0.04]} position={[0, 0.22, 0.48]} material={steel} />
      <Box size={[0.64, 0.05, 0.04]} position={[0, 0.22, -0.48]} material={steel} />
      <Box size={[0.03, 0.24, 0.03]} position={[0, 0.07, 0]} material={steel} cast={false} />
      <Cluster geometry={cylinder(0.08, 0.04, 14)} material={mat('rubber', '#ffffff')} items={wheels.map((w) => ({ ...w, c: '#1e1e1e' }))} />
      <Rod from={[-0.28, 0.25, 0.5]} to={[-0.28, 0.68, 0.62]} r={0.012} material={steel} />
      <Rod from={[0.28, 0.25, 0.5]} to={[0.28, 0.68, 0.62]} r={0.012} material={steel} />
      <Rod from={[-0.29, 0.68, 0.62]} to={[0.29, 0.68, 0.62]} r={0.016} material={mat('rubber', '#2b2b2b')} />
    </group>
  );
}

/** 筐: a blue plastic crate on the floor (open top). */
export function CrateModel() {
  const wall = mat('plastic', '#ffffff', { map: crateTexture('#2f6fb3'), roughness: 0.5 });
  return (
    <group>
      <Box size={[0.5, 0.02, 0.36]} position={[0, -0.14, 0]} material={mat('plastic', '#275f9c')} cast={false} />
      <RBox size={[0.5, 0.3, 0.02]} radius={0.006} position={[0, 0, 0.17]} material={wall} />
      <RBox size={[0.5, 0.3, 0.02]} radius={0.006} position={[0, 0, -0.17]} material={wall} />
      <RBox size={[0.02, 0.3, 0.36]} radius={0.006} position={[0.24, 0, 0]} material={wall} />
      <RBox size={[0.02, 0.3, 0.36]} radius={0.006} position={[-0.24, 0, 0]} material={wall} />
    </group>
  );
}

/** 价格牌: the vegetable stall's chalk price board (faces +z). */
export function PriceBoardModel() {
  const tex = useMemo(() => priceBoardTexture([
    ['白菜', '两块一斤'],
    ['西红柿', '三块五一斤'],
    ['黄瓜', '四块一斤'],
    ['土豆', '两块五一斤'],
    ['胡萝卜', '三块一斤'],
    ['茄子', '五块一斤'],
  ], '今日菜价'), []);
  return (
    <group>
      <RBox size={[1.1, 0.7, 0.03]} radius={0.01} position={[0, 0, -0.005]} material={mat('wood', '#6b4426')} cast={false} />
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[1.02, 0.62]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** 买菜车: a shopping trolley — a tartan bag on a two-wheeled frame with a long handle. */
export function TrolleyModel() {
  const bag = mat('fabric', '#ffffff', { map: tartanTexture(), roughness: 0.9 });
  const frame = mat('metal', '#3d4247');
  return (
    <group>
      <Box size={[0.34, 0.02, 0.28]} position={[0, -0.29, 0]} material={mat('fabric', '#5a1a1e')} cast={false} />
      <RBox size={[0.34, 0.6, 0.02]} radius={0.008} position={[0, 0, 0.13]} material={bag} />
      <RBox size={[0.34, 0.6, 0.02]} radius={0.008} position={[0, 0, -0.13]} material={bag} />
      <RBox size={[0.02, 0.6, 0.28]} radius={0.008} position={[0.16, 0, 0]} material={bag} />
      <RBox size={[0.02, 0.6, 0.28]} radius={0.008} position={[-0.16, 0, 0]} material={bag} />
      <Rod from={[-0.14, -0.3, -0.16]} to={[-0.14, 0.62, -0.18]} r={0.009} material={frame} />
      <Rod from={[0.14, -0.3, -0.16]} to={[0.14, 0.62, -0.18]} r={0.009} material={frame} />
      <Rod from={[-0.15, 0.62, -0.18]} to={[0.15, 0.62, -0.18]} r={0.014} material={mat('rubber', '#222')} />
      <Cluster geometry={cylinder(0.065, 0.03, 14)} material={mat('rubber', '#ffffff')} items={[-1, 1].map((s) => ({ p: [s * 0.19, -0.255, -0.12], r: [0, 0, Math.PI / 2], c: '#202020' }) as Inst)} />
    </group>
  );
}
