/**
 * Furniture and room pieces for VR worlds (docs/VR_WORLDS.md "The helper library"). VISUAL ONLY and
 * centred on their bounding box: `size` = [width, height, depth], the origin is the middle of that box —
 * the same convention as an object's collider, so a fixed object (桌子, mass 0) can use `<Table>` as its
 * model with `collider: { box: size }`, and decor in a Scene is placed by its centre with a `<Solid>`
 * of the same size where things should bump into it.
 *
 * Every piece takes plain colours; materials come from kit/materials.ts (shared, cached).
 */
import { useMemo, type ReactNode } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { mat } from './materials';
import { Box, Cyl, RBox, Ball } from './shapes';
import { signTexture } from './textures';
import { FloorCollider, Solid } from './colliders';

type V3 = [number, number, number];

export interface PieceProps {
  position?: V3;
  rotation?: V3;
}

function Group({ position, rotation, children }: PieceProps & { children: ReactNode }) {
  return <group position={position} rotation={rotation}>{children}</group>;
}

/** A table: a top slab on four legs. */
export function Table({ size, color = '#a87447', legColor, top = 0.04, ...g }: PieceProps & { size: V3; color?: string; legColor?: string; top?: number }) {
  const [w, h, d] = size;
  const legs: V3[] = [[-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]].map(([x, , z]) => [x * (w / 2 - 0.06), -top / 2, z * (d / 2 - 0.06)]);
  const leg = mat('wood', legColor ?? color);
  return (
    <Group {...g}>
      <RBox size={[w, top, d]} radius={0.008} position={[0, h / 2 - top / 2, 0]} material={mat('wood', color, { repeat: [Math.max(1, w), 1] })} receive />
      {legs.map((p, i) => <Box key={i} size={[0.05, h - top, 0.05]} position={p} material={leg} />)}
    </Group>
  );
}

/** A chair: seat, back, four legs (faces +Z: you sit looking towards +Z). */
export function Chair({ size = [0.44, 0.9, 0.46], color = '#8c5a35', seatColor, ...g }: PieceProps & { size?: V3; color?: string; seatColor?: string }) {
  const [w, h, d] = size;
  const seatY = -h / 2 + 0.45;
  const wood = mat('wood', color);
  return (
    <Group {...g}>
      <RBox size={[w, 0.04, d]} radius={0.01} position={[0, seatY, 0]} material={seatColor ? mat('fabric', seatColor) : wood} receive />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => (
        <Box key={i} size={[0.035, 0.45, 0.035]} position={[x * (w / 2 - 0.03), -h / 2 + 0.225, z * (d / 2 - 0.03)]} material={wood} />
      ))}
      <RBox size={[w, h - 0.47, 0.03]} radius={0.01} position={[0, seatY + (h - 0.47) / 2 + 0.02, -d / 2 + 0.02]} material={wood} />
    </Group>
  );
}

/** A kitchen counter run: cabinets with doors + handles, a toe kick and a worktop (faces +Z). */
export function Counter({ size, top = '#d9d4c8', front = '#f3efe6', handle = '#8d939a', doors, topMaterial = 'stone', withTop = true, ...g }: PieceProps & {
  size: V3; top?: string; front?: string; handle?: string; doors?: number; topMaterial?: 'stone' | 'wood';
  /** false: no worktop (draw your own around a sink / hob cut-out). */
  withTop?: boolean;
}) {
  const [w, h, d] = size;
  const n = doors ?? Math.max(1, Math.round(w / 0.6));
  const dw = (w - 0.02) / n;
  const body = mat('painted', front);
  const handleMat = mat('steel', handle);
  return (
    <Group {...g}>
      <Box size={[w - 0.02, h - 0.14, d - 0.04]} position={[0, -0.03, -0.02]} material={body} receive />
      <Box size={[w - 0.06, 0.1, d - 0.1]} position={[0, -h / 2 + 0.05, -0.06]} material={mat('rubber', '#3a3a3a')} cast={false} />
      {withTop && <RBox size={[w, 0.04, d]} radius={0.006} position={[0, h / 2 - 0.02, 0]} material={mat(topMaterial, top, { repeat: [Math.max(1, w), 1] })} receive />}
      {Array.from({ length: n }, (_, i) => {
        const x = -w / 2 + 0.01 + dw * (i + 0.5);
        return (
          <group key={i} position={[x, -0.03, d / 2 - 0.035]}>
            <RBox size={[dw - 0.012, h - 0.17, 0.02]} radius={0.004} material={body} cast={false} />
            <Box size={[0.012, 0.12, 0.012]} position={[i % 2 === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05, h / 2 - 0.2, 0.02]} material={handleMat} cast={false} />
          </group>
        );
      })}
    </Group>
  );
}

