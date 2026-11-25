/**
 * The airport's static world: the departures hall (terrazzo floor, a carpeted gate lounge, panelled
 * walls, a glass curtain wall onto the apron, a ceiling of light strips, columns with posters), the
 * decor that has no task (signage, queue posts, the security divest table, the tray stand, the gate
 * desk, café shelves and tables, the exit doors) — and the `<Solid>` colliders. Outside the glass: the
 * apron, a jet bridge, a baggage tug, a control tower, a sky. Everything with a Chinese name to learn
 * is an OBJECT instead (index.tsx).
 *
 * Hall: x −6 … 6, z −5 … 5, 4.6 m high, centred on the origin. You start at z 4.2 by the exit doors,
 * facing the glass (−Z): check-in on the left, security in the middle, gate 12 at the back right, the
 * café on the right.
 */
import { useMemo } from 'react';
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { Box, Cyl, FloorCollider, RBox, Solid, SolidCylinder, mat } from '../kit';
import { Inst, Static, boxGeo, cylGeo, type InstanceAt } from './parts';
import {
  apronTexture, bannerTexture, carpetTexture, gateScreenTexture, menuTexture, posterTexture, skyTexture, terrazzoTexture,
  wayfindingTexture, type SignIcon,
} from './textures';

const W = 12;
const D = 10;
const H = 4.6;

const unlit = new Map<string, MeshBasicMaterial>();
function lit(key: string, make: () => MeshBasicMaterial): MeshBasicMaterial {
  let m = unlit.get(key);
  if (!m) {
    m = make();
    unlit.set(key, m);
  }
  return m;
}

/** A hanging / wall sign from the wayfinding texture (one textured plane + a dark frame). */
function Wayfinding({ zh, en, icon = 'none', arrow = '', size, position, rotation, bg, fg, hang }: {
  zh: string; en: string; icon?: SignIcon; arrow?: '←' | '→' | '↑' | '↓' | ''; size: [number, number];
  position: [number, number, number]; rotation?: [number, number, number]; bg?: string; fg?: string; hang?: number;
}) {
  const face = useMemo(() => lit(`w:${zh}:${en}:${arrow}:${bg}`, () => new MeshBasicMaterial({ map: wayfindingTexture({ zh, en, icon, arrow, bg, fg, aspect: size[0] / size[1] }), toneMapped: false, side: DoubleSide })), [zh, en, icon, arrow, bg, fg, size]);
  return (
    <group position={position} rotation={rotation}>
      <Box size={[size[0] + 0.05, size[1] + 0.05, 0.05]} material={mat('painted', '#1d2026')} cast={false} />
      <mesh position={[0, 0, 0.027]} material={face}>
        <planeGeometry args={size} />
      </mesh>
      <mesh position={[0, 0, -0.027]} rotation={[0, Math.PI, 0]} material={face}>
        <planeGeometry args={size} />
      </mesh>
      {hang ? [-size[0] * 0.35, size[0] * 0.35].map((x) => <Box key={x} size={[0.02, hang, 0.02]} position={[x, size[1] / 2 + hang / 2, 0]} material={mat('steel')} cast={false} />) : null}
    </group>
  );
}

