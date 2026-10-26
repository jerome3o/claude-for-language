/**
 * A flat panel in the room whose face is a canvas drawn from UI nodes (ui/layout.ts): window
 * content, title bars and the tray all use it. Hover highlights the tap target under the ray;
 * a click (pressed and released on the same target) reports the target's action.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Mesh } from 'three';
import { renderPanel, type PanelImage } from '../ui/draw';
import { ensureFonts } from '../ui/fonts';
import { hitAt, type HitRegion, type UiLayout, type UiNode } from '../ui/layout';
import type { InteractionHub, VrHit } from './interaction';
import { registerDebugPanel } from './debug';

export const PX_PER_METRE = 1600;

export interface PanelMeshProps {
  nodes: readonly UiNode[];
  widthPx: number;
  hub: InteractionHub;
  images?: ReadonlyMap<string, PanelImage>;
  onAction?(action: string, source: string): void;
  /** Any press on the panel (focuses its window). */
  onPress?(): void;
  /** Squeeze / grip on the panel. */
  onGrab?(hit: VrHit, source: string): boolean;
  /** Pressed where there is no tap target (a title bar starts a drag from there). */
  onBackgroundDown?(hit: VrHit, source: string): void;
  background?: string;
  radius?: number;
  padding?: number;
  minHeightPx?: number;
  maxHeightPx?: number;
  /** Where the panel hangs from: its top edge (windows grow downwards) or its centre. */
  anchor?: 'top' | 'center';
  onHeight?(metres: number): void;
  /** Name in the e2e / debug registry (`window.__vr`). */
  debugId?: string;
  renderOrder?: number;
}

function uvToPx(hit: VrHit, layout: UiLayout, widthPx: number): { x: number; y: number } | null {
  if (!hit.uv) return null;
  return { x: hit.uv.x * widthPx, y: (1 - hit.uv.y) * layout.height };
}

export function PanelMesh(props: PanelMeshProps) {
  const { nodes, widthPx, hub, images, anchor = 'top' } = props;
  const gl = useThree((s) => s.gl);
  const canvas = useMemo(() => document.createElement('canvas'), []);
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    return t;
  }, [canvas]);
  useEffect(() => {
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  }, [gl, texture]);
  useEffect(() => () => texture.dispose(), [texture]);

  const meshRef = useRef<Mesh>(null);
  const layoutRef = useRef<UiLayout | null>(null);
  const hoveredRef = useRef<HitRegion | null>(null);
  const downRef = useRef<HitRegion | null>(null);
  const [heightPx, setHeightPx] = useState(props.minHeightPx ?? 64);
  const latest = useRef(props);
  latest.current = props;

  const draw = () => {
    const { layout, resized } = renderPanel(canvas, latest.current.nodes, widthPx, {
      images: latest.current.images,
      hovered: hoveredRef.current,
      background: latest.current.background,
      radius: latest.current.radius,
      padding: latest.current.padding,
      minHeight: latest.current.minHeightPx,
      maxHeight: latest.current.maxHeightPx,
    });
    layoutRef.current = layout;
    if (resized) {
      texture.dispose();
      setHeightPx(layout.height);
      latest.current.onHeight?.(layout.height / PX_PER_METRE);
    }
    texture.needsUpdate = true;
    return layout;
  };

  useEffect(() => {
    // the hovered region belongs to the old layout: find it again by action
    const prev = hoveredRef.current;
    let cancelled = false;
    const layout = draw();
    if (prev) {
      hoveredRef.current = layout.hits.find((h) => h.action === prev.action) ?? null;
    }
    void ensureFonts(layout.texts).then((loaded) => {
      if (loaded && !cancelled) draw();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, images, widthPx]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const regionOf = (hit: VrHit | null) => {
      const layout = layoutRef.current;
      if (!hit || !layout) return null;
      const p = uvToPx(hit, layout, widthPx);
      return p ? hitAt(layout, p.x, p.y) : null;
    };
    const unregister = hub.register(mesh, {
      onHover: (hit) => {
        const region = regionOf(hit);
        if (region?.action !== hoveredRef.current?.action || region?.x !== hoveredRef.current?.x || region?.y !== hoveredRef.current?.y) {
          hoveredRef.current = region;
          draw();
        }
      },
      onDown: (hit, source) => {
        latest.current.onPress?.();
        const region = regionOf(hit);
        downRef.current = region;
        if (!region) latest.current.onBackgroundDown?.(hit, source);
      },
      onUp: (hit, source, click) => {
        const down = downRef.current;
        downRef.current = null;
        if (!click || !down) return;
        const region = regionOf(hit);
        if (region && region.action === down.action) latest.current.onAction?.(region.action, source);
      },
      onGrab: (hit, source) => latest.current.onGrab?.(hit, source) ?? false,
    });
    const unregisterDebug = props.debugId ? registerDebugPanel(props.debugId, { mesh, layout: () => layoutRef.current, widthPx }) : () => {};
    return () => {
      unregister();
      unregisterDebug();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, widthPx, props.debugId]);

  const w = widthPx / PX_PER_METRE;
  const h = heightPx / PX_PER_METRE;
  return (
    <mesh ref={meshRef} position={[0, anchor === 'top' ? -h / 2 : 0, 0]} scale={[w, h, 1]} renderOrder={props.renderOrder ?? 0}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} alphaTest={0.5} toneMapped={false} />
    </mesh>
  );
}