/** Wall cupboards (hang them above a counter; faces +Z). */
export function WallCabinet({ size, color = '#f3efe6', handle = '#8d939a', doors, ...g }: PieceProps & { size: V3; color?: string; handle?: string; doors?: number }) {
  const [w, h, d] = size;
  const n = doors ?? Math.max(1, Math.round(w / 0.5));
  const dw = w / n;
  const body = mat('painted', color);
  return (
    <Group {...g}>
      <Box size={[w, h, d - 0.02]} position={[0, 0, -0.01]} material={body} />
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[-w / 2 + dw * (i + 0.5), 0, d / 2 - 0.01]}>
          <RBox size={[dw - 0.012, h - 0.012, 0.02]} radius={0.004} material={body} cast={false} />
          <Box size={[0.012, 0.1, 0.012]} position={[i % 2 === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05, -h / 2 + 0.08, 0.02]} material={mat('steel', handle)} cast={false} />
        </group>
      ))}
    </Group>
  );
}

/** Open shelves: sides, back and `shelves` boards (faces +Z). */
export function Shelf({ size, shelves = 3, color = '#b98a5a', ...g }: PieceProps & { size: V3; shelves?: number; color?: string }) {
  const [w, h, d] = size;
  const wood = mat('wood', color);
  return (
    <Group {...g}>
      <Box size={[0.02, h, d]} position={[-w / 2 + 0.01, 0, 0]} material={wood} />
      <Box size={[0.02, h, d]} position={[w / 2 - 0.01, 0, 0]} material={wood} />
      <Box size={[w, h, 0.01]} position={[0, 0, -d / 2 + 0.005]} material={wood} cast={false} />
      {Array.from({ length: shelves + 1 }, (_, i) => (
        <Box key={i} size={[w - 0.04, 0.02, d - 0.01]} position={[0, -h / 2 + 0.01 + (i * (h - 0.02)) / shelves, 0.005]} material={wood} receive />
      ))}
    </Group>
  );
}

/** A window in a wall: a frame, mullions and a bright sky behind (faces +Z, into the room). */
export function WindowPane({ size, frame = '#f5f2ea', sky = ['#9cc6ee', '#e7f1f8'], ...g }: PieceProps & { size: [number, number]; frame?: string; sky?: [string, string] }) {
  const [w, h] = size;
  const skyTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      const gr = ctx.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, sky[0]);
      gr.addColorStop(1, sky[1]);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 8, 128);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [sky]);
  const f = mat('painted', frame);
  return (
    <Group {...g}>
      <mesh position={[0, 0, -0.06]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={skyTex} toneMapped={false} />
      </mesh>
      <Box size={[w + 0.08, 0.05, 0.08]} position={[0, h / 2, 0]} material={f} />
      <Box size={[w + 0.08, 0.05, 0.12]} position={[0, -h / 2, 0.02]} material={f} />
      <Box size={[0.05, h, 0.08]} position={[-w / 2, 0, 0]} material={f} />
      <Box size={[0.05, h, 0.08]} position={[w / 2, 0, 0]} material={f} />
      <Box size={[0.03, h, 0.05]} position={[0, 0, 0]} material={f} />
      <Box size={[w, 0.03, 0.05]} position={[0, 0, 0]} material={f} />
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[w, h]} />
        <primitive object={mat('glass')} attach="material" />
      </mesh>
    </Group>
  );
}

/** A pendant lamp hanging from `cord` metres below the ceiling point it is placed at. */
export function PendantLamp({ cord = 0.6, shade = '#2f3a4a', ...g }: PieceProps & { cord?: number; shade?: string }) {
  return (
    <Group {...g}>
      <Cyl r={0.004} h={cord} position={[0, -cord / 2, 0]} material={mat('rubber', '#222')} cast={false} />
      <Cyl r={0.18} rTop={0.05} h={0.16} open position={[0, -cord - 0.06, 0]} material={mat('metal', shade, { doubleSide: true, roughness: 0.5 })} cast={false} />
      <Ball r={0.045} position={[0, -cord - 0.1, 0]} material={mat('glow')} cast={false} />
    </Group>
  );
}

/** A potted plant: a pot and a few leafy blobs. */
export function Plant({ height = 0.6, pot = '#b7653f', leaf = '#4f8f3a', ...g }: PieceProps & { height?: number; pot?: string; leaf?: string }) {
  const potH = height * 0.32;
  return (
    <Group {...g}>
      <Cyl r={height * 0.16} rTop={height * 0.2} h={potH} position={[0, -height / 2 + potH / 2, 0]} material={mat('ceramic', pot, { roughness: 0.6 })} />
      {[[0, 0.62, 0, 0.2], [0.08, 0.5, 0.05, 0.15], [-0.08, 0.52, -0.04, 0.16], [0.02, 0.8, -0.03, 0.13]].map(([x, y, z, r], i) => (
        <Ball key={i} r={height * r} position={[x * height, -height / 2 + y * height, z * height]} material={mat('leaf', leaf)} segments={12} />
      ))}
    </Group>
  );
}

