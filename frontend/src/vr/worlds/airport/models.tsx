/**
 * The airport's object models (docs/VR_WORLDS.md "The contract"). Every model is drawn in its object's
 * own frame: the origin is the object's origin in index.tsx (the middle of its collider), +Z is its
 * front. All procedural — kit shapes, this folder's canvas textures (textures.ts) and instanced parts
 * (parts.tsx); nothing is loaded. Brands, airlines and logos are invented.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, TorusGeometry, type Group, type Mesh } from 'three';
import { Ball, Box, Cyl, Lathe, RBox, bottleProfile, cupProfile, mat, stripeTexture } from '../kit';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ModelProps } from '../types';
import { Inst, Static, boxGeo, cylGeo, useBeltDrive, useWeigher, type InstanceAt } from './parts';
import {
  beltTexture, boardingPassTexture, checkinScreenTexture, coverRowTexture, coverTexture, cupSleeveTexture, departuresTexture,
  fuselageTexture, gateNumberTexture, idCardTexture, luggageTagTexture, makeScaleDisplay, newspaperTexture,
  passportTexture, scanTexture, tailTexture, vendingHeaderTexture, vendingTexture, wayfindingTexture,
} from './textures';

const torusCache = new Map<string, TorusGeometry>();
function torus(r: number, tube: number, arc = Math.PI * 2, radial = 8, tubular = 24) {
  const k = `${r}:${tube}:${arc}:${radial}:${tubular}`;
  let g = torusCache.get(k);
  if (!g) {
    g = new TorusGeometry(r, tube, radial, tubular, arc);
    torusCache.set(k, g);
  }
  return g;
}

const basicCache = new Map<string, MeshBasicMaterial>();
/** An unlit material for screens and lit signs (a texture or a colour), shared per key. */
function screen(key: string, opts: { map?: MeshBasicMaterial['map']; color?: string; opacity?: number }): MeshBasicMaterial {
  let m = basicCache.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ map: opts.map ?? null, color: opts.color ?? '#ffffff', toneMapped: false, transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1 });
    basicCache.set(key, m);
  }
  return m;
}

/** A flat textured face (labels, covers, screens): a plane facing +Z. */
function Face({ size, material, position, rotation }: { size: [number, number]; material: MeshBasicMaterial | MeshStandardMaterial; position?: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <mesh position={position} rotation={rotation} material={material}>
      <planeGeometry args={size} />
    </mesh>
  );
}

const DARK = '#2b2f36';

// ── luggage ─────────────────────────────────────────────────────────────

function Spinners({ w, d, y, color = '#1d1f22' }: { w: number; d: number; y: number; color?: string }) {
  const at = useMemo<InstanceAt[]>(() => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => ({ p: [x * (w / 2 - 0.035), y, z * (d / 2 - 0.03)], r: [0, 0, Math.PI / 2] })), [w, d, y]);
  return <Inst geometry={cylGeo(0.022, 0.024, 10)} material={mat('rubber', color)} at={at} cast={false} />;
}

/** The big hard-shell suitcase (行李箱): ribbed shell, carry handle, telescopic handle, spinners, a bag tag. */
export function SuitcaseModel() {
  const shell = mat('plastic', '#1f6f78', { roughness: 0.32 });
  const rib = mat('plastic', '#1a5d65', { roughness: 0.3 });
  const ribs = useMemo<InstanceAt[]>(() => [-0.12, -0.04, 0.04, 0.12].flatMap((x) => [{ p: [x, 0.01, 0.137] as [number, number, number] }, { p: [x, 0.01, -0.137] as [number, number, number] }]), []);
  const tag = useMemo(() => mat('paper', '#ffffff', { map: luggageTagTexture() }), []);
  return (
    <Static>
      <RBox size={[0.44, 0.56, 0.27]} radius={0.04} segments={3} position={[0, 0.01, 0]} material={shell} />
      <Inst geometry={boxGeo(0.03, 0.5, 0.006)} material={rib} at={ribs} cast={false} />
      <Box size={[0.445, 0.02, 0.275]} position={[0, 0.01, 0]} material={mat('rubber', '#16191c')} cast={false} />
      {/* telescopic handle (retracted) + carry handle on top */}
      <Box size={[0.2, 0.025, 0.04]} position={[0, 0.283, -0.07]} material={mat('rubber', '#202326')} cast={false} />
      <RBox size={[0.14, 0.02, 0.03]} radius={0.008} position={[0, 0.29, 0.05]} material={mat('rubber', '#202326')} cast={false} />
      <Spinners w={0.44} d={0.27} y={-0.278} />
      {/* bag tag on a strap */}
      <Box size={[0.006, 0.06, 0.006]} position={[0.08, 0.265, 0.05]} material={mat('rubber', '#c9c9c9')} cast={false} />
      <mesh position={[0.08, 0.22, 0.142]} material={tag}>
        <planeGeometry args={[0.1, 0.05]} />
      </mesh>
    </Static>
  );
}

/** The small soft carry-on (also 行李箱): fabric, zip line, front pocket, handle. */
export function CarryOnModel() {
  const fabric = mat('fabric', '#7d2333');
  return (
    <Static>
      <RBox size={[0.36, 0.44, 0.23]} radius={0.05} segments={3} position={[0, 0.01, 0]} material={fabric} />
      <RBox size={[0.28, 0.26, 0.04]} radius={0.03} position={[0, -0.02, 0.12]} material={mat('fabric', '#6a1d2b')} cast={false} />
      <Box size={[0.24, 0.006, 0.006]} position={[0, 0.115, 0.142]} material={mat('steel')} cast={false} />
      <Box size={[0.37, 0.008, 0.236]} position={[0, 0.1, 0]} material={mat('rubber', '#2a2a2a')} cast={false} />
      <RBox size={[0.12, 0.02, 0.03]} radius={0.008} position={[0, 0.235, 0]} material={mat('rubber', '#202326')} cast={false} />
      <Spinners w={0.36} d={0.23} y={-0.218} />
    </Static>
  );
}

/** A backpack lying on its back (背包): rounded body, front pocket, straps underneath, a zip pull. */
export function BackpackModel() {
  const body = mat('fabric', '#2f4a6e');
  return (
    <Static>
      <RBox size={[0.32, 0.16, 0.44]} radius={0.06} segments={3} position={[0, -0.005, 0]} material={body} />
      <RBox size={[0.24, 0.05, 0.2]} radius={0.03} position={[0, 0.08, 0.08]} material={mat('fabric', '#26405f')} cast={false} />
      <RBox size={[0.06, 0.03, 0.12]} radius={0.01} position={[0, 0.07, -0.18]} material={mat('fabric', '#1d2f45')} cast={false} />
      {[-0.08, 0.08].map((x) => (
        <RBox key={x} size={[0.05, 0.015, 0.34]} radius={0.006} position={[x, -0.085, 0]} material={mat('fabric', '#1b1e24')} cast={false} />
      ))}
      <Box size={[0.012, 0.03, 0.006]} position={[0.1, 0.105, 0.18]} material={mat('chrome')} cast={false} />
    </Static>
  );
}

