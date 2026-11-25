/**
 * One object in a world: its physics body (dynamic when it has mass, fixed otherwise), colliders from
 * its spec (parts with `when` come and go with its states), its model, an invisible pick proxy the
 * rays / mouse hit, an outline when pointed at or hinted, and impact sounds by material.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { BallCollider, CuboidCollider, CylinderCollider, RigidBody, type CollisionEnterPayload, type RapierRigidBody } from '@react-three/rapier';
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, Vector3, type LineSegments, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { colliderParts, localBounds, partActive, type WorldMaterial } from '@shared/vr-worlds';
import type { WorldModel, WorldObjectDef } from '../types';
import type { Interactive, InteractionHub } from '../../scene/interaction';
import type { Grabber } from './grabber';
import type { LiveObjects } from './live';
import type { SoundEngine } from '../sound';

const SURFACE: Record<WorldMaterial, { friction: number; restitution: number }> = {
  wood: { friction: 0.6, restitution: 0.25 },
  glass: { friction: 0.4, restitution: 0.25 },
  metal: { friction: 0.4, restitution: 0.3 },
  plastic: { friction: 0.5, restitution: 0.4 },
  cloth: { friction: 0.9, restitution: 0.05 },
  paper: { friction: 0.7, restitution: 0.1 },
  ceramic: { friction: 0.5, restitution: 0.2 },
  food: { friction: 0.8, restitution: 0.2 },
  stone: { friction: 0.7, restitution: 0.15 },
};

const HOVER_COLOR = '#86b9ff';
const HINT_COLOR = '#ffd166';
/** Small things get a bigger pick box than their collider: easier to point at. */
const MIN_PICK = 0.07;

function GltfModel({ url, scale = 1, offset = [0, 0, 0] }: { url: string; scale?: number; offset?: [number, number, number] }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    s.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return s;
  }, [gltf]);
  return <primitive object={scene} scale={scale} position={offset} />;
}

function Model({ model, states }: { model: WorldModel; states: Record<string, string> }) {
  if (typeof model === 'function') {
    const M = model;
    return <M states={states} />;
  }
  return (
    <Suspense fallback={null}>
      <GltfModel url={model.gltf} scale={model.scale} offset={model.offset} />
    </Suspense>
  );
}

