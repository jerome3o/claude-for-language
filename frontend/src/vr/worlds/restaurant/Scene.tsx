/**
 * The restaurant's static world (docs/VR_WORLDS.md "The contract"): the dining room (tiled floor, red
 * wood panelling under cream walls, beams and ceiling lights), the kitchen glimpsed through the serving
 * hatch (a wok over a flickering flame, heat lamps, a 厨房重地 sign — lit by the world's second point
 * light), the till's cash register and the liquor shelf behind it with a 福, a side cabinet of stacked
 * bowls and plates, the front door under 欢迎光临, a window at dusk, scrolls, notices and a plant — and
 * the `<Solid>` colliders for what things should bump into. Everything with a Chinese name to learn is
 * an OBJECT instead (index.tsx), with its own collider.
 *
 * Room: x −3 … 3, z −2.5 … 2.5, 3 m high, centred on the origin. The hatch is in the back wall (−z)
 * at x −0.3 … 1.1, y 1.02 … 1.75; the kitchen behind it (z −2.5 … −3.6) is decor only.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshBasicMaterial, type PointLight } from 'three';
import { Plant, Sign, Solid, SolidCylinder, FloorCollider, WindowPane, mat, bowlProfile, bottleProfile, plateProfile } from '../kit';
import { box, cyl, lathe, merged, ring } from './geom';
import { noticeTexture, scrollTexture } from './textures';

type V3 = [number, number, number];

const W = 6;
const D = 5;
const H = 3;
const HOLE = { x0: -0.3, x1: 1.1, y0: 1.0, y1: 1.75 };

function Flat({ tex, size, position, rotation }: { tex: ReturnType<typeof noticeTexture>; size: [number, number]; position: V3; rotation?: V3 }) {
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={tex} roughness={0.7} />
    </mesh>
  );
}

/** The kitchen behind the hatch: tiles, a steel counter, a wok on a flickering flame, heat lamps. */
function Kitchen() {
  const light = useRef<PointLight>(null);
  const flame = useMemo(() => new MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false, transparent: true, opacity: 0.9 }), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 0.75 + 0.25 * Math.abs(Math.sin(t * 11) * Math.sin(t * 3.7 + 1));
    if (light.current) light.current.intensity = 2.2 + 0.9 * f;
    flame.opacity = 0.6 + 0.4 * f;
  });
  const tiles = merged('kitchen-tiles', () => [
    // stops 4 cm behind the dining room's back wall, so no edge shows through it
    box([2.0, 0.02, 1.08], [0.4, -0.01, -3.08]),
    box([2.0, 2.4, 0.04], [0.4, 1.2, -3.62]),
    box([0.04, 2.4, 1.08], [-0.62, 1.2, -3.08]),
    box([0.04, 2.4, 1.08], [1.42, 1.2, -3.08]),
    box([2.0, 0.04, 1.08], [0.4, 2.42, -3.08]),
  ]);
  const steel = merged('kitchen-steel', () => [
    box([1.9, 0.9, 0.6], [0.4, 0.45, -3.3]),
    box([1.4, 0.32, 0.55], [0.4, 2.0, -3.3]),
    box([1.4, 0.03, 0.34], [0.4, 1.32, -2.75]),
    box([0.03, 0.34, 0.03], [-0.25, 1.48, -2.9]), box([0.03, 0.34, 0.03], [1.05, 1.48, -2.9]),
    cyl(0.012, 0.32, [0.95, 1.55, -3.55], { seg: 6 }), ring(0.04, 0.008, [0.95, 1.38, -3.53], [Math.PI / 2, 0, 0]),
    cyl(0.012, 0.3, [1.1, 1.56, -3.55], { seg: 6 }), box([0.08, 0.01, 0.1], [1.1, 1.4, -3.53], [1.3, 0, 0]),
  ]);
  const wok = merged('kitchen-wok', () => [lathe(bowlProfile(0.24, 0.1, 0.006), [0.1, 0.99, -3.3]), cyl(0.012, 0.3, [0.42, 1.03, -3.3], { seg: 6, rot: [0, 0, Math.PI / 2 - 0.15] }), cyl(0.1, 0.04, [0.1, 0.92, -3.3], { seg: 16 })]);
  const flames = merged('kitchen-flames', () => [
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return cyl(0.018, 0.08, [0.1 + Math.cos(a) * 0.09, 0.96, -3.3 + Math.sin(a) * 0.09], { rTop: 0.001, seg: 5 });
    }),
    cyl(0.07, 0.08, [-0.05, 1.42, -2.75], { rTop: 0.03, seg: 12, open: true }),
    cyl(0.07, 0.08, [0.85, 1.42, -2.75], { rTop: 0.03, seg: 12, open: true }),
  ]);
  const plates = merged('kitchen-plates', () => Array.from({ length: 6 }, (_, i) => lathe(plateProfile(0.1, 0.016), [0.75, 0.92 + i * 0.012, -3.25], undefined, 16)));
  const sign = useMemo(() => noticeTexture('厨房重地', '闲人免进', '#ffffff', '#c8102e'), []);
  return (
    <group>
      <mesh geometry={tiles} material={mat('tile', '#eef2f2', { tiles: 6, grout: '#c9d0d0', repeat: [3, 3] })} receiveShadow />
      <mesh geometry={steel} material={mat('steel', '#bfc5cb', { roughness: 0.3 })} />
      <mesh geometry={wok} material={mat('metal', '#26282b', { roughness: 0.45 })} />
      <mesh geometry={flames} material={flame} />
      <mesh geometry={plates} material={mat('ceramic', '#f6f3ec')} />
      <Flat tex={sign} size={[0.5, 0.25]} position={[-0.2, 1.62, -3.598]} />
      {/* Always mounted: only its intensity flickers. */}
      <pointLight ref={light} position={[0.4, 1.7, -3.0]} color="#ffb070" intensity={2.6} distance={4.2} decay={1.5} />
    </group>
  );
}

