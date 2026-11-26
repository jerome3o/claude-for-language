/**
 * The street's static world (docs/VR_WORLDS.md "The contract"): a dusk sky, the road (yellow centre
 * lines, stop lines, 慢 painted in each lane), the pavements with their kerbs and the yellow tactile
 * strip (盲道), the convenience shop's shell (glass front, tiled floor, its own light), the shopfronts
 * next door and across the road, the flats above them with lit windows and air-conditioners, towers
 * and a skyline fading into the evening haze, more lamps and trees down the road, the far side's
 * signal pole — and the `<Solid>` colliders for what things should bump into. Every thing with a
 * Chinese name to learn is an OBJECT instead (index.tsx).
 *
 * Layout (metres, the ground at y 0): the road runs along X, z −3.5 … 0.5, the zebra crossing at x 0;
 * this side's pavement z 0.5 … 4 (the shop's front at z 4, its inside to z 7); the far pavement
 * z −7 … −3.5 (the bus stop on the left, the post box and the shared bike on the right). All shop
 * names are invented.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, MeshBasicMaterial, MeshStandardMaterial, type Mesh } from 'three';
import { Box, Cyl, RBox, Solid, SolidCylinder, FloorCollider, mat } from '../kit';
import { Merged, type Part } from './merge';
import { CarSignal, WalkerHead, glow, print, street } from './models';
import { asphaltTex, canvasTex, facadeTex, fitText, paverTex, roadPaintTex, signTex, skyTex, tactileTex } from './textures';

const ROAD = { z0: -3.5, z1: 0.5 };
const CROSS = 1.4;

function facadeMat(key: string, o: Parameters<typeof facadeTex>[1], emissive = 2.2): MeshStandardMaterial {
  const { map, emissive: e } = facadeTex(key, o);
  return new MeshStandardMaterial({ map, emissiveMap: e, emissive: '#ffffff', emissiveIntensity: emissive, roughness: 0.85 });
}

/**
 * Dusk: the evening preset a little darker (exposure), so the lit windows, signs and lamps — unlit
 * materials, not tone mapped — glow against it. Put back when the world closes.
 */
function Dusk({ exposure = 0.7 }: { exposure?: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const before = gl.toneMappingExposure;
    gl.toneMappingExposure = exposure;
    return () => { gl.toneMappingExposure = before; };
  }, [gl, exposure]);
  return null;
}

/** The sky dome (unlit, no fog) with a pale moon. */
function Sky() {
  const material = useMemo(() => new MeshBasicMaterial({ map: skyTex(), side: BackSide, fog: false, depthWrite: false, toneMapped: false }), []);
  const moon = useMemo(() => new MeshBasicMaterial({ color: '#fff6e0', fog: false, toneMapped: false }), []);
  return (
    <group>
      <mesh material={material} renderOrder={-10}>
        <sphereGeometry args={[100, 24, 16]} />
      </mesh>
      <mesh material={moon} position={[30, 48, -78]}>
        <circleGeometry args={[2.2, 24]} />
      </mesh>
    </group>
  );
}

