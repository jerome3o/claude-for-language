import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
/**
 * Stroke-order data for handwriting practice (docs/STROKE_ORDER.md).
 * hanzi-writer-data ships one JSON per character, named by the character
 * itself; we serve them as /strokes/<code point in hex>.json (ASCII URLs), with
 * the Arphic Public License beside them as the licence requires. Not precached
 * by the service worker — the app fetches a character when it is first written
 * and keeps it in IndexedDB (services/strokeData.ts).
 */
function strokeDataPlugin() {
    var dataDir;
    var findDataDir = function () {
        if (dataDir !== undefined)
            return dataDir;
        try {
            dataDir = path.dirname(createRequire(import.meta.url).resolve('hanzi-writer-data/package.json'));
        }
        catch (_a) {
            dataDir = null;
        }
        return dataDir;
    };
    var sourceFor = function (dir, name) {
        if (name === 'ARPHICPL.TXT')
            return path.join(dir, name);
        var m = /^([0-9a-f]{2,6})\.json$/.exec(name);
        if (!m)
            return null;
        return path.join(dir, "".concat(String.fromCodePoint(parseInt(m[1], 16)), ".json"));
    };
    var outDir = 'dist';
    return {
        name: 'stroke-data',
        configResolved: function (config) {
            outDir = path.resolve(config.root, config.build.outDir);
        },
        configureServer: function (server) {
            server.middlewares.use('/strokes/', function (req, res) {
                var dir = findDataDir();
                var name = (req.url || '').replace(/^\//, '').split('?')[0];
                var file = dir ? sourceFor(dir, name) : null;
                if (!file || !fs.existsSync(file)) {
                    res.statusCode = 404;
                    res.end('not found');
                    return;
                }
                res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8');
                fs.createReadStream(file).pipe(res);
            });
        },
        writeBundle: function () {
            var _a;
            var dir = findDataDir();
            if (!dir) {
                this.warn('hanzi-writer-data is not installed — handwriting practice will have no stroke data');
                return;
            }
            var out = path.join(outDir, 'strokes');
            fs.mkdirSync(out, { recursive: true });
            var count = 0;
            for (var _i = 0, _b = fs.readdirSync(dir); _i < _b.length; _i++) {
                var f = _b[_i];
                if (!f.endsWith('.json') || f === 'package.json')
                    continue;
                var ch = f.slice(0, -5);
                var cp = ch.codePointAt(0);
                if (cp === undefined || String.fromCodePoint(cp) !== ch)
                    continue;
                fs.copyFileSync(path.join(dir, f), path.join(out, "".concat(cp.toString(16), ".json")));
                count++;
            }
            fs.copyFileSync(path.join(dir, 'ARPHICPL.TXT'), path.join(out, 'ARPHICPL.TXT'));
            (_a = this.info) === null || _a === void 0 ? void 0 : _a.call(this, "stroke data: ".concat(count, " characters \u2192 ").concat(path.relative(process.cwd(), out)));
        },
    };
}
export default defineConfig({
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, '../shared'),
        },
    },
    define: {
        'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
    },
    plugins: [
        react(),
        strokeDataPlugin(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'apple-touch-icon.svg', 'icon-192.svg', 'icon-512.svg'],
            manifest: false, // Use manifest.json in public folder
            workbox: {
                // .wasm is sql.js (SQLite) for the Anki export — precached so it works offline
                globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
                runtimeCaching: [
                    {
                        // API calls - network first with 10s timeout, fallback to cache
                        urlPattern: /^.*\/api\/(?!audio).*/i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-cache',
                            networkTimeoutSeconds: 10,
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    {
                        // Audio files - cache first, 30-day expiry
                        urlPattern: /^.*\/api\/audio\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'audio-cache',
                            expiration: {
                                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                                maxEntries: 500,
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                ],
            },
        }),
    ],
    server: {
        port: 3000,
        allowedHosts: true,
        proxy: {
            '/api': {
                target: 'http://localhost:8787',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-query': ['@tanstack/react-query'],
                    'vendor-markdown': ['react-markdown'],
                    'vendor-pinyin': ['pinyin-pro'],
                    'vendor-dexie': ['dexie', 'dexie-react-hooks'],
                },
            },
        },
    },
});