function Hall() {
  const floor = useMemo(() => new MeshStandardMaterial({ map: terrazzoTexture(), roughness: 0.22, metalness: 0.05 }), []);
  const carpet = useMemo(() => new MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 }), []);
  const lowerWall = mat('stone', '#cfd3d6', { roughness: 0.45, repeat: [6, 1] });
  const upperWall = mat('plaster', '#eef0f1', { repeat: [5, 2] });
  const ceiling = mat('plaster', '#f6f7f8');
  const mullion = mat('painted', '#4a5058', { roughness: 0.4, metalness: 0.3 });
  const mullions = useMemo<InstanceAt[]>(() => Array.from({ length: 9 }, (_, i) => ({ p: [-6 + i * 1.5, H / 2, -4.98] })), []);
  const lights = useMemo<InstanceAt[]>(() => {
    const out: InstanceAt[] = [];
    for (const z of [-3.6, -1.2, 1.2, 3.6]) for (const x of [-4.2, -1.4, 1.4, 4.2]) out.push({ p: [x, H - 0.04, z] });
    return out;
  }, []);
  const baffles = useMemo<InstanceAt[]>(() => Array.from({ length: 23 }, (_, i) => ({ p: [-5.5 + i * 0.5, H - 0.22, 0] })), []);
  const glow = lit('ceiling-light', () => new MeshBasicMaterial({ color: '#fdfcf7', toneMapped: false }));
  return (
    <group>
      {/* floor + the gate lounge carpet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={floor} receiveShadow>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.8, 0.003, -3.6]} material={carpet} receiveShadow>
        <planeGeometry args={[4.4, 2.8]} />
      </mesh>
      {/* walls: stone panels below, plaster above (left, right, front); the back is glass */}
      {([
        [[-W / 2, 0, 0], [0, Math.PI / 2, 0], D],
        [[W / 2, 0, 0], [0, -Math.PI / 2, 0], D],
        [[0, 0, D / 2], [0, Math.PI, 0], W],
      ] as Array<[[number, number, number], [number, number, number], number]>).map(([p, r, len], i) => (
        <group key={i} position={p} rotation={r}>
          <mesh position={[0, 1.2, 0]} material={lowerWall} receiveShadow>
            <planeGeometry args={[len, 2.4]} />
          </mesh>
          <mesh position={[0, 2.4 + (H - 2.4) / 2, 0]} material={upperWall}>
            <planeGeometry args={[len, H - 2.4]} />
          </mesh>
          <Box size={[len, 0.04, 0.03]} position={[0, 2.4, 0.015]} material={mat('steel', '#aab1b8')} cast={false} />
          <Box size={[len, 0.1, 0.02]} position={[0, 0.05, 0.01]} material={mat('painted', '#7d858c')} cast={false} />
        </group>
      ))}
      {/* the glass curtain wall onto the apron */}
      <mesh position={[0, H / 2, -5]} material={mat('glass', '#cfe6f2', { opacity: 0.14, roughness: 0.02 })}>
        <planeGeometry args={[W, H]} />
      </mesh>
      <Inst geometry={boxGeo(0.08, H, 0.12)} material={mullion} at={mullions} cast={false} />
      <Box size={[W, 0.1, 0.14]} position={[0, 2.9, -4.98]} material={mullion} cast={false} />
      <Box size={[W, 0.3, 0.3]} position={[0, 0.15, -4.92]} material={mat('painted', '#5d646c')} cast={false} receive />
      {/* the ceiling: plaster, wooden baffles, light panels */}
      <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]} material={ceiling}>
        <planeGeometry args={[W, D]} />
      </mesh>
      <Inst geometry={boxGeo(0.06, 0.4, D)} material={mat('wood', '#c49a6c')} at={baffles} cast={false} />
      <Inst geometry={boxGeo(1.6, 0.04, 0.5)} material={glow} at={lights} cast={false} />
      {/* columns with posters */}
      {([[-2.9, 0.45], [2.3, -0.25]] as Array<[number, number]>).map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Cyl r={0.32} h={H} position={[0, H / 2, 0]} material={mat('painted', '#e7e9eb', { roughness: 0.35 })} segments={24} receive />
          <Cyl r={0.34} h={0.12} position={[0, 0.06, 0]} material={mat('steel', '#9aa2aa')} segments={24} cast={false} />
          <mesh position={[0, 1.6, 0.345]} material={lit(`poster:${i}`, () => new MeshBasicMaterial({ map: posterTexture(i ? 'panda' : 'lake'), toneMapped: false }))}>
            <planeGeometry args={[0.5, 0.75]} />
          </mesh>
          <SolidCylinder r={0.33} h={H} at={[0, H / 2, 0]} />
        </group>
      ))}
      {/* colliders: floor, walls, the glass, the ceiling */}
      <FloorCollider size={[W + 1, D + 1]} />
      <Solid size={[W + 1, H, 0.4]} at={[0, H / 2, -D / 2 - 0.2]} />
      <Solid size={[W + 1, H, 0.4]} at={[0, H / 2, D / 2 + 0.2]} />
      <Solid size={[0.4, H, D + 1]} at={[-W / 2 - 0.2, H / 2, 0]} />
      <Solid size={[0.4, H, D + 1]} at={[W / 2 + 0.2, H / 2, 0]} />
      <Solid size={[W + 1, 0.4, D + 1]} at={[0, H + 0.2, 0]} />
    </group>
  );
}

