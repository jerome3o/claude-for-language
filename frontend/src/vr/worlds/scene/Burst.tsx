/**
 * A task's little celebration: a burst of confetti-like sparks at a place, falling and shrinking over
 * ~1 s. One InstancedMesh (64 sparks), nothing allocated per burst.
 */
import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, OctahedronGeometry, Quaternion, Vector3 } from 'three';

const N = 64;
const LIFE = 1.1;
const COLORS = ['#ffd166', '#63d394', '#86b9ff', '#ff8fab', '#ffffff', '#f4a261'];

interface Spark { p: Vector3; v: Vector3; age: number; spin: number }

export function Burst({ trigger }: { trigger: MutableRefObject<((at: Vector3) => void) | null> }) {
  const mesh = useRef<InstancedMesh>(null);
  const sparks = useRef<Spark[]>([]);
  const geom = useMemo(() => new OctahedronGeometry(0.012, 0), []);
  const mat = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), []);
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), axis: new Vector3(0.3, 1, 0.2).normalize() }), []);

  trigger.current = (at: Vector3) => {
    const list: Spark[] = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 1.4 + Math.random() * 1.8;
      const out = 0.5 + Math.random() * 1.2;
      list.push({ p: at.clone(), v: new Vector3(Math.cos(a) * out, up, Math.sin(a) * out), age: 0, spin: Math.random() * 6 });
      mesh.current?.setColorAt(i, new Color(COLORS[i % COLORS.length]));
    }
    if (mesh.current?.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    sparks.current = list;
  };

  useFrame((_, dtRaw) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(0.05, dtRaw);
    const list = sparks.current;
    let alive = 0;
    for (let i = 0; i < N; i++) {
      const s = list[i];
      if (!s || s.age >= LIFE) {
        tmp.m.makeScale(0, 0, 0);
        m.setMatrixAt(i, tmp.m);
        continue;
      }
      alive++;
      s.age += dt;
      s.v.y -= 4.5 * dt;
      s.v.multiplyScalar(1 - 1.2 * dt);
      s.p.addScaledVector(s.v, dt);
      const k = Math.max(0, 1 - s.age / LIFE);
      tmp.q.setFromAxisAngle(tmp.axis, s.age * s.spin);
      tmp.s.setScalar(k);
      tmp.m.compose(s.p, tmp.q, tmp.s);
      m.setMatrixAt(i, tmp.m);
    }
    m.visible = alive > 0;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geom, mat, N]} frustumCulled={false} visible={false} />;
}