/** The register on the till, the liquor shelf behind it and the 福 above. */
function TillCorner() {
  const register = merged('till-register', () => [box([0.34, 0.09, 0.26], [-2.3, 1.045, -2.17]), box([0.04, 0.12, 0.04], [-2.3, 1.15, -2.24]), box([0.26, 0.17, 0.02], [-2.3, 1.25, -2.22], [-0.25, 0, 0])]);
  const shelf = merged('till-shelf', () => [
    box([1.3, 0.025, 0.2], [-2.2, 1.45, -2.4]), box([1.3, 0.025, 0.2], [-2.2, 1.85, -2.4]),
    box([0.025, 0.6, 0.2], [-2.86, 1.65, -2.4]), box([0.025, 0.6, 0.2], [-1.54, 1.65, -2.4]),
  ]);
  const bottles = merged('till-bottles', () => [1.4625, 1.8625].flatMap((y, row) => Array.from({ length: 7 }, (_, i) => lathe(bottleProfile(0.032 - (i % 3) * 0.004, 0.26 - ((i + row) % 3) * 0.04, 0.01), [-2.74 + i * 0.18, y + (0.26 - ((i + row) % 3) * 0.04) / 2, -2.4], undefined, 10))));
  const labels = merged('till-labels', () => [1.4625, 1.8625].flatMap((y) => Array.from({ length: 7 }, (_, i) => cyl(0.0335 - (i % 3) * 0.004, 0.05, [-2.74 + i * 0.18, y + 0.07, -2.4], { seg: 10, open: true }))));
  const screen = useMemo(() => new MeshBasicMaterial({ color: '#7fc8ff', toneMapped: false }), []);
  return (
    <group>
      <mesh geometry={register} material={mat('plastic', '#2b2d30', { roughness: 0.4 })} castShadow />
      <mesh position={[-2.3, 1.252, -2.208]} rotation={[-0.25, 0, 0]} material={screen}>
        <planeGeometry args={[0.22, 0.14]} />
      </mesh>
      <Solid size={[0.34, 0.12, 0.26]} at={[-2.3, 1.06, -2.17]} />
      <mesh geometry={shelf} material={mat('wood', '#4a2416')} castShadow />
      <mesh geometry={bottles} material={mat('glass', '#8a4a1a', { opacity: 0.8 })} />
      <mesh geometry={labels} material={mat('paper', '#c8102e')} />
      <Solid size={[1.3, 0.025, 0.2]} at={[-2.2, 1.45, -2.4]} />
      <Solid size={[1.3, 0.025, 0.2]} at={[-2.2, 1.85, -2.4]} />
      <Sign text="福" size={[0.34, 0.34]} bg="#c8102e" fg="#ffd35c" position={[-2.2, 2.45, -2.485]} rotation={[0, 0, Math.PI / 4]} />
    </group>
  );
}