/** Beyond the glass: apron, jet bridge, a tug with baggage carts, a tower, hills and sky. */
function Outside() {
  const apron = useMemo(() => new MeshStandardMaterial({ map: apronTexture(), roughness: 0.9 }), []);
  const sky = lit('sky', () => new MeshBasicMaterial({ map: skyTexture(), toneMapped: false, fog: false }));
  const yellow = mat('painted', '#f2c230', { roughness: 0.6 });
  const carts = useMemo<InstanceAt[]>(() => [0, 1, 2].map((i) => ({ p: [-9 - i * 2.4, 0.75, -12] })), []);
  const bags = useMemo<InstanceAt[]>(() => [0, 1, 2].flatMap((i) => [[-0.5, 0], [0.4, 0.2], [0, -0.4]].map(([dx, dz]) => ({ p: [-9 - i * 2.4 + dx, 1.25, -12 + dz] as [number, number, number], r: [0, i + dx, 0] as [number, number, number] }))), []);
  const edgeLights = useMemo<InstanceAt[]>(() => Array.from({ length: 14 }, (_, i) => ({ p: [-26 + i * 4, 0.12, -38] })), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -45]} material={apron} receiveShadow>
        <planeGeometry args={[160, 80]} />
      </mesh>
      {/* the stand's yellow lead-in line and a taxiway line */}
      <Box size={[0.25, 0.01, 30]} position={[11.5, 0.0, -20]} material={yellow} cast={false} />
      <Box size={[90, 0.01, 0.3]} position={[0, 0.0, -36]} material={yellow} cast={false} />
      <Inst geometry={cylGeo(0.08, 0.24, 8)} material={lit('edge-light', () => new MeshBasicMaterial({ color: '#5fb0ff', toneMapped: false }))} at={edgeLights} cast={false} />
      {/* the jet bridge: from the glass to the plane's front door */}
      <group position={[12.4, 3.4, -16.5]}>
        <Box size={[2.4, 2.5, 11]} material={mat('painted', '#c9ced2', { roughness: 0.45 })} cast={false} />
        <Box size={[2.42, 0.7, 10.8]} position={[0, 0.2, 0]} material={mat('glass', '#7f9db5', { opacity: 0.75 })} cast={false} />
        <Box size={[0.35, 3.4, 0.35]} position={[0, -2.9, 3.5]} material={mat('steel', '#8d959d')} cast={false} />
        <Box size={[1.6, 0.4, 0.8]} position={[0, -4.4, 3.5]} material={mat('rubber', '#2a2d31')} cast={false} />
      </group>
      {/* a baggage tug pulling three carts */}
      <group position={[-6.2, 0.7, -12]}>
        <RBox size={[2.0, 1.0, 1.4]} radius={0.12} material={yellow} cast={false} />
        <Box size={[0.8, 0.8, 1.3]} position={[-0.4, 0.85, 0]} material={mat('glass', '#7d93a6', { opacity: 0.6 })} cast={false} />
      </group>
      <Inst geometry={boxGeo(2.0, 0.2, 1.5)} material={mat('metal', '#6f7880')} at={carts} cast={false} />
      <Inst geometry={boxGeo(0.6, 0.45, 0.35)} material={mat('plastic', '#4c6d8f')} at={bags} cast={false} />
      {/* the control tower */}
      <group position={[-30, 0, -55]}>
        <Cyl r={2.2} rTop={1.6} h={26} position={[0, 13, 0]} material={mat('painted', '#e1e4e7')} segments={20} cast={false} />
        <Cyl r={4.6} rTop={5.4} h={3.2} position={[0, 27.6, 0]} material={mat('glass', '#3f6c8f', { opacity: 0.9 })} segments={20} cast={false} />
        <Cyl r={5.6} rTop={3} h={1.4} position={[0, 29.9, 0]} material={mat('painted', '#e1e4e7')} segments={20} cast={false} />
      </group>
      {/* a hangar on the horizon */}
      <Box size={[30, 9, 14]} position={[32, 4.5, -62]} material={mat('painted', '#b9c2c9')} cast={false} />
      {/* the sky: a wide backdrop with hills */}
      <mesh position={[0, 26, -80]} material={sky}>
        <planeGeometry args={[240, 70]} />
      </mesh>
    </group>
  );
}

