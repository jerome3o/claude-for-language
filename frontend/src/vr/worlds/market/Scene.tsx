/**
 * The market's static world: the hall (wet terrazzo floor, tiled dado, corrugated roof on green steel
 * beams, a skylight), the signs (平安菜市场, 新鲜蔬菜, 时令水果, 豆制品, 干货粮油, 小心地滑, price tags
 * in the produce), the DISPLAY produce heaped in crates on the back of each stall (instanced, not
 * physics — the grabbable things are objects, index.tsx), egg trays and tofu on a tray, open sacks of
 * grain, hanging chilli strings and garlic, stacked crates behind the stalls, decorative bulbs, puddles
 * and a drain — plus the `<Solid>`s things bump into.
 *
 * Hall: x −3.5 … 3.5, z −3 … 3, 3.2 m high. The aisle runs down the middle (x −1.4 … 1.4): the
 * vegetable stall on the left, fruit on the right, tofu & eggs across the far end, dry goods front
 * right, the cart and the bin front left. You start at z 2.3 looking down the aisle.
 */
import { useMemo } from 'react';
import { BoxGeometry } from 'three';
import { Box, Cyl, RBox, Room, Sign, Solid, SolidCylinder, mat } from '../kit';
import { Cluster, cone, cylinder, heap, lathe, podProfile, sphere, torus, tube, type Inst } from './pieces';
import { corrugatedTexture, crateTexture, floorTexture, sackTexture, watermelonTexture } from './textures';

type V3 = [number, number, number];

const crateGeo = new BoxGeometry(1, 1, 1);

/** Display crates: [x, y (bottom), z, w, h, d, tint]. */
const CRATES: Array<[number, number, number, number, number, number, string]> = [
  // vegetable stall, back strip (counter top 0.85)
  [-2.1, 0.85, -1.75, 0.36, 0.12, 0.4, '#3f7fd0'],
  [-2.1, 0.85, -1.3, 0.36, 0.12, 0.4, '#3fa060'],
  [-2.1, 0.85, -0.85, 0.36, 0.12, 0.4, '#3f7fd0'],
  // fruit stall, back strip
  [2.1, 0.85, -1.75, 0.36, 0.12, 0.4, '#d8a23a'],
  [2.1, 0.85, -1.3, 0.36, 0.12, 0.4, '#3fa060'],
  [2.1, 0.85, -0.85, 0.36, 0.12, 0.4, '#d8a23a'],
  [2.1, 0.85, -0.4, 0.36, 0.12, 0.4, '#3f7fd0'],
  // on the cart (back half)
  [-2.2, 0.54, 1.75, 0.5, 0.18, 0.42, '#3fa060'],
  // stacked behind the stalls (vendor side)
  [-2.85, 0, -1.6, 0.5, 0.3, 0.36, '#3f7fd0'], [-2.85, 0.3, -1.6, 0.5, 0.3, 0.36, '#d8a23a'], [-2.85, 0, -1.1, 0.5, 0.3, 0.36, '#3fa060'],
  [2.85, 0, -1.7, 0.5, 0.3, 0.36, '#3fa060'], [2.85, 0.3, -1.7, 0.5, 0.3, 0.36, '#3f7fd0'], [2.85, 0.6, -1.7, 0.5, 0.3, 0.36, '#d8a23a'], [2.85, 0, -0.2, 0.5, 0.3, 0.36, '#d8a23a'],
  [-3.0, 0, 0.5, 0.5, 0.3, 0.36, '#3f7fd0'], [-3.0, 0.3, 0.5, 0.5, 0.3, 0.36, '#3fa060'],
];

/** A heap moved to sit on a crate's top (crates hold their produce just under the rim). */
function onCrate(items: Inst[], c: (typeof CRATES)[number], sink = 0.03): Inst[] {
  const [x, y, z, , h] = c;
  return items.map((it) => ({ ...it, p: [it.p[0] + x, it.p[1] + y + h - sink, it.p[2] + z] }));
}