/** Ground: asphalt, two pavements, road paint, kerbs, the tactile strips, drains and manhole covers. */
function Ground() {
  const asphalt = useMemo(() => mat('stone', '#ffffff', { map: asphaltTex(), roughness: 0.92 }), []);
  const pavers = useMemo(() => mat('stone', '#ffffff', { map: paverTex(), roughness: 0.85 }), []);
  const tactile = useMemo(() => mat('stone', '#ffffff', { map: tactileTex(), roughness: 0.7 }), []);
  const slow = useMemo(() => new MeshStandardMaterial({ map: roadPaintTex('慢'), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  const L = 120;
  // A plane's texture coordinates scaled so the texture repeats every `tile` metres.
  const ground = (w: number, d: number, tile: number): Part => ({ plane: [w, d], uv: [w / tile, d / tile], rot: [-Math.PI / 2, 0, 0] });
  const white = mat('painted', '#efece4', { roughness: 0.7 });
  const yellow = mat('painted', '#e6b52c', { roughness: 0.7 });
  // a line along the road on both sides of the crossing (left clear 1 m beyond the stripes)
  const lines = (z: number, w: number): Part[] => [
    { box: [L / 2 - CROSS - 1, 0.004, w], at: [-(L / 4) - (CROSS + 1) / 2, 0.002, z] },
    { box: [L / 2 - CROSS - 1, 0.004, w], at: [L / 4 + (CROSS + 1) / 2, 0.002, z] },
  ];
  return (
    <group>
      <Merged id="asphalt" material={asphalt} receive parts={[{ ...ground(L, ROAD.z1 - ROAD.z0 + 0.4, 4), at: [0, 0, (ROAD.z0 + ROAD.z1) / 2] }]} />
      <Merged id="pavers" material={pavers} receive parts={[
        { ...ground(L, 4.0, 1.2), at: [0, 0.003, 2.5] },
        { ...ground(L, 4.6, 1.2), at: [0, 0.003, -5.8] },
      ]} />
      <Merged id="tactile" material={tactile} receive parts={[
        { ...ground(L, 0.3, 0.3), at: [0, 0.006, 3.45] },
        { ...ground(L, 0.3, 0.3), at: [0, 0.006, -4.65] },
        // the warning pads leading to the crossing
        { ...ground(1.2, 2.7, 0.3), at: [0, 0.007, 2.05] },
        { ...ground(1.2, 0.8, 0.3), at: [0, 0.007, -4.05] },
      ]} />
      {/* the double yellow centre line (broken at the crossing), white stop lines and lane edges */}
      <Merged id="lines-yellow" material={yellow} receive parts={[...lines(-1.58, 0.12), ...lines(-1.42, 0.12)]} />
      <Merged id="lines-white" material={white} receive parts={[
        { box: [0.35, 0.004, 1.85], at: [-CROSS - 0.6, 0.002, -0.55] },
        { box: [0.35, 0.004, 1.85], at: [CROSS + 0.6, 0.002, -2.45] },
        ...lines(0.3, 0.1), ...lines(-3.3, 0.1),
      ]} />
      <mesh material={slow} position={[-5.2, 0.006, -0.55]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <planeGeometry args={[1.0, 2.0]} />
      </mesh>
      <mesh material={slow} position={[5.2, 0.006, -2.45]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[1.0, 2.0]} />
      </mesh>
      {/* kerbs: granite, dropped at the crossing */}
      <Merged id="kerbs" material={mat('stone', '#b9b5ad', { roughness: 0.8 })} cast receive parts={[
        { box: [L / 2 - CROSS, 0.12, 0.15], at: [-(L / 4) - CROSS / 2, 0.06, ROAD.z1] },
        { box: [L / 2 - CROSS, 0.12, 0.15], at: [L / 4 + CROSS / 2, 0.06, ROAD.z1] },
        { box: [L / 2 - CROSS, 0.12, 0.15], at: [-(L / 4) - CROSS / 2, 0.06, ROAD.z0] },
        { box: [L / 2 - CROSS, 0.12, 0.15], at: [L / 4 + CROSS / 2, 0.06, ROAD.z0] },
        { box: [2 * CROSS, 0.02, 0.15], at: [0, 0.01, ROAD.z1] }, { box: [2 * CROSS, 0.02, 0.15], at: [0, 0.01, ROAD.z0] },
      ]} />
      {/* drains along the kerb, manhole covers (井盖) */}
      <Merged id="drains" material={mat('metal', '#2f3236', { roughness: 0.6 })} receive parts={[
        ...[-5.6, -2.6, 3.4, 6.2].map((x): Part => ({ box: [0.5, 0.01, 0.25], at: [x, 0.005, ROAD.z1 - 0.22] })),
        ...[-4.2, 2.8].map((x): Part => ({ box: [0.5, 0.01, 0.25], at: [x, 0.005, ROAD.z0 + 0.22] })),
        { cyl: [0.35, 0.012, 0.35, 20], at: [-3.0, 0.006, -2.4] }, { cyl: [0.3, 0.012, 0.3, 20], at: [-5.8, 0.008, 2.0] },
      ]} />
      <FloorCollider size={[18, 16]} />
      {/* the kerbs' colliders (inside the playable block): things roll up to them */}
      <Solid size={[6.0, 0.12, 0.15]} at={[-4.4, 0.06, ROAD.z1]} />
      <Solid size={[6.0, 0.12, 0.15]} at={[4.4, 0.06, ROAD.z1]} />
      <Solid size={[6.0, 0.12, 0.15]} at={[-4.4, 0.06, ROAD.z0]} />
      <Solid size={[6.0, 0.12, 0.15]} at={[4.4, 0.06, ROAD.z0]} />
    </group>
  );
}

/** The convenience shop's shell: glass front with posters, the inside (tiles, white walls, ceiling lights, its light), neighbours. */
function Shop() {
  const floor = useMemo(() => mat('tile', '#eceae4', { tiles: 4, grout: '#c9c5bc', repeat: [5, 3] }), []);
  const wall = useMemo(() => mat('plaster', '#f6f4ef', { repeat: [3, 2] }), []);
  const frame = useMemo(() => mat('metal', '#3e464e', { roughness: 0.35 }), []);
  const poster = useMemo(() => signTex('shop-poster', 256, 256, '#ff8a1f', [['关东煮', 0.2, '#ffffff', 0.3], ['热乎乎', 0.12, '#fff3a8', 0.56], ['3元起', 0.14, '#ffffff', 0.8]], '#ffffff'), []);
  const poster2 = useMemo(() => signTex('shop-poster2', 256, 256, '#16a37c', [['新品上市', 0.16, '#ffffff', 0.3], ['冰咖啡', 0.18, '#fff3a8', 0.58], ['第二杯半价', 0.1, '#ffffff', 0.82]], '#ffffff'), []);
  const till = useMemo(() => signTex('till', 256, 72, '#0f8a6a', [['收银台', 0.62, '#ffffff', 0.54]]), []);
  const promo = useMemo(() => signTex('promo', 256, 170, '#d9342b', [['会员日', 0.24, '#ffe066', 0.28], ['全场九折', 0.22, '#ffffff', 0.62], ['每周三', 0.13, '#ffe0d6', 0.86]], '#ffe066'), []);
  const rules = useMemo(() => signTex('aisle', 512, 96, '#16a37c', [['零食  ·  方便食品  ·  饼干', 0.42, '#ffffff', 0.54]]), []);
  const hours = useMemo(() => signTex('shop-hours', 256, 96, '#ffffff', [['营业时间', 0.3, '#0f8a6a', 0.3], ['全天 24 小时', 0.26, '#333333', 0.72]]), []);
  return (
    <group>
      {/* the inside */}
      <mesh material={floor} position={[0, 0.004, 5.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[5.2, 3.0]} />
      </mesh>
      <Merged id="shop-walls" material={wall} receive parts={[
        { plane: [3.0, 3.0], at: [-2.6, 1.5, 5.5], rot: [0, Math.PI / 2, 0] },
        { plane: [3.0, 3.0], at: [2.6, 1.5, 5.5], rot: [0, -Math.PI / 2, 0] },
        { plane: [5.2, 3.0], at: [0, 1.5, 7.0], rot: [0, Math.PI, 0] },
        { plane: [5.2, 3.0], at: [0, 3.0, 5.5], rot: [Math.PI / 2, 0, 0] },
        // the inside of the front, above the door and windows
        { plane: [5.2, 0.9], at: [0, 2.55, 4.03] },
      ]} />
      <Merged id="shop-ceiling-lights" material={glow('#f4fbff')} parts={[
        { box: [1.2, 0.02, 0.3], at: [-1.0, 2.99, 5.0] }, { box: [1.2, 0.02, 0.3], at: [1.0, 2.99, 5.0] },
        { box: [1.2, 0.02, 0.3], at: [-1.0, 2.99, 6.2] }, { box: [1.2, 0.02, 0.3], at: [1.0, 2.99, 6.2] },
      ]} />
      {/* the shop's own light: one of the world's two point lights, always on */}
      <pointLight position={[0, 2.6, 5.6]} color="#f4f8ff" intensity={8} distance={8} decay={1.4} />
      {/* inside: the till sign over the counter, a promotion on the left wall, a clock over the shelves */}
      <mesh material={glow('#ffffff', till)} position={[-1.75, 2.45, 5.4]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.8, 0.22]} />
      </mesh>
      <Box size={[0.012, 0.5, 0.012]} position={[-1.75, 2.75, 5.1]} material={frame} cast={false} />
      <Box size={[0.012, 0.5, 0.012]} position={[-1.75, 2.75, 5.7]} material={frame} cast={false} />
      <mesh material={print(promo)} position={[-2.59, 1.75, 6.3]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.9, 0.6]} />
      </mesh>
      <mesh material={print(rules)} position={[0.6, 2.25, 6.99]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.6, 0.3]} />
      </mesh>
      {/* the oden pot on the counter (关东煮) and the register keep things off them */}
      <Cyl r={0.17} h={0.14} position={[-1.75, 1.02, 4.85]} material={mat('steel', '#c6ccd2', { roughness: 0.25 })} segments={20} />
      <Merged id="oden" material={mat('food', '#c99a5a', { roughness: 0.6 })} parts={[
        { box: [0.06, 0.05, 0.04], at: [-1.8, 1.08, 4.8] }, { ball: [0.03, 8], at: [-1.7, 1.08, 4.9] }, { box: [0.05, 0.04, 0.06], at: [-1.69, 1.08, 4.78] },
        { cyl: [0.025, 0.05, 0.025, 8], at: [-1.82, 1.08, 4.92] },
      ]} />
      <SolidCylinder r={0.17} h={0.14} at={[-1.75, 1.02, 4.85]} />
      <Solid size={[0.32, 0.1, 0.28]} at={[-1.75, 0.995, 5.95]} />

      {/* the glass front: windows either side of the door, frames, posters, the ATM's wall */}
      <Merged id="shop-glass" material={mat('glass', '#cfe6ee', { opacity: 0.18 })} parts={[
        { plane: [2.1, 2.1], at: [-1.55, 1.15, 4.0] }, { plane: [1.25, 2.1], at: [1.125, 1.15, 4.0] },
      ]} />
      <Merged id="shop-frames" material={frame} cast parts={[
        { box: [5.3, 0.12, 0.08], at: [0, 2.16, 4.0] }, { box: [5.3, 0.1, 0.1], at: [0, 0.05, 4.0] },
        { box: [0.08, 2.2, 0.08], at: [-2.6, 1.1, 4.0] }, { box: [0.08, 2.2, 0.08], at: [-0.52, 1.1, 4.0] },
        { box: [0.08, 2.2, 0.08], at: [0.52, 1.1, 4.0] }, { box: [0.08, 2.2, 0.08], at: [1.75, 1.1, 4.0] },
        { box: [0.06, 2.2, 0.06], at: [-1.55, 1.1, 4.0] },
      ]} />
      <mesh material={print(poster)} position={[-2.05, 1.2, 3.98]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.7, 0.7]} />
      </mesh>
      <mesh material={print(poster)} position={[-2.05, 1.2, 4.02]}>
        <planeGeometry args={[0.7, 0.7]} />
      </mesh>
      <mesh material={print(poster2)} position={[1.12, 1.25, 3.98]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.6, 0.6]} />
      </mesh>
      <mesh material={print(hours)} position={[-0.95, 1.6, 3.985]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.4, 0.15]} />
      </mesh>
      {/* the wall behind the ATM */}
      <Box size={[0.85, 2.2, 0.12]} position={[2.18, 1.1, 4.06]} material={mat('stone', '#d6d2ca')} />
      {/* above the shop: a band of stone, under the flats */}
      <Box size={[24, 0.6, 0.2]} position={[0, 3.3, 4.12]} material={mat('stone', '#cbc4b8')} cast={false} />
      {/* colliders: the front (glass + frames) around the door, the walls, the ceiling */}
      <Solid size={[2.1, 2.2, 0.1]} at={[-1.55, 1.1, 4.0]} />
      <Solid size={[2.1, 2.2, 0.1]} at={[1.55, 1.1, 4.0]} />
      <Solid size={[5.4, 0.9, 0.2]} at={[0, 2.6, 4.0]} />
      <Solid size={[0.2, 3, 3.2]} at={[-2.7, 1.5, 5.5]} />
      <Solid size={[0.2, 3, 3.2]} at={[2.7, 1.5, 5.5]} />
      <Solid size={[5.6, 3, 0.2]} at={[0, 1.5, 7.1]} />
      <Solid size={[5.6, 0.2, 3.2]} at={[0, 3.1, 5.5]} />
    </group>
  );
}

