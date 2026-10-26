/**
 * One VR window: a grab bar (title, ⤒ bring to front, ✕ close) over a content panel. Drag the
 * bar — or squeeze / grip anywhere on the window — to carry it; it turns to keep facing you and
 * is remembered where you left it (windowStore.ts).
 */
import { useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { dragPose, localPoint, type VrPose } from '@shared/vr';
import type { UiNode } from '../ui/layout';
import type { PanelImage } from '../ui/draw';
import type { VrWindow, HeadPose } from '../windowStore';
import { PanelMesh, PX_PER_METRE } from './PanelMesh';
import type { InteractionHub, VrHit } from './interaction';

export const WINDOW_WIDTH_PX = 1000;
/** 0.625 m: a window ends ~0.65 m below the eyes, above the tray's line of sight (shared/vr trayPose). */
export const WINDOW_MAX_HEIGHT_PX = Math.round(0.625 * PX_PER_METRE);
const BAR_GAP = 0.008;

export interface PanelView {
  title: string;
  nodes: UiNode[];
}

export interface WindowFrameProps {
  win: VrWindow;
  view: PanelView | undefined;
  focused: boolean;
  hub: InteractionHub;
  images: ReadonlyMap<string, PanelImage>;
  /** Head pose and the world group's offset (rays are in world space, poses in the room's). */
  getHead(): HeadPose;
  toRoom(p: { x: number; y: number; z: number }): { x: number; y: number; z: number };
  onAction(id: string, action: string, source: string): void;
  onClose(id: string): void;
  onFocus(id: string): void;
  onMove(id: string, pose: VrPose): void;
  onFront(id: string): void;
}

export function WindowFrame(props: WindowFrameProps) {
  const { win, view, focused, hub } = props;
  const groupRef = useRef<Group>(null);
  const [barH, setBarH] = useState(0.06);
  const latest = useRef(props);
  latest.current = props;

  const startDrag = (hit: VrHit, source: string): boolean => {
    const group = groupRef.current;
    if (!group) return false;
    const start = latest.current.win.pose;
    const grabLocal = localPoint(start, latest.current.toRoom(hit.point));
    const distance = hit.distance;
    let pose: VrPose = start;
    latest.current.onFocus(win.id);
    hub.beginDrag(source, {
      move: (ray) => {
        const origin = latest.current.toRoom(ray.origin);
        pose = dragPose(origin, ray.direction, distance, grabLocal, latest.current.getHead().position);
        group.position.set(pose.x, pose.y, pose.z);
        group.rotation.y = pose.yaw;
      },
      end: () => latest.current.onMove(win.id, pose),
    });
    return true;
  };

  const barNodes = useMemo<UiNode[]>(() => [{
    t: 'bar',
    title: `⠿  ${view?.title ?? '…'}`,
    color: focused ? 'ink' : 'muted',
    buttons: [
      { t: 'button', label: '⤒', action: 'front', tone: 'plain' },
      { t: 'button', label: '✕', action: 'close', tone: 'plain' },
    ],
  }], [view?.title, focused]);

  const emptyNodes = useMemo<UiNode[]>(() => [{ t: 'text', text: 'Loading…', color: 'muted' }], []);

  return (
    <group ref={groupRef} position={[win.pose.x, win.pose.y, win.pose.z]} rotation={[0, win.pose.yaw, 0]}>
      <PanelMesh
        nodes={barNodes}
        widthPx={WINDOW_WIDTH_PX}
        hub={hub}
        padding={14}
        radius={22}
        background={focused ? '#2b5bb0' : '#262f44'}
        onHeight={setBarH}
        onPress={() => props.onFocus(win.id)}
        onBackgroundDown={(hit, source) => startDrag(hit, source)}
        onGrab={startDrag}
        onAction={(action) => {
          if (action === 'close') props.onClose(win.id);
          else if (action === 'front') props.onFront(win.id);
        }}
        debugId={`bar:${win.key}`}
      />
      <group position={[0, -barH - BAR_GAP, 0]}>
        <PanelMesh
          nodes={view?.nodes ?? emptyNodes}
          widthPx={WINDOW_WIDTH_PX}
          hub={hub}
          images={props.images}
          maxHeightPx={WINDOW_MAX_HEIGHT_PX}
          minHeightPx={160}
          onPress={() => props.onFocus(win.id)}
          onGrab={startDrag}
          onAction={(action, source) => props.onAction(win.id, action, source)}
          debugId={`win:${win.key}`}
        />
      </group>
    </group>
  );
}
