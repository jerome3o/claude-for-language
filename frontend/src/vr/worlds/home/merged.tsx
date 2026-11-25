/**
 * Many static boxes in ONE draw call (docs/VR_WORLDS.md "Performance budget": ≤ 250 draw calls): the
 * apartment's interior walls, skirting, door frames and the decor books on the shelves are each
 * merged into a single geometry with a colour per box (vertex colours), so a whole room's walls cost
 * one mesh instead of dozens.
 */
import { useEffect, useMemo } from 'react';
import { BoxGeometry, BufferAttribute, Color, Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

export interface MergedBox {
  size: V3;
  at: V3;
  /** Yaw (about Y), radians. */
  yaw?: number;
  color?: string;
}

export function mergeBoxes(boxes: readonly MergedBox[], fallback = '#ffffff'): BufferGeometry {
  const parts = boxes.map((b) => {
    const g = new BoxGeometry(b.size[0], b.size[1], b.size[2]).toNonIndexed();
    const m = new Matrix4().compose(new Vector3(...b.at), new Quaternion().setFromEuler(new Euler(0, b.yaw ?? 0, 0)), new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    const c = new Color(b.color ?? fallback);
    const n = g.getAttribute('position').count;
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new BufferAttribute(colours, 3));
    return g;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged ?? new BoxGeometry(0.001, 0.001, 0.001);
}

export function MergedBoxes({ boxes, roughness = 0.85, map, cast = false, receive = true }: {
  boxes: readonly MergedBox[];
  roughness?: number;
  /** A shared texture tinted by each box's colour (plaster noise on walls). */
  map?: Texture;
  cast?: boolean;
  receive?: boolean;
}) {
  const geometry = useMemo(() => mergeBoxes(boxes), [boxes]);
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, map: map ?? null }), [roughness, map]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  return <mesh geometry={geometry} material={material} castShadow={cast} receiveShadow={receive} />;
}
