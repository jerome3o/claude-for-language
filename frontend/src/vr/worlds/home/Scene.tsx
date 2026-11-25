/**
 * The apartment's static world (docs/VR_WORLDS.md): floors (wooden planks, tiles in the bathroom and the
 * entry), the outer walls, the interior walls with their doorways (ONE merged mesh), skirting and door
 * casings (merged too), the ceiling and its lights, decor (a 山水 painting, 家和万事兴 in the hallway, a
 * Chinese knot, the 出入平安 doormat, books on the shelves, the shower, the stairwell behind the front
 * door) — and the `<Solid>` colliders. Everything with a Chinese word to learn is an OBJECT (index.tsx).
 *
 * Walls never cast shadows, so the one directional light reaches every room.
 */
import { useMemo } from 'react';
import { Box, Cyl, FloorCollider, RBox, Rug, Sign, Solid, SolidCylinder, mat, noiseTexture, seeded } from '../kit';
import { MergedBoxes, type MergedBox } from './merged';
import { Bottle, BedroomWindow, GatheredCurtains } from './models';
import { doormatTexture, moonTexture, paintingTexture, scrollTexture } from './textures';

type V3 = [number, number, number];

const H = 2.7;
const WALL = '#f3ede2';
const TRIM = '#efe8dc';

/** Interior walls (thickness 0.1): the line z −0.6 with the hallway opening, the hallway's two walls with doorways. */
const INTERIOR: Array<{ size: V3; at: V3 }> = [
  { size: [4.4, H, 0.1], at: [-1.8, H / 2, -0.6] },
  { size: [2.3, H, 0.1], at: [2.85, H / 2, -0.6] },
  { size: [1.3, 0.45, 0.1], at: [1.05, 2.475, -0.6] },
  // x 0.4: bedroom | hallway (doorway z −2.0 … −1.2)
  { size: [0.1, H, 1.4], at: [0.4, H / 2, -2.7] },
  { size: [0.1, H, 0.6], at: [0.4, H / 2, -0.9] },
  { size: [0.1, 0.6, 0.8], at: [0.4, 2.4, -1.6] },
  // x 1.7: hallway | bathroom (doorway z −2.0 … −1.2)
  { size: [0.1, H, 1.4], at: [1.7, H / 2, -2.7] },
  { size: [0.1, H, 0.6], at: [1.7, H / 2, -0.9] },
  { size: [0.1, 0.6, 0.8], at: [1.7, 2.4, -1.6] },
];

/** Door casings and the hallway arch (light trim), the front door's frame (wood). */
const CASINGS: MergedBox[] = [
  { size: [0.08, 2.25, 0.03], at: [0.49, 1.125, -0.535], color: TRIM },
  { size: [0.08, 2.25, 0.03], at: [1.61, 1.125, -0.535], color: TRIM },
  { size: [1.3, 0.08, 0.03], at: [1.05, 2.25, -0.535], color: TRIM },
  ...[0.4, 1.7].flatMap((x): MergedBox[] => [
    { size: [0.14, 2.1, 0.06], at: [x, 1.05, -1.97], color: TRIM },
    { size: [0.14, 2.1, 0.06], at: [x, 1.05, -1.23], color: TRIM },
    { size: [0.14, 0.06, 0.92], at: [x, 2.13, -1.6], color: TRIM },
  ]),
  { size: [0.03, 2.12, 0.08], at: [3.985, 1.06, 1.11], color: '#6e4a2f' },
  { size: [0.03, 2.12, 0.08], at: [3.985, 1.06, 2.09], color: '#6e4a2f' },
  { size: [0.03, 0.08, 1.06], at: [3.985, 2.1, 1.6], color: '#6e4a2f' },
];

