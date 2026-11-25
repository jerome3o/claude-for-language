/**
 * World lighting presets (docs/VR_WORLDS.md "Performance budget"): a hemisphere fill, ONE shadow-casting
 * directional light (1024² map fitted to the play area) and an environment map generated in code
 * (three's RoomEnvironment through PMREM — reflections for metal / glass / ceramic, no HDR download).
 * A world may add a couple of small point lights of its own (lamps), no more.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Color, PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type LightingPreset = 'indoor_day' | 'indoor_warm' | 'indoor_hall' | 'outdoor_day' | 'outdoor_evening';

interface PresetDef {
  background: string;
  sky: string;
  ground: string;
  hemi: number;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  env: number;
  exposure: number;
  fog?: [string, number, number];
}

const PRESETS: Record<LightingPreset, PresetDef> = {
  indoor_day: { background: '#d9e6f2', sky: '#f4f1ea', ground: '#8a7a68', hemi: 1.1, sun: '#fff1dc', sunIntensity: 2.2, sunDir: [2.5, 4, 3], env: 0.55, exposure: 1.05 },
  indoor_warm: { background: '#2a2320', sky: '#ffe3c2', ground: '#4a3a2e', hemi: 0.8, sun: '#ffd7a8', sunIntensity: 1.5, sunDir: [-1.5, 4, 2], env: 0.45, exposure: 1.0 },
  indoor_hall: { background: '#dfe6ec', sky: '#f6f8fa', ground: '#9aa0a6', hemi: 1.3, sun: '#ffffff', sunIntensity: 1.6, sunDir: [3, 6, 2], env: 0.7, exposure: 1.05 },
  outdoor_day: { background: '#a9cdec', sky: '#cfe6ff', ground: '#8f8a7a', hemi: 1.0, sun: '#fff4e0', sunIntensity: 3.2, sunDir: [6, 9, 4], env: 0.6, exposure: 1.0, fog: ['#c7dced', 25, 70] },
  outdoor_evening: { background: '#f2b48a', sky: '#ffd2a8', ground: '#5a4a52', hemi: 0.7, sun: '#ffb37a', sunIntensity: 2.0, sunDir: [-8, 3.5, -2], env: 0.45, exposure: 1.0, fog: ['#e9a98a', 20, 60] },
};

/** The shadow camera covers `shadowArea` metres around the origin: centre your world on (0, 0). */
export function WorldLighting({ preset, shadowArea = 8 }: { preset: LightingPreset; shadowArea?: number }) {
  const p = PRESETS[preset];
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = p.env;
    scene.background = new Color(p.background);
    gl.toneMappingExposure = p.exposure;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, p]);
  const half = shadowArea / 2;
  return (
    <>
      <hemisphereLight args={[p.sky, p.ground, p.hemi]} />
      <directionalLight
        color={p.sun}
        intensity={p.sunIntensity}
        position={p.sunDir}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {p.fog && <fog attach="fog" args={p.fog} />}
    </>
  );
}
