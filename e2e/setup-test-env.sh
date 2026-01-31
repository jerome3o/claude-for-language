#!/bin/bash
# Setup script for E2E test environment
# Creates worker/.dev.vars with test configuration

set -e

WORKER_DIR="${1:-../worker}"

cat > "$WORKER_DIR/.dev.vars" << EOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-test-key}
GOOGLE_TTS_API_KEY=${GOOGLE_TTS_API_KEY:-test-key}
MINIMAX_API_KEY=${MINIMAX_API_KEY:-test-key}
GEMINI_API_KEY=${GEMINI_API_KEY:-test-key}
GOOGLE_CLIENT_ID=test-client-id
GOOGLE_CLIENT_SECRET=test-client-secret
SESSION_SECRET=test-session-secret
ADMIN_EMAIL=admin@test.e2e
E2E_TEST_MODE=true
EOF

echo "Created $WORKER_DIR/.dev.vars with E2E test configuration"