/** Skirting boards along the walls (8 cm). */
const SKIRT = '#d8cbb5';
const sk = (x0: number, x1: number, z: number): MergedBox => ({ size: [x1 - x0, 0.08, 0.015], at: [(x0 + x1) / 2, 0.04, z], color: SKIRT });
const skz = (z0: number, z1: number, x: number): MergedBox => ({ size: [0.015, 0.08, z1 - z0], at: [x, 0.04, (z0 + z1) / 2], color: SKIRT });
const SKIRTING: MergedBox[] = [
  sk(-4, 4, 3.392), sk(-4, 0.4, -0.542), sk(1.7, 4, -0.542),
  skz(-0.55, 3.4, -3.992), skz(-0.55, 1.1, 3.992), skz(2.1, 3.4, 3.992),
  sk(-4, 0.35, -3.392), sk(-4, 0.35, -0.658), skz(-3.4, -2.0, 0.342), skz(-1.2, -0.65, 0.342), skz(-3.4, -0.65, -3.992),
  skz(-3.4, -2.0, 0.458), skz(-1.2, -0.6, 0.458), skz(-3.4, -2.0, 1.642), skz(-1.2, -0.6, 1.642), sk(0.45, 1.65, -3.392),
];

/** Decor books standing on the bookshelf's shelves (left part), one merged mesh. */
const SHELF_TOPS = [0.02, 0.465, 1.355];
const BOOK_COLOURS = ['#8b1e1e', '#1f4e79', '#2e6b3f', '#c9a227', '#5b3a1d', '#d9d2c5', '#3b3f6b', '#a14b2a', '#6b8f8a', '#2b2b2b'];
function shelfBooks(): MergedBox[] {
  const rnd = seeded(42);
  const out: MergedBox[] = [];
  for (const top of SHELF_TOPS) {
    let x = -0.73;
    while (x < -0.37) {
      const w = 0.025 + rnd() * 0.02;
      const h = 0.2 + rnd() * 0.12;
      out.push({ size: [w, h, 0.18 + rnd() * 0.05], at: [x + w / 2, top + h / 2, -0.38], color: BOOK_COLOURS[Math.floor(rnd() * BOOK_COLOURS.length)] });
      x += w + 0.002;
    }
  }
  // a short stack lying on the desk in the bedroom
  out.push({ size: [0.16, 0.03, 0.22], at: [-1.42, 0.765, -1.05], color: '#3b3f6b' });
  out.push({ size: [0.15, 0.025, 0.21], at: [-1.42, 0.793, -1.05], yaw: 0.15, color: '#c9a227' });
  return out;
}

function Plane({ size, at, rot = [0, 0, 0], material, receive = true }: { size: [number, number]; at: V3; rot?: V3; material: ReturnType<typeof mat>; receive?: boolean }) {
  return (
    <mesh position={at} rotation={rot} material={material} receiveShadow={receive}>
      <planeGeometry args={size} />
    </mesh>
  );
}

function Picture({ map, size, at, rot = [0, 0, 0], frame = '#3a2a1c' }: { map: ReturnType<typeof paintingTexture>; size: [number, number]; at: V3; rot?: V3; frame?: string }) {
  return (
    <group position={at} rotation={rot}>
      <Box size={[size[0] + 0.06, size[1] + 0.06, 0.025]} position={[0, 0, -0.008]} material={mat('wood', frame)} cast={false} />
      <mesh position={[0, 0, 0.0055]}>
        <planeGeometry args={size} />
        <meshStandardMaterial map={map} roughness={0.85} />
      </mesh>
    </group>
  );
}

/** A red Chinese knot (中国结) with a tassel, hung on a wall (faces +Z). */
function ChineseKnot() {
  const red = mat('fabric', '#c8102e');
  return (
    <group>
      <Cyl r={0.004} h={0.12} position={[0, 0.2, 0]} material={red} segments={6} cast={false} />
      <RBox size={[0.17, 0.17, 0.025]} radius={0.01} rotation={[0, 0, Math.PI / 4]} position={[0, 0.02, 0]} material={red} cast={false} />
      <RBox size={[0.1, 0.1, 0.03]} radius={0.008} rotation={[0, 0, Math.PI / 4]} position={[0, 0.02, 0.004]} material={mat('fabric', '#e0b84a')} cast={false} />
      <Cyl r={0.012} h={0.03} position={[0, -0.12, 0]} material={mat('fabric', '#e0b84a')} segments={8} cast={false} />
      <Cyl r={0.03} rTop={0.012} h={0.2} position={[0, -0.24, 0]} material={red} segments={10} cast={false} />
    </group>
  );
}