/** A row of shopfronts drawn as one picture: invented little shops, shutters and lit windows. */
function shopRowTex(key: string, shops: Array<{ name: string; bg: string; fg: string; open: boolean; sub?: string }>, emissive: boolean) {
  return canvasTex(`row:${key}:${emissive}`, 2048, 256, (ctx, w, h) => {
    const n = shops.length;
    const sw = w / n;
    ctx.fillStyle = emissive ? '#000' : '#b8b0a4';
    ctx.fillRect(0, 0, w, h);
    shops.forEach((s, i) => {
      const x = i * sw;
      // sign board
      ctx.fillStyle = emissive ? (s.open ? s.bg : '#000') : s.bg;
      ctx.fillRect(x + 10, 6, sw - 20, 62);
      ctx.fillStyle = emissive ? (s.open ? s.fg : '#000') : s.fg;
      fitText(ctx, s.name, x + sw / 2, 38, 44, sw - 50);
      // the front below: lit glass or a rolled-down shutter
      if (s.open) {
        ctx.fillStyle = emissive ? '#ffd9a0' : '#e8c890';
        ctx.fillRect(x + 22, 82, sw - 44, h - 92);
        ctx.fillStyle = emissive ? '#6a4a2a' : '#7a5a3a';
        for (let k = 0; k < 4; k++) ctx.fillRect(x + 22 + ((sw - 44) * k) / 4, 82, 4, h - 92);
        if (s.sub) {
          ctx.fillStyle = emissive ? '#ffffff' : '#ffffff';
          ctx.fillRect(x + sw / 2 - 60, 120, 120, 40);
          ctx.fillStyle = emissive ? '#000' : '#333';
          fitText(ctx, s.sub, x + sw / 2, 141, 24, 110, 500);
        }
      } else {
        ctx.fillStyle = emissive ? '#000' : '#9a9da0';
        ctx.fillRect(x + 22, 82, sw - 44, h - 92);
        ctx.fillStyle = emissive ? '#000' : '#85888b';
        for (let y = 86; y < h - 10; y += 8) ctx.fillRect(x + 22, y, sw - 44, 2);
      }
      ctx.fillStyle = emissive ? '#000' : '#8c8478';
      ctx.fillRect(x, 0, 8, h);
    });
  }, { text: shops.map((s) => s.name + (s.sub ?? '')).join('') });
}