/** The luggage trolley (手推车): a deck on castors, a tall frame with a push bar at the back (−X). */
export function TrolleyModel() {
  const frame = mat('steel', '#c7ccd2', { roughness: 0.28 });
  const tube = cylGeo(0.016, 1, 10);
  const posts = useMemo<InstanceAt[]>(() => [
    { p: [-0.45, 0.07, -0.26], s: [1, 0.95, 1] }, { p: [-0.45, 0.07, 0.26], s: [1, 0.95, 1] },
    { p: [0.0, -0.385, -0.27], r: [0, 0, Math.PI / 2], s: [1, 0.92, 1] }, { p: [0.0, -0.385, 0.27], r: [0, 0, Math.PI / 2], s: [1, 0.92, 1] },
  ], []);
  const wheels = useMemo<InstanceAt[]>(() => [[-0.38, -0.25], [-0.38, 0.25], [0.38, -0.22], [0.38, 0.22]].map(([x, z]) => ({ p: [x, -0.405, z], r: [Math.PI / 2, 0, 0] })), []);
  return (
    <Static>
      {/* the deck: a slatted steel bed */}
      <RBox size={[0.95, 0.03, 0.58]} radius={0.01} position={[0, -0.32, 0]} material={mat('metal', '#8f979f', { roughness: 0.45 })} receive />
      <Inst geometry={tube} material={frame} at={posts} />
      {/* front lip, the push bar (a red grip) and the backrest mesh */}
      <Box size={[0.03, 0.14, 0.58]} position={[0.47, -0.25, 0]} material={frame} cast={false} />
      <Cyl r={0.02} h={0.6} rotation={[Math.PI / 2, 0, 0]} position={[-0.45, 0.54, 0]} material={mat('rubber', '#b8262c', { roughness: 0.6 })} cast={false} />
      <Box size={[0.012, 0.6, 0.5]} position={[-0.44, 0.12, 0]} material={mat('metal', '#a8b0b8', { opacity: 0.55, roughness: 0.4 })} cast={false} />
      <Box size={[0.012, 0.08, 0.5]} position={[-0.44, 0.35, 0]} material={mat('plastic', '#1e4fa3')} cast={false} />
      <Inst geometry={cylGeo(0.045, 0.035, 14)} material={mat('rubber', '#1b1b1b')} at={wheels} cast={false} />
    </Static>
  );
}

// ── documents and small things ──────────────────────────────────────────