function CheckIn() {
  const posts = useMemo<InstanceAt[]>(() => [0.95, 1.55, 2.15, 2.75].flatMap((z) => [{ p: [-3.75, 0.47, z] as [number, number, number] }, { p: [-3.15, 0.47, z] as [number, number, number] }]), []);
  const tapes = useMemo<InstanceAt[]>(() => [0.95, 1.55, 2.15].flatMap((z) => [{ p: [-3.75, 0.88, z + 0.3] as [number, number, number] }, { p: [-3.15, 0.88, z + 0.3] as [number, number, number] }]), []);
  return (
    <group>
      {/* the check-in backdrop on the left wall */}
      <group position={[-5.97, 0, 0.9]} rotation={[0, Math.PI / 2, 0]}>
        <Box size={[4.2, 2.0, 0.04]} position={[0, 2.6, 0]} material={mat('painted', '#1e4fa3', { roughness: 0.5 })} cast={false} />
      </group>
      <Wayfinding zh="值机" en="Check-in · Skylark Air" icon="checkin" size={[2.6, 0.6]} position={[-5.92, 3.1, 0.9]} rotation={[0, Math.PI / 2, 0]} bg="#1e4fa3" fg="#ffffff" />
      <Wayfinding zh="国内出发" en="Domestic departures" icon="plane" size={[2.6, 0.55]} position={[-5.92, 2.35, 0.9]} rotation={[0, Math.PI / 2, 0]} bg="#163d80" fg="#ffd24a" />
      {/* queue posts with blue belts */}
      <Inst geometry={cylGeo(0.03, 0.94, 10)} material={mat('chrome')} at={posts} cast={false} />
      <Inst geometry={boxGeo(0.008, 0.05, 0.6)} material={mat('fabric', '#1e4fa3')} at={tapes} cast={false} />
      {/* the information sign over the desk */}
      <Wayfinding zh="问询" en="Information" icon="info" size={[1.3, 0.4]} position={[-5.93, 2.3, 4.15]} rotation={[0, Math.PI / 2, 0]} bg="#1e4fa3" fg="#ffffff" />
    </group>
  );
}

function Security() {
  return (
    <group>
      {/* the divest table where you empty your pockets */}
      <group position={[-2.6, 0, -0.6]}>
        <RBox size={[1.3, 0.05, 0.6]} radius={0.01} position={[0, 0.775, 0]} material={mat('steel', '#c3c9cf', { roughness: 0.3 })} receive />
        {[-0.6, 0.6].map((x) => <Box key={x} size={[0.05, 0.75, 0.5]} position={[x, 0.375, 0]} material={mat('steel', '#8d959d')} cast={false} />)}
        <Box size={[1.2, 0.03, 0.5]} position={[0, 0.25, 0]} material={mat('steel', '#8d959d')} cast={false} />
      </group>
      <Solid size={[1.3, 0.8, 0.6]} at={[-2.6, 0.4, -0.6]} />
      {/* the tray stand */}
      <group position={[-3.65, 0, -1.8]}>
        <Box size={[0.62, 0.04, 0.46]} position={[0, 0.68, 0]} material={mat('steel', '#c3c9cf')} receive cast={false} />
        {[[-0.28, -0.2], [0.28, -0.2], [-0.28, 0.2], [0.28, 0.2]].map(([x, z]) => <Cyl key={`${x}${z}`} r={0.015} h={0.66} position={[x, 0.33, z]} material={mat('steel', '#8d959d')} segments={8} cast={false} />)}
      </group>
      <Solid size={[0.62, 0.7, 0.46]} at={[-3.65, 0.35, -1.8]} />
      {/* the one-metre line on the floor: 请在一米线外等候 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.2, 0.004, 0.25]} material={lit('one-metre', () => new MeshBasicMaterial({ map: wayfindingTexture({ zh: '请在一米线外等候', en: 'Please wait behind the line', bg: '#ffd24a', fg: '#1a1a1a', aspect: 6 }), toneMapped: false }))}>
        <planeGeometry args={[2.4, 0.4]} />
      </mesh>
      <Wayfinding zh="安检" en="Security check" icon="security" size={[1.4, 0.42]} position={[1.0, 2.5, -1.8]} />
    </group>
  );
}

function Gate() {
  const screenMat = lit('gate-screen', () => new MeshBasicMaterial({ map: gateScreenTexture(), toneMapped: false }));
  return (
    <group>
      {/* the gate desk with its screen */}
      <group position={[5.15, 0, -3.5]}>
        <RBox size={[1.1, 1.05, 0.5]} radius={0.04} position={[0, 0.525, 0]} material={mat('painted', '#f3f4f6', { roughness: 0.3 })} />
        <Box size={[1.12, 0.12, 0.02]} position={[0, 0.85, 0.25]} material={mat('plastic', '#1e4fa3')} cast={false} />
        <Box size={[0.05, 0.5, 0.05]} position={[0, 1.3, -0.1]} material={mat('steel')} cast={false} />
        <RBox size={[0.7, 0.42, 0.04]} radius={0.01} position={[0, 1.7, -0.1]} material={mat('plastic', '#2b2f36')} cast={false} />
        <mesh position={[0, 1.7, -0.078]} material={screenMat}>
          <planeGeometry args={[0.66, 0.38]} />
        </mesh>
      </group>
      <Solid size={[1.1, 1.05, 0.5]} at={[5.15, 0.525, -3.5]} />
      {/* the gate sign's post */}
      <Cyl r={0.04} h={2.27} position={[5.6, 1.135, -2.35]} material={mat('steel', '#8d959d')} segments={10} cast={false} />
      <SolidCylinder r={0.05} h={2.27} at={[5.6, 1.135, -2.35]} />
      {/* the seat rows' backrests (the seats are objects) */}
      <Solid size={[2.4, 0.5, 0.08]} at={[3.3, 0.72, -2.72]} />
      <Solid size={[2.4, 0.5, 0.08]} at={[3.3, 0.72, -3.82]} />
      <Wayfinding zh="登机口" en="Gates 1–20" icon="plane" arrow="↑" size={[1.9, 0.44]} position={[2.6, 3.9, 1.8]} hang={0.48} />
    </group>
  );
}

