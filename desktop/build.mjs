// Bundles the desktop app with esbuild into dist/: the main process, the three
// preloads (CommonJS, `electron` left external) and the two small pages
// (overlay, share picker). The overlay reuses the web app's drawing code
// (frontend/src/services/calls/annotations.ts) and the shared rules (shared/).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const alias = { '@shared': path.resolve(here, '../shared') };
const common = { bundle: true, sourcemap: 'linked', logLevel: 'warning', alias, absWorkingDir: here };

const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] };
const page = { ...common, platform: 'browser', format: 'iife', target: 'chrome130' };

await Promise.all([
  build({ ...node, entryPoints: ['src/main.ts'], outfile: 'dist/main.js' }),
  build({ ...node, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js' }),
  build({ ...node, entryPoints: ['src/overlay/preload.ts'], outfile: 'dist/overlay-preload.js' }),
  build({ ...node, entryPoints: ['src/picker/preload.ts'], outfile: 'dist/picker-preload.js' }),
  build({ ...page, entryPoints: ['src/overlay/renderer.ts'], outfile: 'dist/overlay.js' }),
  build({ ...page, entryPoints: ['src/picker/renderer.ts'], outfile: 'dist/picker.js' }),
]);
console.log('desktop: built dist/');