/** Price tags on sticks: [text, x, y, z, yaw]. */
const TAGS: Array<[string, number, number, number, number]> = [
  ['两块一斤', -1.97, 1.13, -2.0, Math.PI / 2],
  ['三块五一斤', -1.93, 1.1, -1.75, Math.PI / 2],
  ['四块一斤', -1.93, 1.1, -1.3, Math.PI / 2],
  ['两块五一斤', -1.93, 1.1, -0.85, Math.PI / 2],
  ['六块一斤', 1.93, 1.1, -1.75, -Math.PI / 2],
  ['五块一斤', 1.93, 1.1, -1.3, -Math.PI / 2],
  ['四块五一斤', 1.93, 1.1, -0.85, -Math.PI / 2],
  ['一块八一斤', 1.93, 1.13, -0.4, -Math.PI / 2],
  ['两块一块', -0.55, 1.1, -2.62, 0],
  ['五块一斤', 0.45, 1.12, -2.62, 0],
  // the dry-goods sacks: 大米, 黄豆, 红豆, 花生 (their names are on cards above them)
  ['三块一斤', 1.92, 0.98, 0.95, -Math.PI / 2],
  ['六块一斤', 1.92, 0.98, 1.3, -Math.PI / 2],
  ['八块一斤', 1.92, 0.98, 1.65, -Math.PI / 2],
  ['十块一斤', 1.92, 0.98, 2.0, -Math.PI / 2],
];