/** A café chair: a wooden seat and back on one pedestal (lighter than the kit's four-legged chair). */
function CafeChair({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <RBox size={[0.42, 0.04, 0.42]} radius={0.01} position={[0, 0.45, 0]} material={mat('wood', '#a8774a')} receive />
      <RBox size={[0.42, 0.36, 0.03]} radius={0.01} position={[0, 0.68, -0.2]} material={mat('wood', '#a8774a')} cast={false} />
      <Cyl r={0.025} h={0.44} position={[0, 0.22, 0]} material={mat('steel', '#3b3f45')} segments={8} cast={false} />
    </group>
  );
}

function Cafe() {
  const menu = lit('menu', () => new MeshBasicMaterial({ map: menuTexture(), toneMapped: false }));
  const jars = useMemo<InstanceAt[]>(() => [1.9, 2.25, 2.6, 2.95, 3.3].flatMap((z) => [{ p: [5.85, 1.42, z] as [number, number, number] }, { p: [5.85, 1.82, z + 0.1] as [number, number, number] }]), []);
  const shelves = useMemo<InstanceAt[]>(() => [1.3, 1.7].map((y) => ({ p: [5.86, y, 2.6] })), []);
  const tables: Array<[number, number]> = [[3.4, 2.2], [3.4, 3.75]];
  return (
    <group>
      {/* back bar: shelves with jars, the menu board, the café name over it */}
      <Inst geometry={boxGeo(0.26, 0.03, 2.0)} material={mat('wood', '#7a4f2c')} at={shelves} cast={false} />
      <Inst geometry={cylGeo(0.06, 0.18, 12)} material={mat('glass', '#d8c4a0', { opacity: 0.7 })} at={jars} cast={false} />
      <mesh position={[5.95, 2.55, 2.6]} rotation={[0, -Math.PI / 2, 0]} material={menu}>
        <planeGeometry args={[1.1, 1.1]} />
      </mesh>
      <Box size={[0.03, 1.18, 1.18]} position={[5.985, 2.55, 2.6]} material={mat('wood', '#3b2a1e')} cast={false} />
      {/* pendant lamps over the bar (one warm light, always mounted) */}
      {[2.0, 2.6, 3.2].map((z) => (
        <group key={z} position={[4.9, 0, z]}>
          <Cyl r={0.004} h={1.6} position={[0, 3.8, 0]} material={mat('rubber', '#222')} cast={false} />
          <Cyl r={0.12} rTop={0.03} h={0.16} open position={[0, 2.95, 0]} material={mat('metal', '#2d2d2d', { doubleSide: true, roughness: 0.5 })} cast={false} />
          <mesh position={[0, 2.88, 0]} material={lit('bulb', () => new MeshBasicMaterial({ color: '#ffe2a8', toneMapped: false }))}>
            <sphereGeometry args={[0.04, 10, 8]} />
          </mesh>
        </group>
      ))}
      <pointLight position={[4.6, 2.7, 2.6]} color="#ffcf8f" intensity={3.2} distance={5} decay={1.6} />
      {/* two café tables with chairs */}
      {tables.map(([x, z]) => (
        <group key={z}>
          <Cyl r={0.36} h={0.03} position={[x, 0.725, z]} material={mat('wood', '#c49a6c')} segments={24} receive />
          <Cyl r={0.03} h={0.7} position={[x, 0.36, z]} material={mat('steel', '#4a5058')} segments={8} cast={false} />
          <Cyl r={0.22} h={0.02} position={[x, 0.01, z]} material={mat('steel', '#4a5058')} segments={16} cast={false} />
          <SolidCylinder r={0.36} h={0.74} at={[x, 0.37, z]} />
          {[-1, 1].map((s) => (
            <group key={s}>
              <CafeChair position={[x + s * 0.62, 0, z]} rotation={[0, -s * Math.PI / 2, 0]} />
              <Solid size={[0.42, 0.45, 0.42]} at={[x + s * 0.62, 0.225, z]} />
            </group>
          ))}
        </group>
      ))}
      {/* the café counter's back: a low wall so nothing rolls under the shelves */}
      <Solid size={[0.3, 1.1, 2.0]} at={[5.85, 0.55, 2.6]} />
    </group>
  );
}