function rowMat(key: string, shops: Parameters<typeof shopRowTex>[1]) {
  return new MeshStandardMaterial({ map: shopRowTex(key, shops, false), emissiveMap: shopRowTex(key, shops, true), emissive: '#ffffff', emissiveIntensity: 1.8, roughness: 0.8 });
}

/** The buildings: this side's flats over the shop and the neighbours, the far side's shops and flats, towers, skyline. */
function Buildings() {
  const left = useMemo(() => rowMat('left', [
    { name: '老王面馆', bg: '#b3261e', fg: '#ffe066', open: true, sub: '牛肉面' },
    { name: '小林理发', bg: '#1f5aa6', fg: '#ffffff', open: true, sub: '剪发 30元' },
    { name: '五金店', bg: '#3a3f46', fg: '#ffcf4a', open: false },
  ]), []);
  const right = useMemo(() => rowMat('right', [
    { name: '幸福药房', bg: '#2e8b57', fg: '#ffffff', open: true, sub: '24小时' },
    { name: '鲜花', bg: '#e8507a', fg: '#ffffff', open: false },
    { name: '快递驿站', bg: '#f2b134', fg: '#5a2a12', open: true, sub: '取件' },
  ]), []);
  const far = useMemo(() => rowMat('far', [
    { name: '甜甜奶茶', bg: '#ff7aa2', fg: '#ffffff', open: true, sub: '珍珠奶茶' },
    { name: '水饺', bg: '#b3261e', fg: '#ffffff', open: true, sub: '堂食 外带' },
    { name: '眼镜店', bg: '#1f5aa6', fg: '#ffffff', open: false },
    { name: '包子铺', bg: '#f2b134', fg: '#8a1c12', open: true, sub: '早餐' },
    { name: '文具', bg: '#5b3aa6', fg: '#ffffff', open: false },
    { name: '手机维修', bg: '#16a37c', fg: '#ffffff', open: true, sub: '贴膜' },
  ]), []);
  const flatsNear = useMemo(() => facadeMat('near', { seed: 3, wall: '#d9cbb8', frame: '#ece6dc', cols: 6, rows: 4, lit: 0.5, ac: true, balcony: true }), []);
  const flatsFar = useMemo(() => facadeMat('far', { seed: 8, wall: '#c9b9a6', frame: '#e8e1d6', cols: 6, rows: 4, lit: 0.45, ac: true }), []);
  const tower = useMemo(() => facadeMat('tower', { seed: 12, wall: '#8e98a6', frame: '#c4cad2', cols: 8, rows: 8, lit: 0.4 }, 2.6), []);
  const tower2 = useMemo(() => facadeMat('tower2', { seed: 17, wall: '#b3a28f', frame: '#ddd3c4', cols: 6, rows: 8, lit: 0.5, ac: true }, 2.6), []);
  const skyline = useMemo(() => facadeMat('skyline', { seed: 21, wall: '#4b5574', frame: '#5d6888', cols: 10, rows: 10, lit: 0.35 }, 3), []);
  const towers: Part[] = [];
  const towers2: Part[] = [];
  const sky: Part[] = [];
  // towers behind the far side (and behind you), square-ish so the repeated windows look right
  const T: Array<[number, number, number, number, 1 | 2]> = [
    [-30, -24, 14, 34, 1], [-12, -22, 12, 28, 2], [7, -26, 14, 42, 1], [25, -21, 12, 26, 2], [42, -30, 14, 38, 1],
    [-45, -32, 14, 30, 2], [-22, 20, 14, 32, 1], [0, 24, 14, 40, 2], [22, 19, 12, 28, 1], [-40, 14, 12, 24, 2], [40, 16, 12, 30, 2],
  ];
  for (const [x, z, w, h, k] of T) (k === 1 ? towers : towers2).push({ box: [w, h, w], at: [x, h / 2, z], uv: [w / 12, h / 12] });
  // the skyline: far, tall, fading into the haze
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 62 + (i % 3) * 8;
    const w = 14 + (i % 4) * 4;
    const h = 30 + ((i * 7) % 5) * 9;
    sky.push({ box: [w, h, w], at: [Math.cos(a) * r, h / 2, Math.sin(a) * r], uv: [w / 14, h / 14] });
  }
  return (
    <group>
      {/* this side: the neighbours' shopfronts left and right of the shop, the flats above */}
      <Merged id="row-left" material={left} receive parts={[{ plane: [12, 3.0], at: [-8.6, 1.5, 4.0], rot: [0, Math.PI, 0] }]} />
      <Merged id="row-left-back" material={left} parts={[{ plane: [12, 3.0], at: [-8.6, 1.5, 4.0] }]} />
      <Merged id="row-right" material={right} receive parts={[{ plane: [12, 3.0], at: [8.6, 1.5, 4.0], rot: [0, Math.PI, 0] }]} />
      <Merged id="flats-near" material={flatsNear} parts={[{ plane: [30, 14], at: [0, 10.6, 4.2], rot: [0, Math.PI, 0], uv: [2.5, 14 / 12] }]} />
      {/* the far side */}
      <Merged id="row-far" material={far} receive parts={[{ plane: [24, 3.2], at: [0, 1.6, -7.0], uv: [1, 1] }, { plane: [24, 3.2], at: [-24, 1.6, -7.0] }, { plane: [24, 3.2], at: [24, 1.6, -7.0] }]} />
      <Merged id="flats-far" material={flatsFar} parts={[{ plane: [72, 9], at: [0, 8.1, -7.2], uv: [6, 0.75] }]} />
      <Box size={[72, 0.4, 0.4]} position={[0, 3.42, -7.0]} material={mat('stone', '#bdb3a4')} cast={false} />
      <Merged id="towers" material={tower} parts={towers} />
      <Merged id="towers2" material={tower2} parts={towers2} />
      <Merged id="skyline" material={skyline} parts={sky} />
      {/* walls: the shopfronts beside the shop and across the road stop you */}
      <Solid size={[4.0, 3, 0.2]} at={[-4.6, 1.5, 4.1]} />
      <Solid size={[4.0, 3, 0.2]} at={[4.6, 1.5, 4.1]} />
      <Solid size={[14, 3, 0.2]} at={[0, 1.5, -7.1]} />
    </group>
  );
}