export function MarketScene() {
  const floor = useMemo(() => {
    const t = floorTexture();
    t.repeat.set(3.5, 3);
    return mat('tile', '#ffffff', { map: t, roughness: 0.3 });
  }, []);
  const roof = useMemo(() => {
    const t = corrugatedTexture();
    t.repeat.set(16, 1);
    return mat('metal', '#ffffff', { map: t, roughness: 0.55, metalness: 0.35, doubleSide: true });
  }, []);
  const dado = mat('tile', '#e9efe9', { tiles: 6, grout: '#aab5ae', repeat: [10, 2] });
  const dadoSide = mat('tile', '#e9efe9', { tiles: 6, grout: '#aab5ae', repeat: [8, 2] });
  const band = mat('tile', '#3f8a63', { tiles: 6, grout: '#2d6a4a', repeat: [12, 0.25] });
  const beam = mat('painted', '#2f5d4a', { roughness: 0.5 });

  const crates = useMemo<Inst[]>(() => CRATES.map(([x, y, z, w, h, d, c]) => ({ p: [x, y + h / 2, z], s: [w, h, d], c })), []);

  const produce = useMemo(() => {
    const [v0, v1, v2] = CRATES;
    const [f0, f1, f2, f3] = CRATES.slice(3);
    const cart = CRATES[7];
    return {
      tomatoes: [...onCrate(heap(1, 0.32, 0.36, 0.036, 3, ['#d42a1d', '#c92218', '#e0401f', '#b81d18']), v0)],
      cucumbers: onCrate(Array.from({ length: 14 }, (_, i) => ({
        p: [-0.13 + (i % 7) * 0.043, 0.018 + Math.floor(i / 7) * 0.03, (i % 2) * 0.02 - 0.01], r: [Math.PI / 2, (i % 3) * 0.08, 0], c: i % 4 ? '#2f5d22' : '#3b6e2a',
      }) as Inst), v1),
      potatoes: onCrate(heap(3, 0.32, 0.36, 0.034, 3, ['#b8925f', '#a98352', '#c29a68'], 0.4, 0.8), v2),
      apples: onCrate(heap(4, 0.32, 0.36, 0.039, 3, ['#c8232c', '#b81d28', '#d63a2c', '#e0b23a']), f0),
      oranges: onCrate(heap(5, 0.32, 0.36, 0.037, 3, ['#f0861a', '#f29a2a', '#e47a14']), f1),
      pears: onCrate(heap(6, 0.32, 0.36, 0.036, 2, ['#d7cf5f', '#cfc552', '#e0d873']), f2),
      melons: [
        { p: [f3[0] - 0.06, f3[1] + f3[4] + 0.08, f3[2] - 0.08], s: [0.8, 0.75, 0.8] },
        { p: [f3[0] + 0.07, f3[1] + f3[4] + 0.08, f3[2] + 0.09], s: [0.8, 0.75, 0.8], r: [0, 1, 0] },
        { p: [2.6, 0.12, 0.45], s: 1, r: [0, 0.4, 0] }, { p: [2.88, 0.12, 0.42], s: 1.05 }, { p: [2.74, 0.12, 0.66], s: 0.95, r: [0, 2, 0] },
        { p: [2.74, 0.33, 0.51], s: 1 },
      ] as Inst[],
      cabbages: onCrate(Array.from({ length: 5 }, (_, i) => ({ p: [-0.18 + i * 0.09, 0.06 + (i % 2) * 0.03, 0], r: [Math.PI / 2, 0.1 * (i - 2), 0], s: 0.95 }) as Inst), cart, 0),
    };
  }, []);

  // Hanging decor: chilli strings and garlic over the vegetable stall, bananas over the fruit stall.
  const chilliStrings = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    for (const z of [-1.55, -1.05]) for (let k = 0; k < 16; k++) {
      out.push({ p: [-1.28 + (k % 2) * 0.02, 2.12 - k * 0.04, z + ((k % 3) - 1) * 0.018], r: [Math.PI + ((k % 3) - 1) * 0.5, k, ((k % 2) - 0.5) * 0.6], c: k % 5 ? '#c41616' : '#a01010' });
    }
    return out;
  }, []);
  const garlicString = useMemo<Inst[]>(() => Array.from({ length: 10 }, (_, k) => ({ p: [-1.28, 2.1 - k * 0.05, -0.55 + ((k % 2) - 0.5) * 0.035], s: [1, 0.85, 1] }) as Inst), []);
  // two bunches hanging from the fruit awning's frame: fingers fanned round the crown, curving down
  const hangingBananas = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    for (const [z, y] of [[-1.5, 1.98], [-1.0, 2.02]] as const) {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        // the finger's upper end sits at the crown: shift it out by where Rz put that end
        out.push({ p: [1.3 + 0.031 * Math.cos(a), y - 0.085 - (k % 2) * 0.02, z - 0.031 * Math.sin(a)], r: [0, a, -Math.PI / 2 + 0.35] });
      }
    }
    return out;
  }, []);
  const eggs = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    for (const [ox, oy] of [[0.35, 0.89], [0.62, 0.89], [0.485, 0.93]] as const) {
      for (let i = 0; i < 5; i++) for (let k = 0; k < 4; k++) out.push({ p: [ox - 0.1 + i * 0.05, oy + 0.03, -2.72 + k * 0.05], s: [1, 1.25, 1], c: (i + k) % 4 ? '#d8b089' : '#efe3cf' });
    }
    return out;
  }, []);
  const tofuBlocks = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) out.push({ p: [-0.78 + i * 0.12, 0.905, -2.72 + k * 0.12], s: [0.11, 0.05, 0.11] });
    return out;
  }, []);

  const sacks: Array<[string, string, number]> = [['大米', '#f4f1e6', 0.95], ['黄豆', '#e2b955', 1.3], ['红豆', '#8e2a22', 1.65], ['花生', '#c79a5c', 2.0]];
  const bulbs = useMemo<Inst[]>(() => [[-1.85, 2.0, -1.4], [-1.85, 2.0, -0.2], [1.85, 2.0, -1.4], [1.85, 2.0, -0.2], [0, 2.15, -2.35], [1.85, 2.05, 1.5]].map((p) => ({ p: p as V3, s: [1, 1.25, 1] })), []);
  const cords = useMemo<Inst[]>(() => bulbs.map((b) => {
    const top = b.p[0] === 0 || b.p[2] > 1 ? 3.2 : 2.24;
    const len = top - b.p[1];
    return { p: [b.p[0], b.p[1] + len / 2, b.p[2]], s: [1, len, 1] };
  }), [bulbs]);

  const tagSticks = useMemo<Inst[]>(() => TAGS.map(([, x, y, z]) => ({ p: [x, y - 0.11, z], s: [1, 0.18, 1] })), []);
  const puddles = useMemo<Inst[]>(() => [{ p: [-0.4, 0.002, -0.6], s: [0.7, 1, 0.45] }, { p: [0.5, 0.002, -1.6], s: [0.45, 1, 0.6] }, { p: [-0.7, 0.002, 1.2], s: [0.35, 1, 0.3] }], []);
  const stools = useMemo<Inst[]>(() => [{ p: [-2.95, 0.15, -0.3], c: '#c8322a' }, { p: [2.95, 0.15, -1.05], c: '#2f6fb3' }, { p: [0.0, 0.15, -3.0 + 0.2], c: '#c8322a' }], []);

  return (
    <group>
      <Room size={[7, 6]} height={3.2} floor={floor} wall={mat('plaster', '#b9cdbf', { repeat: [4, 2] })} ceiling={roof} skirting="#5d7a68" />

      {/* tiled dado on every wall */}
      <mesh position={[0, 0.65, -2.995]} material={dado} receiveShadow><planeGeometry args={[7, 1.3]} /></mesh>
      <mesh position={[0, 0.65, 2.995]} rotation={[0, Math.PI, 0]} material={dado}><planeGeometry args={[7, 1.3]} /></mesh>
      <mesh position={[-3.495, 0.65, 0]} rotation={[0, Math.PI / 2, 0]} material={dadoSide} receiveShadow><planeGeometry args={[6, 1.3]} /></mesh>
      <mesh position={[3.495, 0.65, 0]} rotation={[0, -Math.PI / 2, 0]} material={dadoSide} receiveShadow><planeGeometry args={[6, 1.3]} /></mesh>
      {/* a band of green tiles along the top of the dado */}
      <Box size={[7, 0.08, 0.012]} position={[0, 1.34, -2.992]} material={band} cast={false} />
      <Box size={[7, 0.08, 0.012]} position={[0, 1.34, 2.992]} material={band} cast={false} />
      <Box size={[0.012, 0.08, 6]} position={[-3.492, 1.34, 0]} material={band} cast={false} />
      <Box size={[0.012, 0.08, 6]} position={[3.492, 1.34, 0]} material={band} cast={false} />

      {/* the roof's steel: three cross beams, two runners, a skylight strip down the aisle */}
      {[-2, 0, 2].map((z) => <Box key={z} size={[7, 0.16, 0.08]} position={[0, 3.04, z]} material={beam} cast={false} />)}
      {[-1.2, 1.2].map((x) => <Box key={x} size={[0.08, 0.1, 6]} position={[x, 3.1, 0]} material={beam} cast={false} />)}
      <mesh position={[0, 3.185, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.9, 5.6]} />
        <meshBasicMaterial color="#f4fbff" toneMapped={false} />
      </mesh>

      {/* signs */}
      <Sign text="平安菜市场" size={[2.6, 0.5]} bg="#b3171d" fg="#ffd66b" frame="#5a1a10" position={[0, 2.62, -2.97]} />
      <Sign text="新鲜蔬菜" size={[0.9, 0.24]} bg="#2f8f5b" fg="#ffffff" position={[-1.85, 2.62, 0.45]} />
      <Sign text="时令水果" size={[0.9, 0.24]} bg="#d9483b" fg="#fff4d6" position={[1.85, 2.62, 0.45]} />
      <Sign text="豆腐 豆浆 鸡蛋" size={[1.0, 0.2]} bg="#f6f1e2" fg="#2b5fa8" frame="#7a5a36" position={[0, 1.42, -2.9]} />
      <Sign text="干货 粮油" size={[0.9, 0.24]} bg="#8a5a2a" fg="#ffe7a8" position={[3.49, 2.05, 1.5]} rotation={[0, -Math.PI / 2, 0]} />
      <Sign text="公平秤" size={[0.5, 0.18]} bg="#1c5a9b" fg="#ffffff" position={[3.49, 1.62, -0.25]} rotation={[0, -Math.PI / 2, 0]} />
      <Sign text="营业时间 6:00-19:00" size={[1.0, 0.16]} bg="#ffffff" fg="#333333" frame="#9aa59f" position={[-3.49, 1.75, 1.6]} rotation={[0, Math.PI / 2, 0]} />
      <Sign text="请勿乱扔垃圾" size={[0.7, 0.14]} bg="#2f7d45" fg="#ffffff" position={[-3.49, 1.45, 0.9]} rotation={[0, Math.PI / 2, 0]} />
      {/* 小心地滑: a yellow A-frame by the puddle */}
      <group position={[-0.55, 0, -0.25]} rotation={[0, 0.5, 0]}>
        <group position={[0, 0.3, 0.06]} rotation={[-0.2, 0, 0]}>
          <RBox size={[0.3, 0.6, 0.02]} radius={0.008} material={mat('plastic', '#f2c218')} />
          <Sign text="小心地滑" size={[0.24, 0.12]} bg="#f2c218" fg="#1c1c1c" position={[0, 0.12, 0.011]} />
        </group>
        <RBox size={[0.3, 0.6, 0.02]} radius={0.008} position={[0, 0.3, -0.06]} rotation={[0.2, 0, 0]} material={mat('plastic', '#f2c218')} />
      </group>
      <Solid size={[0.3, 0.6, 0.24]} at={[-0.55, 0.3, -0.25]} yaw={0.5} />

      {/* price tags in the produce */}
      {TAGS.map(([text, x, y, z, yaw]) => (
        <Sign key={`${text}${x}${z}`} text={text} size={[0.17, 0.06]} bg="#ffffff" fg="#c8102e" position={[x, y, z]} rotation={[0, yaw, 0]} />
      ))}
      <Cluster geometry={cylinder(0.003, 1, 4)} material={mat('wood', '#c9a26b')} items={tagSticks} cast={false} />

      {/* display crates (instanced, one draw) and the produce heaped in them */}
      <Cluster geometry={crateGeo} material={mat('plastic', '#ffffff', { map: crateTexture('#d6d9dc'), roughness: 0.5 })} items={crates} receive />
      <Cluster geometry={sphere(0.036, 12)} material={mat('food', '#ffffff', { roughness: 0.25 })} items={produce.tomatoes} cast={false} />
      <Cluster geometry={lathe('cucumber', podProfile(0.21, [0.011, 0.015, 0.017, 0.017, 0.017, 0.016, 0.014, 0.01]), 12)} material={mat('food', '#ffffff', { roughness: 0.55 })} items={produce.cucumbers} cast={false} />
      <Cluster geometry={sphere(0.034, 10)} material={mat('stone', '#ffffff', { roughness: 0.92 })} items={produce.potatoes.map((p) => ({ ...p, s: [1.25, 0.85, 1] }))} cast={false} />
      <Cluster geometry={sphere(0.039, 14)} material={mat('food', '#ffffff', { roughness: 0.35 })} items={produce.apples} cast={false} />
      <Cluster geometry={sphere(0.037, 12)} material={mat('stone', '#ffffff', { roughness: 0.55 })} items={produce.oranges} cast={false} />
      <Cluster geometry={lathe('pear', [[0, -0.05], [0.022, -0.048], [0.034, -0.032], [0.035, -0.014], [0.027, 0.006], [0.019, 0.022], [0.016, 0.036], [0.011, 0.046], [0, 0.05]], 12)} material={mat('food', '#ffffff', { roughness: 0.45 })} items={produce.pears.map((p) => ({ ...p, r: [0, p.r?.[1] ?? 0, 0] }))} cast={false} />
      <Cluster geometry={sphere(0.12, 20)} material={mat('food', '#ffffff', { map: watermelonTexture(), roughness: 0.35 })} items={produce.melons} />
      <Cluster geometry={lathe('cabbage', [[0, -0.17], [0.045, -0.165], [0.062, -0.12], [0.07, -0.04], [0.071, 0.04], [0.066, 0.11], [0.05, 0.155], [0.02, 0.17], [0, 0.17]], 12)} material={mat('leaf', '#c9dfa0', { roughness: 0.65 })} items={produce.cabbages} cast={false} />
      {/* back-strip and cart colliders: things bump into the display, never fall into it */}
      <Solid size={[0.38, 0.24, 1.32]} at={[-2.1, 0.97, -1.3]} />
      <Solid size={[0.38, 0.24, 1.75]} at={[2.1, 0.97, -1.07]} />
      <Solid size={[0.52, 0.3, 0.44]} at={[-2.2, 0.69, 1.75]} />

      {/* the far stall: a wet tray of tofu, egg trays three high */}
      <RBox size={[0.52, 0.03, 0.28]} radius={0.006} position={[-0.6, 0.865, -2.66]} material={mat('wood', '#c9a26b')} />
      <Cluster geometry={crateGeo} material={mat('food', '#f4efe0', { roughness: 0.6 })} items={tofuBlocks} cast={false} />
      <Box size={[0.3, 0.03, 0.22]} position={[0.35, 0.865, -2.645]} material={mat('paper', '#c8b89a')} cast={false} />
      <Box size={[0.3, 0.03, 0.22]} position={[0.62, 0.865, -2.645]} material={mat('paper', '#c8b89a')} cast={false} />
      <Box size={[0.3, 0.03, 0.22]} position={[0.485, 0.905, -2.645]} material={mat('paper', '#c8b89a')} cast={false} />
      <Cluster geometry={sphere(0.024, 10)} material={mat('food', '#ffffff', { roughness: 0.6 })} items={eggs} cast={false} />
      <Cyl r={0.12} h={0.3} position={[0.85, 1.0, -2.68]} material={mat('plastic', '#f2f4f5')} />
      <Sign text="豆浆" size={[0.14, 0.08]} bg="#ffffff" fg="#2b5fa8" position={[0.85, 1.02, -2.555]} />
      <Solid size={[1.9, 0.2, 0.32]} at={[0.05, 0.95, -2.66]} />
      {/* a chopping board for the cleaver */}
      <RBox size={[0.4, 0.03, 0.28]} radius={0.008} position={[0.0, 0.865, -2.28]} material={mat('wood', '#d2ae7a')} receive />
      <Solid size={[0.4, 0.03, 0.28]} at={[0.0, 0.865, -2.28]} />
      {/* one warm light over the far stall (always mounted) */}
      <pointLight position={[0, 2.1, -2.2]} color="#ffd9a6" intensity={2.2} distance={4.5} decay={1.6} />

      {/* the dry-goods stall: open sacks of grain on the back strip, two full sacks on the floor */}
      {sacks.map(([name, grain, z]) => (
        <group key={name} position={[2.1, 0.8, z]}>
          <Cyl r={0.15} rTop={0.16} h={0.24} position={[0, 0.12, 0]} material={mat('fabric', '#e6dcc2', { roughness: 0.95 })} />
          <mesh geometry={torus(0.158, 0.018, Math.PI * 2, 20)} position={[0, 0.235, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('fabric', '#d9cdb0')} />
          <mesh geometry={sphere(0.15, 14)} position={[0, 0.22, 0]} scale={[1, 0.28, 1]} material={mat('stone', grain, { roughness: 0.9 })} />
          <Sign text={name} size={[0.12, 0.06]} bg="#ffffff" fg="#c8102e" position={[-0.17, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]} />
        </group>
      ))}
      <Solid size={[0.36, 0.3, 1.5]} at={[2.1, 0.95, 1.48]} />
      {[[2.55, 2.55, 0.3], [2.9, 2.6, -0.2]].map(([x, z, yaw]) => (
        <RBox key={x} size={[0.45, 0.24, 0.32]} radius={0.06} position={[x, 0.12, z]} rotation={[0, yaw, 0]} material={mat('fabric', '#ffffff', { map: sackTexture('大米') })} receive />
      ))}
      <Solid size={[0.9, 0.24, 0.45]} at={[2.72, 0.12, 2.57]} />

      {/* hanging decor */}
      <Cluster geometry={cone(0.008, 0.06, 6)} material={mat('food', '#ffffff', { roughness: 0.3 })} items={chilliStrings} cast={false} />
      <Cluster geometry={lathe('garlic-deco', [[0, -0.024], [0.02, -0.022], [0.029, -0.012], [0.03, 0], [0.026, 0.012], [0.014, 0.02], [0.004, 0.025], [0, 0.026]], 10)} material={mat('food', '#efe6dc', { roughness: 0.7 })} items={garlicString} cast={false} />
      <Cluster geometry={tube('banana', [[-0.09, 0.012, 0], [-0.045, -0.008, 0], [0, -0.012, 0], [0.045, -0.006, 0], [0.085, 0.014, 0]], 0.0165, 16)} material={mat('food', '#e8cf3a', { roughness: 0.55 })} items={hangingBananas} cast={false} />
      <Cluster geometry={cylinder(0.004, 1, 4)} material={mat('rubber', '#3a2a1a')} items={[[-1.28, -1.55, 0.7], [-1.28, -1.05, 0.7], [-1.28, -0.55, 0.6], [1.3, -1.5, 0.3], [1.3, -1.0, 0.25]].map(([x, z, len]) => ({ p: [x, 2.22 - len / 2, z], s: [1, len, 1] }) as Inst)} cast={false} />
      {/* awning poles on the counters' aisle corners */}
      <Cluster geometry={cylinder(0.022, 1, 10)} material={mat('metal', '#6f7a80')} items={[[-1.42, -1.98], [-1.42, 0.28], [1.42, -1.98], [1.42, 0.28]].map(([x, z]) => ({ p: [x, 1.55, z], s: [1, 1.4, 1] }) as Inst)} />
      {[[-1.42, -1.98], [-1.42, 0.28], [1.42, -1.98], [1.42, 0.28]].map(([x, z]) => <SolidCylinder key={`${x}${z}`} r={0.022} h={1.4} at={[x, 1.55, z]} />)}

      {/* decorative bulbs (emissive only — the 灯泡 object and the far stall own the two lights) */}
      <Cluster geometry={sphere(0.035, 12)} material={mat('glow', '#fff2c8', { emissive: '#ffcf7a', emissiveIntensity: 1.8 })} items={bulbs} cast={false} />
      <Cluster geometry={cylinder(0.004, 1, 4)} material={mat('rubber', '#1e1e1e')} items={cords} cast={false} />

      {/* stools, puddles, the aisle drain */}
      <Cluster geometry={cylinder(0.15, 0.3, 14, 0.13)} material={mat('plastic', '#ffffff', { roughness: 0.45 })} items={stools} />
      <Cluster geometry={cylinder(1, 0.002, 24)} material={mat('liquid', '#4f5a56', { opacity: 0.35, roughness: 0.04 })} items={puddles} cast={false} />
      {/* dropped cabbage leaves, a coiled hose for washing the floor down */}
      <Cluster geometry={sphere(0.06, 10)} material={mat('leaf', '#ffffff', { roughness: 0.7 })} items={[
        { p: [-1.25, 0.006, -1.6], s: [1.2, 0.08, 0.7], r: [0, 0.6, 0], c: '#a9cf7a' },
        { p: [-1.1, 0.006, -0.95], s: [1.0, 0.08, 0.6], r: [0, -0.4, 0], c: '#c3dc96' },
        { p: [1.22, 0.006, -0.3], s: [0.9, 0.08, 0.55], r: [0, 1.2, 0], c: '#9cc46a' },
      ]} cast={false} />
      <Cluster geometry={torus(0.17, 0.013, Math.PI * 2, 28)} material={mat('rubber', '#ffffff', { roughness: 0.6 })} items={[0, 1, 2].map((k) => ({ p: [1.55, 0.014 + k * 0.024, -2.6], r: [Math.PI / 2, 0, 0], s: 1 - k * 0.06, c: '#2f7d45' }) as Inst)} />
      <Box size={[0.22, 0.004, 1.0]} position={[0, 0.002, -1.0]} material={mat('metal', '#ffffff', { map: crateTexture('#5a6066'), roughness: 0.45 })} cast={false} />
    </group>
  );
}