export function HomeScene() {
  const plaster = useMemo(() => noiseTexture('#ffffff', 0.04, [3, 1]), []);
  const interior = useMemo<MergedBox[]>(() => INTERIOR.map((w) => ({ ...w, color: WALL })), []);
  const books = useMemo(shelfBooks, []);
  const wall = mat('plaster', WALL, { repeat: [4, 2] });
  const bathTile = (w: number) => mat('tile', '#eef2f2', { tiles: 6, grout: '#c9d1d1', repeat: [Math.max(1, Math.round(w / 1.2 * 10) / 10), 2.2] });
  const doormat = useMemo(() => doormatTexture(), []);
  return (
    <group>
      {/* ── floors, ceiling ── */}
      <Plane size={[8, 6.8]} at={[0, 0, 0]} rot={[-Math.PI / 2, 0, 0]} material={mat('wood_planks', '#a77b52', { repeat: [6, 5] })} />
      <Plane size={[2.3, 2.8]} at={[2.85, 0.002, -2.0]} rot={[-Math.PI / 2, 0, 0]} material={mat('tile', '#dfe4e4', { tiles: 4, grout: '#b6bebe', repeat: [3, 4] })} />
      <Plane size={[1.1, 3.95]} at={[3.45, 0.002, 1.425]} rot={[-Math.PI / 2, 0, 0]} material={mat('tile', '#d6cdbd', { tiles: 2, grout: '#a39a88', repeat: [1.2, 4.4] })} />
      <Plane size={[8, 6.8]} at={[0, H - 0.001, 0]} rot={[Math.PI / 2, 0, 0]} material={mat('plaster', '#fbf8f2')} receive={false} />
      {([[-2.1, 1.3, 0.24], [3.2, 1.5, 0.18], [1.05, -2.0, 0.15], [-2.2, -2.0, 0.22], [2.85, -2.0, 0.18]] as Array<[number, number, number]>).map(([x, z, r]) => (
        <Cyl key={`${x}:${z}`} r={r} h={0.03} position={[x, H - 0.015, z]} material={mat('glow', '#fff7e6')} cast={false} segments={20} />
      ))}

      {/* ── outer walls (planes, seen from inside), split around the front door ── */}
      <Plane size={[8, H]} at={[0, H / 2, -3.4]} material={wall} />
      <Plane size={[8, H]} at={[0, H / 2, 3.4]} rot={[0, Math.PI, 0]} material={wall} />
      <Plane size={[6.8, H]} at={[-4, H / 2, 0]} rot={[0, Math.PI / 2, 0]} material={wall} />
      <Plane size={[4.55, H]} at={[4, H / 2, -1.125]} rot={[0, -Math.PI / 2, 0]} material={wall} />
      <Plane size={[1.35, H]} at={[4, H / 2, 2.725]} rot={[0, -Math.PI / 2, 0]} material={wall} />
      <Plane size={[0.9, 0.6]} at={[4, 2.4, 1.6]} rot={[0, -Math.PI / 2, 0]} material={wall} />
      {/* accent walls: sage behind the bed, walnut behind the TV */}
      <Plane size={[2.75, H]} at={[-3.997, H / 2, -2.025]} rot={[0, Math.PI / 2, 0]} material={mat('plaster', '#c8d5c6', { repeat: [2, 2] })} />
      <Box size={[2.6, 2.3, 0.03]} position={[-2.1, 1.15, 3.385]} material={mat('wood', '#7d5b3e', { repeat: [3, 1] })} cast={false} receive />

      {/* ── interior walls, casings, skirting (one mesh each) ── */}
      <MergedBoxes boxes={interior} map={plaster} roughness={0.95} />
      <MergedBoxes boxes={CASINGS} roughness={0.5} />
      <MergedBoxes boxes={SKIRTING} roughness={0.6} />

      {/* ── bathroom tiles ── */}
      <Plane size={[2.2, H]} at={[2.85, H / 2, -3.397]} material={bathTile(2.2)} />
      <Plane size={[2.7, H]} at={[3.997, H / 2, -2.0]} rot={[0, -Math.PI / 2, 0]} material={bathTile(2.7)} />
      <Plane size={[2.2, H]} at={[2.85, H / 2, -0.653]} rot={[0, Math.PI, 0]} material={bathTile(2.2)} />
      <Plane size={[1.35, H]} at={[1.753, H / 2, -2.675]} rot={[0, Math.PI / 2, 0]} material={bathTile(1.35)} />
      <Plane size={[0.55, H]} at={[1.753, H / 2, -0.925]} rot={[0, Math.PI / 2, 0]} material={bathTile(0.55)} />

      {/* ── living room decor ── */}
      <Rug size={[2.0, 1.1]} position={[-2.1, 0, 1.15]} color="#a8483a" border="#e9d5ae" />
      <Picture map={paintingTexture()} size={[1.2, 0.52]} at={[-2.1, 1.55, -0.53]} />
      <MergedBoxes boxes={books} roughness={0.75} />
      {/* a blue-and-white vase and a photo on the middle shelf */}
      <Cyl r={0.05} rTop={0.03} h={0.22} position={[-0.6, 1.02, -0.38]} material={mat('ceramic', '#f3f1ea')} segments={16} />
      <Cyl r={0.051} rTop={0.045} h={0.05} open position={[-0.6, 0.97, -0.38]} material={mat('ceramic', '#2b5fa8')} segments={16} cast={false} />
      <RBox size={[0.16, 0.2, 0.015]} radius={0.004} position={[-0.38, 1.01, -0.46]} rotation={[-0.12, 0, 0]} material={mat('wood', '#3a2a1c')} cast={false} />
      {/* switches */}
      <Box size={[0.08, 0.08, 0.01]} position={[0.25, 1.3, -0.545]} material={mat('plastic', '#f7f7f5')} cast={false} />
      <Box size={[0.01, 0.08, 0.08]} position={[3.995, 1.3, 2.85]} material={mat('plastic', '#f7f7f5')} cast={false} />
      {/* the entry: a Chinese knot over the shoe cabinet, the doormat, shoes, the umbrella stand */}
      <group position={[3.985, 1.6, 0.2]} rotation={[0, -Math.PI / 2, 0]}>
        <ChineseKnot />
      </group>
      <group position={[3.5, 0.005, 1.6]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.9, 0.6]} />
          <meshStandardMaterial map={doormat} roughness={0.95} />
        </mesh>
      </group>
      {[-0.06, 0.06].map((dz) => (
        <group key={dz} position={[3.35, 0, 0.1 + dz]} rotation={[0, Math.PI / 2 + dz, 0]}>
          <RBox size={[0.1, 0.025, 0.27]} radius={0.008} position={[0, 0.0125, 0]} material={mat('rubber', '#e9e9e6')} cast={false} />
          <RBox size={[0.09, 0.06, 0.2]} radius={0.025} position={[0, 0.05, -0.02]} material={mat('fabric', '#3b4a6b')} cast={false} />
        </group>
      ))}
      <Cyl r={0.11} h={0.45} open position={[3.72, 0.225, 2.95]} material={mat('metal', '#2f3236', { doubleSide: true, roughness: 0.4 })} segments={20} />
      <Cyl r={0.11} h={0.01} position={[3.72, 0.005, 2.95]} material={mat('metal', '#2f3236')} segments={20} cast={false} />

      {/* ── hallway ── */}
      <group position={[1.05, 1.45, -3.395]}>
        <mesh>
          <planeGeometry args={[0.36, 1.15]} />
          <meshStandardMaterial map={scrollTexture('家和万事兴')} roughness={0.9} />
        </mesh>
        <Cyl r={0.012} h={0.44} position={[0, 0.59, 0.01]} rotation={[0, 0, Math.PI / 2]} material={mat('wood', '#4a3220')} segments={8} cast={false} />
        <Cyl r={0.014} h={0.44} position={[0, -0.59, 0.01]} rotation={[0, 0, Math.PI / 2]} material={mat('wood', '#4a3220')} segments={8} cast={false} />
      </group>

      {/* ── bedroom decor ── */}
      <group position={[-2.9, 1.5, -3.36]}>
        <BedroomWindow />
        <group position={[0, 0.02, 0.08]}>
          <GatheredCurtains width={1.2} height={1.3} />
        </group>
      </group>
      <Picture map={moonTexture()} size={[0.75, 0.5]} at={[-3.985, 1.55, -2.15]} rot={[0, Math.PI / 2, 0]} frame="#d9cbb5" />
      <Rug size={[1.4, 0.6]} position={[-2.75, 0, -1.05]} color="#d8c7a6" border="#8a9bb0" />
      {/* a pen pot on the desk */}
      <Cyl r={0.035} h={0.1} position={[-1.45, 0.8, -0.75]} material={mat('ceramic', '#2f6f7a')} segments={12} />
      {[[-0.01, 0.0, '#c8102e'], [0.012, 0.008, '#2b5fa8'], [0.0, -0.012, '#e0b84a']].map(([dx, dz, c]) => (
        <Cyl key={c as string} r={0.004} h={0.16} position={[-1.45 + (dx as number), 0.86, -0.75 + (dz as number)]} rotation={[0.08, 0, (dx as number) * 6]} material={mat('plastic', c as string)} segments={6} cast={false} />
      ))}

      {/* ── bathroom decor: the vanity under the basin, a shower corner, a towel rail, a bath mat ── */}
      <Box size={[1.0, 0.72, 0.5]} position={[2.45, 0.4, -3.15]} material={mat('painted', '#5b6b7a')} />
      <RBox size={[1.04, 0.04, 0.52]} radius={0.006} position={[2.45, 0.78, -3.14]} material={mat('stone', '#e9e6df', { roughness: 0.3 })} receive />
      {[2.2, 2.7].map((x) => <Box key={x} size={[0.012, 0.1, 0.012]} position={[x + (x < 2.45 ? 0.2 : -0.2), 0.62, -2.894]} material={mat('steel')} cast={false} />)}
      <Box size={[0.012, 0.62, 0.006]} position={[2.45, 0.42, -2.897]} material={mat('painted', '#4a5866')} cast={false} />
      <Box size={[0.8, 0.05, 0.5]} position={[2.15, 0.025, -0.9]} material={mat('ceramic', '#f7f7f4')} receive />
      <Cyl r={0.05} h={0.003} position={[2.15, 0.051, -0.9]} material={mat('chrome')} segments={16} cast={false} />
      <mesh position={[2.56, 1.0, -0.9]} rotation={[0, Math.PI / 2, 0]} material={mat('glass', '#d8ecf2')}>
        <planeGeometry args={[0.5, 1.9]} />
      </mesh>
      <Box size={[0.02, 1.9, 0.02]} position={[2.56, 1.0, -1.14]} material={mat('chrome')} cast={false} />
      <Cyl r={0.012} h={1.1} position={[2.15, 1.45, -0.67]} material={mat('chrome')} segments={10} cast={false} />
      <Cyl r={0.08} h={0.02} position={[2.15, 2.0, -0.76]} rotation={[0.35, 0, 0]} material={mat('chrome')} segments={18} cast={false} />
      <Box size={[0.12, 0.02, 0.32]} position={[1.81, 1.1, -0.86]} material={mat('chrome')} cast={false} />
      <Bottle text="洗发水" color="#e0b84a" position={[1.81, 1.19, -0.95]} />
      <Bottle text="沐浴露" color="#7fb3c9" position={[1.81, 1.19, -0.78]} />
      <Cyl r={0.01} h={0.5} position={[1.8, 1.3, -2.7]} rotation={[Math.PI / 2, 0, 0]} material={mat('chrome')} segments={8} cast={false} />
      <Box size={[0.03, 0.55, 0.42]} position={[1.8, 1.04, -2.7]} material={mat('fabric', '#e8c45a')} cast={false} />
      <RBox size={[0.6, 0.012, 0.4]} radius={0.006} position={[2.3, 0.008, -1.6]} material={mat('fabric', '#7fb3c9')} cast={false} />

      {/* ── the stairwell behind the front door (seen when it is open) ── */}
      <Plane size={[1.7, 2.8]} at={[4.85, 0.001, 1.6]} rot={[-Math.PI / 2, 0, 0]} material={mat('stone', '#a19c94', { repeat: [2, 3] })} />
      <Plane size={[2.8, H]} at={[5.7, H / 2, 1.6]} rot={[0, -Math.PI / 2, 0]} material={mat('plaster', '#dcd9d2')} />
      <Plane size={[1.7, H]} at={[4.85, H / 2, 0.2]} material={mat('plaster', '#dcd9d2')} />
      <Plane size={[1.7, H]} at={[4.85, H / 2, 3.0]} rot={[0, Math.PI, 0]} material={mat('plaster', '#dcd9d2')} />
      <Sign text="3楼" size={[0.36, 0.2]} bg="#2b5fa8" fg="#ffffff" position={[5.69, 1.75, 1.6]} rotation={[0, -Math.PI / 2, 0]} />

      {/* ── colliders ── */}
      <FloorCollider size={[12, 8]} center={[0.5, 0]} />
      <Solid size={[9, H, 0.4]} at={[0, H / 2, -3.6]} />
      <Solid size={[9, H, 0.4]} at={[0, H / 2, 3.6]} />
      <Solid size={[0.4, H, 7.6]} at={[-4.2, H / 2, 0]} />
      <Solid size={[0.4, H, 4.95]} at={[4.2, H / 2, -1.325]} />
      <Solid size={[0.4, H, 1.75]} at={[4.2, H / 2, 2.925]} />
      <Solid size={[0.4, 0.6, 0.9]} at={[4.2, 2.4, 1.6]} />
      <Solid size={[9, 0.4, 7.6]} at={[0, H + 0.2, 0]} />
      <Solid size={[0.2, H, 3]} at={[5.8, H / 2, 1.6]} />
      <Solid size={[1.8, H, 0.2]} at={[4.85, H / 2, 0.1]} />
      <Solid size={[1.8, H, 0.2]} at={[4.85, H / 2, 3.1]} />
      {INTERIOR.map((w, i) => <Solid key={i} size={w.size} at={w.at} />)}
      {/* sofa back, arms and back cushions (the seat is the 沙发 object) */}
      <Solid size={[2.0, 0.65, 0.22]} at={[-2.1, 0.525, -0.44]} />
      <Solid size={[1.6, 0.35, 0.12]} at={[-2.1, 0.62, -0.27]} />
      <Solid size={[0.2, 0.62, 0.8]} at={[-3.0, 0.31, -0.15]} />
      <Solid size={[0.2, 0.62, 0.8]} at={[-1.2, 0.31, -0.15]} />
      {/* the bed's headboard */}
      <Solid size={[0.08, 1.1, 1.6]} at={[-3.96, 0.55, -2.15]} />
      {/* decor books, the vase, the desk's book stack and pen pot */}
      {SHELF_TOPS.map((t) => <Solid key={t} size={[0.38, 0.32, 0.22]} at={[-0.545, t + 0.16, -0.38]} />)}
      <SolidCylinder r={0.05} h={0.22} at={[-0.6, 1.02, -0.38]} />
      <Solid size={[0.17, 0.06, 0.23]} at={[-1.42, 0.78, -1.05]} />
      <SolidCylinder r={0.036} h={0.1} at={[-1.45, 0.8, -0.75]} />
      {/* the vanity, the shower tray and glass, the umbrella stand's walls */}
      <Solid size={[1.0, 0.8, 0.5]} at={[2.45, 0.4, -3.15]} />
      <Solid size={[0.8, 0.05, 0.5]} at={[2.15, 0.025, -0.9]} />
      <Solid size={[0.02, 1.9, 0.5]} at={[2.56, 1.0, -0.9]} />
      <Solid size={[0.22, 0.45, 0.02]} at={[3.72, 0.225, 2.84]} />
      <Solid size={[0.22, 0.45, 0.02]} at={[3.72, 0.225, 3.06]} />
      <Solid size={[0.02, 0.45, 0.22]} at={[3.61, 0.225, 2.95]} />
      <Solid size={[0.02, 0.45, 0.22]} at={[3.83, 0.225, 2.95]} />
    </group>
  );
}