/** More lamps and trees down the road (decor), lit together with the 路灯 object. */
function DistantStreet() {
  const lampXs = [-27, -15, 9, 21, 33, -39];
  const farLampXs = [-21, -9, 15, 27, -33];
  const poles: Part[] = [
    ...lampXs.flatMap((x): Part[] => [{ cyl: [0.07, 4.4, 0.05, 8], at: [x, 2.2, 0.82] }, { box: [0.06, 0.06, 0.95], at: [x, 4.28, 0.37] }]),
    ...farLampXs.flatMap((x): Part[] => [{ cyl: [0.07, 4.4, 0.05, 8], at: [x, 2.2, -3.82] }, { box: [0.06, 0.06, 0.95], at: [x, 4.28, -3.37] }]),
    // the far side's lamp inside the block (decor) and its pole
    { cyl: [0.07, 4.4, 0.05, 8], at: [3.2, 2.2, -3.82] }, { box: [0.06, 0.06, 0.95], at: [3.2, 4.28, -3.37] },
  ];
  const lampHeads: Part[] = [
    ...lampXs.map((x): Part => ({ box: [0.42, 0.02, 0.18], at: [x, 4.14, -0.03] })),
    ...[...farLampXs, 3.2].map((x): Part => ({ box: [0.42, 0.02, 0.18], at: [x, 4.14, -2.97] })),
  ];
  const housings: Part[] = [
    ...lampXs.map((x): Part => ({ box: [0.5, 0.12, 0.24], at: [x, 4.2, -0.03] })),
    ...[...farLampXs, 3.2].map((x): Part => ({ box: [0.5, 0.12, 0.24], at: [x, 4.2, -2.97] })),
  ];
  const treeXs = [-13, -8.5, 8.5, 13, 18.5, -18.5, -24, 24];
  return (
    <group>
      <Merged id="far-poles" material={mat('metal', '#5d6670', { roughness: 0.45 })} parts={poles} />
      <Merged id="far-housings" material={mat('metal', '#4d555e', { roughness: 0.5 })} parts={housings} />
      <LampGlow parts={lampHeads} />
      <Merged id="far-trunks" material={mat('wood', '#5d4632', { roughness: 0.9 })} parts={treeXs.map((x): Part => ({ cyl: [0.12, 3.0, 0.08, 8], at: [x, 1.5, -5.6] }))} />
      <Merged id="far-crowns" material={mat('leaf', '#3f7d33', { roughness: 0.8 })} parts={treeXs.flatMap((x, i): Part[] => [
        { ball: [1.0, 10], at: [x, 3.3, -5.6] }, { ball: [0.7, 9], at: [x + 0.6, 3.0, -5.4 + (i % 2) * 0.3] }, { ball: [0.6, 9], at: [x - 0.5, 3.6, -5.8] },
      ])} />
    </group>
  );
}

