import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

// One app per build (vite-plugin-singlefile is single-entry): scripts/build-apps.mjs
// runs this once per app with APP_ROOT (the app's directory, holding index.html)
// and APP_OUT (its dist folder). Defaults build the original study app.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, 'src/ui');
const appOut = process.env.APP_OUT || path.resolve(__dirname, 'dist/study');

export default defineConfig({
  root: appRoot,
  plugins: [viteSingleFile()],
  build: {
    outDir: appOut,
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild',
  },
});
