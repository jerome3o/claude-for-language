#!/usr/bin/env node
/**
 * Builds every MCP App UI as a single self-contained HTML file and embeds
 * them all into src/app-html.ts.
 *
 * Apps:
 *   study  -> src/ui/index.html            (the original flashcard app)
 *   <name> -> src/ui/apps/<name>/index.html
 *
 * vite-plugin-singlefile only supports one entry per build, so each app is a
 * separate `vite build` (APP_ROOT / APP_OUT env vars are read by
 * vite.config.ts) and the results are concatenated by embed-html.js.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const uiDir = join(root, 'src', 'ui');
const appsDir = join(uiDir, 'apps');
const distDir = join(root, 'dist');

const apps = [{ name: 'study', dir: uiDir }];
if (existsSync(appsDir)) {
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    if (!existsSync(join(appsDir, entry.name, 'index.html'))) continue;
    apps.push({ name: entry.name, dir: join(appsDir, entry.name) });
  }
}

rmSync(distDir, { recursive: true, force: true });
for (const app of apps) {
  console.log(`\n▶ Building app "${app.name}" (${app.dir})`);
  execSync('npx vite build', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, APP_ROOT: app.dir, APP_OUT: join(distDir, app.name) },
  });
}

execSync(`node ${join(__dirname, 'embed-html.js')} ${apps.map((a) => a.name).join(' ')}`, {
  cwd: root,
  stdio: 'inherit',
});