function Doors() {
  const frame = mat('painted', '#4a5058', { roughness: 0.4, metalness: 0.3 });
  const outside = lit('outside-light', () => new MeshBasicMaterial({ color: '#e7eff5', toneMapped: false }));
  return (
    <group position={[0, 0, 4.98]}>
      {/* the exit doors behind the start: a bright street outside */}
      <mesh position={[0, 1.2, 0.01]} rotation={[0, Math.PI, 0]} material={outside}>
        <planeGeometry args={[2.2, 2.4]} />
      </mesh>
      <Box size={[2.3, 0.12, 0.1]} position={[0, 2.44, -0.02]} material={frame} cast={false} />
      {[-1.12, 0, 1.12].map((x) => <Box key={x} size={[0.06, 2.4, 0.1]} position={[x, 1.2, -0.02]} material={frame} cast={false} />)}
      <mesh position={[0, 1.2, -0.03]} rotation={[0, Math.PI, 0]} material={mat('glass', '#d5e6ee', { opacity: 0.3 })}>
        <planeGeometry args={[2.2, 2.4]} />
      </mesh>
      {/* the toilets' corridor on the left wall */}
      <group position={[-5.99, 0, -8.38]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.1, 0]} material={lit('corridor', () => new MeshBasicMaterial({ color: '#c9d2d8', toneMapped: false }))}>
          <planeGeometry args={[1.3, 2.2]} />
        </mesh>
        {[-0.68, 0.68].map((x) => <Box key={x} size={[0.06, 2.24, 0.08]} position={[x, 1.12, 0.02]} material={frame} cast={false} />)}
        <Box size={[1.42, 0.06, 0.08]} position={[0, 2.22, 0.02]} material={frame} cast={false} />
      </group>
      {/* the welcome banner on the right wall */}
      <mesh position={[5.97, 3.75, -4.98]} rotation={[0, -Math.PI / 2, 0]} material={lit('banner', () => new MeshBasicMaterial({ map: bannerTexture(), toneMapped: false }))}>
        <planeGeometry args={[6.4, 0.8]} />
      </mesh>
    </group>
  );
}

export function AirportScene() {
  return (
    <group>
      <Static>
        <Hall />
        <CheckIn />
        <Security />
        <Gate />
        <Cafe />
        <Doors />
      </Static>
      <Static>
        <Outside />
      </Static>
    </group>
  );
}
