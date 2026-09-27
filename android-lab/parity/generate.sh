#!/usr/bin/env bash
# Regenerate the parity fixtures from the web app's TypeScript.
# Needs the repo's node_modules (npm ci at the root).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="${1:-$root/android-lab/core/build/parity}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
"$root/node_modules/.bin/esbuild" "$here/generate-fixtures.ts" --bundle --platform=node --format=esm \
  --outfile="$tmp/generate.mjs" --log-level=warning
TZ=UTC node "$tmp/generate.mjs" "$out"