/** A rug on the floor (a flat rounded box). */
export function Rug({ size, color = '#8a4b3c', border = '#e7d2b0', ...g }: PieceProps & { size: [number, number]; color?: string; border?: string }) {
  return (
    <Group {...g}>
      <RBox size={[size[0], 0.01, size[1]]} radius={0.004} position={[0, 0.005, 0]} material={mat('fabric', border)} cast={false} receive />
      <Box size={[size[0] - 0.12, 0.012, size[1] - 0.12]} position={[0, 0.006, 0]} material={mat('fabric', color)} cast={false} receive />
    </Group>
  );
}

/** A sign / notice / shop board with Chinese text (faces +Z). */
export function Sign({ text, size = [0.8, 0.2], bg = '#7a2121', fg = '#ffe7a8', frame, ...g }: PieceProps & { text: string; size?: [number, number]; bg?: string; fg?: string; frame?: string }) {
  const tex = useMemo(() => signTexture(text, { bg, fg, width: 512, height: Math.round((512 * size[1]) / size[0]) }), [text, bg, fg, size]);
  return (
    <Group {...g}>
      {frame && <Box size={[size[0] + 0.04, size[1] + 0.04, 0.02]} position={[0, 0, -0.012]} material={mat('wood', frame)} cast={false} />}
      <mesh>
        <planeGeometry args={size} />
        <meshStandardMaterial map={tex} roughness={0.7} />
      </mesh>
    </Group>
  );
}

/** A wall clock with a drawn face. */
export function WallClock({ r = 0.16, ...g }: PieceProps & { r?: number }) {
  const face = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fbf8f1';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#333';
      ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.lineWidth = i % 3 === 0 ? 8 : 4;
        ctx.beginPath();
        ctx.moveTo(128 + Math.sin(a) * 100, 128 - Math.cos(a) * 100);
        ctx.lineTo(128 + Math.sin(a) * 116, 128 - Math.cos(a) * 116);
        ctx.stroke();
      }
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + 50, 128 - 30);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 - 20, 128 - 92);
      ctx.stroke();
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  return (
    <Group {...g}>
      <Cyl r={r} h={0.04} rotation={[Math.PI / 2, 0, 0]} material={mat('plastic', '#2d2d2d')} cast={false} />
      <mesh position={[0, 0, 0.021]}>
        <circleGeometry args={[r * 0.9, 40]} />
        <meshStandardMaterial map={face} roughness={0.5} />
      </mesh>
    </Group>
  );
}

/**
 * A room: floor, four walls (seen from inside), a ceiling, skirting — and their colliders. `size` =
 * [width (x), depth (z)], centred on the origin, the floor at y = 0. Pass `wall` / `floor` / `ceiling`
 * materials from `mat(...)`. Put windows, doors and cupboards in front of the walls.
 */
export function Room({ size, height = 2.7, floor, wall, ceiling, skirting = '#d7d0c3', colliders = true }: {
  size: [number, number]; height?: number;
  floor: ReturnType<typeof mat>; wall: ReturnType<typeof mat>; ceiling?: ReturnType<typeof mat>; skirting?: string; colliders?: boolean;
}) {
  const [w, d] = size;
  const sk = mat('painted', skirting);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={floor}>
        <planeGeometry args={[w, d]} />
      </mesh>
      {([
        [[0, height / 2, -d / 2], [0, 0, 0], w],
        [[0, height / 2, d / 2], [0, Math.PI, 0], w],
        [[-w / 2, height / 2, 0], [0, Math.PI / 2, 0], d],
        [[w / 2, height / 2, 0], [0, -Math.PI / 2, 0], d],
      ] as Array<[V3, V3, number]>).map(([p, r, len], i) => (
        <mesh key={i} position={p} rotation={r} material={wall} receiveShadow>
          <planeGeometry args={[len, height]} />
        </mesh>
      ))}
      {ceiling && (
        <mesh position={[0, height - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} material={ceiling}>
          <planeGeometry args={[w, d]} />
        </mesh>
      )}
      <Box size={[w, 0.08, 0.015]} position={[0, 0.04, -d / 2 + 0.008]} material={sk} cast={false} />
      <Box size={[w, 0.08, 0.015]} position={[0, 0.04, d / 2 - 0.008]} material={sk} cast={false} />
      <Box size={[0.015, 0.08, d]} position={[-w / 2 + 0.008, 0.04, 0]} material={sk} cast={false} />
      <Box size={[0.015, 0.08, d]} position={[w / 2 - 0.008, 0.04, 0]} material={sk} cast={false} />
      {colliders && (
        <>
          <FloorCollider size={[w + 1, d + 1]} />
          <Solid size={[w + 1, height, 0.4]} at={[0, height / 2, -d / 2 - 0.2]} />
          <Solid size={[w + 1, height, 0.4]} at={[0, height / 2, d / 2 + 0.2]} />
          <Solid size={[0.4, height, d + 1]} at={[-w / 2 - 0.2, height / 2, 0]} />
          <Solid size={[0.4, height, d + 1]} at={[w / 2 + 0.2, height / 2, 0]} />
          <Solid size={[w + 1, 0.4, d + 1]} at={[0, height + 0.2, 0]} />
        </>
      )}
    </group>
  );
}