/** The decor lamps' lit faces: one merged mesh whose material follows `street.lampsOn`. */
function LampGlow({ parts }: { parts: Part[] }) {
  const ref = useRef<Mesh | null>(null);
  const lit = useMemo(() => glow('#ffe2a8'), []);
  const unlit = useMemo(() => mat('glass', '#d8dde2', { opacity: 0.9 }), []);
  useFrame(() => {
    const m = ref.current;
    if (m) m.material = street.lampsOn ? lit : unlit;
  });
  return (
    <group ref={(g) => { if (g) ref.current = g.children[0] as Mesh; }}>
      <Merged id="far-lamp-glow" material={unlit} parts={parts} />
    </group>
  );
}

/** The far side of the crossing: its signal pole (walkers' head + car signals) and a stone bollard each side. */
function FarSignal() {
  const pole = mat('metal', '#5d6670', { roughness: 0.45 });
  return (
    <group>
      <group position={[-1.55, 0, -3.78]}>
        <Cyl r={0.06} rTop={0.05} h={3.2} position={[0, 1.6, 0]} material={pole} segments={12} />
        <Cyl r={0.12} h={0.12} position={[0, 0.06, 0]} material={pole} segments={12} />
        <WalkerHead position={[0, 2.35, 0.08]} />
        <RBox size={[0.14, 0.22, 0.1]} radius={0.015} position={[0, 1.1, -0.11]} rotation={[0, Math.PI, 0]} material={mat('plastic', '#f2c21b', { roughness: 0.4 })} />
        <Cyl r={0.06} rTop={0.045} h={1.2} position={[0, 3.65, 0]} material={pole} segments={10} />
        <Box size={[0.07, 0.07, 2.3]} position={[0, 4.22, 1.12]} material={pole} />
        <CarSignal position={[-0.06, 3.8, 2.1]} rotation={[0, -Math.PI / 2, 0]} />
        <CarSignal position={[0.06, 3.8, 1.2]} rotation={[0, Math.PI / 2, 0]} />
      </group>
      <SolidCylinder r={0.06} h={3.2} at={[-1.55, 1.6, -3.78]} />
      <Merged id="bollards" material={mat('stone', '#c9c4bb', { roughness: 0.8 })} cast parts={[
        { cyl: [0.16, 0.45, 0.13, 14], at: [1.55, 0.225, -3.78] }, { ball: [0.13, 12], at: [1.55, 0.45, -3.78], scale: [1, 0.5, 1] },
        { cyl: [0.16, 0.45, 0.13, 14], at: [-1.6, 0.225, 0.8] }, { ball: [0.13, 12], at: [-1.6, 0.45, 0.8], scale: [1, 0.5, 1] },
      ]} />
      <SolidCylinder r={0.16} h={0.45} at={[1.55, 0.225, -3.78]} />
      <SolidCylinder r={0.16} h={0.45} at={[-1.6, 0.225, 0.8]} />
      {/* a bike rack where the shared bike stands */}
      <Merged id="bike-rack" material={mat('steel', '#aab1b8')} cast parts={[
        { box: [2.4, 0.04, 0.04], at: [4.7, 0.05, -6.15] },
        ...[3.8, 4.4, 5.0, 5.6].map((x): Part => ({ box: [0.04, 0.5, 0.04], at: [x, 0.25, -6.15] })),
      ]} />
    </group>
  );
}

export function StreetScene() {
  return (
    <group>
      <Dusk />
      <Sky />
      <Ground />
      <Shop />
      <Buildings />
      <DistantStreet />
      <FarSignal />
    </group>
  );
}
