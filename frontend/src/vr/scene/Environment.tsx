/**
 * The room (docs/VR.md "Comfort"): a calm dusk sky, distant soft hills, a pale floor with two
 * faint rings at 1 m and 2 m to ground the space. Nothing moves, nothing flickers, no artificial
 * locomotion. Everything is drawn from code (no downloaded models or textures).
 */
import { useEffect, useMemo } from 'react';
import { BackSide, CanvasTexture, Color, DoubleSide, SRGBColorSpace } from 'three';

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 bottom;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.8)) : mix(horizon, bottom, min(-h * 4.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}`;

function floorTexture(): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#d9d2c5');
  g.addColorStop(0.35, '#cfc6b6');
  g.addColorStop(1, '#a9a6a3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // rings at 1 m and 2 m (the floor disc is 24 m across)
  const pxPerM = size / 24;
  ctx.strokeStyle = 'rgba(80, 70, 60, 0.22)';
  ctx.lineWidth = 2;
  for (const r of [1, 2]) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r * pxPerM, 0, Math.PI * 2);
    ctx.stroke();
  }
  // a soft rug where you stand
  ctx.fillStyle = 'rgba(120, 140, 170, 0.18)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 0.6 * pxPerM, 0, Math.PI * 2);
  ctx.fill();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function hillsTexture(): CanvasTexture {
  const w = 2048;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const layers: Array<[string, number, number, number]> = [
    ['rgba(140, 150, 175, 0.55)', 0.55, 3, 0.18],
    ['rgba(118, 128, 150, 0.8)', 0.7, 5, 0.12],
  ];
  for (const [color, base, waves, amp] of layers) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const t = (x / w) * Math.PI * 2;
      // integer wave counts so the band wraps seamlessly
      const y = h * (base - amp * (0.6 * Math.sin(t * waves) + 0.4 * Math.sin(t * (waves * 2 + 1) + 1.3)));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function Environment() {
  const skyUniforms = useMemo(() => ({
    top: { value: new Color('#6f8fbf') },
    horizon: { value: new Color('#e8d9c6') },
    bottom: { value: new Color('#b9b2aa') },
  }), []);
  const floor = useMemo(floorTexture, []);
  const hills = useMemo(hillsTexture, []);
  useEffect(() => () => {
    floor.dispose();
    hills.dispose();
  }, [floor, hills]);
  return (
    <group>
      <mesh renderOrder={-10}>
        <sphereGeometry args={[60, 32, 16]} />
        <shaderMaterial side={BackSide} depthWrite={false} uniforms={skyUniforms} vertexShader={SKY_VERTEX} fragmentShader={SKY_FRAGMENT} />
      </mesh>
      <mesh position={[0, 6, 0]} renderOrder={-9}>
        <cylinderGeometry args={[40, 40, 12, 64, 1, true]} />
        <meshBasicMaterial map={hills} transparent side={DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[12, 64]} />
        <meshBasicMaterial map={floor} toneMapped={false} />
      </mesh>
    </group>
  );
}