/** A side cabinet between the till and the hatch: stacks of bowls and plates, a thermos of hot water. */
function SideCabinet() {
  const body = merged('side-cabinet', () => [box([0.8, 0.8, 0.4], [-0.85, 0.42, -2.29]), box([0.84, 0.04, 0.44], [-0.85, 0.84, -2.29])]);
  const doors = merged('side-cabinet-doors', () => [box([0.38, 0.6, 0.012], [-1.045, 0.45, -2.085]), box([0.38, 0.6, 0.012], [-0.655, 0.45, -2.085])]);
  const knobs = merged('side-cabinet-knobs', () => [cyl(0.012, 0.02, [-0.875, 0.5, -2.07], { rot: [Math.PI / 2, 0, 0], seg: 8 }), cyl(0.012, 0.02, [-0.825, 0.5, -2.07], { rot: [Math.PI / 2, 0, 0], seg: 8 })]);
  const stacks = merged('side-cabinet-stacks', () => [
    ...Array.from({ length: 6 }, (_, i) => lathe(bowlProfile(0.07, 0.065), [-1.05, 0.893 + i * 0.022, -2.3], undefined, 16)),
    ...Array.from({ length: 8 }, (_, i) => lathe(plateProfile(0.11, 0.02), [-0.82, 0.87 + i * 0.012, -2.3], undefined, 16)),
  ]);
  const thermos = merged('side-thermos', () => [cyl(0.06, 0.3, [-0.58, 1.01, -2.32], { seg: 16 }), cyl(0.035, 0.05, [-0.58, 1.185, -2.32], { rTop: 0.03, seg: 12 })]);
  return (
    <group>
      <mesh geometry={body} material={mat('wood', '#5a2a18')} castShadow receiveShadow />
      <mesh geometry={doors} material={mat('wood', '#6e3622')} />
      <mesh geometry={knobs} material={mat('metal', '#d4a640', { metalness: 0.9, roughness: 0.3 })} />
      <mesh geometry={stacks} material={mat('ceramic', '#f6f3ec')} castShadow />
      <mesh geometry={thermos} material={mat('painted', '#c8302a', { roughness: 0.3 })} castShadow />
      <Solid size={[0.84, 0.86, 0.44]} at={[-0.85, 0.43, -2.29]} />
      <SolidCylinder r={0.07} h={0.14} at={[-1.05, 0.93, -2.3]} />
      <SolidCylinder r={0.11} h={0.1} at={[-0.82, 0.91, -2.3]} />
      <SolidCylinder r={0.06} h={0.34} at={[-0.58, 1.03, -2.32]} />
    </group>
  );
}

/** The front door with glass panes, 推 on it, 欢迎光临 above and a mat. */
function FrontDoor() {
  const frame = merged('door-frame', () => [
    box([1.1, 0.08, 0.08], [1.6, 2.14, 2.47]), box([0.08, 2.18, 0.08], [1.09, 1.07, 2.47]), box([0.08, 2.18, 0.08], [2.11, 1.07, 2.47]),
    box([0.5, 2.06, 0.05], [1.355, 1.03, 2.475]), box([0.5, 2.06, 0.05], [1.845, 1.03, 2.475]),
  ]);
  const glass = merged('door-glass', () => [box([0.36, 1.1, 0.01], [1.355, 1.35, 2.448]), box([0.36, 1.1, 0.01], [1.845, 1.35, 2.448])]);
  const handles = merged('door-handles', () => [box([0.025, 0.45, 0.025], [1.56, 1.05, 2.43]), box([0.025, 0.45, 0.025], [1.64, 1.05, 2.43])]);
  return (
    <group>
      <mesh geometry={frame} material={mat('wood', '#5a2a18')} />
      <mesh geometry={glass} material={mat('glass', '#8fb3cc', { opacity: 0.75 })} />
      <mesh geometry={handles} material={mat('steel')} />
      <Sign text="推" size={[0.14, 0.14]} bg="#ffffff" fg="#c8102e" position={[1.355, 1.62, 2.44]} rotation={[0, Math.PI, 0]} />
      <Sign text="欢迎光临" size={[1.0, 0.24]} bg="#b3120f" fg="#ffd76a" frame="#4a2a14" position={[1.6, 2.42, 2.485]} rotation={[0, Math.PI, 0]} />
      <mesh position={[1.6, 0.006, 2.1]} receiveShadow>
        <boxGeometry args={[1.0, 0.012, 0.6]} />
        <primitive object={mat('fabric', '#7a1a1a')} attach="material" />
      </mesh>
    </group>
  );
}

