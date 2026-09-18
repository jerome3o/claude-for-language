/**
 * Lazy, memoised sql.js (SQLite → WASM) initialisation for the browser.
 * The .wasm is emitted as a hashed asset by Vite and precached by the PWA
 * service worker, so exports keep working offline.
 */

import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let promise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!promise) {
    promise = initSqlJs({ locateFile: () => wasmUrl }).catch(err => {
      promise = null;
      throw err;
    });
  }
  return promise;
}