export function PassportModel() {
  const cover = useMemo(() => mat('paper', '#ffffff', { map: passportTexture(), roughness: 0.6 }), []);
  return (
    <Static>
      <RBox size={[0.09, 0.012, 0.125]} radius={0.004} material={mat('paper', '#6e1420', { roughness: 0.6 })} />
      <Face size={[0.086, 0.12]} material={cover} position={[0, 0.0062, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <Box size={[0.084, 0.008, 0.119]} position={[0.003, 0, 0]} material={mat('paper', '#f4efe2')} cast={false} />
    </Static>
  );
}

export function BoardingPassModel() {
  const face = useMemo(() => mat('paper', '#ffffff', { map: boardingPassTexture() }), []);
  return (
    <Static>
      <Box size={[0.2, 0.004, 0.08]} material={mat('paper', '#fbfbf7')} cast={false} />
      <Face size={[0.2, 0.08]} material={face} position={[0, 0.0022, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    </Static>
  );
}

export function IdCardModel() {
  const face = useMemo(() => mat('plastic', '#ffffff', { map: idCardTexture(), roughness: 0.3 }), []);
  return (
    <Static>
      <RBox size={[0.0856, 0.004, 0.054]} radius={0.0018} material={mat('plastic', '#e6edf3', { roughness: 0.3 })} cast={false} />
      <Face size={[0.084, 0.052]} material={face} position={[0, 0.0022, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    </Static>
  );
}

/** A folded airport map leaflet. */
export function MapModel() {
  const face = useMemo(() => mat('paper', '#ffffff', { map: wayfindingTexture({ zh: '机场地图', en: 'Airport map', icon: 'plane', bg: '#e8f1fb', fg: '#1e4fa3', aspect: 1.4 }) }), []);
  return (
    <Static>
      <Box size={[0.21, 0.006, 0.15]} material={mat('paper', '#f2f6fb')} cast={false} />
      <Face size={[0.2, 0.14]} material={face} position={[0, 0.0032, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    </Static>
  );
}

/** A phone: black glass front, a lit screen, a camera bump. */
export function PhoneModel() {
  const glass = mat('plastic', '#0f1115', { roughness: 0.08 });
  return (
    <Static>
      <RBox size={[0.075, 0.009, 0.155]} radius={0.004} material={mat('metal', '#3d4249', { roughness: 0.3 })} />
      <Box size={[0.068, 0.001, 0.146]} position={[0, 0.0046, 0]} material={glass} cast={false} />
      <Box size={[0.062, 0.001, 0.13]} position={[0, 0.0052, 0.002]} material={screen('phone-screen', { color: '#2d5fa8' })} cast={false} />
      <RBox size={[0.03, 0.004, 0.03]} radius={0.004} position={[-0.015, -0.006, -0.05]} material={glass} cast={false} />
    </Static>
  );
}

/** A bunch of keys on a ring with a little tag. */
export function KeysModel() {
  const metal = mat('metal', '#c9b37a', { roughness: 0.3 });
  const steel = mat('steel', '#cfd4d9', { roughness: 0.25 });
  return (
    <Static>
      <mesh geometry={torus(0.014, 0.002, Math.PI * 2, 6, 18)} rotation={[Math.PI / 2, 0, 0]} position={[-0.03, 0, 0]} material={steel} />
      {[[0.02, -0.01, 0.15, metal], [0.018, 0.012, -0.25, steel]].map(([x, z, r, m], i) => (
        <group key={i} position={[x as number, 0, z as number]} rotation={[0, r as number, 0]}>
          <Box size={[0.045, 0.003, 0.012]} position={[0.005, 0, 0]} material={m as MeshStandardMaterial} cast={false} />
          <Cyl r={0.011} h={0.004} position={[-0.022, 0, 0]} material={m as MeshStandardMaterial} segments={12} cast={false} />
        </group>
      ))}
      <RBox size={[0.025, 0.006, 0.035]} radius={0.003} position={[-0.035, -0.002, 0.012]} material={mat('plastic', '#e0503b')} cast={false} />
    </Static>
  );
}

/** A leather wallet, folded, with a stitched edge and a card peeking out. */
export function WalletModel() {
  return (
    <Static>
      <RBox size={[0.11, 0.022, 0.09]} radius={0.008} material={mat('fabric', '#5b3520', { roughness: 0.55 })} />
      <Box size={[0.08, 0.003, 0.05]} position={[0.02, 0.012, 0]} material={mat('plastic', '#d8a93a')} cast={false} />
      <Box size={[0.112, 0.002, 0.004]} position={[0, 0.011, 0.04]} material={mat('fabric', '#c79b6d')} cast={false} />
    </Static>
  );
}

/** A leather belt rolled up, its buckle on top. */
export function BeltModel() {
  return (
    <Static>
      <Cyl r={0.062} h={0.035} material={mat('fabric', '#2a1c14', { roughness: 0.5 })} segments={20} />
      <Cyl r={0.03} h={0.036} material={mat('fabric', '#3a271b')} segments={14} cast={false} />
      <RBox size={[0.05, 0.006, 0.04]} radius={0.004} position={[0.05, 0.02, 0]} material={mat('chrome')} cast={false} />
    </Static>
  );
}

/** Folded over-ear headphones. */
export function HeadphonesModel() {
  const plastic = mat('plastic', '#e9e9ec', { roughness: 0.35 });
  return (
    <Static>
      <mesh geometry={torus(0.075, 0.009, Math.PI, 8, 20)} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, -0.01]} material={plastic} />
      {[-0.075, 0.075].map((x) => (
        <group key={x} position={[x, -0.005, 0.01]}>
          <Cyl r={0.045} h={0.03} material={plastic} segments={20} cast={false} />
          <Cyl r={0.038} h={0.012} position={[0, -0.018, 0]} material={mat('fabric', '#3a3d42')} segments={18} cast={false} />
        </group>
      ))}
    </Static>
  );
}

/** A plastic water bottle with a blue cap and a label. */
export function WaterBottleModel() {
  const label = useMemo(() => wayfindingTexture({ zh: '矿泉水', en: 'Mineral water', bg: '#e8f6ff', fg: '#1d6fb8', aspect: 3 }), []);
  return (
    <Static>
      <Cyl r={0.031} h={0.13} position={[0, -0.035, 0]} material={mat('liquid', '#cdeaf7', { opacity: 0.5 })} cast={false} />
      <Lathe profile={bottleProfile(0.035, 0.22, 0.013)} material={mat('glass', '#e8f6ff', { opacity: 0.35 })} />
      <Cyl r={0.0356} h={0.05} position={[0, -0.02, 0]} open material={mat('paper', '#ffffff', { map: label, doubleSide: true })} cast={false} segments={20} />
      <Cyl r={0.015} h={0.02} position={[0, 0.115, 0]} material={mat('plastic', '#2a6fd6')} segments={12} cast={false} />
    </Static>
  );
}

/** A grey security tray (托盘): a shallow open box with a lip. */
export function TrayModel() {
  const grey = mat('plastic', '#8a9199', { roughness: 0.5 });
  const dark = mat('plastic', '#757c84', { roughness: 0.55 });
  return (
    <Static>
      <Box size={[0.56, 0.012, 0.4]} position={[0, -0.034, 0]} material={dark} receive cast={false} />
      <Box size={[0.56, 0.08, 0.012]} position={[0, 0, 0.194]} material={grey} />
      <Box size={[0.56, 0.08, 0.012]} position={[0, 0, -0.194]} material={grey} cast={false} />
      <Box size={[0.012, 0.08, 0.4]} position={[0.274, 0, 0]} material={grey} />
      <Box size={[0.012, 0.08, 0.4]} position={[-0.274, 0, 0]} material={grey} cast={false} />
      <Box size={[0.58, 0.008, 0.42]} position={[0, 0.038, 0]} material={grey} cast={false} />
    </Static>
  );
}

/** A paper coffee cup with a lid and a kraft sleeve. */
export function CoffeeModel() {
  const sleeve = useMemo(() => mat('paper', '#ffffff', { map: cupSleeveTexture(), doubleSide: true }), []);
  return (
    <Static>
      <Lathe profile={cupProfile(0.04, 0.1, 0.003, 0.75)} position={[0, -0.005, 0]} material={mat('paper', '#fbf8f2', { doubleSide: true })} segments={20} />
      <Cyl r={0.036} rTop={0.039} h={0.045} position={[0, -0.005, 0]} open material={sleeve} segments={20} cast={false} />
      <Cyl r={0.042} rTop={0.036} h={0.012} position={[0, 0.05, 0]} material={mat('plastic', '#2a2522', { roughness: 0.4 })} segments={20} cast={false} />
    </Static>
  );
}

/** A triangle sandwich in a clear pack. */
export function SandwichModel() {
  return (
    <Static>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <Cyl r={0.065} h={0.04} segments={3} rotation={[0, 0, 0]} material={mat('food', '#e9d3a6', { roughness: 0.8 })} cast={false} />
      </group>
      <Box size={[0.13, 0.008, 0.008]} position={[0.0, 0.0, 0.0]} material={mat('leaf', '#5f9e3f')} cast={false} />
      <Box size={[0.14, 0.05, 0.1]} material={mat('glass', '#ffffff', { opacity: 0.18 })} />
    </Static>
  );
}

/** A can of cola (generic: red with a white wave, no brand). */
export function ColaModel() {
  const label = useMemo(() => stripeTexture('#c4161c', '#ffffff', 6), []);
  return (
    <Static>
      <Cyl r={0.033} h={0.11} material={mat('metal', '#ffffff', { map: label, metalness: 0.4, roughness: 0.3 })} segments={20} />
      <Cyl r={0.029} rTop={0.026} h={0.012} position={[0, 0.061, 0]} material={mat('steel')} segments={16} cast={false} />
      <Cyl r={0.029} h={0.006} position={[0, -0.058, 0]} material={mat('steel')} segments={16} cast={false} />
    </Static>
  );
}

export function MagazineModel() {
  const cover = useMemo(() => mat('paper', '#ffffff', { map: coverTexture(0), roughness: 0.4 }), []);
  return (
    <Static>
      <Box size={[0.21, 0.01, 0.28]} material={mat('paper', '#f6f3ee')} />
      <Face size={[0.21, 0.28]} material={cover} position={[0, 0.0052, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    </Static>
  );
}

export function NewspaperModel() {
  const front = useMemo(() => mat('paper', '#ffffff', { map: newspaperTexture() }), []);
  return (
    <Static>
      <Box size={[0.28, 0.014, 0.21]} material={mat('paper', '#ebe6da')} />
      <Face size={[0.21, 0.27]} material={front} position={[0, 0.0072, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} />
    </Static>
  );
}

/** A U-shaped neck pillow (颈枕). */
export function NeckPillowModel() {
  return (
    <Static>
      <mesh geometry={torus(0.08, 0.045, Math.PI * 1.45, 10, 22)} rotation={[-Math.PI / 2, 0, -Math.PI * 0.225 + Math.PI / 2]} position={[0, -0.0, 0.01]} material={mat('fabric', '#e0a33a')} castShadow />
      <Box size={[0.03, 0.03, 0.01]} position={[0, 0.01, 0.12]} material={mat('fabric', '#b47a20')} cast={false} />
    </Static>
  );
}

/** A folded umbrella lying down: canopy wrapped round the shaft, a hooked handle. */
export function UmbrellaModel() {
  const hook = useMemo(() => torus(0.03, 0.008, Math.PI, 6, 12), []);
  return (
    <Static>
      <Cyl r={0.032} rTop={0.012} h={0.6} rotation={[0, 0, -Math.PI / 2]} position={[0.08, 0, 0]} material={mat('fabric', '#1f2c4f')} segments={10} />
      <Cyl r={0.005} h={0.12} rotation={[0, 0, -Math.PI / 2]} position={[0.42, 0, 0]} material={mat('steel')} segments={6} cast={false} />
      <Cyl r={0.011} h={0.14} rotation={[0, 0, -Math.PI / 2]} position={[-0.29, 0, 0]} material={mat('wood', '#5a3a22')} segments={8} cast={false} />
      <mesh geometry={hook} position={[-0.36, 0.0, 0.0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} material={mat('wood', '#5a3a22')} castShadow />
      <Box size={[0.03, 0.004, 0.02]} position={[0.0, 0.03, 0]} material={mat('fabric', '#18223d')} cast={false} />
    </Static>
  );
}

/** A desk bell: a chrome dome on a black base. */
export function BellModel() {
  return (
    <Static>
      <Cyl r={0.045} h={0.014} position={[0, -0.023, 0]} material={mat('plastic', '#1b1b1b', { roughness: 0.3 })} segments={20} cast={false} />
      <Ball r={0.038} scale={[1, 0.75, 1]} position={[0, -0.012, 0]} material={mat('chrome')} segments={18} />
      <Cyl r={0.004} h={0.018} position={[0, 0.022, 0]} material={mat('chrome')} segments={8} cast={false} />
      <Ball r={0.007} position={[0, 0.031, 0]} material={mat('chrome')} segments={8} cast={false} />
    </Static>
  );
}

/** The yellow A-frame "caution: wet floor" sign (警示牌). */
export function WetFloorSignModel() {
  const face = useMemo(() => mat('plastic', '#ffffff', { map: wayfindingTexture({ zh: '小心地滑', en: 'Caution · wet floor', icon: 'none', bg: '#ffd24a', fg: '#1a1a1a', aspect: 0.75 }), roughness: 0.4 }), []);
  const body = mat('plastic', '#ffcf2e', { roughness: 0.4 });
  return (
    <Static>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * 0.055]} rotation={[s * 0.18, 0, 0]}>
          <RBox size={[0.3, 0.6, 0.012]} radius={0.005} material={body} />
          <Face size={[0.24, 0.32]} material={face} position={[0, 0.06, s * 0.007]} rotation={[0, s > 0 ? 0 : Math.PI, 0]} />
        </group>
      ))}
      <Box size={[0.06, 0.04, 0.03]} position={[0, 0.29, 0]} material={body} cast={false} />
    </Static>
  );
}

// ── check-in ────────────────────────────────────────────────────────────

/** The check-in counter (柜台): passenger side at +Z — a wood-faced desk, a raised ledge, a staff screen. */
export function CounterModel() {
  const screenMat = useMemo(() => screen('checkin-screen', { map: checkinScreenTexture() }), []);
  const front = mat('wood', '#c49464', { repeat: [2, 1] });
  return (
    <Static>
      <Box size={[1.7, 0.9, 0.6]} position={[0, -0.07, -0.04]} material={mat('painted', '#eef0f2')} receive />
      <Box size={[1.7, 1.0, 0.04]} position={[0, -0.025, 0.33]} material={front} cast={false} />
      <Box size={[1.72, 0.05, 0.12]} position={[0, 0.5, 0.29]} material={mat('stone', '#e6e2da', { roughness: 0.35 })} receive cast={false} />
      <Box size={[1.7, 0.04, 0.62]} position={[0, 0.505, -0.02]} material={mat('stone', '#d9d4cb', { roughness: 0.35 })} receive cast={false} />
      <Box size={[1.72, 0.06, 0.06]} position={[0, -0.495, 0.33]} material={mat('rubber', '#2a2d31')} cast={false} />
      {/* the counter number + airline strip on the front */}
      <Box size={[1.7, 0.08, 0.005]} position={[0, 0.3, 0.352]} material={mat('plastic', '#1e4fa3')} cast={false} />
      {/* the staff monitor, turned to the agent's side */}
      <group position={[0.4, 0.68, -0.1]} rotation={[0, Math.PI, 0]}>
        <RBox size={[0.42, 0.28, 0.03]} radius={0.01} material={mat('plastic', DARK)} cast={false} />
        <Box size={[0.38, 0.24, 0.002]} position={[0, 0, 0.016]} material={screen('staff-screen', { color: '#3d7fd9' })} cast={false} />
        <Box size={[0.04, 0.16, 0.04]} position={[0, -0.2, -0.02]} material={mat('plastic', DARK)} cast={false} />
      </group>
      {/* a bag-tag printer and a boarding-pass reader on the ledge */}
      <RBox size={[0.18, 0.1, 0.16]} radius={0.01} position={[-0.45, 0.58, -0.12]} material={mat('plastic', '#e9ecef')} cast={false} />
      <RBox size={[0.12, 0.04, 0.1]} radius={0.008} position={[-0.6, 0.545, 0.25]} material={mat('plastic', '#1b1b1b')} cast={false} />
      <Box size={[0.08, 0.004, 0.06]} position={[-0.6, 0.567, 0.25]} material={screen('reader-glow', { color: '#3ce07a' })} cast={false} />
      {/* the airline screen on a post */}
      <Box size={[0.05, 0.9, 0.05]} position={[-0.7, 0.95, -0.25]} material={mat('steel')} cast={false} />
      <group position={[-0.7, 1.45, -0.25]} rotation={[0, 0, 0]}>
        <RBox size={[0.7, 0.28, 0.04]} radius={0.01} material={mat('plastic', DARK)} cast={false} />
        <Face size={[0.66, 0.24]} material={screenMat} position={[0, 0, 0.021]} />
      </group>
    </Static>
  );
}

/** The luggage scale (秤): a low steel platform with a ribbed rubber pan and an LED read-out on a post. It weighs what lies on it. */
export function ScaleModel() {
  const ref = useRef<Group>(null);
  const display = useMemo(() => makeScaleDisplay(), []);
  const displayMat = useMemo(() => new MeshBasicMaterial({ map: display.texture, toneMapped: false }), [display]);
  useWeigher(ref, { centre: [0, 0.15, 0], size: [0.75, 0.62] }, (kg) => display.show(kg));
  const ribs = useMemo<InstanceAt[]>(() => Array.from({ length: 12 }, (_, i) => ({ p: [-0.33 + i * 0.06, 0.152, 0] })), []);
  return (
    <group ref={ref}>
      <Static>
      <RBox size={[0.75, 0.28, 0.62]} radius={0.015} position={[0, -0.01, 0]} material={mat('steel', '#a9b1b9', { roughness: 0.4 })} />
      <Box size={[0.71, 0.012, 0.58]} position={[0, 0.142, 0]} material={mat('rubber', '#202225')} receive cast={false} />
      <Inst geometry={boxGeo(0.02, 0.006, 0.56)} material={mat('rubber', '#2c2f33')} at={ribs} cast={false} />
      {/* the read-out on a post at the passenger's side */}
      <Box size={[0.04, 0.85, 0.04]} position={[0.42, 0.3, 0.27]} material={mat('steel')} cast={false} />
      <group position={[0.42, 0.78, 0.3]} rotation={[-0.25, 0, 0]}>
        <RBox size={[0.24, 0.11, 0.05]} radius={0.01} material={mat('plastic', DARK)} cast={false} />
        <mesh position={[0, 0, 0.026]} material={displayMat}>
          <planeGeometry args={[0.2, 0.075]} />
        </mesh>
      </group>
      </Static>
    </group>
  );
}

/** A belt surface whose texture scrolls while it runs. */
function MovingBelt({ size, running, speed, position }: { size: [number, number]; running: boolean; speed: number; position: [number, number, number] }) {
  const material = useMemo(() => {
    const t = beltTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(1, size[0] / 0.25);
    return new MeshStandardMaterial({ map: t, roughness: 0.85 });
  }, [size]);
  useFrame((_, dt) => {
    if (running && material.map) material.map.offset.y -= (dt * speed) / 0.25;
  });
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} material={material} receiveShadow>
      <planeGeometry args={[size[1], size[0]]} />
    </mesh>
  );
}

/** The check-in conveyor (传送带): runs along +X to a rubber-curtain portal; carries bags while on. */
export function ConveyorModel({ states }: ModelProps) {
  const ref = useRef<Group>(null);
  const on = states.belt === 'on';
  useBeltDrive(ref, on, { centre: [0, 0.15, 0], length: 3.9, width: 0.56, speed: 0.45, stopBefore: 0.32 });
  const lamp = useRef<Mesh>(null);
  const side = mat('steel', '#9aa3ac', { roughness: 0.4 });
  const flaps = useMemo<InstanceAt[]>(() => Array.from({ length: 7 }, (_, i) => ({ p: [1.9, 0.42, -0.24 + i * 0.08] })), []);
  useFrame(({ clock }) => {
    if (lamp.current) (lamp.current.material as MeshBasicMaterial).color.set(on ? (Math.sin(clock.elapsedTime * 6) > 0 ? '#ffb020' : '#6a4a10') : '#3a3a3a');
  });
  return (
    <group ref={ref}>
      <MovingBelt size={[3.9, 0.52]} running={on} speed={0.45} position={[0, 0.151, 0]} />
      <Static>
      <Box size={[3.9, 0.26, 0.5]} position={[0, -0.02, 0]} material={side} />
      <Box size={[3.9, 0.08, 0.04]} position={[0, 0.19, -0.3]} material={side} cast={false} />
      <Box size={[3.9, 0.03, 0.03]} position={[0, 0.15, 0.28]} material={side} cast={false} />
      <Box size={[0.06, 0.16, 0.56]} position={[1.98, 0.15, 0]} material={mat('rubber', '#1d1f22')} cast={false} />
      {/* the portal over the end: two posts, a header, rubber strips */}
      {[-0.34, 0.34].map((z) => <Box key={z} size={[0.08, 0.95, 0.06]} position={[1.9, 0.33, z]} material={mat('painted', '#d9dde2')} cast={false} />)}
      <Box size={[0.12, 0.16, 0.8]} position={[1.9, 0.86, 0]} material={mat('painted', '#d9dde2')} cast={false} />
      <Inst geometry={boxGeo(0.01, 0.5, 0.075)} material={mat('rubber', '#2a2d30', { roughness: 0.7 })} at={flaps} cast={false} />
      </Static>
      <mesh ref={lamp} position={[1.9, 0.98, 0]}>
        <sphereGeometry args={[0.045, 12, 8]} />
        <meshBasicMaterial color="#3a3a3a" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ── the hall ────────────────────────────────────────────────────────────

/** The departures board (显示屏): a lit screen in a housing, hung from the ceiling on two rods. */
export function BoardModel() {
  const face = useMemo(() => screen('dep-board', { map: departuresTexture() }), []);
  const housing = mat('painted', '#3a3f47', { roughness: 0.4 });
  return (
    <Static>
      <RBox size={[3.0, 1.35, 0.16]} radius={0.03} material={housing} />
      <Face size={[2.86, 1.23]} material={face} position={[0, 0, 0.082]} />
      <Face size={[2.86, 1.23]} material={face} position={[0, 0, -0.082]} rotation={[0, Math.PI, 0]} />
      {[-1.1, 1.1].map((x) => <Box key={x} size={[0.04, 1.1, 0.04]} position={[x, 1.22, 0]} material={mat('steel')} cast={false} />)}
    </Static>
  );
}

/** The gate sign (登机口): a double-sided yellow board with a huge 12. */
export function GateSignModel() {
  const face = useMemo(() => screen('gate-number', { map: gateNumberTexture() }), []);
  return (
    <Static>
      <RBox size={[1.0, 0.56, 0.1]} radius={0.015} material={mat('painted', '#20242b')} cast={false} />
      <Face size={[0.94, 0.52]} material={face} position={[0, 0, 0.052]} />
      <Face size={[0.94, 0.52]} material={face} position={[0, 0, -0.052]} rotation={[0, Math.PI, 0]} />
    </Static>
  );
}

/** A lit wayfinding sign as an object (洗手间 / 出口 / 行李提取). */
export function SignBoard({ zh, en, icon, arrow, size, bg, fg }: { zh: string; en: string; icon: Parameters<typeof wayfindingTexture>[0]['icon']; arrow?: '←' | '→' | '↑' | ''; size: [number, number]; bg?: string; fg?: string }) {
  const face = useMemo(() => screen(`way:${zh}:${bg}`, { map: wayfindingTexture({ zh, en, icon, arrow, bg, fg, aspect: size[0] / size[1] }) }), [zh, en, icon, arrow, bg, fg, size]);
  return (
    <Static>
      <RBox size={[size[0] + 0.04, size[1] + 0.04, 0.06]} radius={0.01} material={mat('painted', '#1d2026')} cast={false} />
      <Face size={size} material={face} position={[0, 0, 0.032]} />
      <Face size={size} material={face} position={[0, 0, -0.032]} rotation={[0, Math.PI, 0]} />
    </Static>
  );
}
export const ToiletSignModel = () => <SignBoard zh="洗手间" en="Toilets" icon="wc" arrow="" size={[1.06, 0.32]} />;
export const ExitSignModel = () => <SignBoard zh="出口" en="Exit" icon="exit" arrow="" size={[0.96, 0.28]} bg="#11804a" fg="#ffffff" />;
export const BaggageSignModel = () => <SignBoard zh="行李提取" en="Baggage claim" icon="baggage" arrow="→" size={[1.46, 0.34]} />;

/** The x-ray scanner (安检机): roller tables, a tunnel with lead curtains, a running belt, a monitor. */
export function XrayModel({ states }: ModelProps) {
  const ref = useRef<Group>(null);
  const on = states.power === 'on';
  useBeltDrive(ref, on, { centre: [0.45, -0.02, 0], length: 2.3, width: 0.7, speed: 0.3, stopBefore: 0.32, height: 0.5 });
  const shell = mat('painted', '#dfe3e7', { roughness: 0.35 });
  const trim = mat('painted', '#2d6cc4', { roughness: 0.4 });
  const roller = mat('steel', '#c5ccd3', { roughness: 0.25 });
  const rollers = useMemo<InstanceAt[]>(() => Array.from({ length: 13 }, (_, i) => ({ p: [-1.62 + i * 0.072, -0.035, 0], r: [Math.PI / 2, 0, 0] })), []);
  const curtains = useMemo<InstanceAt[]>(() => [-0.72, 0.72].flatMap((x) => Array.from({ length: 9 }, (_, i) => ({ p: [x, 0.36, -0.36 + i * 0.09] as [number, number, number] }))), []);
  const scan = useMemo(() => screen('xray-scan', { map: scanTexture() }), []);
  const off = screen('screen-off', { color: '#101418' });
  const light = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const l = light.current;
    if (l) (l.material as MeshBasicMaterial).color.set(on ? (Math.sin(clock.elapsedTime * 3) > -0.2 ? '#38e070' : '#1d6e3a') : '#5a1a1a');
  });
  return (
    <group ref={ref}>
      <MovingBelt size={[2.3, 0.66]} running={on} speed={0.3} position={[0.45, -0.019, 0]} />
      <mesh ref={light} position={[0.55, 0.93, 0.3]}>
        <cylinderGeometry args={[0.04, 0.04, 0.07, 12]} />
        <meshBasicMaterial color="#38e070" toneMapped={false} />
      </mesh>
      <Face size={[0.46, 0.29]} material={on ? scan : off} position={[0.95 + Math.sin(0.5) * 0.021, 0.85, -0.62 + Math.cos(0.5) * 0.021]} rotation={[0, 0.5, 0]} />
      <Static>
      {/* base cabinets under the tables and the tunnel */}
      <Box size={[0.93, 0.7, 0.62]} position={[-1.185, -0.42, 0]} material={shell} />
      <Box size={[0.9, 0.7, 0.62]} position={[1.17, -0.42, 0]} material={shell} />
      <Box size={[3.3, 0.08, 0.66]} position={[-0.015, -0.76, 0]} material={mat('rubber', '#2a2d31')} cast={false} />
      {/* the tunnel housing: walls, roof, the blue band */}
      <Box size={[1.44, 1.52, 0.1]} position={[0, -0.06, -0.45]} material={shell} />
      <Box size={[1.44, 1.52, 0.1]} position={[0, -0.06, 0.45]} material={shell} />
      <Box size={[1.44, 0.2, 1.0]} position={[0, 0.8, 0]} material={shell} />
      <Box size={[1.46, 0.08, 1.02]} position={[0, 0.66, 0]} material={trim} cast={false} />
      <Box size={[1.36, 0.68, 0.7]} position={[0, -0.4, 0]} material={mat('painted', '#c9ced3')} cast={false} />
      {/* rollers on the entrance table, the belt from the tunnel to the exit */}
      <Inst geometry={cylGeo(0.022, 0.64, 10)} material={roller} at={rollers} cast={false} />
      <Box size={[2.3, 0.04, 0.66]} position={[0.45, -0.042, 0]} material={mat('rubber', '#1e2023')} cast={false} />
      {[-1.185, 1.17].flatMap((x) => [-0.35, 0.35].map((z) => <Box key={`${x}:${z}`} size={[0.92, 0.05, 0.03]} position={[x, 0.005, z]} material={mat('steel', '#aab2ba')} cast={false} />))}
      <Box size={[0.05, 0.12, 0.7]} position={[1.66, 0.04, 0]} material={mat('rubber', '#1d1f22')} cast={false} />
      <Inst geometry={boxGeo(0.008, 0.66, 0.085)} material={mat('rubber', '#3b3a36', { opacity: 0.92, roughness: 0.8 })} at={curtains} cast={false} />
      {/* warning label + the status light on the roof */}
      <Face size={[0.5, 0.14]} material={screen('xray-label', { map: wayfindingTexture({ zh: 'X光安检', en: 'X-ray screening', icon: 'security', bg: '#2d6cc4', fg: '#ffffff', aspect: 3.5 }) })} position={[0, 0.45, 0.502]} />
      {/* the operator's monitor beside the exit */}
      <Box size={[0.05, 0.75, 0.05]} position={[0.95, 0.35, -0.62]} material={mat('steel')} cast={false} />
      <group position={[0.95, 0.85, -0.62]} rotation={[0, 0.5, 0]}>
        <RBox size={[0.5, 0.34, 0.04]} radius={0.01} material={mat('plastic', DARK)} cast={false} />
      </group>
      </Static>
    </group>
  );
}

/** The walk-through metal detector (安检门): two pillars with LED strips, a header with a light. */
export function DetectorModel() {
  const panel = mat('painted', '#e9e4d8', { roughness: 0.4 });
  const leds = useMemo<InstanceAt[]>(() => [-0.43, 0.43].flatMap((x) => Array.from({ length: 10 }, (_, i) => ({ p: [x, -0.95 + i * 0.19, 0.18] as [number, number, number] }))), []);
  return (
    <Static>
      {[-0.5, 0.5].map((x) => <RBox key={x} size={[0.14, 2.2, 0.55]} radius={0.02} position={[x, 0, 0]} material={panel} cast={false} />)}
      <RBox size={[1.14, 0.18, 0.55]} radius={0.02} position={[0, 1.01, 0]} material={panel} cast={false} />
      <Box size={[1.0, 0.1, 0.005]} position={[0, 1.01, 0.278]} material={mat('plastic', '#2d6cc4')} cast={false} />
      <Inst geometry={boxGeo(0.006, 0.12, 0.03)} material={screen('detector-led', { color: '#4ce38a' })} at={leds} cast={false} />
      <mesh position={[0, 1.13, 0]}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshBasicMaterial color="#4ce38a" toneMapped={false} />
      </mesh>
      {[-0.5, 0.5].map((x) => <Box key={`f${x}`} size={[0.2, 0.03, 0.6]} position={[x, -1.085, 0]} material={mat('rubber', '#2a2d31')} cast={false} />)}
    </Static>
  );
}

/** A square stainless bin with a top opening and a 垃圾 label. */
export function BinModel() {
  const steel = mat('steel', '#a6aeb6', { roughness: 0.35 });
  const label = useMemo(() => mat('paper', '#ffffff', { map: wayfindingTexture({ zh: '其他垃圾', en: 'Other waste', bg: '#3a3f47', fg: '#ffffff', aspect: 2.2 }) }), []);
  return (
    <Static>
      <Box size={[0.4, 0.02, 0.4]} position={[0, -0.37, 0]} material={steel} cast={false} />
      <Box size={[0.4, 0.76, 0.02]} position={[0, 0.0, 0.19]} material={steel} />
      <Box size={[0.4, 0.76, 0.02]} position={[0, 0.0, -0.19]} material={steel} cast={false} />
      <Box size={[0.02, 0.76, 0.4]} position={[0.19, 0.0, 0]} material={steel} />
      <Box size={[0.02, 0.76, 0.4]} position={[-0.19, 0.0, 0]} material={steel} cast={false} />
      <Box size={[0.36, 0.01, 0.36]} position={[0, -0.355, 0]} material={mat('plastic', '#2a2d31')} cast={false} />
      <Face size={[0.3, 0.14]} material={label} position={[0, 0.2, 0.202]} />
    </Static>
  );
}

/** A row of four beam seats (座位): the seats face −Z (the window), the backs are at +Z. */
export function SeatsModel() {
  const leather = mat('fabric', '#2b3038', { roughness: 0.6 });
  const shellMat = mat('steel', '#b9c0c8', { roughness: 0.35 });
  const seats = useMemo<InstanceAt[]>(() => [-0.9, -0.3, 0.3, 0.9].map((x) => ({ p: [x, 0.01, 0] })), []);
  const backs = useMemo<InstanceAt[]>(() => [-0.9, -0.3, 0.3, 0.9].map((x) => ({ p: [x, 0.3, 0.27], r: [-0.12, 0, 0] })), []);
  const seatBack = useMemo(() => new RoundedBoxGeometry(0.54, 0.5, 0.07, 2, 0.03), []);
  const backTrims = useMemo<InstanceAt[]>(() => [-0.9, -0.3, 0.3, 0.9].map((x) => ({ p: [x, 0.56, 0.3], r: [-0.12, 0, 0] })), []);
  const arms = useMemo<InstanceAt[]>(() => [-1.2, -0.6, 0, 0.6, 1.2].map((x) => ({ p: [x, 0.17, -0.02] })), []);
  const legs = useMemo<InstanceAt[]>(() => [-1.0, 1.0].map((x) => ({ p: [x, -0.24, 0] })), []);
  return (
    <Static>
      <Inst geometry={boxGeo(0.56, 0.07, 0.48)} material={leather} at={seats} receive />
      <Inst geometry={seatBack} material={leather} at={backs} />
      <Inst geometry={boxGeo(0.5, 0.025, 0.03)} material={shellMat} at={backTrims} cast={false} />
      <Inst geometry={boxGeo(0.05, 0.05, 0.46)} material={shellMat} at={arms} cast={false} />
      <Box size={[2.4, 0.06, 0.1]} position={[0, -0.08, 0.05]} material={shellMat} cast={false} />
      <Inst geometry={boxGeo(0.08, 0.38, 0.4)} material={shellMat} at={legs} cast={false} />
    </Static>
  );
}

/** The airliner outside (飞机): fuselage along X (nose at +X), wings, engines, tail with the invented lark, gear. */
export function PlaneModel() {
  const white = mat('painted', '#f4f6f8', { roughness: 0.35, metalness: 0.15 });
  const belly = mat('painted', '#1e4fa3', { roughness: 0.4 });
  const grey = mat('metal', '#9aa3ac', { roughness: 0.4 });
  const band = useMemo(() => screen('fuselage', { map: fuselageTexture() }), []);
  // The livery band: a strip wrapped round the +Z side of the fuselage (u along the plane, v up).
  const bandGeometry = useMemo(() => {
    const g = new PlaneGeometry(24, 1.3, 1, 8);
    const p = g.attributes.position;
    const r = 2.015;
    for (let i = 0; i < p.count; i++) {
      const a = (p.getY(i) + 0.55) / r;
      p.setXYZ(i, p.getX(i), Math.sin(a) * r, Math.cos(a) * r);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const tail = useMemo(() => new MeshStandardMaterial({ map: tailTexture(), roughness: 0.4, side: DoubleSide }), []);
  return (
    <Static>
      <Cyl r={2.0} h={24} rotation={[0, 0, Math.PI / 2]} material={white} segments={32} cast={false} />
      <Cyl r={2.02} h={24} rotation={[0, 0, Math.PI / 2]} position={[0, -0.9, 0]} scale={[1, 1, 0.82]} material={belly} segments={32} cast={false} />
      <Ball r={2.0} scale={[1.8, 1, 1]} position={[12, 0, 0]} material={white} segments={28} cast={false} />
      <Cyl r={2.0} rTop={0.45} h={6} rotation={[0, 0, Math.PI / 2 + 0.06]} position={[-14.8, 0.35, 0]} material={white} segments={28} cast={false} />
      <mesh geometry={bandGeometry} material={band} />
      {/* wings (swept), engines */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box size={[4.2, 0.35, 11]} position={[-1.2, -1.1, s * 7.2]} rotation={[0, s * 0.42, s * -0.05]} material={white} cast={false} />
          <group position={[1.2, -2.0, s * 5.2]}>
            <Cyl r={0.95} h={3.2} rotation={[0, 0, Math.PI / 2]} material={grey} segments={24} cast={false} />
            <Cyl r={0.7} h={0.05} rotation={[0, 0, Math.PI / 2]} position={[1.62, 0, 0]} material={mat('metal', '#2a2d31')} segments={20} cast={false} />
            <Box size={[1.2, 0.8, 0.25]} position={[-0.8, 0.8, 0]} material={grey} cast={false} />
          </group>
          <Box size={[2.2, 0.2, 4.6]} position={[-15.2, 1.4, s * 2.6]} rotation={[0, s * 0.45, 0]} material={white} cast={false} />
        </group>
      ))}
      {/* the tail fin with the livery on both faces */}
      <group position={[-15.0, 3.4, 0]} rotation={[0, 0, 0.5]}>
        <Box size={[3.4, 4.6, 0.3]} material={white} cast={false} />
        <Face size={[3.3, 4.5]} material={tail} position={[0, 0, 0.16]} />
        <Face size={[3.3, 4.5]} material={tail} position={[0, 0, -0.16]} rotation={[0, Math.PI, 0]} />
      </group>
      {/* landing gear */}
      {[[9.5, 0], [-2.5, 1.6], [-2.5, -1.6]].map(([x, z]) => (
        <group key={`${x}:${z}`} position={[x, -2.0, z]}>
          <Box size={[0.2, 0.9, 0.2]} material={grey} cast={false} />
          <Cyl r={0.42} h={0.5} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.78, 0]} material={mat('rubber', '#1b1b1b')} segments={18} cast={false} />
        </group>
      ))}
    </Static>
  );
}

// ── the café, the shops ─────────────────────────────────────────────────

/** The café's bar counter (吧台): wood slat front, stone top, a pastry case and a till. */
export function CafeCounterModel() {
  const slats = useMemo<InstanceAt[]>(() => Array.from({ length: 22 }, (_, i) => ({ p: [-0.97 + i * 0.0925, -0.04, 0.3] })), []);
  const signFace = useMemo(() => screen('cafe-sign', { map: wayfindingTexture({ zh: '豆香咖啡', en: 'Bean & Aroma Café', icon: 'coffee', bg: '#2a211c', fg: '#f3d9a7', aspect: 3.6 }) }), []);
  return (
    <Static>
      <Box size={[2.0, 1.0, 0.56]} position={[0, -0.05, -0.02]} material={mat('painted', '#3b2c24')} />
      <Inst geometry={boxGeo(0.07, 0.98, 0.03)} material={mat('wood', '#a8774a')} at={slats} cast={false} />
      <RBox size={[2.06, 0.05, 0.66]} radius={0.01} position={[0, 0.525, 0]} material={mat('stone', '#ece8e1', { roughness: 0.3 })} receive cast={false} />
      <Face size={[0.9, 0.25]} material={signFace} position={[0.45, 0.2, 0.318]} />
      {/* a glass pastry case on the near end */}
      <group position={[-0.72, 0.7, 0.02]}>
        <Box size={[0.52, 0.3, 0.42]} material={mat('glass', '#e8f4f8', { opacity: 0.25 })} cast={false} />
        <Box size={[0.48, 0.01, 0.38]} position={[0, -0.02, 0]} material={mat('steel')} cast={false} />
        {[-0.15, 0, 0.15].map((x) => <Ball key={x} r={0.045} scale={[1.2, 0.6, 1]} position={[x, 0.0, 0.05]} material={mat('food', '#c98b45', { roughness: 0.8 })} segments={10} cast={false} />)}
      </group>
      {/* the till */}
      <group position={[0.2, 0.62, -0.12]}>
        <RBox size={[0.3, 0.14, 0.24]} radius={0.01} material={mat('plastic', '#e9ecef')} cast={false} />
        <Box size={[0.26, 0.16, 0.02]} position={[0, 0.16, -0.06]} rotation={[-0.3, 0, 0]} material={screen('till', { color: '#3b6ea8' })} cast={false} />
      </group>
    </Static>
  );
}

/** The espresso machine (咖啡机): steel body, two group heads, a steam wand, cups on top; steam while on. */
export function CoffeeMachineModel({ states }: ModelProps) {
  const on = states.power === 'on';
  const steam = useRef<Group>(null);
  const body = mat('steel', '#c3c9cf', { roughness: 0.22 });
  const red = mat('painted', '#b0272d', { roughness: 0.3 });
  useFrame(({ clock }) => {
    const s = steam.current;
    if (!s) return;
    s.visible = on;
    if (!on) return;
    s.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.6 + i * 0.33) % 1;
      c.position.y = 0.05 + t * 0.25;
      c.scale.setScalar(0.5 + t * 1.2);
      ((c as Mesh).material as MeshBasicMaterial).opacity = 0.35 * (1 - t);
    });
  });
  const steamMats = useMemo(() => [0, 1, 2].map(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false })), []);
  return (
    <group>
      <Box size={[0.12, 0.05, 0.004]} position={[0, 0.17, 0.212]} material={screen(on ? 'coffee-on' : 'coffee-off', { color: on ? '#62d0ff' : '#1a2128' })} cast={false} />
      <Static>
      <RBox size={[0.5, 0.41, 0.42]} radius={0.02} position={[0, 0.045, 0]} material={body} />
      <Box size={[0.5, 0.1, 0.43]} position={[0, -0.21, 0]} material={red} cast={false} />
      <Box size={[0.44, 0.015, 0.2]} position={[0, -0.25, 0.12]} material={mat('steel', '#8d959d')} cast={false} />
      {[-0.11, 0.11].map((x) => (
        <group key={x} position={[x, -0.06, 0.2]}>
          <Cyl r={0.035} h={0.05} material={mat('chrome')} segments={14} cast={false} />
          <Box size={[0.02, 0.02, 0.12]} position={[0, -0.03, 0.06]} material={mat('rubber', '#1b1b1b')} cast={false} />
        </group>
      ))}
      <Cyl r={0.006} h={0.2} position={[0.22, -0.08, 0.2]} rotation={[0.3, 0, 0]} material={mat('chrome')} segments={6} cast={false} />
      {[-0.12, 0, 0.12].map((x) => <Cyl key={x} r={0.03} rTop={0.034} h={0.05} position={[x, 0.28, -0.02]} material={mat('ceramic', '#ffffff')} segments={14} cast={false} />)}
      </Static>
      <group ref={steam} position={[0.22, -0.18, 0.24]}>
        {steamMats.map((m, i) => (
          <mesh key={i} material={m}>
            <sphereGeometry args={[0.025, 8, 6]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** The vending machine (自动售货机): a lit window of drinks, a header, a keypad, the pick-up bay. */
export function VendingModel() {
  const windowMat = useMemo(() => screen('vending', { map: vendingTexture() }), []);
  const header = useMemo(() => screen('vending-head', { map: vendingHeaderTexture() }), []);
  return (
    <Static>
      <RBox size={[0.95, 1.9, 0.8]} radius={0.02} material={mat('painted', '#1f5fae', { roughness: 0.4 })} />
      <Face size={[0.6, 1.2]} material={windowMat} position={[-0.1, 0.2, 0.402]} />
      <Box size={[0.62, 1.22, 0.01]} position={[-0.1, 0.2, 0.41]} material={mat('glass', '#ffffff', { opacity: 0.15 })} cast={false} />
      <Face size={[0.86, 0.2]} material={header} position={[0, 0.82, 0.402]} />
      <RBox size={[0.18, 0.5, 0.03]} radius={0.01} position={[0.33, 0.25, 0.41]} material={mat('plastic', '#e9ecef')} cast={false} />
      <Box size={[0.12, 0.08, 0.004]} position={[0.33, 0.4, 0.427]} material={screen('vend-lcd', { color: '#6fd0a8' })} cast={false} />
      <Box size={[0.13, 0.13, 0.004]} position={[0.33, 0.2, 0.427]} material={screen('vend-qr', { color: '#ffffff' })} cast={false} />
      <RBox size={[0.6, 0.2, 0.06]} radius={0.01} position={[-0.1, -0.62, 0.39]} material={mat('plastic', '#14181d')} cast={false} />
      <Box size={[0.95, 0.06, 0.8]} position={[0, -0.92, 0]} material={mat('rubber', '#202326')} cast={false} />
    </Static>
  );
}

/** The newsstand rack (报刊架): a back, sides and three sloped-lip shelves; covers propped on the back. */
export function RackModel() {
  const wood = mat('wood', '#8a5b3a');
  const rows = useMemo(() => [0, 4].map((s) => screen(`cover-row:${s}`, { map: coverRowTexture(s) })), []);
  const shelves = useMemo<InstanceAt[]>(() => [-0.55, -0.05, 0.45].map((y) => ({ p: [0, y, 0] })), []);
  const lips = useMemo<InstanceAt[]>(() => [-0.51, -0.01, 0.49].map((y) => ({ p: [0, y, 0.15] })), []);
  const signFace = useMemo(() => screen('rack-sign', { map: wayfindingTexture({ zh: '报刊杂志', en: 'Newspapers & magazines', bg: '#7a2121', fg: '#ffe7a8', aspect: 3.6 }) }), []);
  return (
    <Static>
      <Box size={[1.1, 1.7, 0.04]} position={[0, 0, -0.16]} material={wood} />
      {[-0.535, 0.535].map((x) => <Box key={x} size={[0.03, 1.7, 0.36]} position={[x, 0, 0]} material={wood} cast={false} />)}
      <Inst geometry={boxGeo(1.07, 0.03, 0.3)} material={wood} at={shelves} receive cast={false} />
      <Inst geometry={boxGeo(1.07, 0.08, 0.02)} material={mat('steel', '#c9ced4')} at={lips} cast={false} />
      <Face size={[1.0, 0.34]} material={rows[0]} position={[0, -0.33, -0.12]} rotation={[-0.15, 0, 0]} />
      <Face size={[1.0, 0.34]} material={rows[1]} position={[0, 0.17, -0.12]} rotation={[-0.15, 0, 0]} />
      <Face size={[1.0, 0.28]} material={signFace} position={[0, 0.98, -0.12]} />
    </Static>
  );
}

/** The information desk (问询处): a curved white front with a blue band, a lit "i". */
export function InfoDeskModel() {
  const label = useMemo(() => screen('info-desk', { map: wayfindingTexture({ zh: '问询处', en: 'Information', icon: 'info', bg: '#1e4fa3', fg: '#ffffff', aspect: 3.4 }) }), []);
  return (
    <Static>
      <RBox size={[1.6, 1.06, 0.6]} radius={0.06} segments={3} position={[0, -0.02, -0.02]} material={mat('painted', '#f3f4f6', { roughness: 0.3 })} receive />
      <Box size={[1.62, 0.12, 0.02]} position={[0, 0.18, 0.29]} material={mat('plastic', '#1e4fa3')} cast={false} />
      <Face size={[0.9, 0.26]} material={label} position={[0, -0.12, 0.293]} />
      <RBox size={[1.66, 0.04, 0.66]} radius={0.01} position={[0, 0.53, 0]} material={mat('stone', '#d9d4cb', { roughness: 0.3 })} receive cast={false} />
      <group position={[0.45, 0.72, -0.12]} rotation={[0, Math.PI, 0]}>
        <RBox size={[0.4, 0.26, 0.03]} radius={0.01} material={mat('plastic', DARK)} cast={false} />
        <Box size={[0.36, 0.22, 0.002]} position={[0, 0, 0.016]} material={screen('info-screen', { color: '#4a83c9' })} cast={false} />
      </group>
    </Static>
  );
}

/** The lost-property box (失物招领): an open-topped blue box with a sign on its front. */
export function LostBoxModel() {
  const paint = mat('painted', '#3d5f8a', { roughness: 0.45 });
  const label = useMemo(() => screen('lost-label', { map: wayfindingTexture({ zh: '失物招领', en: 'Lost & found', icon: 'lost', bg: '#f4f1e8', fg: '#2a3e5c', aspect: 2.2 }) }), []);
  return (
    <Static>
      <Box size={[0.7, 0.04, 0.5]} position={[0, -0.43, 0]} material={paint} cast={false} />
      <Box size={[0.7, 0.9, 0.03]} position={[0, 0, 0.235]} material={paint} />
      <Box size={[0.7, 0.9, 0.03]} position={[0, 0, -0.235]} material={paint} cast={false} />
      <Box size={[0.03, 0.9, 0.5]} position={[0.335, 0, 0]} material={paint} cast={false} />
      <Box size={[0.03, 0.9, 0.5]} position={[-0.335, 0, 0]} material={paint} cast={false} />
      <Box size={[0.72, 0.03, 0.52]} position={[0, 0.45, 0]} material={mat('steel', '#c9ced4')} cast={false} />
      <Face size={[0.6, 0.27]} material={label} position={[0, 0.1, 0.252]} />
    </Static>
  );
}

/** A waiting bench (长椅): a slatted seat on two steel legs. */
export function BenchModel() {
  const slats = useMemo<InstanceAt[]>(() => [-0.18, -0.06, 0.06, 0.18].map((z) => ({ p: [0, 0.21, z] })), []);
  return (
    <Static>
      <Inst geometry={boxGeo(1.8, 0.04, 0.1)} material={mat('wood', '#b07a4a')} at={slats} receive />
      {[-0.75, 0.75].map((x) => <Box key={x} size={[0.06, 0.42, 0.44]} position={[x, -0.02, 0]} material={mat('steel', '#5d646c')} cast={false} />)}
      <Box size={[1.6, 0.04, 0.04]} position={[0, 0.0, 0]} material={mat('steel', '#5d646c')} cast={false} />
    </Static>
  );
}

/** A big indoor plant in a white planter (植物). */
export function PlantModel() {
  const leaves = useMemo<InstanceAt[]>(() => {
    const out: InstanceAt[] = [];
    for (let i = 0; i < 22; i++) {
      const a = i * 2.39996;
      const y = 0.05 + (i / 22) * 0.6;
      const r = 0.12 + 0.12 * Math.sin(i);
      out.push({ p: [Math.cos(a) * r, y, Math.sin(a) * r], r: [0.9 * Math.sin(a), a, 0.6], s: [1, 1, 1] });
    }
    return out;
  }, []);
  const leafGeo = useMemo(() => {
    const g = boxGeo(0.18, 0.012, 0.11);
    return g;
  }, []);
  return (
    <Static>
      <Cyl r={0.22} rTop={0.26} h={0.5} position={[0, -0.45, 0]} material={mat('ceramic', '#f1efe9', { roughness: 0.5 })} segments={20} />
      <Cyl r={0.24} h={0.02} position={[0, -0.2, 0]} material={mat('stone', '#4a3a2a')} cast={false} segments={16} />
      <Cyl r={0.02} h={0.9} position={[0, 0.2, 0]} material={mat('wood', '#5a4030')} segments={6} cast={false} />
      <Inst geometry={leafGeo} material={mat('leaf', '#3f7d34', { roughness: 0.6 })} at={leaves} />
    </Static>
  );
}