/** A red Chinese knot (中国结) on the front wall. */
function ChineseKnot() {
  const g = merged('chinese-knot', () => [
    ...[-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => ring(0.035, 0.007, [a * 0.05, b * 0.05, 0], [0, 0, Math.PI / 4], Math.PI * 2, 14))),
    ring(0.11, 0.008, [0, 0, 0], [0, 0, Math.PI / 4], Math.PI * 2, 4),
    cyl(0.006, 0.18, [0, 0.21, 0], { seg: 5 }),
    ...Array.from({ length: 10 }, (_, i) => cyl(0.004, 0.28, [(i - 4.5) * 0.008, -0.26, 0], { seg: 4 })),
  ]);
  return <mesh geometry={g} material={mat('fabric', '#c8102e')} position={[-0.3, 1.95, 2.47]} castShadow />;
}

/** The room: floor, walls round the hatch, panelling, trims, beams and ceiling lights + their colliders. */
function Shell() {
  const walls = merged('rest-walls', () => {
    const left = HOLE.x0 + W / 2;
    const right = W / 2 - HOLE.x1;
    return [
      box([left, H, 0.04], [-W / 2 + left / 2, H / 2, -D / 2 - 0.02]),
      box([right, H, 0.04], [W / 2 - right / 2, H / 2, -D / 2 - 0.02]),
      box([HOLE.x1 - HOLE.x0, H - HOLE.y1, 0.04], [(HOLE.x0 + HOLE.x1) / 2, (H + HOLE.y1) / 2, -D / 2 - 0.02]),
      box([HOLE.x1 - HOLE.x0, HOLE.y0, 0.04], [(HOLE.x0 + HOLE.x1) / 2, HOLE.y0 / 2, -D / 2 - 0.02]),
      box([W, H, 0.04], [0, H / 2, D / 2 + 0.02]),
      box([0.04, H, D], [-W / 2 - 0.02, H / 2, 0]),
      box([0.04, H, D], [W / 2 + 0.02, H / 2, 0]),
    ];
  });
  const panels = merged('rest-panels', () => [
    box([W, 0.95, 0.02], [0, 0.525, -D / 2 + 0.01]), box([W, 0.95, 0.02], [0, 0.525, D / 2 - 0.01]),
    box([0.02, 0.95, D], [-W / 2 + 0.01, 0.525, 0]), box([0.02, 0.95, D], [W / 2 - 0.01, 0.525, 0]),
  ]);
  const trim = merged('rest-trim', () => [
    box([W, 0.05, 0.04], [0, 1.0, -D / 2 + 0.02]), box([W, 0.05, 0.04], [0, 1.0, D / 2 - 0.02]),
    box([0.04, 0.05, D], [-W / 2 + 0.02, 1.0, 0]), box([0.04, 0.05, D], [W / 2 - 0.02, 1.0, 0]),
    box([W, 0.1, 0.03], [0, 0.05, -D / 2 + 0.025]), box([W, 0.1, 0.03], [0, 0.05, D / 2 - 0.025]),
    box([0.03, 0.1, D], [-W / 2 + 0.025, 0.05, 0]), box([0.03, 0.1, D], [W / 2 - 0.025, 0.05, 0]),
    box([W, 0.08, 0.06], [0, H - 0.04, -D / 2 + 0.03]), box([W, 0.08, 0.06], [0, H - 0.04, D / 2 - 0.03]),
    box([0.06, 0.08, D], [-W / 2 + 0.03, H - 0.04, 0]), box([0.06, 0.08, D], [W / 2 - 0.03, H - 0.04, 0]),
    ...[-1.6, 0, 1.6].map((z) => box([W, 0.14, 0.16], [0, H - 0.07, z])),
  ]);
  const lights = merged('rest-ceiling-lights', () => [[-2.1, 1.3], [0.4, 1.3], [2.1, 1.3], [0.4, -1.4], [2.1, -1.0], [-2.2, -1.2]].map(([x, z]) => cyl(0.16, 0.02, [x, H - 0.012, z], { seg: 20 })));
  const glow = useMemo(() => new MeshBasicMaterial({ color: '#fff1d6', toneMapped: false }), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat('tile', '#d9cdb6', { tiles: 2, grout: '#a8987c', repeat: [6, 5] })}>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh geometry={walls} material={mat('plaster', '#f1e3c6', { repeat: [4, 2] })} receiveShadow />
      <mesh geometry={panels} material={mat('wood', '#7a3a22', { repeat: [4, 1] })} receiveShadow />
      <mesh geometry={trim} material={mat('wood', '#3f1e12')} />
      <mesh position={[0, H - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('plaster', '#f6eedf')}>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh geometry={lights} material={glow} />
      {/* colliders: floor, four walls (the back one closes the hatch too), the ceiling */}
      <FloorCollider size={[W + 1, D + 1]} />
      <Solid size={[W + 1, H, 0.4]} at={[0, H / 2, -D / 2 - 0.2]} />
      <Solid size={[W + 1, H, 0.4]} at={[0, H / 2, D / 2 + 0.2]} />
      <Solid size={[0.4, H, D + 1]} at={[-W / 2 - 0.2, H / 2, 0]} />
      <Solid size={[0.4, H, D + 1]} at={[W / 2 + 0.2, H / 2, 0]} />
      <Solid size={[W + 1, 0.4, D + 1]} at={[0, H + 0.2, 0]} />
    </group>
  );
}

