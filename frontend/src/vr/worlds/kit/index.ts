/**
 * The VR worlds helper library (docs/VR_WORLDS.md "The helper library"): everything a world folder
 * needs to build its room and objects from code.
 */
export { mat, type MatPreset, type MatOptions } from './materials';
export { Box, RBox, Cyl, Ball, Lathe, cupProfile, bowlProfile, plateProfile, bottleProfile, potProfile, type PrimitiveProps } from './shapes';
export { Table, Chair, Counter, WallCabinet, Shelf, WindowPane, PendantLamp, Plant, Rug, Sign, WallClock, Room } from './furniture';
export { Solid, SolidCylinder, FloorCollider } from './colliders';
export { WorldLighting, type LightingPreset } from './lighting';
export { woodTexture, tileTexture, checkerTexture, plankTexture, noiseTexture, stripeTexture, labelTexture, signTexture, seeded } from './textures';