/** An invisible box rays / the mouse hit (drawn with an invisible material, so it raycasts but never renders). */
function PickBox({ id, size, at, live, hub, handlers }: { id: string; size: [number, number, number]; at: [number, number, number]; live: LiveObjects; hub: InteractionHub; handlers: Interactive }) {
  const ref = useRef<Mesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return undefined;
    const a = live.addProxy(id, mesh);
    const b = hub.register(mesh, handlers);
    return () => {
      a();
      b();
    };
  }, [id, live, hub, handlers]);
  return (
    <mesh ref={ref} position={at} name={`pick:${id}`}>
      <boxGeometry args={size} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

export interface WorldObjectProps {
  def: WorldObjectDef;
  states: Record<string, string>;
  live: LiveObjects;
  hub: InteractionHub;
  grabber: Grabber;
  sound: SoundEngine;
  /** Glows (hint) — pulsing yellow outline. */
  hinted: boolean;
  onHover(id: string, source: string, on: boolean): void;
}

export function WorldObject({ def, states, live, hub, grabber, sound, hinted, onHover }: WorldObjectProps) {
  const body = useRef<RapierRigidBody>(null);
  const outline = useRef<LineSegments>(null);
  const hoverSources = useRef(new Set<string>());
  const dynamic = def.mass > 0;
  const parts = colliderParts(def);
  const active = parts.filter((p) => partActive(p, states));
  const surface = SURFACE[def.material];
  const bounds = useMemo(() => localBounds(def), [def]);
  const pick = useMemo(() => {
    const size = [0, 1, 2].map((i) => Math.max(MIN_PICK, bounds.max[i] - bounds.min[i])) as [number, number, number];
    const centre = [0, 1, 2].map((i) => (bounds.max[i] + bounds.min[i]) / 2) as [number, number, number];
    return { size, centre };
  }, [bounds]);
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(pick.size[0] + 0.01, pick.size[1] + 0.01, pick.size[2] + 0.01)), [pick]);
  const outlineMat = useMemo(() => new LineBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.9, depthTest: false }), []);
  useEffect(() => () => {
    edges.dispose();
    outlineMat.dispose();
  }, [edges, outlineMat]);

  useEffect(() => {
    live.setBody(def.id, body.current);
    return () => live.setBody(def.id, null);
  }, [def.id, live]);

  const handlers = useMemo<Interactive>(() => ({
    onHover: (hit, source) => {
      const had = hoverSources.current.has(source);
      if (hit && !had) {
        hoverSources.current.add(source);
        onHover(def.id, source, true);
      } else if (!hit && had) {
        hoverSources.current.delete(source);
        onHover(def.id, source, false);
      }
    },
    onDown: (hit, source) => grabber.press(def.id, source, hit),
    onGrab: (hit, source) => grabber.grabNow(def.id, source, hit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [def.id, grabber]);

  useFrame(({ clock }) => {
    const o = outline.current;
    if (!o) return;
    const hovered = hoverSources.current.size > 0 || live.get(def.id)?.heldBy != null;
    o.visible = hovered || hinted;
    if (!o.visible) return;
    outlineMat.color.set(hovered ? HOVER_COLOR : HINT_COLOR);
    outlineMat.opacity = hovered ? 0.9 : 0.55 + 0.45 * Math.sin(clock.elapsedTime * 5);
  });

  const tmp = useMemo(() => new Vector3(), []);
  const onCollisionEnter = (e: CollisionEnterPayload) => {
    const self = live.get(def.id);
    if (!self) return;
    const otherId = (e.other.rigidBodyObject?.userData as { worldObject?: string } | undefined)?.worldObject;
    const other = otherId ? live.get(otherId) : undefined;
    const rel = tmp.copy(self.lastVel);
    if (other && other.def.mass > 0) rel.sub(other.lastVel);
    const speed = rel.length();
    const pos = live.position(def.id, new Vector3());
    sound.impact(def.material, pos, speed, def.id);
    // Hitting a fixed object of another material (a bottle on the wooden table): that one sounds too.
    if (other && other.def.mass <= 0 && other.def.material !== def.material) sound.impact(other.def.material, pos, speed * 0.7, `${otherId}:${def.id}`);
  };

  const shapes = active.map((p, i) => {
    const off = p.offset ?? [0, 0, 0];
    const common = { position: off, friction: surface.friction, restitution: surface.restitution, ...(dynamic ? { mass: def.mass / active.length } : {}) };
    const key = `${i}:${JSON.stringify(p.when ?? {})}`;
    if ('box' in p) return <CuboidCollider key={key} args={[p.box[0] / 2, p.box[1] / 2, p.box[2] / 2]} {...common} />;
    if ('ball' in p) return <BallCollider key={key} args={[p.ball]} {...common} />;
    return <CylinderCollider key={key} args={[p.cylinder[1] / 2, p.cylinder[0]]} {...common} />;
  });

  return (
    <RigidBody
      ref={body}
      type={dynamic ? 'dynamic' : 'fixed'}
      colliders={false}
      position={def.at}
      rotation={[0, def.yaw ?? 0, 0]}
      ccd={dynamic}
      canSleep
      linearDamping={0.08}
      angularDamping={0.35}
      userData={{ worldObject: def.id }}
      onCollisionEnter={dynamic ? onCollisionEnter : undefined}
      name={`obj:${def.id}`}
    >
      {shapes}
      <group>
        <Model model={def.model} states={states} />
      </group>
      {active.map((p, i) => {
        const h = 'box' in p ? p.box.map((n) => n / 2) : 'ball' in p ? [p.ball, p.ball, p.ball] : [p.cylinder[0], p.cylinder[1] / 2, p.cylinder[0]];
        const size = h.map((n) => Math.max(MIN_PICK, n * 2 + 0.01)) as [number, number, number];
        return <PickBox key={`${i}:${JSON.stringify(p.when ?? {})}`} id={def.id} size={size} at={p.offset ?? [0, 0, 0]} live={live} hub={hub} handlers={handlers} />;
      })}
      <lineSegments ref={outline} geometry={edges} material={outlineMat} position={pick.centre} visible={false} renderOrder={5} />
    </RigidBody>
  );
}