export function RestaurantScene() {
  const scroll1 = useMemo(() => scrollTexture('生意兴隆'), []);
  const scroll2 = useMemo(() => scrollTexture('宾至如归'), []);
  const hours = useMemo(() => noticeTexture('营业时间', '10:00 — 22:00'), []);
  const wifi = useMemo(() => noticeTexture('无线网密码', '88888888', '#eef6ff', '#1d4f91'), []);
  const rods = merged('scroll-rods', () => [-1.6, 0.5].flatMap((z) => [cyl(0.012, 0.4, [-2.975, 2.33, z], { rot: [Math.PI / 2, 0, 0], seg: 8 }), cyl(0.014, 0.4, [-2.975, 1.27, z], { rot: [Math.PI / 2, 0, 0], seg: 8 })]));
  return (
    <group>
      <Shell />
      <Kitchen />
      <TillCorner />
      <SideCabinet />
      <FrontDoor />
      <ChineseKnot />
      {/* scrolls on the left wall: business prospers / guests feel at home */}
      <Flat tex={scroll1} size={[0.32, 1.02]} position={[-2.985, 1.8, -1.6]} rotation={[0, Math.PI / 2, 0]} />
      <Flat tex={scroll2} size={[0.32, 1.02]} position={[-2.985, 1.8, 0.5]} rotation={[0, Math.PI / 2, 0]} />
      <mesh geometry={rods} material={mat('wood', '#3a1f10')} />
      {/* a window at dusk on the left wall */}
      <WindowPane size={[1.0, 0.9]} sky={['#2f3f6e', '#e8996a']} frame="#5a2a18" position={[-2.93, 1.65, 1.5]} rotation={[0, Math.PI / 2, 0]} />
      {/* notices: opening hours by the fridge, the Wi-Fi password by the fish tank */}
      <Flat tex={hours} size={[0.44, 0.22]} position={[2.985, 1.65, -1.2]} rotation={[0, -Math.PI / 2, 0]} />
      <Flat tex={wifi} size={[0.36, 0.18]} position={[2.985, 1.55, 1.05]} rotation={[0, -Math.PI / 2, 0]} />
      <Plant height={1.0} position={[2.55, 0.5, 2.1]} pot="#8a3a22" />
      <SolidCylinder r={0.2} h={0.35} at={[2.55, 0.175, 2.1]} />
    </group>
  );
}
