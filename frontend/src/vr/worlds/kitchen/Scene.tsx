/**
 * The kitchen's static world: the room (tiled floor, warm walls, a ceiling), the tiled splashback, wall
 * cupboards, a spice shelf, a door with 福 and a 厨房 sign, a rug, a plant on the windowsill — and the
 * `<Solid>` colliders for what things should bump into. Everything with a Chinese name to learn is an
 * OBJECT instead (index.tsx), with its own collider.
 *
 * Room: x −2.5 … 2.5, z −2.25 … 2.25, 2.7 m high; the counter runs along the back wall (−z), the fridge
 * in the back-right corner, the table in the middle-left, the door on the front wall (+z).
 */
import { Box, Plant, Room, RBox, Rug, Shelf, Sign, Solid, WallCabinet, mat } from '../kit';

export function KitchenScene() {
  return (
    <group>
      <Room
        size={[5, 4.5]}
        height={2.7}
        floor={mat('tile', '#e3ddd1', { tiles: 4, grout: '#bdb5a6', repeat: [5, 4.5] })}
        wall={mat('plaster', '#f2e8d8', { repeat: [4, 2] })}
        ceiling={mat('plaster', '#fbf8f2')}
        skirting="#d8cbb5"
      />
      {/* splashback tiles behind the counter, under the window and the cupboards */}
      <mesh position={[-0.5, 1.05, -2.245]} receiveShadow material={mat('tile', '#dfeef0', { tiles: 6, grout: '#c4d4d6', repeat: [13, 1] })}>
        <planeGeometry args={[3.9, 0.3]} />
      </mesh>
      {/* wall cupboards (left of the window) and a cooker hood over the hob */}
      <WallCabinet size={[1.3, 0.7, 0.34]} position={[-1.75, 1.95, -2.08]} color="#f1ece2" />
      <Solid size={[1.3, 0.7, 0.34]} at={[-1.75, 1.95, -2.08]} />
      <RBox size={[0.62, 0.12, 0.45]} radius={0.01} position={[-1.6, 1.55, -2.03]} material={mat('steel', '#c8cdd3', { roughness: 0.3 })} />
      <Box size={[0.24, 0.5, 0.24]} position={[-1.6, 1.85, -2.13]} material={mat('steel', '#c8cdd3', { roughness: 0.3 })} cast={false} />
      <Solid size={[0.62, 0.12, 0.45]} at={[-1.6, 1.55, -2.03]} />
      {/* a spice shelf on the right wall (the jars on it are objects) */}
      <Shelf size={[0.9, 0.5, 0.24]} shelves={2} position={[2.36, 1.35, -0.45]} rotation={[0, -Math.PI / 2, 0]} color="#b98a5a" />
      <Solid size={[0.24, 0.02, 0.9]} at={[2.36, 1.11, -0.45]} />
      <Solid size={[0.24, 0.02, 0.9]} at={[2.36, 1.35, -0.45]} />
      <Solid size={[0.24, 0.02, 0.9]} at={[2.36, 1.59, -0.45]} />
      {/* the door on the front wall, 福 upside down (福到了: luck has arrived) and a 厨房 sign over it */}
      <group position={[1.2, 0, 2.24]} rotation={[0, Math.PI, 0]}>
        <RBox size={[0.9, 2.05, 0.05]} radius={0.01} position={[0, 1.025, 0]} material={mat('wood', '#8a5a36')} />
        <Box size={[0.98, 0.06, 0.06]} position={[0, 2.08, -0.005]} material={mat('painted', '#e7dcc9')} cast={false} />
        <Box size={[0.04, 0.12, 0.05]} position={[0.36, 1.0, 0.04]} material={mat('chrome')} />
        <group position={[0, 1.45, 0.03]} rotation={[0, 0, Math.PI]}>
          <Sign text="福" size={[0.34, 0.34]} bg="#c8102e" fg="#ffd35c" />
        </group>
        <Sign text="厨房" size={[0.6, 0.2]} bg="#7a2121" fg="#ffe7a8" position={[0, 2.3, 0.01]} frame="#4a2a14" />
      </group>
      {/* a rug under the table, a plant on the windowsill */}
      <Rug size={[2.0, 1.5]} position={[-0.7, 0, 0.1]} color="#9b4c3a" border="#e9d5ae" />
      <Plant height={0.32} position={[-0.02, 1.41, -2.16]} pot="#3f7f8f" />
      {/* a calendar beside the door: 日历 in red */}
      <Sign text="十一月" size={[0.3, 0.12]} bg="#ffffff" fg="#c8102e" position={[2.2, 1.6, 2.24]} rotation={[0, Math.PI, 0]} />
    </group>
  );
}
